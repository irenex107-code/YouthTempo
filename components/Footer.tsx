import Link from "next/link";
import { footerLinks } from "@/data/site";
import { useTranslation } from "@/lib/i18n/client";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-ink/10 bg-ink px-5 py-12 text-white sm:px-8 lg:px-12 lg:py-16">
      <div className="container grid gap-10 md:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="text-lg font-black tracking-[-0.03em]">YouthTempo</p>
          <p className="mt-4 max-w-xl text-sm leading-7 text-white/65">
            {t("common.footer.description")}
          </p>
          <p className="mt-5 text-xs font-bold text-white/45">{t("common.footer.tagline")}</p>
        </div>
        <div className="flex flex-wrap content-start gap-x-5 gap-y-3 text-sm font-bold text-white/70 md:justify-end">
          {footerLinks.map((item) => (
            <Link key={item.labelKey} href={item.href} className="rounded-lg px-1 py-1 hover:text-white">
              {t(item.labelKey)}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
