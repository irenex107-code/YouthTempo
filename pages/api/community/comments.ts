import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { getActiveCommunityMute, getCommunityBlockedUserIds, getCommunityIdentity } from "@/lib/community";
import { moderateCommunityContent } from "@/lib/messageSafety";
import { enforceUserRateLimit } from "@/lib/rateLimit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["POST", "DELETE"].includes(req.method || "")) {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录，再参与讨论。" });
    const supabase = getSupabaseAdmin();
    const identity = await getCommunityIdentity(supabase, user);

    if (req.method === "DELETE") {
      const commentId = typeof req.body?.commentId === "string" ? req.body.commentId.trim() : "";
      if (!commentId) return res.status(400).json({ error: "请选择要删除的评论。" });
      const { data: comment, error: commentError } = await supabase
        .from("community_comments")
        .select("id,author_user_id,moderation_status")
        .eq("id", commentId)
        .maybeSingle();
      if (commentError) throw commentError;
      if (!comment || comment.moderation_status === "removed") {
        return res.status(404).json({ error: "这条评论已经不存在。" });
      }
      const email = (user.email || "").trim().toLowerCase();
      const { data: platformAdmin, error: adminError } = email
        ? await supabase.from("admin_roles").select("id").eq("email", email).eq("status", "active").maybeSingle()
        : { data: null, error: null };
      if (adminError) throw adminError;
      if (comment.author_user_id !== user.id && !platformAdmin) {
        return res.status(403).json({ error: "只能删除自己发布的评论。" });
      }
      const { error: deleteError } = await supabase
        .from("community_comments")
        .update({
          moderation_status: "removed",
          moderation_reason: comment.author_user_id === user.id ? "作者删除" : "平台管理员删除",
        })
        .eq("id", commentId)
        .eq("moderation_status", comment.moderation_status);
      if (deleteError) throw deleteError;
      return res.status(200).json({ ok: true });
    }
    const activeMute = await getActiveCommunityMute(supabase, user.id);
    if (activeMute) {
      return res.status(403).json({
        error: activeMute.ends_at
          ? `你的社区回应功能暂时受限，到 ${new Date(activeMute.ends_at).toLocaleString("zh-CN")} 后恢复。`
          : "你的社区回应功能目前受限，请联系平台了解处理情况。",
        muted: true,
        mutedUntil: activeMute.ends_at,
      });
    }
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
    const blockedUserIds = await getCommunityBlockedUserIds(supabase, user.id);
    if (post.author_user_id !== user.id && blockedUserIds.has(post.author_user_id as string)) {
      return res.status(404).json({ error: "这条内容不存在，或你没有查看权限。" });
    }
    if (!post.commenter_roles.includes(identity.role)) {
      return res.status(403).json({ error: "发布者没有向你的身份开放评论。" });
    }

    const moderation = moderateCommunityContent(body);
    if (moderation.status === "blocked") {
      return res.status(422).json({ error: moderation.reason, blocked: true });
    }
    if (!(await enforceUserRateLimit({
      supabase,
      userId: user.id,
      action: "community_comment_create",
      limit: 20,
      windowSeconds: 10 * 60,
      res,
      message: "回应得有些频繁，请稍等一会儿再试。你写下的内容仍保留在当前页面。",
    }))) return;
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

export const config = {
  api: { bodyParser: { sizeLimit: "8kb" } },
};
