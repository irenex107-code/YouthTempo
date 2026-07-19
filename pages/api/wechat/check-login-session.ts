import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

// 免登录：网页轮询扫码登录会话状态。未登录访客也能查（只凭 scene）。
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const scene = String(req.query.scene || "");
    if (!scene) return res.status(400).json({ error: "缺少登录会话 scene。" });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("wechat_login_sessions")
      .select("scene,status,expires_at,confirmed_at")
      .eq("scene", scene)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "登录会话不存在或已失效。" });

    if (data.status === "pending" && new Date(data.expires_at).getTime() < Date.now()) {
      await supabase.from("wechat_login_sessions").update({ status: "expired" }).eq("scene", scene);
      return res.status(200).json({ status: "expired", authenticated: false });
    }

    // TODO(小程序接入后补全)：status === 'confirmed' 时，这里需要把 mini-login 生成的
    // 一次性登录凭证（email + otp token，来自 supabase.auth.admin.generateLink）返回给前端，
    // 前端再用 verifyOtp 建立会话。当前骨架阶段仅返回状态，网页会一直等待。
    return res.status(200).json({
      status: data.status,
      authenticated: data.status === "confirmed",
      confirmedAt: data.confirmed_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信登录状态检查失败。";
    return res.status(500).json({ error: message });
  }
}
