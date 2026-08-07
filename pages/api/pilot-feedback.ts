import type { NextApiRequest, NextApiResponse } from "next";
import { PILOT_FEEDBACK_VERSION, parsePilotFeedback, resolvePilotFeedbackRole } from "@/lib/pilotFeedback";
import { requireActiveStudentConsent } from "@/lib/studentConsent";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { enforceUserRateLimit } from "@/lib/rateLimit";

const feedbackFields = "id,role,form_version,overall_experience,clarity,safety,most_helpful,hard_to_use,suggestion,may_contact,created_at,updated_at";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录。" });
    const supabase = getSupabaseAdmin();
    const role = await resolvePilotFeedbackRole(supabase, user);
    if (!role) return res.status(403).json({ error: "这份反馈目前只面向学生、家长和支持老师。" });

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("pilot_feedback")
        .select(feedbackFields)
        .eq("user_id", user.id)
        .eq("form_version", PILOT_FEEDBACK_VERSION)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({ role, version: PILOT_FEEDBACK_VERSION, feedback: data });
    }

    if (role === "student") await requireActiveStudentConsent(supabase, user.id);
    if (!(await enforceUserRateLimit({
      supabase,
      req,
      userId: user.id,
      action: "pilot_feedback_submit",
      limit: 10,
      windowSeconds: 60 * 60,
      res,
      message: "提交得有些频繁，请稍后再试。",
      area: "save",
      unavailableMessage: "反馈暂时无法提交，请稍后再试。",
    }))) return;
    const feedback = parsePilotFeedback((req.body || {}) as Record<string, unknown>);
    const { data, error } = await supabase
      .from("pilot_feedback")
      .upsert({
        user_id: user.id,
        role,
        form_version: PILOT_FEEDBACK_VERSION,
        ...feedback,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,form_version" })
      .select(feedbackFields)
      .single();
    if (error) throw error;
    return res.status(200).json({ role, version: PILOT_FEEDBACK_VERSION, feedback: data, notice: "已经收到，谢谢你认真告诉我们。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "反馈暂时没能保存，请稍后再试。";
    const statusCode = (error as Error & { statusCode?: number })?.statusCode;
    const status = statusCode || (message.includes("请先登录") ? 401 : message.includes("选择 1 到 5") || message.includes("1000 字") ? 400 : 500);
    return res.status(status).json({ error: status >= 500 ? "反馈暂时没能保存，请稍后再试。" : message });
  }
}
