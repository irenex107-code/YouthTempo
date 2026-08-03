import type { FailureKind, MonitoredArea, MonitoredClientOperation } from "@/lib/monitoringTypes";

function classifyClientFailure(error: unknown): FailureKind {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  const name = error instanceof Error ? error.name : "";
  if (["AbortError", "TimeoutError"].includes(name) || message.includes("超时") || message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("fetch") || message.includes("network") || message.includes("网络")) return "network";
  if (message.includes("invalid") || message.includes("expired") || message.includes("验证码") || message.includes("otp")) {
    return "invalid_or_expired";
  }
  if (message.includes("permission") || message.includes("row-level security") || message.includes("42501")) {
    return "permission_denied";
  }
  if (message.includes("429") || message.includes("rate limit") || message.includes("频繁")) return "rate_limited";
  if (message.includes("503") || message.includes("unavailable") || message.includes("暂时不可用")) {
    return "service_unavailable";
  }
  return "unexpected";
}

export function reportClientOperationFailure(
  area: MonitoredArea,
  operation: MonitoredClientOperation,
  error: unknown,
) {
  if (typeof window === "undefined") return;
  const failureKind = classifyClientFailure(error);
  // Invalid or expired OTPs are normal user input outcomes, not operational incidents.
  if (failureKind === "invalid_or_expired") return;
  void fetch("/api/monitoring/client-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area, operation, failureKind }),
    keepalive: true,
  }).catch(() => undefined);
}
