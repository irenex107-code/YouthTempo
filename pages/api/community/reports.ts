import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { getCommunityBlockedUserIds, getCommunityIdentity } from "@/lib/community";
import {
  communityReportCategory,
  isCommunityReportCategory,
  type CommunityReportCategory,
} from "@/lib/communityReports";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录。" });
    const supabase = getSupabaseAdmin();
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("community_reports")
        .select("id,post_id,comment_id,reason,category,priority,status,created_at,target_review_at,resolved_at")
        .eq("reporter_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return res.status(200).json({ reports: data || [] });
    }

    if (!(await enforceUserRateLimit({
      supabase,
      req,
      userId: user.id,
      action: "community_report_submit",
      limit: 20,
      windowSeconds: 60 * 60,
      res,
      message: "举报提交得有些频繁，请稍后再试。",
      area: "community",
      unavailableMessage: "举报服务暂时不可用，请稍后再试。",
    }))) return;

    const postId = typeof req.body?.postId === "string" ? req.body.postId.trim() : null;
    const commentId = typeof req.body?.commentId === "string" ? req.body.commentId.trim() : null;
    const category: CommunityReportCategory = isCommunityReportCategory(req.body?.category)
      ? req.body.category
      : "other";
    const details = typeof req.body?.details === "string" ? req.body.details.trim() : "";
    const legacyReason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const reason = details || legacyReason || communityReportCategory(category).label;
    if ((!postId && !commentId) || (postId && commentId)) {
      return res.status(400).json({ error: "请选择要举报的内容。" });
    }
    if (reason.length > 500) return res.status(400).json({ error: "补充说明请控制在 500 字以内。" });
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
    const { data: report, error } = await supabase
      .from("community_reports")
      .insert({
        reporter_user_id: user.id,
        post_id: postId,
        comment_id: commentId,
        category,
        reason,
      })
      .select("id,post_id,comment_id,reason,category,priority,status,created_at,target_review_at,resolved_at")
      .single();
    if (error) throw error;
    const serviceLevel = communityReportCategory(category);
    return res.status(201).json({
      ok: true,
      report,
      notice: `举报已进入${serviceLevel.priority === "urgent" ? "紧急" : serviceLevel.priority === "high" ? "优先" : "常规"}队列，目标在 ${serviceLevel.targetHours} 小时内完成首次复核。`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "举报暂时无法提交。";
    if (message.includes("community_reports_open_")) {
      return res.status(409).json({ error: "你已经举报过这条内容，平台正在查看。" });
    }
    return res.status(500).json({ error: "举报暂时无法提交，请稍后再试。" });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "8kb" } },
};
