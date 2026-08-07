import { createHmac, randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportOperationalError } from "@/lib/operationalMonitoring";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

type RateLimitRule = {
  action: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
};

const aiClientCookie = "yt_ai_client";
const aiClientLimit = 20;
const aiIpLimit = 120;
const aiWindowSeconds = 10 * 60;

function identifierHash(identifier: string) {
  const secret = process.env.RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Rate limit secret is not configured.");
  return createHmac("sha256", secret).update(identifier).digest("hex");
}

function clientIp(req: NextApiRequest) {
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded.join(",") : forwarded || "";
  const forwardedIps = forwardedValue.split(",").map((value) => value.trim()).filter(Boolean);
  return forwardedIps.at(-1) || req.socket.remoteAddress || "unknown";
}

function aiClientId(req: NextApiRequest, res: NextApiResponse) {
  const existing = req.cookies[aiClientCookie];
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const created = randomUUID();
  const cookie = `${aiClientCookie}=${created}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`;
  const current = res.getHeader("Set-Cookie");
  const next = Array.isArray(current) ? [...current, cookie] : current ? [String(current), cookie] : cookie;
  res.setHeader("Set-Cookie", next);
  return created;
}

async function consumeRateLimit(supabase: SupabaseClient, rule: RateLimitRule): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_identifier_hash: identifierHash(rule.identifier),
    p_action: rule.action,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== "boolean" || typeof row.remaining !== "number" || !row.reset_at) {
    throw new Error("Rate limit service returned an invalid result.");
  }
  return { allowed: row.allowed, remaining: row.remaining, resetAt: new Date(row.reset_at) };
}

function applyHeaders(
  res: NextApiResponse,
  result: RateLimitResult,
  limit: number,
  windowSeconds: number,
) {
  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(result.remaining));
  res.setHeader("RateLimit-Reset", String(retryAfterSeconds));
  res.setHeader("RateLimit-Policy", `${limit};w=${windowSeconds}`);
  return retryAfterSeconds;
}

export async function enforceUserRateLimit({
  supabase,
  req,
  userId,
  action,
  limit,
  windowSeconds,
  res,
  message,
  area = "save",
  unavailableMessage = "服务暂时不可用，请稍后再试。",
}: {
  supabase: SupabaseClient;
  req: NextApiRequest;
  userId: string;
  action: string;
  limit: number;
  windowSeconds: number;
  res: NextApiResponse;
  message: string;
  area?: "auth" | "save" | "ai" | "community";
  unavailableMessage?: string;
}) {
  try {
    const result = await consumeRateLimit(supabase, {
      identifier: `user:${userId}`,
      action,
      limit,
      windowSeconds,
    });
    const retryAfterSeconds = applyHeaders(res, result, limit, windowSeconds);
    if (result.allowed) return true;
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ error: message, rateLimited: true, retryAfterSeconds });
    return false;
  } catch (error) {
    await reportOperationalError({
      req,
      area,
      operation: `${action}_rate_limit`,
      error,
      statusCode: 503,
    });
    res.status(503).json({ error: unavailableMessage });
    return false;
  }
}

export async function enforceAiRateLimit(
  req: NextApiRequest,
  res: NextApiResponse,
  supabase: SupabaseClient,
) {
  const clientId = aiClientId(req, res);
  const clientResult = await consumeRateLimit(supabase, {
    identifier: `ai-client:${clientId}`,
    action: "ai_generate_client",
    limit: aiClientLimit,
    windowSeconds: aiWindowSeconds,
  });
  const ipResult = clientResult.allowed
    ? await consumeRateLimit(supabase, {
        identifier: `ai-ip:${clientIp(req)}`,
        action: "ai_generate_ip",
        limit: aiIpLimit,
        windowSeconds: aiWindowSeconds,
      })
    : null;
  const effectiveResult = ipResult || clientResult;
  const effectiveLimit = ipResult ? aiIpLimit : aiClientLimit;
  const retryAfterSeconds = applyHeaders(res, effectiveResult, effectiveLimit, aiWindowSeconds);
  if (clientResult.allowed && ipResult?.allowed) return true;
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: "生成得有些频繁，请稍等一会儿再试。你刚才填写的内容仍保留在当前页面。",
    rateLimited: true,
    retryAfterSeconds,
  });
  return false;
}
