import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/router";
import { normalizeLocale, type Locale } from "@/lib/i18n/config";
import {
  dictionaries,
  translate,
  type TranslationKey,
} from "@/lib/i18n/dictionaries";

type I18nContextValue = {
  locale: Locale;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const locale = normalizeLocale(router.locale);
  const value = useMemo<I18nContextValue>(() => {
    const dictionary = dictionaries[locale];
    return {
      locale,
      t: (key) => translate(dictionary, key),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useTranslation must be used within I18nProvider");
  return context;
}
