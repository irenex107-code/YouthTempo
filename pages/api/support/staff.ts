import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { parseStaffApplication } from "@/lib/supportWorkflow";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("supportFlow.errors.signIn") });
    const supabase = getSupabaseAdmin();
    const { data: current, error: currentError } = await supabase.from("support_staff_applications")
      .select("user_id,category,status,legal_name,credential_type,credential_number,evidence_path,service_languages,age_scopes,service_scope,availability,institution_name,boundaries_confirmed,crisis_rules_confirmed,privacy_rules_confirmed,invited_by,review_note,submitted_at,reviewed_at")
      .eq("user_id", user.id).maybeSingle();
    if (currentError) throw currentError;
    if (req.method === "GET") return res.status(200).json({
      application: current ? { ...current, evidence_path: current.evidence_path ? "uploaded" : null } : null,
    });
    if (current && !["pending", "rejected"].includes(current.status)) {
      return res.status(409).json({ error: t("supportFlow.errors.locked") });
    }
    if (current?.category === "school_duty_teacher") {
      if (req.body?.action !== "confirm_invitation"
        || req.body?.boundariesConfirmed !== true
        || req.body?.crisisRulesConfirmed !== true
        || req.body?.privacyRulesConfirmed !== true) {
        return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      }
      const { error } = await supabase.from("support_staff_applications")
        .update({
          boundaries_confirmed: true, crisis_rules_confirmed: true, privacy_rules_confirmed: true,
          updated_at: new Date().toISOString(),
        }).eq("user_id", user.id).eq("status", "pending");
      if (error) throw error;
      return res.status(200).json({ saved: true });
    }
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("role").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role === "学生") {
      const { data: consent, error: consentError } = await supabase.from("student_consents")
        .select("age_band,consent_basis,status").eq("student_user_id", user.id).maybeSingle();
      if (consentError) throw consentError;
      if (consent?.age_band !== "18_plus" || consent.consent_basis !== "adult_self" || consent.status !== "active") {
        return res.status(403).json({ error: t("supportFlow.errors.noAccess") });
      }
    }
    let parsed;
    try { parsed = parseStaffApplication(req.body); }
    catch { return res.status(400).json({ error: t("supportFlow.errors.invalid") }); }
    const { error } = await supabase.from("support_staff_applications").upsert({
      ...parsed,
      user_id: user.id,
      status: "pending",
      evidence_path: current?.evidence_path || null,
      invited_by: null,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    return res.status(200).json({ saved: true });
  } catch (error) {
    await reportOperationalError({ req, area: "save", operation: "support_staff_application", error, statusCode: 503 });
    return res.status(503).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
