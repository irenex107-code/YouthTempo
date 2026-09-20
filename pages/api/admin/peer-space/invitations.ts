import type { NextApiRequest, NextApiResponse } from "next";
import { getAdminContext } from "@/lib/adminAccess";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import {
  normalizeInvitationEmail,
  PEER_SPACE_INVITATIONS_API_ENABLED,
  validEvidenceSource,
  validInvitationKind,
} from "@/lib/peerSpaceInvitations";
import { getAuthenticatedUser } from "@/lib/supabaseServer";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function databaseCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : null;
}

function invitationFields(body: Record<string, unknown>) {
  const email = normalizeInvitationEmail(body.email);
  const schoolId = body.schoolId === "" || body.schoolId == null ? null : body.schoolId;
  const reference = typeof body.evidenceReference === "string" ? body.evidenceReference.trim() : "";
  if (
    !email || !validInvitationKind(body.eligibilityKind)
    || !validEvidenceSource(body.evidenceSource)
    || reference.length < 8 || reference.length > 160
    || (schoolId !== null && (typeof schoolId !== "string" || !uuidPattern.test(schoolId)))
  ) return null;
  return {
    email,
    school_id: schoolId as string | null,
    eligibility_kind: body.eligibilityKind,
    evidence_source: body.evidenceSource,
    evidence_reference: reference,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "PATCH"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录。" });
    const context = await getAdminContext(req);
    if (context.kind !== "platform") return res.status(403).json({ error: "仅平台管理员可以管理解忧室邀请。" });
    if (!PEER_SPACE_INVITATIONS_API_ENABLED) {
      return res.status(404).json({ error: "解忧室邀请管理尚未启用。" });
    }

    const { supabase } = context;
    const { data: space, error: spaceError } = await supabase
      .from("peer_spaces")
      .select("id,status")
      .eq("code", "adult_peer_space")
      .maybeSingle();
    if (spaceError) throw spaceError;
    if (!space) return res.status(409).json({ error: "成年人解忧室尚未配置。" });

    if (req.method === "GET") {
      const [{ data: invitations, error: invitationError }, { data: cohorts, error: cohortError }, { data: schools, error: schoolError }] = await Promise.all([
        supabase.from("peer_space_email_invitations")
          .select("id,email,cohort_id,school_id,eligibility_kind,evidence_source,evidence_reference,status,claimed_user_id,invited_at,claimed_at,revoked_at")
          .eq("space_id", space.id).order("invited_at", { ascending: false }).limit(100),
        supabase.from("peer_space_cohorts")
          .select("id,internal_name,status,starts_at,ends_at")
          .eq("space_id", space.id).order("created_at", { ascending: false }).limit(100),
        supabase.from("schools").select("id,name").eq("status", "active").order("name").limit(100),
      ]);
      if (invitationError) throw invitationError;
      if (cohortError) throw cohortError;
      if (schoolError) throw schoolError;
      const claimedUserIds = [...new Set((invitations || []).map((item) => item.claimed_user_id).filter((id): id is string => Boolean(id)))];
      const { data: memberships, error: membershipError } = claimedUserIds.length
        ? await supabase.from("peer_space_memberships")
          .select("user_id,cohort_id,status")
          .eq("space_id", space.id).in("user_id", claimedUserIds)
        : { data: [], error: null };
      if (membershipError) throw membershipError;
      const membershipStatus = new Map((memberships || []).map((item) => [`${item.user_id}:${item.cohort_id}`, item.status]));
      return res.status(200).json({
        invitations: (invitations || []).map((item) => ({
          ...item,
          membership_status: item.claimed_user_id
            ? membershipStatus.get(`${item.claimed_user_id}:${item.cohort_id}`) || null
            : null,
        })),
        cohorts: cohorts || [],
        schools: schools || [],
        spaceStatus: space.status,
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    if (req.method === "POST" && body.action === "create_cohort") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 3 || name.length > 120) {
        return res.status(400).json({ error: "批次名称需要 3–120 个字符。" });
      }
      const { data, error } = await supabase.from("peer_space_cohorts").insert({
        space_id: space.id,
        internal_name: name,
        status: "active",
        created_by: context.user.id,
      }).select("id,internal_name,status").single();
      if (error) throw error;
      return res.status(201).json({ cohort: data });
    }

    if (req.method === "POST" && body.action === "invite") {
      const cohortId = body.cohortId;
      const fields = invitationFields(body);
      if (!fields || typeof cohortId !== "string" || !uuidPattern.test(cohortId)) {
        return res.status(400).json({ error: "请检查登录邮箱、资格依据、学校和试点批次。" });
      }
      const { data: cohort, error: cohortError } = await supabase.from("peer_space_cohorts")
        .select("id").eq("id", cohortId).eq("space_id", space.id).eq("status", "active").maybeSingle();
      if (cohortError) throw cohortError;
      if (!cohort) return res.status(409).json({ error: "该试点批次不可用。" });
      if (fields.school_id) {
        const { data: school, error: schoolError } = await supabase.from("schools")
          .select("id").eq("id", fields.school_id).eq("status", "active").maybeSingle();
        if (schoolError) throw schoolError;
        if (!school) return res.status(409).json({ error: "所选学校不可用。" });
      }
      const { data, error } = await supabase.from("peer_space_email_invitations").insert({
        ...fields,
        space_id: space.id,
        cohort_id: cohortId,
        invited_by: context.user.id,
        updated_by: context.user.id,
      }).select("id,status").single();
      if (error) {
        if (databaseCode(error) === "23505") return res.status(409).json({ error: "这个邮箱已有有效邀请，请先更正或撤销。" });
        throw error;
      }
      return res.status(201).json({ invitation: data });
    }

    if (req.method === "PATCH" && body.action === "correct") {
      const fields = invitationFields(body);
      if (!fields || typeof body.invitationId !== "string" || !uuidPattern.test(body.invitationId)) {
        return res.status(400).json({ error: "请检查待更正的邀请信息。" });
      }
      if (fields.school_id) {
        const { data: school, error: schoolError } = await supabase.from("schools")
          .select("id").eq("id", fields.school_id).eq("status", "active").maybeSingle();
        if (schoolError) throw schoolError;
        if (!school) return res.status(409).json({ error: "所选学校不可用。" });
      }
      const { data, error } = await supabase.from("peer_space_email_invitations")
        .update({ ...fields, updated_by: context.user.id })
        .eq("id", body.invitationId).eq("space_id", space.id).eq("status", "pending")
        .select("id,status").maybeSingle();
      if (error) {
        if (databaseCode(error) === "23505") return res.status(409).json({ error: "这个邮箱已有有效邀请。" });
        throw error;
      }
      if (!data) return res.status(409).json({ error: "只有待认领邀请可以更正。" });
      return res.status(200).json({ invitation: data });
    }

    if (req.method === "PATCH" && body.action === "revoke") {
      const id = body.invitationId;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (typeof id !== "string" || !uuidPattern.test(id) || reason.length < 3 || reason.length > 160) {
        return res.status(400).json({ error: "请选择邀请并填写 3–160 字的撤销原因。" });
      }
      const { data: invitation, error: invitationError } = await supabase
        .from("peer_space_email_invitations")
        .select("id").eq("id", id).eq("space_id", space.id).maybeSingle();
      if (invitationError) throw invitationError;
      if (!invitation) return res.status(409).json({ error: "邀请已撤销或不存在。" });
      const { data, error } = await supabase.rpc("revoke_peer_space_email_invitation", {
        p_invitation_id: id,
        p_actor_user_id: context.user.id,
        p_reason: reason,
      });
      if (error) throw error;
      if (data !== true) return res.status(409).json({ error: "邀请已撤销或不存在。" });
      return res.status(200).json({ revoked: true });
    }

    return res.status(400).json({ error: "邀请操作无效。" });
  } catch (error) {
    await reportOperationalError({ req, area: "save", operation: "peer_space_invitation_management", error, statusCode: 503 });
    return res.status(503).json({ error: "邀请管理暂时不可用，请稍后再试。" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
