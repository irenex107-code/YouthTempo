import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录。" });
    const postId = typeof req.body?.postId === "string" ? req.body.postId.trim() : null;
    const commentId = typeof req.body?.commentId === "string" ? req.body.commentId.trim() : null;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if ((!postId && !commentId) || (postId && commentId)) {
      return res.status(400).json({ error: "请选择要举报的内容。" });
    }
    if (!reason) return res.status(400).json({ error: "请简单说明原因。" });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("community_reports").insert({
      reporter_user_id: user.id,
      post_id: postId,
      comment_id: commentId,
      reason: reason.slice(0, 500),
    });
    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "举报暂时无法提交。";
    return res.status(500).json({ error: message });
  }
}
