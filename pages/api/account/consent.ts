import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  STUDENT_CONSENT_POLICY_VERSION,
  type StudentAgeBand,
  consentSummary,
} from "@/lib/studentConsent";

const consentFields = "student_user_id,age_band,policy_version,status,student_assented_at,guardian_user_id,guardian_consented_at,withdrawn_at";

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

  if (profile?.role === "学生") {
    const { data: consent, error } = await supabase
      .from("student_consents")
      .select(consentFields)
      .eq("student_user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return {
      role: "student" as const,
      policyVersion: STUDENT_CONSENT_POLICY_VERSION,
      consent: consentSummary(
        consent,
        userId,
        profile.display_name || profile.email || "学生",
        (guardianLinks || []).some((link) => link.student_user_id === userId),
      ),
      children: [],
    };
  }

  if (profile?.role === "家长") {
    const childLinks = (guardianLinks || []).filter((link) => link.guardian_user_id === userId);
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

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录。" });
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") return res.status(200).json(await loadConsentResponse(supabase, user.id));

    if (req.method === "POST" && req.body?.action === "student_assent") {
      const ageBand = req.body?.ageBand as StudentAgeBand;
      if (!["under_14", "14_17", "18_plus"].includes(ageBand)) {
        return res.status(400).json({ error: "请选择年龄范围。" });
      }
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role,school_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (profile?.role !== "学生") return res.status(403).json({ error: "只有学生账号需要完成学生确认。" });

      const now = new Date().toISOString();
      const status = ageBand === "under_14" ? "ineligible" : ageBand === "18_plus" ? "active" : "pending_guardian";
      const { error } = await supabase.from("student_consents").upsert({
        student_user_id: user.id,
        school_id: profile.school_id || null,
        age_band: ageBand,
        policy_version: STUDENT_CONSENT_POLICY_VERSION,
        status,
        student_assented_at: ageBand === "under_14" ? null : now,
        guardian_user_id: null,
        guardian_consented_at: null,
        withdrawn_at: null,
        withdrawn_by: null,
        updated_at: now,
      });
      if (error) throw error;
      const { error: eventError } = await supabase.from("student_consent_events").insert({
        student_user_id: user.id,
        school_id: profile.school_id || null,
        actor_user_id: user.id,
        event_type: ageBand === "under_14" ? "declared_under_14" : "student_assented",
        age_band: ageBand,
        policy_version: STUDENT_CONSENT_POLICY_VERSION,
      });
      if (eventError) throw eventError;
      return res.status(200).json(await loadConsentResponse(supabase, user.id));
    }

    if (req.method === "POST" && req.body?.action === "guardian_consent") {
      const studentUserId = typeof req.body?.studentUserId === "string" ? req.body.studentUserId.trim() : "";
      if (!studentUserId) return res.status(400).json({ error: "请选择孩子账号。" });
      const { data: link, error: linkError } = await supabase
        .from("guardian_student_links")
        .select("school_id")
        .eq("guardian_user_id", user.id)
        .eq("student_user_id", studentUserId)
        .eq("status", "active")
        .maybeSingle();
      if (linkError) throw linkError;
      if (!link) return res.status(403).json({ error: "只有学校已确认关联的监护人可以完成确认。" });
      const { data: consent, error: consentError } = await supabase
        .from("student_consents")
        .select("age_band,policy_version,status,student_assented_at")
        .eq("student_user_id", studentUserId)
        .maybeSingle();
      if (consentError) throw consentError;
      if (!consent || consent.age_band !== "14_17" || !consent.student_assented_at || consent.policy_version !== STUDENT_CONSENT_POLICY_VERSION) {
        return res.status(409).json({ error: "请先让孩子在自己的账户中阅读说明并完成学生确认。" });
      }
      const now = new Date().toISOString();
      const { error } = await supabase.from("student_consents").update({
        school_id: link.school_id,
        guardian_user_id: user.id,
        guardian_consented_at: now,
        status: "active",
        withdrawn_at: null,
        withdrawn_by: null,
        updated_at: now,
      }).eq("student_user_id", studentUserId);
      if (error) throw error;
      const { error: eventError } = await supabase.from("student_consent_events").insert({
        student_user_id: studentUserId,
        school_id: link.school_id,
        guardian_user_id: user.id,
        actor_user_id: user.id,
        event_type: "guardian_consented",
        age_band: "14_17",
        policy_version: STUDENT_CONSENT_POLICY_VERSION,
      });
      if (eventError) throw eventError;
      return res.status(200).json(await loadConsentResponse(supabase, user.id));
    }

    if (req.method === "DELETE") {
      const requestedStudentId = typeof req.body?.studentUserId === "string" ? req.body.studentUserId.trim() : "";
      const studentUserId = requestedStudentId || user.id;
      if (studentUserId !== user.id) {
        const { data: link, error: linkError } = await supabase
          .from("guardian_student_links")
          .select("school_id")
          .eq("guardian_user_id", user.id)
          .eq("student_user_id", studentUserId)
          .eq("status", "active")
          .maybeSingle();
        if (linkError) throw linkError;
        if (!link) return res.status(403).json({ error: "你不能撤回这个学生账号的确认。" });
      }
      const { data: consent, error: consentError } = await supabase
        .from("student_consents")
        .select("age_band,policy_version,school_id,guardian_user_id")
        .eq("student_user_id", studentUserId)
        .maybeSingle();
      if (consentError) throw consentError;
      if (!consent) return res.status(404).json({ error: "尚未找到可撤回的确认。" });
      const now = new Date().toISOString();
      const { error } = await supabase.from("student_consents").update({
        status: "withdrawn",
        withdrawn_at: now,
        withdrawn_by: user.id,
        updated_at: now,
      }).eq("student_user_id", studentUserId);
      if (error) throw error;
      const { error: eventError } = await supabase.from("student_consent_events").insert({
        student_user_id: studentUserId,
        school_id: consent.school_id,
        guardian_user_id: consent.guardian_user_id,
        actor_user_id: user.id,
        event_type: "consent_withdrawn",
        age_band: consent.age_band,
        policy_version: consent.policy_version,
      });
      if (eventError) throw eventError;
      return res.status(200).json(await loadConsentResponse(supabase, user.id));
    }

    return res.status(400).json({ error: "无法识别的确认操作。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "知情同意状态更新失败。";
    return res.status(500).json({ error: message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
