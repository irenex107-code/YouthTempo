import type { NextApiRequest } from "next";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function getLegacyJwtRole(key: string) {
  const parts = key.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(payload) as { role?: string };
    return parsed.role || null;
  } catch {
    return null;
  }
}

function assertSupabaseServerConfig() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server credentials are not configured.");
  }

  if (serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error("服务端环境变量 SUPABASE_SERVICE_ROLE_KEY 不能使用 publishable key，请改填 Supabase API Keys 中的 sb_secret_ 密钥或旧版 service_role key。");
  }

  const role = getLegacyJwtRole(serviceRoleKey);
  if (role && role !== "service_role") {
    throw new Error("服务端环境变量 SUPABASE_SERVICE_ROLE_KEY 现在不是 service_role key，请不要填 anon key，需改填 sb_secret_ 密钥或旧版 service_role key。");
  }
}

export function getSupabaseAdmin() {
  assertSupabaseServerConfig();

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getAuthenticatedUser(req: NextApiRequest) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error) throw error;
  return data.user;
}
