import { expect, test } from "@playwright/test";
import { buildReferralGuidance, REFERRAL_RULE_VERSION } from "@/lib/referralRules";

const baseInput = {
  currentStates: ["情绪压力比较大"],
  affectedAreas: ["情绪表达"],
  duration: "只是今天",
  impact: "基本没有",
  adultWillingness: "暂时不想",
  preferredSupport: ["自己先整理一下"],
  mainNeed: "一个具体小步骤",
};

test("Referral 规则从低压力自助路径开始", () => {
  const result = buildReferralGuidance(baseInput, "zh-CN");
  expect(result).toMatchObject({
    decisionMethod: "deterministic_rules",
    decisionVersion: REFERRAL_RULE_VERSION,
    supportTier: "self_guided",
  });
  expect(result.recommendedSupport).toContain("自我整理");
  expect(result.supportReminder).toContain("不是评估或诊断");
});

test("愿意让人倾听时优先可信任的真人", () => {
  const result = buildReferralGuidance({
    ...baseInput,
    adultWillingness: "愿意",
    preferredSupport: ["有人听我说"],
  }, "zh-CN");
  expect(result.recommendedSupport).toContain("家长、老师");
  expect(result.recommendedSupport).toContain("可信任成年人");
  expect(result.supportTier).toBe("trusted_adult");
  expect(result.nextStep).toContain("先听我");
});

test("持续或明显影响时升级学校或专业真人支持", () => {
  const school = buildReferralGuidance({
    ...baseInput,
    duration: "一两周",
    impact: "有一点影响",
  }, "zh-CN");
  expect(school.recommendedSupport).toContain("学校");
  expect(school.supportTier).toBe("school_support");

  const professional = buildReferralGuidance({
    ...baseInput,
    duration: "更久一些",
    impact: "已经明显影响",
  }, "zh-CN");
  expect(professional.recommendedSupport).toContain("有资质的心理专业人员");
  expect(professional.supportTier).toBe("professional_support");
});

test("英文规则返回同一决策版本且不使用诊断标签", () => {
  const result = buildReferralGuidance({
    ...baseInput,
    duration: "One or two weeks",
    impact: "It is having a clear impact",
    preferredSupport: ["Professional support"],
  }, "en");
  expect(result.decisionVersion).toBe(REFERRAL_RULE_VERSION);
  expect(result.recommendedSupport).toContain("qualified mental health professional");
  expect(result.supportReminder).toContain("not a diagnosis");
});

test("Referral 页面明确显示规则化且非 AI 生成", async ({ page }) => {
  await page.goto("/referral");
  for (const option of ["情绪压力比较大", "只是今天"]) {
    await page.getByRole("button", { name: option, exact: true }).click();
  }
  await page.getByRole("button", { name: "基本没有", exact: true }).first().click();
  await page.getByRole("button", { name: "基本没有", exact: true }).first().click();
  for (const option of ["暂时不想", "自己先整理一下", "一个具体小步骤"]) {
    await page.getByRole("button", { name: option, exact: true }).click();
  }
  await page.getByRole("button", { name: "查看支持路径", exact: true }).click();

  await expect(page.getByText("规则化支持路径 · 非 AI 生成", { exact: true })).toBeVisible();
  await expect(page.getByText("发送前，请先了解这次 AI 如何参与", { exact: true })).toHaveCount(0);
});
