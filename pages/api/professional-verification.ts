import type { NextApiRequest, NextApiResponse } from "next";
import { parseProfessionalVerificationSubmission } from "@/lib/professionalVerification";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

const selectFields = [
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
  "submitted_at",
  "reviewed_at",
  "review_note",
].join(",");

type VerificationRow = {
  status: string;
  institution_name: string | null;
  position_title: string | null;
  credential_type: string | null;
  credential_number: string | null;
  credential_issuer: string | null;
  credential_expires_on: string | null;
  evidence_reference: string | null;
  applicant_statement: string | null;
  verification_basis: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.email) return res.status(401).json({ error: "请先登录，再查看或提交专业身份资料。" });
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("professional_verifications")
        .select(selectFields)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      const verification = data as unknown as VerificationRow | null;
      return res.status(200).json({
        verification: verification ? {
          status: verification.status,
          institutionName: verification.institution_name,
          positionTitle: verification.position_title,
          credentialType: verification.credential_type,
          credentialNumber: verification.credential_number,
          credentialIssuer: verification.credential_issuer,
          credentialExpiresOn: verification.credential_expires_on,
          evidenceReference: verification.evidence_reference,
          applicantStatement: verification.applicant_statement,
          submittedAt: verification.submitted_at,
          reviewedAt: verification.reviewed_at,
          reviewNote: verification.review_note,
          legacyConfirmed: verification.verification_basis === "legacy_platform_confirmation",
        } : null,
      });
    }

    const submission = parseProfessionalVerificationSubmission(req.body);
    const { data, error } = await supabase.rpc("submit_professional_verification", {
      p_user_id: user.id,
      p_institution_name: submission.institutionName,
      p_position_title: submission.positionTitle,
      p_credential_type: submission.credentialType,
      p_credential_number: submission.credentialNumber,
      p_credential_issuer: submission.credentialIssuer,
      p_credential_expires_on: submission.credentialExpiresOn,
      p_evidence_reference: submission.evidenceReference,
      p_applicant_statement: submission.applicantStatement,
    });
    if (error) throw error;
    return res.status(200).json({ verification: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "专业身份资料暂时无法处理。";
    if (message.includes("already_active")) {
      return res.status(409).json({ error: "你的专业身份已经通过确认，如需更新资料请先联系平台管理员。" });
    }
    if (message.includes("expired")) return res.status(400).json({ error: "已过期的资质不能提交审核。" });
    if (message.includes("请先登录") || message.toLowerCase().includes("jwt")) {
      return res.status(401).json({ error: "请先登录，再查看或提交专业身份资料。" });
    }
    const status = message.startsWith("请填写") || message.includes("字符以内") ? 400 : 500;
    return res.status(status).json({ error: status === 400 ? message : "专业身份资料暂时无法处理，请稍后再试。" });
  }
}
