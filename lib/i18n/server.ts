import { normalizeLocale } from "@/lib/i18n/config";
import type { NextApiRequest } from "next";
import {
  dictionaries,
  translate,
  type TranslationKey,
  type TranslationValues,
} from "@/lib/i18n/dictionaries";

export function getServerTranslator(locale?: string) {
  const dictionary = dictionaries[normalizeLocale(locale)];
  return (key: TranslationKey, values?: TranslationValues) => translate(dictionary, key, values);
}

export function getRequestLocale(req: Pick<NextApiRequest, "body" | "query" | "cookies">) {
  return normalizeLocale(typeof req.body?.locale === "string" ? req.body.locale
    : typeof req.query?.locale === "string" ? req.query.locale : req.cookies?.NEXT_LOCALE);
}
