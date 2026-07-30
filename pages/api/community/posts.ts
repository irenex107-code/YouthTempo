import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  type CommunityRole,
  communityRoleLabels,
  getCommunityIdentity,
  normalizeRoleList,
} from "@/lib/community";
import { moderateCommunityContent } from "@/lib/messageSafety";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录，再进入社区。" });
    const supabase = getSupabaseAdmin();
    const identity = await getCommunityIdentity(supabase, user);

    if (req.method === "POST") {
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

      const moderation = moderateCommunityContent(`${title}\n${body}`);
      if (moderation.status === "blocked") {
        return res.status(422).json({ error: moderation.reason, blocked: true });
      }

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
        .limit(50),
      supabase
        .from("community_posts")
        .select(postFields)
        .eq("moderation_status", "published")
        .eq("author_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (postsError) throw postsError;
    if (ownPostsError) throw ownPostsError;
    const posts = Array.from(
      new Map([...(visiblePosts || []), ...(ownPosts || [])].map((post) => [post.id as string, post])).values(),
    )
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
          can_comment: (post.commenter_roles as string[]).includes(identity.role),
          comments: (comments || [])
            .filter((comment) => comment.post_id === post.id)
            .map((comment) => {
              const commentRole = comment.author_role as CommunityRole;
              const commentAuthor = profileById.get(comment.author_user_id as string);
              return {
                ...comment,
                author_name: commentAuthor?.display_name || commentAuthor?.email || communityRoleLabels[commentRole],
                author_role_label: communityRoleLabels[commentRole],
                verified_professional:
                  commentRole === "professional" && verifiedProfessionalIds.has(comment.author_user_id as string),
              };
            }),
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "社区暂时不可用。";
    return res.status(500).json({ error: message });
  }
}
