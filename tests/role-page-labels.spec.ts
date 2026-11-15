import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import {
  supportCaseStatusKey, supportStaffStatusKey, supportStaffCategoryKey, supportAssignmentRoleKey,
  supportAssignmentStatusKey, peerReviewStatusKey, peerMessageStatusKey, peerReviewCategoryKey,
  reviewPriorityKey, supportFeedbackStatusKey,
} from "../lib/userStatusLabels";

const mappings = [
  { label: "support case", key: supportCaseStatusKey, prefix: "supportFlow.portal.status", values: ["requested", "triage", "awaiting_assignment", "assigned", "active", "paused", "transfer_requested", "transferred", "referred", "closed", "cancelled"] },
  { label: "staff status", key: supportStaffStatusKey, prefix: "supportStaff.status", values: ["pending", "trial", "approved", "paused", "removed", "rejected"] },
  { label: "staff category", key: supportStaffCategoryKey, prefix: "supportStaff.categories", values: ["counselor", "social_worker", "listening_volunteer", "school_duty_teacher"] },
  { label: "assignment status", key: supportAssignmentStatusKey, prefix: "roleFollowup.assignmentStatus", values: ["offered", "accepted", "rejected", "revoked"] },
  { label: "peer review", key: peerReviewStatusKey, prefix: "peerSpaceReview.status", values: ["assigned", "reviewing", "action_required", "referred", "resolved", "closed"] },
  { label: "message status", key: peerMessageStatusKey, prefix: "roleFollowup.messageStatus", values: ["visible", "safety_review", "hidden"] },
  { label: "review category", key: peerReviewCategoryKey, prefix: "roleFollowup.reviewCategory", values: ["crisis", "harassment", "privacy", "report", "other"] },
  { label: "priority", key: reviewPriorityKey, prefix: "community.report.priority", values: ["urgent", "high", "standard"] },
  { label: "feedback status", key: supportFeedbackStatusKey, prefix: "roleFollowup.feedbackStatus", values: ["pending", "reviewed"] },
];
const textAt = (dictionary: unknown, key: string) => key.split(".").reduce<unknown>((value, part) =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, dictionary);

for (const mapping of mappings) {
  test(`${mapping.label} 的已知值使用存在的中英文标签`, () => {
    for (const value of mapping.values) {
      const key = mapping.key(value);
      expect(key).toBe(`${mapping.prefix}.${value}`);
      for (const dictionary of [zh, en]) {
        expect(textAt(dictionary, key)).toEqual(expect.any(String));
        expect(textAt(dictionary, key)).not.toBe(value);
        expect(textAt(dictionary, key)).not.toBe(key);
      }
    }
  });
}

test("分配角色与待审核状态映射到面向用户的标签", () => {
  for (const [key, expected] of [
    [supportAssignmentRoleKey("primary"), "supportFlow.portal.primary"],
    [supportAssignmentRoleKey("backup"), "supportFlow.portal.backup"],
    [peerReviewStatusKey("pending"), "roleFollowup.reviewPending"],
  ]) {
    expect(key).toBe(expected);
    expect(textAt(zh, key)).toEqual(expect.any(String));
    expect(textAt(en, key)).toEqual(expect.any(String));
  }
});

test("未知或畸形状态均使用通用标签，不输出原始值或属性名", () => {
  for (const map of [...mappings.map((mapping) => mapping.key), supportAssignmentRoleKey]) {
    for (const value of [undefined, null, "", "future_private_status", "constructor", "__proto__", 1, {}, ["pending"]]) {
      expect(map(value)).toBe("roleFollowup.unknownStatus");
    }
  }
  for (const dictionary of [zh, en]) {
    expect(textAt(dictionary, "roleFollowup.unknownStatus")).toEqual(expect.any(String));
    expect(textAt(dictionary, "roleFollowup.unknownStatus")).not.toBe("roleFollowup.unknownStatus");
  }
});
