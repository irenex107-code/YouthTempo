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
    titleKey: "sweetModel.modules.sleep.title" as TranslationKey,
    label: "Sleep",
    questionKey: "sweetModel.modules.sleep.question" as TranslationKey,
    summaryKey: "sweetModel.modules.sleep.summary" as TranslationKey,
    exampleKey: "sweetModel.modules.sleep.example" as TranslationKey,
  },
  {
    key: "Wake",
    titleKey: "sweetModel.modules.wake.title" as TranslationKey,
    label: "Wake",
    questionKey: "sweetModel.modules.wake.question" as TranslationKey,
    summaryKey: "sweetModel.modules.wake.summary" as TranslationKey,
    exampleKey: "sweetModel.modules.wake.example" as TranslationKey,
  },
  {
    key: "Eat",
    titleKey: "sweetModel.modules.eat.title" as TranslationKey,
    label: "Eat",
    questionKey: "sweetModel.modules.eat.question" as TranslationKey,
    summaryKey: "sweetModel.modules.eat.summary" as TranslationKey,
    exampleKey: "sweetModel.modules.eat.example" as TranslationKey,
  },
  {
    key: "Exercise",
    titleKey: "sweetModel.modules.exercise.title" as TranslationKey,
    label: "Exercise",
    questionKey: "sweetModel.modules.exercise.question" as TranslationKey,
    summaryKey: "sweetModel.modules.exercise.summary" as TranslationKey,
    exampleKey: "sweetModel.modules.exercise.example" as TranslationKey,
  },
  {
    key: "Task",
    titleKey: "sweetModel.modules.task.title" as TranslationKey,
    label: "Task Engagement",
    questionKey: "sweetModel.modules.task.question" as TranslationKey,
    summaryKey: "sweetModel.modules.task.summary" as TranslationKey,
    exampleKey: "sweetModel.modules.task.example" as TranslationKey,
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
