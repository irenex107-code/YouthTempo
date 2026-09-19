import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isUuid } from "@/lib/supportWorkflow";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale : req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const { supabase, user } = await requirePlatformAdmin(req);
    if (req.method === "GET") {
      const targetId = req.query.userId;
      if (req.query.evidence === "1") {
        if (!isUuid(targetId)) return res.status(400).json({ error: t("supportFlow.errors.invalid") });
        const { data: row, error } = await supabase.from("support_staff_applications")
          .select("evidence_path").eq("user_id", targetId).maybeSingle();
        if (error) throw error;
        if (!row?.evidence_path) return res.status(404).json({ error: t("supportFlow.errors.evidence") });
        const { data, error: signedError } = await supabase.storage.from("support-staff-evidence")
          .createSignedUrl(row.evidence_path, 60);
        if (signedError) throw signedError;
        return res.status(200).json({ url: data.signedUrl, expiresIn: 60 });
      }
      const { data, error } = await supabase.from("support_staff_applications")
        .select("user_id,category,status,legal_name,credential_type,credential_number,evidence_path,service_languages,age_scopes,service_scope,availability,institution_name,boundaries_confirmed,crisis_rules_confirmed,privacy_rules_confirmed,review_note,submitted_at,reviewed_at")
        .order("submitted_at", { ascending: false }).limit(100);
      if (error) throw error;
      const userIds = (data || []).map((item) => item.user_id);
      const { data: training, error: trainingError } = userIds.length
        ? await supabase.from("support_staff_training_records")
          .select("staff_user_id").in("staff_user_id", userIds)
        : { data: [], error: null };
      if (trainingError) throw trainingError;
      return res.status(200).json({ applications: (data || []).map((item) => ({
        ...item, evidence_path: item.evidence_path ? "uploaded" : null,
        training_count: (training || []).filter((record) => record.staff_user_id === item.user_id).length,
      })) });
    }
    const action = req.body?.action;
    const targetId = req.body?.userId;
    if (!isUuid(targetId)) return res.status(400).json({ error: t("supportFlow.errors.invalid") });
    if (action === "record_training") {
      const title = typeof req.body?.trainingTitle === "string" ? req.body.trainingTitle.trim() : "";
      const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      const completedAt = req.body?.completedAt;
      if (!title || title.length > 160 || note.length > 500
        || typeof completedAt !== "string" || !Number.isFinite(Date.parse(completedAt))) {
        return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      }
      const { data: application, error: applicationError } = await supabase.from("support_staff_applications")
        .select("user_id").eq("user_id", targetId).maybeSingle();
      if (applicationError) throw applicationError;
      if (!application) return res.status(404).json({ error: t("supportFlow.errors.invalid") });
      const { error } = await supabase.from("support_staff_training_records").insert({
        staff_user_id: targetId, training_title: title,
        completed_at: new Date(completedAt).toISOString(),
        verified_by: user.id, note: note || null,
      });
      if (error) throw error;
      return res.status(201).json({ recorded: true });
    }
    if (action === "invite_school_teacher") {
      const schoolId = req.body?.schoolId;
      const legalName = typeof req.body?.legalName === "string" ? req.body.legalName.trim() : "";
      if (!isUuid(schoolId) || legalName.length < 2 || legalName.length > 120) {
        return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      }
      const { data: membership, error: membershipError } = await supabase.from("school_members")
        .select("user_id").eq("user_id", targetId).eq("school_id", schoolId)
        .eq("member_role", "school_support").eq("status", "active").maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return res.status(403).json({ error: t("supportFlow.errors.staffScope") });
      const { error } = await supabase.from("support_staff_applications").insert({
        user_id: targetId,
        category: "school_duty_teacher",
        status: "pending",
        legal_name: legalName,
        service_languages: ["zh-CN"],
        age_scopes: ["14_17"],
        service_scope: "school_support",
        availability: "to_be_confirmed",
        boundaries_confirmed: false,
        crisis_rules_confirmed: false,
        privacy_rules_confirmed: false,
        invited_by: user.id,
      });
      if (error) {
        if (error.code === "23505") return res.status(409).json({ error: t("supportFlow.errors.locked") });
        throw error;
      }
      return res.status(201).json({ invited: true });
    }
    if (action !== "review") return res.status(400).json({ error: t("supportFlow.errors.invalid") });
    const nextStatus = req.body?.status;
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!["trial", "approved", "paused", "removed", "rejected"].includes(nextStatus)
      || note.length > 500) return res.status(400).json({ error: t("supportFlow.errors.invalid") });
    const { data: current, error: currentError } = await supabase.from("support_staff_applications")
      .select("category,status,evidence_path,credential_type,credential_number,boundaries_confirmed,crisis_rules_confirmed,privacy_rules_confirmed")
      .eq("user_id", targetId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return res.status(404).json({ error: t("supportFlow.errors.invalid") });
    if (["trial", "approved"].includes(nextStatus)
      && (!current.boundaries_confirmed || !current.crisis_rules_confirmed || !current.privacy_rules_confirmed
        || (current.category !== "school_duty_teacher" && !current.evidence_path)
        || (current.category === "counselor" && (!current.credential_type || !current.credential_number)))) {
      return res.status(409).json({ error: t("supportFlow.errors.evidence") });
    }
    const allowed: Record<string, string[]> = {
      pending: ["trial", "approved", "rejected"],
      trial: ["approved", "paused", "removed", "rejected"],
      approved: ["paused", "removed"],
      paused: ["approved", "removed"],
      rejected: ["trial", "approved"],
      removed: [],
    };
    if (!allowed[current.status]?.includes(nextStatus)) {
      return res.status(409).json({ error: t("supportFlow.errors.locked") });
    }
    const { data: updated, error } = await supabase.from("support_staff_applications")
      .update({ status: nextStatus, review_note: note || null, reviewed_by: user.id,
        reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", targetId).eq("status", current.status).select("status").maybeSingle();
    if (error) throw error;
    if (!updated) return res.status(409).json({ error: t("supportFlow.errors.locked") });
    return res.status(200).json({ status: updated.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("请先登录") ? 401 : message.includes("只有平台管理员") ? 403 : 503;
    if (status === 503) await reportOperationalError({ req, area: "save", operation: "support_staff_review", error, statusCode: 503 });
    return res.status(status).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "5kb" } } };
