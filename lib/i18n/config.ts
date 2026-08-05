export const supportedLocales = ["zh-CN", "en"] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "zh-CN";

export function normalizeLocale(locale?: string): Locale {
  return supportedLocales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}
