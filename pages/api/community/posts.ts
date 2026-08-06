import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  type CommunityRole,
  communityRoleLabels,
  getActiveCommunityMute,
  getCommunityBlockedUserIds,
  getCommunityIdentity,
  normalizeRoleList,
} from "@/lib/community";
import { moderateCommunityContent } from "@/lib/messageSafety";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { requireActiveStudentConsent } from "@/lib/studentConsent";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { normalizeLocale } from "@/lib/i18n/config";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录，再进入社区。" });
    const supabase = getSupabaseAdmin();
    const identity = await getCommunityIdentity(supabase, user);

    if (req.method === "DELETE") {
      const postId = typeof req.body?.postId === "string" ? req.body.postId.trim() : "";
      if (!postId) return res.status(400).json({ error: "请选择要删除的帖子。" });

      const { data: post, error: postError } = await supabase
        .from("community_posts")
        .select("id,author_user_id,moderation_status")
        .eq("id", postId)
        .maybeSingle();
      if (postError) throw postError;
      if (!post || post.moderation_status === "removed") {
        return res.status(404).json({ error: "这条帖子已经不存在。" });
      }

      const email = (user.email || "").trim().toLowerCase();
      const { data: platformAdmin, error: adminError } = email
        ? await supabase.from("admin_roles").select("id").eq("email", email).eq("status", "active").maybeSingle()
        : { data: null, error: null };
      if (adminError) throw adminError;
      if (post.author_user_id !== user.id && !platformAdmin) {
        return res.status(403).json({ error: "只能删除自己发布的帖子。" });
      }

      const { error: deleteError } = await supabase
        .from("community_posts")
        .update({
          moderation_status: "removed",
          moderation_reason: post.author_user_id === user.id ? "作者删除" : "平台管理员删除",
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
        .eq("moderation_status", post.moderation_status);
      if (deleteError) throw deleteError;
      return res.status(200).json({ ok: true });
    }

    if (req.method === "POST") {
      await requireActiveStudentConsent(supabase, user.id);
      const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : undefined);
      const activeMute = await getActiveCommunityMute(supabase, user.id);
      if (activeMute) {
        return res.status(403).json({
          error: activeMute.ends_at
            ? `你的社区发布功能暂时受限，到 ${new Date(activeMute.ends_at).toLocaleString("zh-CN")} 后恢复。`
            : "你的社区发布功能目前受限，请联系平台了解处理情况。",
          muted: true,
          mutedUntil: activeMute.ends_at,
        });
      }
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
      const viewerRoles = normalizeRoleList(req.body?.viewerRoles);
      const commenterRoles = normalizeRoleList(req.body?.commenterRoles);

      if (!title || !body) return res.status(400).json({ error: "请写下标题和内容。" });
      if (title.length > 80) return res.status(400).json({ error: "标题请控制在 80 字以内。" });
      if (body.length > 3000) return res.status(400).json({ error: "内容请控制在 3000 字以内。" });
      if (!viewerRoles.length) return res.status(400).json({ error: "请至少选择一类可以看到内容的人。" });
      if (commenterRoles.some((role) => !viewerRoles.includes(role))) {
        return res.status(400).json({ error: "可以评论的人，也需要先有查看权限。" });
      }

      const moderation = moderateCommunityContent(`${title}\n${body}`, locale);
      if (moderation.status === "blocked") {
        return res.status(422).json({ error: moderation.reason, blocked: true });
      }
      if (!(await enforceUserRateLimit({
        supabase,
        req,
        userId: user.id,
        action: "community_post_create",
        limit: 5,
        windowSeconds: 10 * 60,
        res,
        message: "发布得有些频繁，请稍等一会儿再发。你写下的内容仍保留在当前页面。",
      }))) return;

      const { data: post, error } = await supabase
        .from("community_posts")
        .insert({
          author_user_id: user.id,
          author_role: identity.role,
          title,
          body,
          viewer_roles: viewerRoles,
          commenter_roles: commenterRoles,
          moderation_status: moderation.status,
          moderation_reason: moderation.reason,
        })
        .select("id,moderation_status")
        .single();
      if (error) throw error;

      return res.status(moderation.status === "safety_review" ? 202 : 201).json({
        post,
        safetyNotice: moderation.status === "safety_review",
      });
    }

    const blockedUserIds = await getCommunityBlockedUserIds(supabase, user.id);
    const postFields = "id,author_user_id,author_role,title,body,viewer_roles,commenter_roles,created_at";
    const [
      { data: visiblePosts, error: postsError },
      { data: ownPosts, error: ownPostsError },
    ] = await Promise.all([
      supabase
        .from("community_posts")
        .select(postFields)
        .eq("moderation_status", "published")
        .contains("viewer_roles", [identity.role])
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("community_posts")
        .select(postFields)
        .eq("moderation_status", "published")
        .eq("author_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (postsError) throw postsError;
    if (ownPostsError) throw ownPostsError;
    const posts = Array.from(
      new Map([...(visiblePosts || []), ...(ownPosts || [])].map((post) => [post.id as string, post])).values(),
    )
      .filter((post) => !blockedUserIds.has(post.author_user_id as string))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);

    const postIds = (posts || []).map((post) => post.id as string);
    const authorIds = Array.from(new Set((posts || []).map((post) => post.author_user_id as string)));
    const [{ data: comments, error: commentsError }, { data: profiles, error: profilesError }] = await Promise.all([
      postIds.length
        ? supabase
            .from("community_comments")
            .select("id,post_id,author_user_id,author_role,body,created_at")
            .in("post_id", postIds)
            .eq("moderation_status", "published")
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      authorIds.length
        ? supabase.from("profiles").select("id,display_name,email").in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (commentsError) throw commentsError;
    if (profilesError) throw profilesError;

    const commentAuthorIds = Array.from(new Set((comments || []).map((comment) => comment.author_user_id as string)))
      .filter((id) => !authorIds.includes(id));
    const allAuthorIds = [...authorIds, ...commentAuthorIds];
    const today = new Date().toISOString().slice(0, 10);
    const [
      { data: commentProfiles, error: commentProfilesError },
      { data: professionalVerifications, error: professionalVerificationError },
    ] = await Promise.all([
      commentAuthorIds.length
        ? supabase.from("profiles").select("id,display_name,email").in("id", commentAuthorIds)
        : Promise.resolve({ data: [], error: null }),
      allAuthorIds.length
        ? supabase
            .from("professional_verifications")
            .select("user_id")
            .in("user_id", allAuthorIds)
            .eq("status", "active")
            .or(`credential_expires_on.is.null,credential_expires_on.gte.${today}`)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (commentProfilesError) throw commentProfilesError;
    if (professionalVerificationError) throw professionalVerificationError;
    const verifiedProfessionalIds = new Set(
      (professionalVerifications || []).map((item) => item.user_id as string),
    );
    const profileById = new Map(
      [...(profiles || []), ...(commentProfiles || [])].map((profile) => [profile.id as string, profile]),
    );

    return res.status(200).json({
      currentUser: identity,
      roles: communityRoleLabels,
      posts: (posts || []).map((post) => {
        const postRole = post.author_role as CommunityRole;
        const author = profileById.get(post.author_user_id as string);
        return {
          ...post,
          author_name: author?.display_name || author?.email || communityRoleLabels[postRole],
          author_role_label: communityRoleLabels[postRole],
          verified_professional:
            postRole === "professional" && verifiedProfessionalIds.has(post.author_user_id as string),
          can_delete: post.author_user_id === user.id || identity.canModerate,
          can_comment: (post.commenter_roles as string[]).includes(identity.role),
          comments: (comments || [])
            .filter((comment) => comment.post_id === post.id && !blockedUserIds.has(comment.author_user_id as string))
            .map((comment) => {
              const commentRole = comment.author_role as CommunityRole;
              const commentAuthor = profileById.get(comment.author_user_id as string);
              return {
                ...comment,
                author_name: commentAuthor?.display_name || commentAuthor?.email || communityRoleLabels[commentRole],
                author_role_label: communityRoleLabels[commentRole],
                verified_professional:
                  commentRole === "professional" && verifiedProfessionalIds.has(comment.author_user_id as string),
                can_delete: comment.author_user_id === user.id || identity.canModerate,
              };
            }),
        };
      }),
    });
  } catch (error) {
    const statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 500;
    if (statusCode >= 500 || !Number.isFinite(statusCode)) {
      await reportOperationalError({ req, area: "community", operation: "posts", error, statusCode: 500 });
      return res.status(500).json({ error: "社区暂时不可用，请稍后再试。" });
    }
    const message = error instanceof Error ? error.message : "社区请求无法完成。";
    return res.status(statusCode).json({ error: message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "16kb" } },
};
