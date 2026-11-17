import type { NextApiRequest, NextApiResponse } from "next";
import { CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED } from "@/lib/guardianAccessPolicy";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  STUDENT_CONSENT_POLICY_VERSION,
  type StudentAgeBand,
  consentSummary,
} from "@/lib/studentConsent";

const consentFields = "student_user_id,age_band,consent_basis,policy_version,status,student_assented_at,guardian_user_id,guardian_consented_at,withdrawn_at,updated_at";

async function loadConsentResponse(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  const [{ data: profile, error: profileError }, { data: guardianLinks, error: guardianError }] = await Promise.all([
    supabase.from("profiles").select("id,display_name,email,role").eq("id", userId).maybeSingle(),
    supabase
      .from("guardian_student_links")
      .select("school_id,guardian_user_id,student_user_id")
      .or(`guardian_user_id.eq.${userId},student_user_id.eq.${userId}`)
      .eq("status", "active"),
  ]);
  if (profileError) throw profileError;
  if (guardianError) throw guardianError;
  const availableGuardianLinks = CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? (guardianLinks || []) : [];

  if (profile?.role === "学生") {
    const { data: consent, error } = await supabase
      .from("student_consents")
      .select(consentFields)
      .eq("student_user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return {
      role: "student" as const,
      consentRevision: consent?.updated_at || null,
      policyVersion: STUDENT_CONSENT_POLICY_VERSION,
      consent: consentSummary(
        consent,
        userId,
        profile.display_name || profile.email || "学生",
        availableGuardianLinks.some((link) => link.student_user_id === userId),
      ),
      children: [],
    };
  }

  if (profile?.role === "家长") {
    const childLinks = availableGuardianLinks.filter((link) => link.guardian_user_id === userId);
    const childIds = childLinks.map((link) => link.student_user_id as string);
    const [{ data: children, error: childrenError }, { data: consents, error: consentsError }] = childIds.length
      ? await Promise.all([
          supabase.from("profiles").select("id,display_name,email").in("id", childIds),
          supabase.from("student_consents").select(consentFields).in("student_user_id", childIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (childrenError) throw childrenError;
    if (consentsError) throw consentsError;
    const childById = new Map((children || []).map((child) => [child.id as string, child]));
    const consentById = new Map((consents || []).map((consent) => [consent.student_user_id as string, consent]));
    return {
      role: "guardian" as const,
      policyVersion: STUDENT_CONSENT_POLICY_VERSION,
      consent: null,
      children: childIds.map((studentId) => {
        const child = childById.get(studentId);
        return consentSummary(
          consentById.get(studentId) || null,
          studentId,
          child?.display_name || child?.email || "孩子",
          true,
        );
      }),
    };
  }

  return { role: "other" as const, policyVersion: STUDENT_CONSENT_POLICY_VERSION, consent: null, children: [] };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录。" });
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const operationId = req.query?.operationId;
      if (operationId !== undefined && (typeof operationId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId))) {
        return res.status(400).json({ error: "无法识别的确认操作。" });
      }
      if (operationId === undefined) return res.status(200).json(await loadConsentResponse(supabase, user.id));
      // Read only. An absent event does not prove that a dispatched write failed.
      const { data: event, error } = await supabase.from("student_consent_events")
        .select("id,student_user_id,actor_user_id,event_type,age_band,consent_basis,policy_version")
        .eq("id", operationId).eq("student_user_id", user.id).eq("actor_user_id", user.id).maybeSingle();
      if (error) throw error;
      const receipt = event ? {
        operationId: event.id, eventId: event.id, studentUserId: event.student_user_id, actorUserId: event.actor_user_id,
        action: event.event_type === "consent_withdrawn" ? "withdraw"
          : ["student_assented", "declared_under_14"].includes(event.event_type) ? "student_assent" : null,
        ageBand: event.age_band, consentBasis: event.consent_basis, policyVersion: event.policy_version,
      } : null;
      const snapshot = await loadConsentResponse(supabase, user.id);
      return res.status(200).json({ ...snapshot, verification: { operationId: operationId.toLowerCase(), event: receipt } });
    }

    if (req.method === "POST" && req.body?.action === "guardian_consent") {
      return res.status(403).json({ error: "当前试点未开放家长确认。" });
    }
    const action = req.method === "DELETE" ? "withdraw"
      : req.body?.action === "student_assent" ? "student_assent" : null;
    if (action) {
      if (["actorUserId", "p_actor_user_id", "p_student_user_id"].some(field =>
        req.body?.[field] !== undefined && req.body[field] !== user.id)) {
        return res.status(403).json({ error: "当前试点只有学生本人可以更新确认。" });
      }
      const target = (typeof req.body?.studentUserId === "string" ? req.body.studentUserId.trim() : "") || user.id;
      if (target !== user.id) return res.status(403).json({ error: "当前试点只有学生本人可以更新确认。" });
      const ageBand = action === "student_assent" ? req.body?.ageBand as StudentAgeBand : null;
      if (action === "student_assent" && !["under_14", "14_17", "18_plus"].includes(ageBand || "")) {
        return res.status(400).json({ error: "请选择年龄范围。" });
      }
      const operationId = typeof req.body?.operationId === "string" ? req.body.operationId.toLowerCase() : req.body?.operationId;
      const expected = req.body?.expectedUpdatedAt;
      if (typeof operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)
        || (expected !== null && (typeof expected !== "string" || !Number.isFinite(Date.parse(expected))))) {
        return res.status(400).json({ error: "请重新读取确认状态后再操作。" });
      }
      const { data: operation, error } = await supabase.rpc("apply_student_consent", {
        p_actor_user_id: user.id, p_student_user_id: user.id, p_action: action,
        p_age_band: ageBand, p_expected_updated_at: expected, p_operation_id: operationId,
      });
      if (error) throw error; // No legacy writes, retries or fallback when the RPC is unavailable.
      const outcome = operation?.outcome;
      if (["denied", "invalid", "not_found", "conflict", "operation_mismatch"].includes(outcome)) {
        const status = outcome === "denied" ? 403 : outcome === "invalid" ? 400 : outcome === "not_found" ? 404 : 409;
        return res.status(status).json({ writeOutcome: "not_committed", error: outcome === "denied"
          ? "只有学生本人可以更新确认。" : outcome === "not_found" ? "尚未找到可撤回的确认。" : "确认状态已变化，请重新读取后再操作。" });
      }
      if (!["applied", "replayed"].includes(outcome) || operation.operationId !== operationId
        || operation.eventId !== operationId || operation.action !== action
        || operation.studentUserId !== user.id || operation.actorUserId !== user.id) throw new Error("invalid_consent_receipt");
      return res.status(200).json({ ...await loadConsentResponse(supabase, user.id), operation });
    }

    return res.status(400).json({ error: "无法识别的确认操作。" });
  } catch (error) {
    void error;
    return res.status(500).json({ error: "知情同意状态暂时无法更新，请稍后再试。" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
