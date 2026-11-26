import { getSupabase } from "@/lib/supabaseClient";

export async function aiRequestHeaders(expectedUserId?: string) {
  const supabase = getSupabase();
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  const token = data.session?.access_token;
  if (expectedUserId && data.session?.user.id !== expectedUserId) throw new Error("账号已变化，请确认后再继续。");
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}
