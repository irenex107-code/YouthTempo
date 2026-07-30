import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { getCommunityIdentity } from "@/lib/community";
import { moderateCommunityContent } from "@/lib/messageSafety";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录，再参与讨论。" });
    const supabase = getSupabaseAdmin();
    const identity = await getCommunityIdentity(supabase, user);
    const postId = typeof req.body?.postId === "string" ? req.body.postId.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!postId || !body) return res.status(400).json({ error: "请先写下回复。" });
    if (body.length > 1200) return res.status(400).json({ error: "回复请控制在 1200 字以内。" });

    const { data: post, error: postError } = await supabase
      .from("community_posts")
      .select("author_user_id,viewer_roles,commenter_roles,moderation_status")
      .eq("id", postId)
      .maybeSingle();
    if (postError) throw postError;
    if (
      !post ||
      post.moderation_status !== "published" ||
      (post.author_user_id !== user.id && !post.viewer_roles.includes(identity.role))
    ) return res.status(404).json({ error: "这条内容不存在，或你没有查看权限。" });
    if (!post.commenter_roles.includes(identity.role)) {
      return res.status(403).json({ error: "发布者没有向你的身份开放评论。" });
    }

    const moderation = moderateCommunityContent(body);
    if (moderation.status === "blocked") {
      return res.status(422).json({ error: moderation.reason, blocked: true });
    }
    const { data: comment, error } = await supabase
      .from("community_comments")
      .insert({
        post_id: postId,
        author_user_id: user.id,
        author_role: identity.role,
        body,
        moderation_status: moderation.status,
        moderation_reason: moderation.reason,
      })
      .select("id,moderation_status")
      .single();
    if (error) throw error;
    return res.status(moderation.status === "safety_review" ? 202 : 201).json({
      comment,
      safetyNotice: moderation.status === "safety_review",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "回复暂时无法发送。";
    return res.status(500).json({ error: message });
  }
}
