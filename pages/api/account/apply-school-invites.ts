import type { NextApiRequest, NextApiResponse } from "next";
import { applySchoolInvitesForUser, inviteRoleLabel } from "@/lib/schoolInvites";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.email) return res.status(401).json({ error: "请先登录，再同步学校空间。" });

    const supabase = getSupabaseAdmin();
    const invites = await applySchoolInvitesForUser(supabase, user);

    return res.status(200).json({
      applied: invites.length,
      roles: invites.map((invite) => inviteRoleLabel(invite.assignment_role as string)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "学校空间同步失败。";
    return res.status(500).json({ error: message });
  }
}
