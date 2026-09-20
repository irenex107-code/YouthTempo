import { getSupabase } from "@/lib/supabaseClient";
import type { Locale } from "@/lib/i18n/config";

export type PeerRoomSummary = {
  id: string;
  code: string;
  title: string;
  description: string;
  guidelines: string;
  status: "staffed_open" | "read_only" | "paused" | "closed";
  joined: boolean;
};

export type PeerChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  authorLabel: string;
  own: boolean;
  status: "visible" | "safety_review";
};

export class PeerSpaceRequestError extends Error {
  constructor(message: string, public readonly urgent: boolean) {
    super(message);
  }
}

export async function peerSpaceRequest<T>(
  path: string,
  locale: Locale,
  method = "GET",
  body?: Record<string, unknown>,
): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error(locale === "en" ? "Account service is unavailable." : "账号服务暂时不可用。");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(locale === "en" ? "Please sign in again." : "请重新登录。");
  if (!data.session?.access_token) throw new Error(locale === "en" ? "Please sign in first." : "请先登录。");
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${separator}locale=${encodeURIComponent(locale)}`, {
    method,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify({ ...body, locale }) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; urgent?: boolean };
  if (!response.ok) throw new PeerSpaceRequestError(
    payload.error || (locale === "en" ? "Please try again later." : "请稍后再试。"),
    payload.urgent === true,
  );
  return payload as T;
}
