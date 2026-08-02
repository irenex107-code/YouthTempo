import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { getCommunityBlockedUserIds, getCommunityIdentity } from "@/lib/community";

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
    const identity = await getCommunityIdentity(supabase, user);
    const blockedUserIds = await getCommunityBlockedUserIds(supabase, user.id);
    let targetAuthorUserId = "";

    if (postId) {
      const { data: post, error: postError } = await supabase
        .from("community_posts")
        .select("author_user_id,viewer_roles,moderation_status")
        .eq("id", postId)
        .maybeSingle();
      if (postError) throw postError;
      if (
        !post ||
        post.moderation_status !== "published" ||
        (post.author_user_id !== user.id && !post.viewer_roles.includes(identity.role)) ||
        blockedUserIds.has(post.author_user_id as string)
      ) return res.status(404).json({ error: "这条内容已经不存在，或你没有查看权限。" });
      targetAuthorUserId = post.author_user_id as string;
    } else {
      const { data: comment, error: commentError } = await supabase
        .from("community_comments")
        .select("author_user_id,post_id,moderation_status")
        .eq("id", commentId!)
        .maybeSingle();
      if (commentError) throw commentError;
      if (!comment || comment.moderation_status !== "published" || blockedUserIds.has(comment.author_user_id as string)) {
        return res.status(404).json({ error: "这条内容已经不存在，或你没有查看权限。" });
      }
      const { data: parentPost, error: parentError } = await supabase
        .from("community_posts")
        .select("author_user_id,viewer_roles,moderation_status")
        .eq("id", comment.post_id)
        .maybeSingle();
      if (parentError) throw parentError;
      if (
        !parentPost ||
        parentPost.moderation_status !== "published" ||
        (parentPost.author_user_id !== user.id && !parentPost.viewer_roles.includes(identity.role)) ||
        blockedUserIds.has(parentPost.author_user_id as string)
      ) return res.status(404).json({ error: "这条内容已经不存在，或你没有查看权限。" });
      targetAuthorUserId = comment.author_user_id as string;
    }

    if (targetAuthorUserId === user.id) {
      return res.status(400).json({ error: "不能举报自己发布的内容。" });
    }
    let duplicateQuery = supabase
      .from("community_reports")
      .select("id")
      .eq("reporter_user_id", user.id)
      .in("status", ["new", "reviewing"]);
    duplicateQuery = postId ? duplicateQuery.eq("post_id", postId) : duplicateQuery.eq("comment_id", commentId!);
    const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return res.status(409).json({ error: "你已经举报过这条内容，平台正在查看。" });
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
    if (message.includes("community_reports_open_")) {
      return res.status(409).json({ error: "你已经举报过这条内容，平台正在查看。" });
    }
    return res.status(500).json({ error: message });
  }
}
