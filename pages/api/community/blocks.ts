import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录，再管理社区屏蔽名单。" });
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data: blocks, error: blocksError } = await supabase
        .from("community_blocks")
        .select("blocked_user_id,created_at")
        .eq("blocker_user_id", user.id)
        .order("created_at", { ascending: false });
      if (blocksError) throw blocksError;
      const blockedIds = (blocks || []).map((block) => block.blocked_user_id as string);
      const { data: profiles, error: profilesError } = blockedIds.length
        ? await supabase.from("profiles").select("id,display_name,email,role").in("id", blockedIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileById = new Map((profiles || []).map((profile) => [profile.id as string, profile]));
      return res.status(200).json({
        blocks: (blocks || []).map((block) => {
          const profile = profileById.get(block.blocked_user_id as string);
          return {
            user_id: block.blocked_user_id,
            name: profile?.display_name || profile?.email || "社区成员",
            role: profile?.role || "社区成员",
            created_at: block.created_at,
          };
        }),
      });
    }

    const targetUserId = typeof req.body?.targetUserId === "string" ? req.body.targetUserId.trim() : "";
    if (!targetUserId) return res.status(400).json({ error: "请选择要屏蔽的社区成员。" });
    if (targetUserId === user.id) return res.status(400).json({ error: "不能屏蔽自己。" });

    if (req.method === "DELETE") {
      const { error } = await supabase
        .from("community_blocks")
        .delete()
        .eq("blocker_user_id", user.id)
        .eq("blocked_user_id", targetUserId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return res.status(404).json({ error: "找不到这名社区成员。" });

    const { error } = await supabase.from("community_blocks").upsert(
      { blocker_user_id: user.id, blocked_user_id: targetUserId },
      { onConflict: "blocker_user_id,blocked_user_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "社区屏蔽设置暂时无法保存。";
    return res.status(500).json({ error: message });
  }
}
