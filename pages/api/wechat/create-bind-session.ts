import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { createWechatMiniCode, isWechatConfigured } from "@/lib/wechatMini";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录，再绑定微信。" });
    if (!isWechatConfigured()) return res.status(500).json({ error: "微信小程序环境变量还没有配置完成。" });

    const supabase = getSupabaseAdmin();
    const scene = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase.from("wechat_bind_sessions").insert({
      user_id: user.id,
      scene,
      status: "pending",
      expires_at: expiresAt,
    });
    if (error) throw error;

    const qrCodeDataUrl = await createWechatMiniCode(scene);
    return res.status(200).json({ scene, expiresAt, qrCodeDataUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信绑定会话创建失败。";
    return res.status(500).json({ error: message });
  }
}
