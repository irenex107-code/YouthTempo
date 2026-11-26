import Link from "next/link";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { PageHero } from "@/components/PageHero";
import { useTranslation } from "@/lib/i18n/client";

export default function TalkPage() {
  const { t } = useTranslation();

  return (
    <>
      <PageHero
        label={t("talk.closed.title")}
        title={t("talk.hero.title")}
        subtitle={t("talk.closed.dataNotice")}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-talk.webp"
            alt={t("talk.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="rounded-2xl border border-ink/10 bg-white/85 p-6 shadow-soft sm:p-8">
            <h2 className="text-2xl font-bold leading-tight text-ink">
              {t("talk.support.title")}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted sm:text-base">
              {t("talk.support.description")}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/referral" className="button-primary">
                {t("talk.actions.viewReferral")}
              </Link>
              <Link href="/messages" className="button-secondary">
                {t("talk.actions.openMessages")}
              </Link>
              <Link href="/mood-journal" className="button-secondary">
                {t("talk.actions.openMoodJournal")}
              </Link>
            </div>
          </div>

          <aside className="self-start rounded-2xl border border-[#d59b78]/50 bg-[#fff6ef] p-5">
            <h2 className="font-bold text-ink">{t("talk.urgent.title")}</h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              {t("talk.urgent.description")}
            </p>
          </aside>
        </div>
      </section>
    </>
  );
}
