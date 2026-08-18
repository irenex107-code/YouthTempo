export const AI_NOTICE_VERSION = "ai-notice-2026-08-18-v2";

export function hasAcceptedCurrentAiNotice(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return payload.aiNoticeAccepted === true && payload.aiNoticeVersion === AI_NOTICE_VERSION;
}
