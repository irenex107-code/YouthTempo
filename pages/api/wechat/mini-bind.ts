import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { exchangeWechatCode } from "@/lib/wechatMini";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { code, scene } = req.body || {};
    if (typeof code !== "string" || typeof scene !== "string" || !code || !scene) {
      return res.status(400).json({ error: "缺少微信 code 或绑定 scene。" });
    }

    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from("wechat_bind_sessions")
      .select("id,user_id,status,expires_at")
      .eq("scene", scene)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session || session.status !== "pending") return res.status(404).json({ error: "绑定会话不存在或已经处理。" });
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await supabase.from("wechat_bind_sessions").update({ status: "expired" }).eq("id", session.id);
      return res.status(410).json({ error: "绑定二维码已过期，请在网页重新生成。" });
    }

    const { openid, unionid } = await exchangeWechatCode(code);
    const { data: existingIdentity, error: identityLookupError } = await supabase
      .from("wechat_identities")
      .select("user_id")
      .eq("openid", openid)
      .maybeSingle();
    if (identityLookupError) throw identityLookupError;
    if (existingIdentity && existingIdentity.user_id !== session.user_id) {
      return res.status(409).json({ error: "这个微信已经绑定到另一个账户。" });
    }

    if (existingIdentity) {
      const { error } = await supabase
        .from("wechat_identities")
        .update({ unionid, updated_at: new Date().toISOString() })
        .eq("openid", openid)
        .eq("user_id", session.user_id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("wechat_identities").insert({
        user_id: session.user_id,
        openid,
        unionid,
      });
      if (error) throw error;
    }

    const { error: updateError } = await supabase
      .from("wechat_bind_sessions")
      .update({
        status: "confirmed",
        openid,
        unionid,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (updateError) throw updateError;

    return res.status(200).json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信绑定失败。";
    return res.status(500).json({ error: message });
  }
}
