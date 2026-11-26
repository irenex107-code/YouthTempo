import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { StudentActions } from "@/components/StudentActions";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";

export default function ForYoungAdultsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero
        label={t("forYoungAdults.hero.label")}
        title={t("forYoungAdults.hero.title")}
        subtitle={t("forYoungAdults.hero.description")}
        action={<StudentActions adult recordHref="/garden?audience=adult" />}
        aside={<IllustrationPanel src="/illustrations/system/feature-progress-path.webp" alt={t("forYoungAdults.hero.imageAlt")} priority />}
      />

      <section id="direct-support" className="section scroll-mt-24">
        <div className="container max-w-3xl">
          <h2 className="text-2xl font-bold text-ink">{t("studentActions.adultSupport")}</h2>
          <p className="mt-3 leading-7">{t("studentActions.adultSupportBody")}</p>
          <p className="mt-2 text-sm text-muted">{t("studentActions.consultationAvailability")}</p>
          <p className="mt-3 text-sm leading-6">{t("forYoungAdults.independence.boundary.text")}</p>
          <Link href="/consultation" className="button-secondary mt-4">{t("forYoungAdults.tools.items.support.action")}</Link>
        </div>
      </section>
      <section className="section section-muted">
        <div className="container max-w-3xl">
          <h2 className="text-xl font-bold">{t("forYoungAdults.independence.records.title")}</h2>
          <p className="mt-3 leading-7">{t("forYoungAdults.independence.records.text")}</p>
          <h2 className="mt-6 text-xl font-bold">{t("forYoungAdults.independence.baseline.title")}</h2>
          <p className="mt-2 leading-7">{t("forYoungAdults.independence.baseline.text")}</p>
          <details className="mt-5">
            <summary className="w-fit cursor-pointer font-bold text-sage-dark">{t("studentActions.more")}</summary>
            <div className="mt-4 flex flex-wrap gap-5">
              <Link href="/peer-space" className="underline">{t("forYoungAdults.peerSpace.action")}</Link>
              <Link href="/worry-time" className="underline">{t("forTeens.start.cards.worry.title")}</Link>
              <Link href="/account" className="underline">{t("common.navbar.account.greeting")}</Link>
            </div>
          </details>
        </div>
      </section>

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div><h2 className="text-lg font-bold text-ink">{t("forYoungAdults.teens.title")}</h2><p className="mt-2 text-sm leading-7 text-muted">{t("forYoungAdults.teens.description")}</p></div>
          <Link href="/for-teens" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">{t("forYoungAdults.teens.action")}</Link>
        </div>
      </section>
    </>
  );
}
