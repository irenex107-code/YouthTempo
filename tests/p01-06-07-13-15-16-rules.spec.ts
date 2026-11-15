import { expect, test } from "@playwright/test";
import { buildReferralGuidance } from "@/lib/referralRules";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";

const expected = {
  "zh-CN": {
    profile: "填写姓名等账号资料即可继续。学校学生、老师或负责人身份由学校邀请与成员关系确认；平台管理员职责、专业身份和提供支持资格由平台按各自流程核验，不能在这里自行选择。",
    identity: "登录邮箱和显示名称由本人提供，用于登录和账号展示。学校学生、老师或负责人身份由学校邀请与成员关系确认；平台管理员职责、专业身份和提供支持资格由平台按各自流程核验。账号类型或身份标签本身不授予具体信息访问权。",
    records: "你可以回看本人已有记录，并下载当前账户提供的导出。SWEET 按日删除，花园纪念物可删除，社区和同伴内容可从展示中移除；“想说的话”和支持事项没有逐条删除入口。你也可以申请注销账号。",
    hero: "当自己整理还不够时，用几道题整理一个起点：继续使用自助工具，联系你信任的人，或选择学校、校园、社区和专业支持。由你决定先找谁；这里不会判断你的心理状态。",
    contact: "你现在愿意联系一位信任的人，或一个可用的支持服务吗？",
    school: "学校或校园支持",
  },
  en: {
    profile: "Complete your name and other account details to continue. Student, teacher, and school-lead identities are confirmed through school invitations and memberships. Platform-administrator responsibilities, professional identity, and eligibility to provide support are verified through separate platform processes and cannot be self-selected here.",
    identity: "You provide your sign-in email and display name for sign-in and account display. Student, teacher, and school-lead identities are confirmed through school invitations and memberships. Platform-administrator responsibilities, professional identity, and eligibility to provide support are verified through separate platform processes. An account type or role label alone does not grant access to specific information.",
    records: "You can review your existing records and download the export currently provided for your account. SWEET records can be deleted by day, garden keepsakes can be deleted, and community or peer content can be removed from display. Private messages and support cases have no individual deletion option. You can also request account closure.",
    hero: "When reflecting on your own is not enough, use a few questions to organize a starting point: continue with self-guided tools, contact someone you trust, or choose school, campus, community, or professional support. You decide whom to contact first. This does not judge your mental state.",
    contact: "Would you be willing to contact someone you trust or an available support service?",
    school: "School or campus support",
  },
} as const;

test("P01-06／07／13／15／16双语键只承诺当前能力", () => {
  expect(zh.referral.links.tellAdult).toBe("查看留言选项");
  expect(en.referral.links.tellAdult).toBe("View message options");
  expect(zh.referral.direct.action).toBe("打开悄悄话信箱");
  expect(en.referral.direct.action).toBe("Open private messages");

  expect(zh.account.hero.completeProfileDescription).toBe(expected["zh-CN"].profile);
  expect(en.account.hero.completeProfileDescription).toBe(expected.en.profile);
  expect(zh.privacySafety.dataTypes.account.text).toBe(expected["zh-CN"].identity);
  expect(en.privacySafety.dataTypes.account.text).toBe(expected.en.identity);
  expect(zh.forYoungAdults.independence.records.text).toBe(expected["zh-CN"].records);
  expect(en.forYoungAdults.independence.records.text).toBe(expected.en.records);
  expect(zh.referral.youngAdult.heroDescription).toBe(expected["zh-CN"].hero);
  expect(en.referral.youngAdult.heroDescription).toBe(expected.en.hero);
  expect(zh.referral.youngAdult.trustedContactQuestion).toBe(expected["zh-CN"].contact);
  expect(en.referral.youngAdult.trustedContactQuestion).toBe(expected.en.contact);
  expect(zh.referral.youngAdult.schoolOrCampusSupport).toBe(expected["zh-CN"].school);
  expect(en.referral.youngAdult.schoolOrCampusSupport).toBe(expected.en.school);

  expect(zh.home.audiences.teachers.text).toContain("学校报告尚未正式开放");
  expect(en.home.audiences.teachers.text).toContain("School reports are not yet open");
  expect(zh.forTeachers.hero.description).toContain("新的学校报告尚未正式开放");
  expect(en.forTeachers.hero.description).toContain("new school report is not yet open");
  expect(zh.privacySafety.account.school.text).toContain("学校报告尚未正式开放");
  expect(en.privacySafety.account.school.text).toContain("School reports are not yet open");
});

const baseInput = {
  currentStates: ["情绪压力比较大"],
  affectedAreas: ["情绪表达"],
  duration: "只是今天",
  impact: "基本没有",
  adultWillingness: "暂时不想",
  preferredSupport: ["自己先整理一下"],
  mainNeed: "一个具体小步骤",
};

test("P01-16中文规则保留原分层并让成年人自主选择支持对象", () => {
  const self = buildReferralGuidance(baseInput, "zh-CN", "young_adult");
  const listener = buildReferralGuidance({ ...baseInput, adultWillingness: "愿意", preferredSupport: ["有人听我说"] }, "zh-CN", "young_adult");
  const school = buildReferralGuidance({ ...baseInput, duration: "一两周", impact: "有一点影响" }, "zh-CN", "young_adult");
  const professional = buildReferralGuidance({ ...baseInput, duration: "更久一些", impact: "已经明显影响" }, "zh-CN", "young_adult");

  expect([self.supportTier, listener.supportTier, school.supportTier, professional.supportTier]).toEqual([
    "self_guided", "trusted_adult", "school_support", "professional_support",
  ]);
  expect(self.recommendedSupport).toContain("由你决定");
  expect(listener.recommendedSupport).toContain("由你选择");
  expect(school.recommendedSupport).toContain("由你决定先联系哪一个");
  expect(professional.recommendedSupport).toContain("不要求家长或学校加入");
  expect(professional.recommendedSupport).toContain("有资质的心理专业人员");
});

test("P01-16英文规则保留原分层并让成年人自主选择支持对象", () => {
  const self = buildReferralGuidance({ ...baseInput, preferredSupport: ["Time to reflect on my own"] }, "en", "young_adult");
  const listener = buildReferralGuidance({ ...baseInput, adultWillingness: "willing", preferredSupport: ["Someone to listen"] }, "en", "young_adult");
  const school = buildReferralGuidance({ ...baseInput, duration: "One or two weeks", impact: "A little" }, "en", "young_adult");
  const professional = buildReferralGuidance({
    ...baseInput,
    duration: "Longer than that",
    impact: "It is having a clear impact",
    preferredSupport: ["Professional support"],
  }, "en", "young_adult");

  expect([self.supportTier, listener.supportTier, school.supportTier, professional.supportTier]).toEqual([
    "self_guided", "trusted_adult", "school_support", "professional_support",
  ]);
  expect(self.recommendedSupport).toContain("you decide");
  expect(listener.recommendedSupport).toContain("you choose");
  expect(school.recommendedSupport).toContain("You decide whom to contact first");
  expect(professional.recommendedSupport).toContain("does not require a parent, guardian, or school to join");
  expect(professional.recommendedSupport).toContain("qualified mental health professional");
});
