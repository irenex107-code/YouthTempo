import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import { communityRoleLabels, type CommunityRole } from "@/lib/community";

type ReportRow = {
  id: string;
  reporter_user_id: string;
  post_id: string | null;
  comment_id: string | null;
  reason: string;
  status: "new" | "reviewing" | "resolved";
  created_at: string;
};

type PostRow = {
  id: string;
  author_user_id: string;
  author_role: CommunityRole;
  title: string;
  body: string;
  moderation_status: "published" | "safety_review" | "removed";
  moderation_reason: string | null;
  created_at: string;
};

type CommentRow = {
  id: string;
  post_id: string;
  author_user_id: string;
  author_role: CommunityRole;
  body: string;
  moderation_status: "published" | "safety_review" | "removed";
  moderation_reason: string | null;
  created_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { supabase } = await requirePlatformAdmin(req);
    const [reportsResult, flaggedPostsResult, flaggedCommentsResult] = await Promise.all([
      supabase
        .from("community_reports")
        .select("id,reporter_user_id,post_id,comment_id,reason,status,created_at")
        .in("status", ["new", "reviewing"])
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("community_posts")
        .select("id,author_user_id,author_role,title,body,moderation_status,moderation_reason,created_at")
        .eq("moderation_status", "safety_review")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("community_comments")
        .select("id,post_id,author_user_id,author_role,body,moderation_status,moderation_reason,created_at")
        .eq("moderation_status", "safety_review")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (reportsResult.error) throw reportsResult.error;
    if (flaggedPostsResult.error) throw flaggedPostsResult.error;
    if (flaggedCommentsResult.error) throw flaggedCommentsResult.error;

    const reports = (reportsResult.data || []) as ReportRow[];
    const flaggedPosts = (flaggedPostsResult.data || []) as PostRow[];
    const flaggedComments = (flaggedCommentsResult.data || []) as CommentRow[];
    const postIds = Array.from(
      new Set([
        ...reports.flatMap((report) => (report.post_id ? [report.post_id] : [])),
        ...flaggedPosts.map((post) => post.id),
      ]),
    );
    const commentIds = Array.from(
      new Set([
        ...reports.flatMap((report) => (report.comment_id ? [report.comment_id] : [])),
        ...flaggedComments.map((comment) => comment.id),
      ]),
    );

    const [reportedPostsResult, reportedCommentsResult] = await Promise.all([
      postIds.length
        ? supabase
            .from("community_posts")
            .select("id,author_user_id,author_role,title,body,moderation_status,moderation_reason,created_at")
            .in("id", postIds)
        : Promise.resolve({ data: [], error: null }),
      commentIds.length
        ? supabase
            .from("community_comments")
            .select("id,post_id,author_user_id,author_role,body,moderation_status,moderation_reason,created_at")
            .in("id", commentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (reportedPostsResult.error) throw reportedPostsResult.error;
    if (reportedCommentsResult.error) throw reportedCommentsResult.error;

    const posts = Array.from(
      new Map(
        ([...flaggedPosts, ...((reportedPostsResult.data || []) as PostRow[])]).map((post) => [post.id, post]),
      ).values(),
    );
    const comments = Array.from(
      new Map(
        ([...flaggedComments, ...((reportedCommentsResult.data || []) as CommentRow[])]).map((comment) => [
          comment.id,
          comment,
        ]),
      ).values(),
    );
    const parentPostIds = comments.map((comment) => comment.post_id).filter((id) => !postIds.includes(id));
    const { data: parentPosts, error: parentPostsError } = parentPostIds.length
      ? await supabase.from("community_posts").select("id,title").in("id", parentPostIds)
      : { data: [], error: null };
    if (parentPostsError) throw parentPostsError;

    const authorIds = Array.from(new Set([...posts, ...comments].map((item) => item.author_user_id)));
    const { data: profiles, error: profilesError } = authorIds.length
      ? await supabase.from("profiles").select("id,display_name,email").in("id", authorIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles || []).map((profile) => [profile.id as string, profile]));
    const postTitleById = new Map(
      [...posts, ...(parentPosts || [])].map((post) => [post.id as string, post.title as string]),
    );
    const reportsFor = (kind: "post" | "comment", id: string) =>
      reports
        .filter((report) => (kind === "post" ? report.post_id === id : report.comment_id === id))
        .map((report) => ({
          id: report.id,
          reason: report.reason,
          status: report.status,
          created_at: report.created_at,
        }));
    const authorDetails = (userId: string, role: CommunityRole) => {
      const profile = profileById.get(userId);
      return {
        author_name: profile?.display_name || profile?.email || communityRoleLabels[role],
        author_role_label: communityRoleLabels[role],
      };
    };

    const items = [
      ...posts.map((post) => ({
        id: `post:${post.id}`,
        content_id: post.id,
        content_type: "post" as const,
        title: post.title,
        body: post.body,
        moderation_status: post.moderation_status,
        moderation_reason: post.moderation_reason,
        created_at: post.created_at,
        reports: reportsFor("post", post.id),
        ...authorDetails(post.author_user_id, post.author_role),
      })),
      ...comments.map((comment) => ({
        id: `comment:${comment.id}`,
        content_id: comment.id,
        content_type: "comment" as const,
        title: `回复 · ${postTitleById.get(comment.post_id) || "原帖"}`,
        body: comment.body,
        moderation_status: comment.moderation_status,
        moderation_reason: comment.moderation_reason,
        created_at: comment.created_at,
        reports: reportsFor("comment", comment.id),
        ...authorDetails(comment.author_user_id, comment.author_role),
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.status(200).json({
      counts: {
        total: items.length,
        safetyReview: items.filter((item) => item.moderation_status === "safety_review").length,
        reports: reports.length,
      },
      items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "社区审核队列加载失败。";
    const status = message.includes("只有平台管理员") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
