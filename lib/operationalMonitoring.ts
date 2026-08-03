import { createHash, randomUUID } from "node:crypto";
import type { NextApiRequest } from "next";
import type { FailureKind, MonitoredArea } from "@/lib/monitoringTypes";

type ErrorWithCode = Error & { code?: unknown; status?: unknown; statusCode?: unknown };

function requestId(req: NextApiRequest) {
  const candidate = req.headers["x-request-id"] || req.headers["x-vercel-id"];
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  return typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,128}$/.test(value) ? value : randomUUID();
}

function safeErrorCode(error: unknown) {
  const code = error && typeof error === "object" ? (error as ErrorWithCode).code : undefined;
  return typeof code === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(code) ? code : undefined;
}

function safeErrorName(error: unknown) {
  const name = error instanceof Error ? error.name : undefined;
  return typeof name === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(name) ? name : undefined;
}

export function classifyServerFailure(error: unknown): FailureKind {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const name = error instanceof Error ? error.name : "";
  if (["AbortError", "TimeoutError"].includes(name) || message.includes("timeout")) return "timeout";
  if (message.includes("fetch") || message.includes("network")) return "network";
  if (message.includes("permission") || message.includes("row-level security") || safeErrorCode(error) === "42501") {
    return "permission_denied";
  }
  const status = error && typeof error === "object"
    ? Number((error as ErrorWithCode).statusCode || (error as ErrorWithCode).status)
    : 0;
  if (status === 429) return "rate_limited";
  if (status === 503 || message.includes("unavailable")) return "service_unavailable";
  return "unexpected";
}

export function reportOperationalError({
  req,
  area,
  operation,
  error,
  statusCode = 500,
  durationMs,
  failureKind = classifyServerFailure(error),
}: {
  req: NextApiRequest;
  area: MonitoredArea;
  operation: string;
  error?: unknown;
  statusCode?: number;
  durationMs?: number;
  failureKind?: FailureKind;
}) {
  const event = {
    timestamp: new Date().toISOString(),
    level: "error",
    event: "operation_failed",
    area,
    operation,
    failureKind,
    statusCode,
    requestId: requestId(req),
    errorName: safeErrorName(error),
    errorCode: safeErrorCode(error),
    durationMs: typeof durationMs === "number" ? Math.max(0, Math.round(durationMs)) : undefined,
  };

  console.error(JSON.stringify(event));

  const webhookUrl = process.env.ERROR_MONITOR_WEBHOOK_URL;
  if (!webhookUrl) return;
  void (async () => {
    const parsedWebhookUrl = new URL(webhookUrl);
    if (parsedWebhookUrl.protocol !== "https:") throw new Error("Monitoring webhook must use HTTPS.");
    const response = await fetch(parsedWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.ERROR_MONITOR_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${process.env.ERROR_MONITOR_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error("Monitoring webhook rejected the event.");
  })().catch(() => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "monitor_delivery_failed",
      area,
      operation,
      requestId: event.requestId,
    }));
  });
}

export function anonymousRequestHash(req: NextApiRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = (Array.isArray(forwarded) ? forwarded.at(-1) : forwarded?.split(",").at(-1))
    || req.socket.remoteAddress
    || "unknown";
  return createHash("sha256").update(raw.trim()).digest("hex");
}
