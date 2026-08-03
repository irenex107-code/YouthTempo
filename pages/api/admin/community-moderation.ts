import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import { communityRoleLabels, type CommunityRole } from "@/lib/community";

type ReportRow = {
  id: string;
  reporter_user_id: string;
  post_id: string | null;
  comment_id: string | null;
  reason: string;
  category: string;
  priority: "urgent" | "high" | "standard";
  status: "new" | "reviewing" | "resolved";
  created_at: string;
  target_review_at: string;
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

type ActionRow = {
  id: string;
  content_type: "post" | "comment";
  content_id: string;
  action: "publish" | "remove";
  previous_status: "published" | "safety_review" | "removed";
  new_status: "published" | "removed";
  note: string;
  actor_user_id: string | null;
  created_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { supabase, user } = await requirePlatformAdmin(req);

    if (req.method === "POST") {
      const contentType = req.body?.contentType;
      const contentId = typeof req.body?.contentId === "string" ? req.body.contentId.trim() : "";
      const action = req.body?.action;
      const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (!["post", "comment"].includes(contentType)) {
        return res.status(400).json({ error: "请选择要处理的帖子或回复。" });
      }
      if (!contentId) return res.status(400).json({ error: "缺少需要处理的内容。" });
      if (!["publish", "remove"].includes(action)) {
        return res.status(400).json({ error: "请选择恢复显示或移除内容。" });
      }
      if (!note) return res.status(400).json({ error: "请填写简短的处理说明。" });
      if (note.length > 500) return res.status(400).json({ error: "处理说明请控制在 500 字以内。" });

      const { data, error } = await supabase.rpc("apply_community_moderation", {
        p_content_type: contentType,
        p_content_id: contentId,
        p_action: action,
        p_note: note,
        p_actor_user_id: user.id,
      });
      if (error) throw error;
      return res.status(200).json({
        action: Array.isArray(data) ? data[0] : data,
        notice: action === "publish" ? "内容已恢复显示，关联举报已结清。" : "内容已移除，关联举报已结清。",
      });
    }

    const [reportsResult, flaggedPostsResult, flaggedCommentsResult, actionsResult] = await Promise.all([
      supabase
        .from("community_reports")
        .select("id,reporter_user_id,post_id,comment_id,reason,category,priority,status,created_at,target_review_at")
        .in("status", ["new", "reviewing"])
        .order("target_review_at", { ascending: true })
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
      supabase
        .from("community_moderation_actions")
        .select("id,content_type,content_id,action,previous_status,new_status,note,actor_user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (reportsResult.error) throw reportsResult.error;
    if (flaggedPostsResult.error) throw flaggedPostsResult.error;
    if (flaggedCommentsResult.error) throw flaggedCommentsResult.error;
    if (actionsResult.error) throw actionsResult.error;

    const reports = (reportsResult.data || []) as ReportRow[];
    const flaggedPosts = (flaggedPostsResult.data || []) as PostRow[];
    const flaggedComments = (flaggedCommentsResult.data || []) as CommentRow[];
    const actions = (actionsResult.data || []) as ActionRow[];
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

    const actionPostIds = actions.filter((action) => action.content_type === "post").map((action) => action.content_id);
    const actionCommentIds = actions.filter((action) => action.content_type === "comment").map((action) => action.content_id);
    const [actionPostsResult, actionCommentsResult] = await Promise.all([
      actionPostIds.length
        ? supabase
            .from("community_posts")
            .select("id,author_user_id,author_role,title,body,moderation_status,moderation_reason,created_at")
            .in("id", actionPostIds)
        : Promise.resolve({ data: [], error: null }),
      actionCommentIds.length
        ? supabase
            .from("community_comments")
            .select("id,post_id,author_user_id,author_role,body,moderation_status,moderation_reason,created_at")
            .in("id", actionCommentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (actionPostsResult.error) throw actionPostsResult.error;
    if (actionCommentsResult.error) throw actionCommentsResult.error;
    const actionPosts = (actionPostsResult.data || []) as PostRow[];
    const actionComments = (actionCommentsResult.data || []) as CommentRow[];

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

    const authorIds = Array.from(new Set([
      ...posts.map((item) => item.author_user_id),
      ...comments.map((item) => item.author_user_id),
      ...actionPosts.map((item) => item.author_user_id),
      ...actionComments.map((item) => item.author_user_id),
      ...actions.flatMap((action) => action.actor_user_id ? [action.actor_user_id] : []),
    ]));
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
          category: report.category,
          priority: report.priority,
          status: report.status,
          created_at: report.created_at,
          target_review_at: report.target_review_at,
        }));
    const authorDetails = (userId: string, role: CommunityRole) => {
      const profile = profileById.get(userId);
      return {
        author_name: profile?.display_name || profile?.email || communityRoleLabels[role],
        author_role_label: communityRoleLabels[role],
      };
    };

    const withServiceLevel = <T extends { moderation_status: string; created_at: string }>(
      item: T,
      itemReports: ReturnType<typeof reportsFor>,
    ) => {
      const priorityRank = { urgent: 0, high: 1, standard: 2 } as const;
      const highestReport = [...itemReports].sort(
        (a, b) => priorityRank[a.priority] - priorityRank[b.priority],
      )[0];
      const priority = highestReport?.priority || (item.moderation_status === "safety_review" ? "urgent" : "standard");
      const targetReviewAt = highestReport?.target_review_at || new Date(
        new Date(item.created_at).getTime() + (priority === "urgent" ? 2 : priority === "high" ? 24 : 72) * 60 * 60 * 1000,
      ).toISOString();
      return {
        ...item,
        reports: itemReports,
        priority,
        target_review_at: targetReviewAt,
        overdue: new Date(targetReviewAt).getTime() < Date.now(),
      };
    };

    const items = [
      ...posts.map((post) => withServiceLevel({
        id: `post:${post.id}`,
        content_id: post.id,
        content_type: "post" as const,
        author_user_id: post.author_user_id,
        title: post.title,
        body: post.body,
        moderation_status: post.moderation_status,
        moderation_reason: post.moderation_reason,
        created_at: post.created_at,
        ...authorDetails(post.author_user_id, post.author_role),
      }, reportsFor("post", post.id))),
      ...comments.map((comment) => withServiceLevel({
        id: `comment:${comment.id}`,
        content_id: comment.id,
        content_type: "comment" as const,
        author_user_id: comment.author_user_id,
        title: `回复 · ${postTitleById.get(comment.post_id) || "原帖"}`,
        body: comment.body,
        moderation_status: comment.moderation_status,
        moderation_reason: comment.moderation_reason,
        created_at: comment.created_at,
        ...authorDetails(comment.author_user_id, comment.author_role),
      }, reportsFor("comment", comment.id))),
    ].sort((a, b) => new Date(a.target_review_at).getTime() - new Date(b.target_review_at).getTime());

    const actionPostById = new Map(actionPosts.map((post) => [post.id, post]));
    const actionCommentById = new Map(actionComments.map((comment) => [comment.id, comment]));
    const seenHistoryTargets = new Set<string>();
    const history = actions.map((action) => {
      const targetKey = `${action.content_type}:${action.content_id}`;
      const isLatestForTarget = !seenHistoryTargets.has(targetKey);
      seenHistoryTargets.add(targetKey);
      const content = action.content_type === "post"
        ? actionPostById.get(action.content_id)
        : actionCommentById.get(action.content_id);
      const actor = action.actor_user_id ? profileById.get(action.actor_user_id) : null;
      return {
        ...action,
        title: action.content_type === "post"
          ? (content as PostRow | undefined)?.title || "已不存在的帖子"
          : "社区回复",
        body: content?.body || "内容已不存在。",
        current_status: content?.moderation_status || action.new_status,
        actor_name: actor?.display_name || actor?.email || "已停用的管理员账号",
        is_latest_for_target: isLatestForTarget,
      };
    });

    return res.status(200).json({
      counts: {
        total: items.length,
        safetyReview: items.filter((item) => item.moderation_status === "safety_review").length,
        reports: reports.length,
      },
      items,
      history,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "社区审核队列加载失败。";
    const status = message.includes("只有平台管理员")
      ? 403
      : message.includes("请先登录")
        ? 401
        : message.includes("content_not_found")
          ? 404
          : message.includes("invalid_")
            ? 400
            : 500;
    return res.status(status).json({ error: message });
  }
}
