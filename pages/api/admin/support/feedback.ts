import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isUuid } from "@/lib/supportWorkflow";

type Feedback = {
  case_id: string;
  felt_heard: boolean | null;
  found_help: boolean | null;
  boundaries_respected: boolean | null;
  would_choose_again: boolean | null;
  complaint: boolean;
  safety_review: boolean;
  comment: string | null;
  review_status: "pending" | "reviewed";
  created_at: string;
};

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
    if (req.method === "POST") {
      const caseId = req.body?.caseId;
      const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (!isUuid(caseId) || note.length > 500) return res.status(400).json({ error: t("supportFlow.errors.invalid") });
      const { data, error } = await supabase.rpc("review_support_case_feedback", {
        p_case_id: caseId, p_actor_id: user.id, p_note: note,
      });
      if (error) throw error;
      if (!data) return res.status(409).json({ error: t("supportFlow.errors.notReady") });
      return res.status(200).json({ reviewed: true });
    }
    const { data, error } = await supabase.from("support_case_feedback")
      .select("case_id,felt_heard,found_help,boundaries_respected,would_choose_again,complaint,safety_review,comment,review_status,created_at")
      .order("created_at", { ascending: false }).limit(1000);
    if (error) throw error;
    const rows = (data || []) as Feedback[];
    const ratio = (key: "felt_heard" | "found_help" | "boundaries_respected" | "would_choose_again") => {
      const answered = rows.filter((item) => item[key] !== null);
      return answered.length ? Number((answered.filter((item) => item[key] === true).length / answered.length).toFixed(3)) : null;
    };
    return res.status(200).json({
      sampleLimited: rows.length === 1000,
      count: rows.length,
      ratios: {
        feltHeard: ratio("felt_heard"),
        foundHelp: ratio("found_help"),
        boundariesRespected: ratio("boundaries_respected"),
        wouldChooseAgain: ratio("would_choose_again"),
      },
      pendingComplaints: rows.filter((item) => (item.complaint || item.safety_review) && item.review_status === "pending").length,
      feedback: rows.filter((item) => item.complaint || item.safety_review || item.comment).slice(0, 100)
        .map((item) => ({
          caseId: item.case_id, complaint: item.complaint, safetyReview: item.safety_review,
          comment: item.comment, reviewStatus: item.review_status, createdAt: item.created_at,
        })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("请先登录") ? 401 : message.includes("只有平台管理员") ? 403 : 503;
    if (status === 503) await reportOperationalError({ req, area: "save", operation: "support_feedback_admin", error, statusCode: 503 });
    return res.status(status).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "3kb" } } };
