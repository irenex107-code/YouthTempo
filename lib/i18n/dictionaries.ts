import en from "@/locales/en.json";
import zhCN from "@/locales/zh-CN.json";
import type { Locale } from "@/lib/i18n/config";

export type TranslationDictionary = typeof zhCN;

const enDictionary: TranslationDictionary = en;

export const dictionaries: Record<Locale, TranslationDictionary> = {
  "zh-CN": zhCN,
  en: enDictionary,
};

type NestedKey<T> = {
  [Key in keyof T & string]: T[Key] extends string
    ? Key
    : T[Key] extends Record<string, unknown>
      ? `${Key}.${NestedKey<T[Key]>}`
      : never;
}[keyof T & string];

export type TranslationKey = NestedKey<TranslationDictionary>;

export type TranslationValues = Record<string, string | number>;

export function translate(
  dictionary: TranslationDictionary,
  key: TranslationKey,
  values?: TranslationValues,
): string {
  const value = key.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, dictionary);

  if (typeof value !== "string") {
    throw new Error(`Missing translation key: ${key}`);
  }

  if (!values) return value;

  return value.replace(/\{\{(\w+)\}\}/g, (match, variable: string) => {
    const replacement = values[variable];
    return replacement === undefined ? match : String(replacement);
  });
}
