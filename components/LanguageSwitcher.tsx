import { useTransition } from "react";
import { useRouter } from "next/router";
import { type Locale } from "@/lib/i18n/config";
import { useTranslation } from "@/lib/i18n/client";

const localeCookieMaxAge = 60 * 60 * 24 * 365;

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { locale, t } = useTranslation();
  const [isPending, startTransition] = useTransition();

  function switchLocale(nextLocale: Locale) {
    if (nextLocale === locale || isPending) return;

    document.cookie = `NEXT_LOCALE=${nextLocale}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax`;
    startTransition(() => {
      void router.push(
        { pathname: router.pathname, query: router.query },
        router.asPath,
        { locale: nextLocale, scroll: false },
      );
    });
  }

  return (
    <div
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-ink/15 bg-paper p-0.5 text-sm font-semibold text-muted ${className}`.trim()}
      role="group"
      aria-label={t("common.languageSwitcher.ariaLabel")}
      aria-busy={isPending}
    >
      <button
        type="button"
        className={`min-h-9 rounded-full px-2 hover:text-ink ${locale === "zh-CN" ? "bg-mist text-sage-dark" : "text-muted"}`}
        aria-pressed={locale === "zh-CN"}
        disabled={isPending}
        onClick={() => switchLocale("zh-CN")}
      >
        {t("common.languageSwitcher.chinese")}
      </button>
      <button
        type="button"
        className={`min-h-9 rounded-full px-2 hover:text-ink ${locale === "en" ? "bg-mist text-sage-dark" : "text-muted"}`}
        aria-pressed={locale === "en"}
        disabled={isPending}
        onClick={() => switchLocale("en")}
      >
        {t("common.languageSwitcher.english")}
      </button>
    </div>
  );
}
