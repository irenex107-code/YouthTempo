export const professionalVerificationStatuses = [
  "pending",
  "needs_more_info",
  "active",
  "rejected",
  "revoked",
] as const;

export type ProfessionalVerificationStatus = (typeof professionalVerificationStatuses)[number];

export type ProfessionalVerificationSubmission = {
  institutionName: string;
  positionTitle: string;
  credentialType: string;
  credentialNumber: string;
  credentialIssuer: string;
  credentialExpiresOn: string | null;
  evidenceReference: string;
  applicantStatement: string;
};

export type ProfessionalVerificationReviewAction =
  | "approve"
  | "request_changes"
  | "reject"
  | "revoke";

function requiredText(value: unknown, label: string, min: number, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min) throw new Error(`请填写${label}。`);
  if (text.length > max) throw new Error(`${label}请控制在 ${max} 个字符以内。`);
  return text;
}

function optionalText(value: unknown, label: string, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) throw new Error(`${label}请控制在 ${max} 个字符以内。`);
  return text;
}

function normalizeExpiry(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error("请填写有效的资质到期日期。");
  }
  const today = new Date().toISOString().slice(0, 10);
  if (text < today) throw new Error("已过期的资质不能提交审核。");
  return text;
}

export function parseProfessionalVerificationSubmission(
  value: unknown,
): ProfessionalVerificationSubmission {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    institutionName: requiredText(input.institutionName, "所在机构", 2, 120),
    positionTitle: requiredText(input.positionTitle, "职务或专业方向", 2, 80),
    credentialType: requiredText(input.credentialType, "资质类型", 2, 80),
    credentialNumber: requiredText(input.credentialNumber, "资质编号", 2, 120),
    credentialIssuer: requiredText(input.credentialIssuer, "发证或登记机构", 2, 120),
    credentialExpiresOn: normalizeExpiry(input.credentialExpiresOn),
    evidenceReference: requiredText(input.evidenceReference, "核验材料说明", 5, 500),
    applicantStatement: optionalText(input.applicantStatement, "补充说明", 1000),
  };
}

export function parseProfessionalVerificationReview(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  const action = typeof input.action === "string" ? input.action.trim() : "";
  const note = optionalText(input.note, "处理说明", 1000);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("请选择要处理的申请。");
  }
  if (!["approve", "request_changes", "reject", "revoke"].includes(action)) {
    throw new Error("请选择有效的处理方式。");
  }
  if (action !== "approve" && note.length < 5) {
    throw new Error("请用至少 5 个字说明需要补充、拒绝或撤销的原因。");
  }
  return { userId, action: action as ProfessionalVerificationReviewAction, note };
}

export const professionalVerificationStatusLabels: Record<ProfessionalVerificationStatus, string> = {
  pending: "等待平台确认",
  needs_more_info: "需要补充资料",
  active: "已通过确认",
  rejected: "暂未通过",
  revoked: "确认已撤销",
};
