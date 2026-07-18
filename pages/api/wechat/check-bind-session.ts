import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录，再查看微信绑定状态。" });

    const scene = String(req.query.scene || "");
    if (!scene) return res.status(400).json({ error: "缺少绑定会话 scene。" });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("wechat_bind_sessions")
      .select("scene,status,expires_at,confirmed_at")
      .eq("scene", scene)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "绑定会话不存在或已失效。" });

    if (data.status === "pending" && new Date(data.expires_at).getTime() < Date.now()) {
      await supabase.from("wechat_bind_sessions").update({ status: "expired" }).eq("scene", scene).eq("user_id", user.id);
      return res.status(200).json({ status: "expired", bound: false });
    }

    return res.status(200).json({ status: data.status, bound: data.status === "confirmed", confirmedAt: data.confirmed_at });
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信绑定状态检查失败。";
    return res.status(500).json({ error: message });
  }
}
