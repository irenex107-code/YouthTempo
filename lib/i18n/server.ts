import { normalizeLocale } from "@/lib/i18n/config";
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
