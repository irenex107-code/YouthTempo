import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { exchangeWechatCode } from "@/lib/wechatMini";

// 小程序回调：用 wx.login 拿到的 code 换 openid，查找该微信已关联的账户，
// 确认扫码登录会话。真正的登录凭证签发待小程序完善后补全（见下方 TODO）。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { code, scene } = req.body || {};
    if (typeof code !== "string" || typeof scene !== "string" || !code || !scene) {
      return res.status(400).json({ error: "缺少微信 code 或登录 scene。" });
    }

    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from("wechat_login_sessions")
      .select("id,status,expires_at")
      .eq("scene", scene)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session || session.status !== "pending") return res.status(404).json({ error: "登录会话不存在或已经处理。" });
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await supabase.from("wechat_login_sessions").update({ status: "expired" }).eq("id", session.id);
      return res.status(410).json({ error: "登录二维码已过期，请在网页重新生成。" });
    }

    const { openid, unionid } = await exchangeWechatCode(code);

    // 查这个微信是否已经绑定过某个账户；第一版只允许已注册微信登录。
    const { data: identity, error: identityError } = await supabase
      .from("wechat_identities")
      .select("user_id")
      .eq("openid", openid)
      .maybeSingle();
    if (identityError) throw identityError;
    if (!identity) {
      return res.status(404).json({ error: "这个微信还没有绑定账户，请先用邮箱登录后在账户页绑定微信。" });
    }

    // TODO(小程序接入后补全)：为 identity.user_id 生成一次性登录凭证。推荐：
    //   const { data: userRow } = await supabase.auth.admin.getUserById(identity.user_id);
    //   const { data: link } = await supabase.auth.admin.generateLink({ type: 'magiclink', email: userRow.user.email });
    //   把 link 里的 email + token(otp) 写入本会话，供 check-login-session 返回、网页 verifyOtp 使用。
    // 当前骨架阶段仅把会话标记为 confirmed 并回填 user_id/openid，暂不签发凭证。
    const { error: updateError } = await supabase
      .from("wechat_login_sessions")
      .update({
        status: "confirmed",
        user_id: identity.user_id,
        openid,
        unionid,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (updateError) throw updateError;

    return res.status(200).json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信登录失败。";
    return res.status(500).json({ error: message });
  }
}
