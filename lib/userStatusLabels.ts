import type { TranslationKey } from "@/lib/i18n/dictionaries";

function knownKey(value: unknown, values: readonly string[], prefix: string): TranslationKey {
  return typeof value === "string" && values.includes(value)
    ? `${prefix}.${value}` as TranslationKey : "roleFollowup.unknownStatus";
}

export function supportCaseStatusKey(value: unknown): TranslationKey {
  return knownKey(value, ["requested", "triage", "awaiting_assignment", "assigned", "active", "paused",
    "transfer_requested", "transferred", "referred", "closed", "cancelled"], "supportFlow.portal.status");
}

export function supportStaffStatusKey(value: unknown): TranslationKey {
  return knownKey(value, ["pending", "trial", "approved", "paused", "removed", "rejected"], "supportStaff.status");
}

export function supportStaffCategoryKey(value: unknown): TranslationKey {
  return knownKey(value, ["counselor", "social_worker", "listening_volunteer", "school_duty_teacher"], "supportStaff.categories");
}

export function supportAssignmentRoleKey(value: unknown): TranslationKey {
  return value === "primary" ? "supportFlow.portal.primary" : value === "backup" ? "supportFlow.portal.backup" : "roleFollowup.unknownStatus";
}

export function supportAssignmentStatusKey(value: unknown): TranslationKey {
  return knownKey(value, ["offered", "accepted", "rejected", "revoked"], "roleFollowup.assignmentStatus");
}

export function peerReviewStatusKey(value: unknown): TranslationKey {
  if (value === "pending") return "roleFollowup.reviewPending";
  return knownKey(value, ["assigned", "reviewing", "action_required", "referred", "resolved", "closed"], "peerSpaceReview.status");
}

export function peerMessageStatusKey(value: unknown): TranslationKey {
  return knownKey(value, ["visible", "safety_review", "hidden"], "roleFollowup.messageStatus");
}

export function peerReviewCategoryKey(value: unknown): TranslationKey {
  return knownKey(value, ["crisis", "harassment", "privacy", "report", "other"], "roleFollowup.reviewCategory");
}

export function reviewPriorityKey(value: unknown): TranslationKey {
  return knownKey(value, ["urgent", "high", "standard"], "community.report.priority");
}

export function supportFeedbackStatusKey(value: unknown): TranslationKey {
  return knownKey(value, ["pending", "reviewed"], "roleFollowup.feedbackStatus");
}
