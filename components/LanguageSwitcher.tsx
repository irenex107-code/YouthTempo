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
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-ink/10 bg-paper/80 px-2.5 py-1.5 text-[0.68rem] font-bold text-muted shadow-sm sm:text-xs ${className}`.trim()}
      role="group"
      aria-label={t("common.languageSwitcher.ariaLabel")}
      aria-busy={isPending}
    >
      <button
        type="button"
        className={`rounded px-1 py-0.5 transition hover:text-sage-dark focus:outline-none focus:ring-2 focus:ring-sage/25 ${locale === "zh-CN" ? "text-sage-dark" : "text-muted"}`}
        aria-pressed={locale === "zh-CN"}
        disabled={isPending}
        onClick={() => switchLocale("zh-CN")}
      >
        {t("common.languageSwitcher.chinese")}
      </button>
      <span className="px-0.5 text-ink/25" aria-hidden="true">|</span>
      <button
        type="button"
        className={`rounded px-1 py-0.5 transition hover:text-sage-dark focus:outline-none focus:ring-2 focus:ring-sage/25 ${locale === "en" ? "text-sage-dark" : "text-muted"}`}
        aria-pressed={locale === "en"}
        disabled={isPending}
        onClick={() => switchLocale("en")}
      >
        {t("common.languageSwitcher.english")}
      </button>
    </div>
  );
}
