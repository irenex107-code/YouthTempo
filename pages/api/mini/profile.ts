import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { STUDENT_CONSENT_POLICY_VERSION, type StudentAgeBand } from "@/lib/studentConsent";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.email) return res.status(401).json({ error: "请先登录。" });
    const supabase = getSupabaseAdmin();

    if (req.method === "POST") {
      const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
      const ageBand = req.body?.ageBand as StudentAgeBand;
      if (!displayName || displayName.length > 50) return res.status(400).json({ error: "请输入 1–50 个字符的称呼。" });
      if (!["14_17", "18_plus"].includes(ageBand)) return res.status(400).json({ error: "小程序第一版仅支持 14–17 岁和已满 18 岁用户。" });

      const { data: existingProfile, error: existingError } = await supabase
        .from("profiles")
        .select("role,school_id")
        .eq("id", user.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingProfile && existingProfile.role !== "学生") {
        return res.status(403).json({ error: "小程序第一版先开放给青少年和青年个人使用。其他身份请使用网页工作台。" });
      }

      const now = new Date().toISOString();
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email.trim().toLowerCase(),
        display_name: displayName,
        role: "学生",
        school_id: existingProfile?.school_id || null,
        updated_at: now,
      });
      if (profileError) throw profileError;

      const status = ageBand === "18_plus" ? "active" : "pending_guardian";
      const { error: consentError } = await supabase.from("student_consents").upsert({
        student_user_id: user.id,
        school_id: existingProfile?.school_id || null,
        age_band: ageBand,
        policy_version: STUDENT_CONSENT_POLICY_VERSION,
        status,
        student_assented_at: now,
        guardian_user_id: null,
        guardian_consented_at: null,
        withdrawn_at: null,
        withdrawn_by: null,
        updated_at: now,
      });
      if (consentError) throw consentError;
      const { error: eventError } = await supabase.from("student_consent_events").insert({
        student_user_id: user.id,
        school_id: existingProfile?.school_id || null,
        actor_user_id: user.id,
        event_type: "student_assented",
        age_band: ageBand,
        policy_version: STUDENT_CONSENT_POLICY_VERSION,
      });
      if (eventError) throw eventError;
    }

    const [{ data: profile, error: profileError }, { data: consent, error: consentError }] = await Promise.all([
      supabase.from("profiles").select("id,display_name,role,school_id").eq("id", user.id).maybeSingle(),
      supabase.from("student_consents").select("age_band,status,policy_version").eq("student_user_id", user.id).maybeSingle(),
    ]);
    if (profileError) throw profileError;
    if (consentError) throw consentError;
    return res.status(200).json({
      profile,
      consent: consent?.policy_version === STUDENT_CONSENT_POLICY_VERSION ? consent : null,
      ready: Boolean(profile?.role === "学生" && consent?.status === "active" && consent.policy_version === STUDENT_CONSENT_POLICY_VERSION),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "个人使用状态加载失败。";
    return res.status(500).json({ error: message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };
