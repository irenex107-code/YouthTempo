import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";

type FeedbackRow = {
  id: string;
  user_id: string;
  age_band: "14_17" | "18_plus";
  feature: string;
  outcome: "dismissed" | "submitted";
  helpful: boolean | null;
  would_return: boolean | null;
  wants_human_support: boolean | null;
  comment: string | null;
  safety_review: boolean;
  review_status: string;
  created_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const { supabase } = await requirePlatformAdmin(req);
    const { data, error } = await supabase.from("pilot_experience_feedback")
      .select("id,user_id,age_band,feature,outcome,helpful,would_return,wants_human_support,comment,safety_review,review_status,created_at")
      .order("created_at", { ascending: false }).limit(1000);
    if (error) throw error;
    const rows = (data || []) as FeedbackRow[];
    const submissions = rows.filter((item) => item.outcome === "submitted");
    const ratio = (key: "helpful" | "would_return" | "wants_human_support") => {
      const answered = submissions.filter((item) => item[key] !== null);
      return answered.length ? Number((answered.filter((item) => item[key] === true).length / answered.length).toFixed(3)) : null;
    };
    const countBy = (key: "feature" | "age_band") => Object.fromEntries([...new Set(submissions.map((item) => item[key]))]
      .map((value) => [value, submissions.filter((item) => item[key] === value).length]));
    return res.status(200).json({
      sampleLimited: rows.length === 1000,
      people: new Set(rows.map((item) => item.user_id)).size,
      submissions: submissions.length,
      byFeature: countBy("feature"),
      byAge: countBy("age_band"),
      ratios: {
        helpful: ratio("helpful"),
        wouldReturn: ratio("would_return"),
        wantsHumanSupport: ratio("wants_human_support"),
      },
      pendingSafety: submissions.filter((item) => item.safety_review && item.review_status === "pending").length,
      comments: submissions.filter((item) => item.comment).slice(0, 100).map((item) => ({
        id: item.id,
        feature: item.feature,
        ageBand: item.age_band,
        comment: item.comment,
        safetyReview: item.safety_review,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("请先登录") ? 401 : message.includes("只有平台管理员") ? 403 : 503;
    if (status === 503) {
      await reportOperationalError({ req, area: "save", operation: "pilot_experience_summary", error, statusCode: 503 });
    }
    return res.status(status).json({ error: t("microFeedback.errors.unavailable") });
  }
}
