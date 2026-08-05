import type { NextApiRequest, NextApiResponse } from "next";
import { requirePlatformAdmin } from "@/lib/adminAccess";
import { parseProfessionalVerificationReview } from "@/lib/professionalVerification";

const verificationFields = [
  "user_id",
  "status",
  "institution_name",
  "position_title",
  "credential_type",
  "credential_number",
  "credential_issuer",
  "credential_expires_on",
  "evidence_reference",
  "applicant_statement",
  "verification_basis",
  "credential_verified",
  "institution_verified",
  "submitted_at",
  "reviewed_at",
  "review_note",
  "revoked_at",
  "created_at",
  "updated_at",
].join(",");

type VerificationRow = Record<string, unknown> & { user_id: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const context = await requirePlatformAdmin(req);
    const { supabase } = context;

    if (req.method === "PATCH") {
      const review = parseProfessionalVerificationReview(req.body);
      const { data, error } = await supabase.rpc("review_professional_verification", {
        p_user_id: review.userId,
        p_action: review.action,
        p_note: review.note,
        p_actor_user_id: context.user.id,
      });
      if (error) throw error;
      return res.status(200).json({ verification: Array.isArray(data) ? data[0] : data });
    }

    const { data: verifications, error: verificationError } = await supabase
      .from("professional_verifications")
      .select(verificationFields)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (verificationError) throw verificationError;

    const verificationRows = (verifications || []) as unknown as VerificationRow[];
    const userIds = verificationRows.map((item) => item.user_id);
    const [{ data: profiles, error: profileError }, { data: events, error: eventError }] = await Promise.all([
      userIds.length
        ? supabase.from("profiles").select("id,email,display_name,role,school_id").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase
            .from("professional_verification_events")
            .select("id,user_id,actor_user_id,action,previous_status,new_status,note,created_at")
            .in("user_id", userIds)
            .order("created_at", { ascending: false })
            .limit(1000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (profileError) throw profileError;
    if (eventError) throw eventError;
    const profileById = new Map((profiles || []).map((profile) => [profile.id as string, profile]));

    return res.status(200).json({
      verifications: verificationRows.map((verification) => ({
        ...verification,
        profile: profileById.get(verification.user_id as string) || null,
        events: (events || []).filter((event) => event.user_id === verification.user_id),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "专业身份审核暂时无法处理。";
    const lower = message.toLowerCase();
    if (message.includes("请先登录") || lower.includes("jwt")) return res.status(401).json({ error: "请先登录平台管理员账号。" });
    if (message.includes("只有平台管理员")) return res.status(403).json({ error: message });
    if (
      message.startsWith("请选择")
      || message.startsWith("请用")
      || message.includes("incomplete_or_expired")
      || message.includes("note_required")
    ) {
      const safeMessage = message.includes("incomplete_or_expired")
        ? "资料不完整或资质已经过期，暂时不能通过。"
        : message.includes("note_required")
          ? "请填写处理说明。"
          : message;
      return res.status(400).json({ error: safeMessage });
    }
    if (message.includes("not_found")) return res.status(404).json({ error: "找不到这份专业身份申请。" });
    return res.status(500).json({ error: "专业身份审核暂时无法处理，请稍后再试。" });
  }
}
