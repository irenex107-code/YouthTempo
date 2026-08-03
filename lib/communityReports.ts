export const communityReportCategories = [
  {
    value: "immediate_danger",
    label: "有人正处于危险中",
    hint: "明确威胁、正在被伤害、鼓励自伤自杀或无法保证安全。",
    priority: "urgent",
    targetHours: 2,
  },
  {
    value: "sexual_harm",
    label: "涉未成年人色情或性侵害",
    hint: "性诱导、性剥削、索要私密影像或传播相关内容。",
    priority: "urgent",
    targetHours: 2,
  },
  {
    value: "bullying_threat",
    label: "欺凌、辱骂或威胁",
    hint: "持续羞辱、诽谤、恶意损害形象、骚扰或威胁。",
    priority: "high",
    targetHours: 24,
  },
  {
    value: "privacy_exposure",
    label: "泄露隐私或个人信息",
    hint: "姓名、学校、住址、联系方式、账号或私密经历被公开。",
    priority: "high",
    targetHours: 24,
  },
  {
    value: "harmful_content",
    label: "危险或不适宜内容",
    hint: "暴力、赌博、违法行为，或诱导不安全模仿的内容。",
    priority: "high",
    targetHours: 24,
  },
  {
    value: "fraud_spam",
    label: "诈骗、广告或垃圾信息",
    hint: "索要钱款、可疑链接、冒充身份、重复营销或刷屏。",
    priority: "standard",
    targetHours: 72,
  },
  {
    value: "other",
    label: "其他违反社区规则",
    hint: "不属于以上类型，但可能伤害他人或破坏社区安全。",
    priority: "standard",
    targetHours: 72,
  },
] as const;

export type CommunityReportCategory = (typeof communityReportCategories)[number]["value"];
export type CommunityReportPriority = "urgent" | "high" | "standard";

export function isCommunityReportCategory(value: unknown): value is CommunityReportCategory {
  return communityReportCategories.some((item) => item.value === value);
}

export function communityReportCategory(value: CommunityReportCategory) {
  return communityReportCategories.find((item) => item.value === value)!;
}

export const communityReportPriorityLabels: Record<CommunityReportPriority, string> = {
  urgent: "紧急优先",
  high: "优先处理",
  standard: "常规处理",
};

export function communityReportStatusLabel(status: string) {
  if (status === "resolved") return "已完成复核";
  if (status === "reviewing") return "复核中";
  return "已提交";
}
