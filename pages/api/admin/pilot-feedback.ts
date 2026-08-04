import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import { PILOT_FEEDBACK_VERSION, type PilotFeedbackRole } from "@/lib/pilotFeedback";

type FeedbackRow = {
  id: string;
  user_id: string;
  role: PilotFeedbackRole;
  overall_experience: number;
  clarity: number;
  safety: number;
  most_helpful: string;
  hard_to_use: string;
  suggestion: string;
  may_contact: boolean;
  created_at: string;
  updated_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { supabase } = await requirePlatformAdmin(req);
    const { data, error } = await supabase
      .from("pilot_feedback")
      .select("id,user_id,role,overall_experience,clarity,safety,most_helpful,hard_to_use,suggestion,may_contact,created_at,updated_at")
      .eq("form_version", PILOT_FEEDBACK_VERSION)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const feedback = (data || []) as FeedbackRow[];
    const contactUserIds = feedback.filter((item) => item.may_contact).map((item) => item.user_id);
    const { data: contactProfiles, error: contactError } = contactUserIds.length
      ? await supabase.from("profiles").select("id,email").in("id", contactUserIds)
      : { data: [], error: null };
    if (contactError) throw contactError;
    const contactEmailById = new Map((contactProfiles || []).map((profile) => [profile.id as string, profile.email as string | null]));
    const average = (key: "overall_experience" | "clarity" | "safety") =>
      feedback.length ? Number((feedback.reduce((sum, item) => sum + item[key], 0) / feedback.length).toFixed(1)) : null;
    return res.status(200).json({
      version: PILOT_FEEDBACK_VERSION,
      counts: {
        total: feedback.length,
        student: feedback.filter((item) => item.role === "student").length,
        guardian: feedback.filter((item) => item.role === "guardian").length,
        teacher: feedback.filter((item) => item.role === "teacher").length,
      },
      averages: { overallExperience: average("overall_experience"), clarity: average("clarity"), safety: average("safety") },
      feedback: feedback.map(({ user_id, ...item }) => ({
        ...item,
        contact_email: item.may_contact ? contactEmailById.get(user_id) || null : null,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "试点反馈暂时无法读取。";
    return res.status(message.includes("请先登录") ? 401 : message.includes("只有平台管理员") ? 403 : 500).json({ error: message });
  }
}
