import type { TranslationKey } from "@/lib/i18n/dictionaries";

type LocalizedLink = {
  labelKey: TranslationKey;
  href: string;
};

export const navItems: LocalizedLink[] = [
  { labelKey: "common.navbar.nav.forTeens", href: "/for-teens" },
  { labelKey: "common.navbar.nav.forParents", href: "/for-parents" },
  { labelKey: "common.navbar.nav.forTeachers", href: "/for-teachers" },
  { labelKey: "common.navbar.nav.sweet", href: "/check-in" },
  { labelKey: "common.navbar.nav.community", href: "/community" },
  { labelKey: "common.navbar.nav.referral", href: "/referral" },
];

export const sweetModules = [
  {
    key: "Sleep",
    title: "睡眠",
    label: "Sleep",
    question: "昨晚睡了多久？睡眠质量如何？",
    summary: "睡眠和情绪稳定、注意力恢复、身体修复都有关系。",
    example: "睡眠打卡、睡前情绪整理、睡眠习惯提示。"
  },
  {
    key: "Wake",
    title: "醒来",
    label: "Wake",
    question: "今天醒来后的状态是疲惫、平静还是紧张？",
    summary: "一天开始的状态，会影响年轻人的情绪、专注和行动感。",
    example: "晨间状态记录、柔和唤醒建议、早晨状态整理。"
  },
  {
    key: "Eat",
    title: "饮食",
    label: "Eat",
    question: "今天是否规律吃饭？",
    summary: "规律饮食帮助能量更稳定，也让日常功能更容易维持。",
    example: "饮食规律记录、基础健康提醒。"
  },
  {
    key: "Exercise",
    title: "运动",
    label: "Exercise",
    question: "今天是否有轻量身体活动？",
    summary: "轻量活动可以帮助释放压力，让身体和情绪重新获得一点流动。",
    example: "轻量运动记录、低压力运动挑战。"
  },
  {
    key: "Task",
    title: "任务投入",
    label: "Task Engagement",
    question: "今天是否能完成基本学习或生活任务？",
    summary: "任务投入反映学习、生活和社交功能是否还在稳定运转。",
    example: "学习压力追踪、任务分解、成就感记录。"
  }
];

export const footerLinks: LocalizedLink[] = [
  { labelKey: "common.footer.links.resources", href: "/resources" },
  { labelKey: "common.footer.links.community", href: "/community" },
  { labelKey: "common.footer.links.referral", href: "/referral" },
  { labelKey: "common.footer.links.account", href: "/account" },
  { labelKey: "common.footer.links.privacy", href: "/privacy-safety" },
  { labelKey: "common.footer.links.contact", href: "/contact" },
];
