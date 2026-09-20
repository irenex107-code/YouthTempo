import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";

export default function ForYoungAdultsPage() {
  const { t } = useTranslation();
  const tools = [
    { title: t("forYoungAdults.tools.items.rhythm.title"), text: t("forYoungAdults.tools.items.rhythm.text"), href: "/check-in", action: t("forYoungAdults.tools.items.rhythm.action"), image: "/illustrations/system/feature-sweet-rhythm-v2.webp", alt: t("forYoungAdults.tools.items.rhythm.alt") },
    { title: t("forYoungAdults.tools.items.mood.title"), text: t("forYoungAdults.tools.items.mood.text"), href: "/mood-journal", action: t("forYoungAdults.tools.items.mood.action"), image: "/illustrations/system/feature-mood-puzzle.webp", alt: t("forYoungAdults.tools.items.mood.alt") },
    { title: t("forYoungAdults.tools.items.worry.title"), text: t("forYoungAdults.tools.items.worry.text"), href: "/worry-time", action: t("forYoungAdults.tools.items.worry.action"), image: "/illustrations/system/feature-worry-time.webp", alt: t("forYoungAdults.tools.items.worry.alt") },
    { title: t("forYoungAdults.tools.items.support.title"), text: t("forYoungAdults.tools.items.support.text"), href: "/referral", action: t("forYoungAdults.tools.items.support.action"), image: "/illustrations/system/feature-progress-path.webp", alt: t("forYoungAdults.tools.items.support.alt") },
  ];

  return (
    <>
      <PageHero
        label={t("forYoungAdults.hero.label")}
        title={t("forYoungAdults.hero.title")}
        subtitle={t("forYoungAdults.hero.description")}
        action={<><Link href="/account" className="button-primary">{t("forYoungAdults.hero.primaryAction")}</Link><Link href="/check-in" className="button-secondary">{t("forYoungAdults.hero.secondaryAction")}</Link></>}
        aside={<IllustrationPanel src="/illustrations/system/feature-progress-path.webp" alt={t("forYoungAdults.hero.imageAlt")} priority />}
      />

        <section className="section pb-8 pt-8 sm:pb-12 sm:pt-12">
          <div className="container">
            <article className="overflow-hidden rounded-[2rem] border border-sage/20 bg-gradient-to-br from-paper via-paper to-mist/55 shadow-soft">
              <div className="max-w-3xl p-5 sm:p-7 lg:p-9">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="eyebrow">{t("forYoungAdults.peerSpace.label")}</p>
                  <span className="rounded-full bg-mist px-3 py-1.5 text-xs font-bold text-sage-dark">
                    {t("peerSpaceLive.label")}
                  </span>
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-[-0.025em] text-ink sm:text-3xl">
                  {t("forYoungAdults.peerSpace.title")}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">
                  {t("forYoungAdults.peerSpace.description")}
                </p>
                <Link href="/peer-space" className="button-primary mt-6">
                  {t("forYoungAdults.peerSpace.action")}
                </Link>
              </div>
            </article>
          </div>
        </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader title={t("forYoungAdults.tools.title")} description={t("forYoungAdults.tools.description")} />
          <div className="grid gap-5 md:grid-cols-2">
            {tools.map((tool) => (
              <article key={tool.href} className="card flex flex-col">
                <FeatureIllustration src={tool.image} alt={tool.alt} />
                <h2 className="mt-5 text-xl font-bold text-ink">{tool.title}</h2>
                <p className="mt-3 flex-1 text-sm leading-7 text-muted">{tool.text}</p>
                <Link href={tool.href} className="button-primary mt-5 w-fit">{tool.action}</Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-5 md:grid-cols-2">
          <article className="card"><p className="eyebrow">{t("forYoungAdults.independence.confirmation.label")}</p><h2 className="mt-3 text-lg font-bold text-ink">{t("forYoungAdults.independence.confirmation.title")}</h2><p className="mt-3 text-sm leading-7 text-muted">{t("forYoungAdults.independence.confirmation.text")}</p></article>
          <article className="card"><p className="eyebrow">{t("forYoungAdults.independence.records.label")}</p><h2 className="mt-3 text-lg font-bold text-ink">{t("forYoungAdults.independence.records.title")}</h2><p className="mt-3 text-sm leading-7 text-muted">{t("forYoungAdults.independence.records.text")}</p></article>
          <article className="card"><p className="eyebrow">{t("forYoungAdults.independence.baseline.label")}</p><h2 className="mt-3 text-lg font-bold text-ink">{t("forYoungAdults.independence.baseline.title")}</h2><p className="mt-3 text-sm leading-7 text-muted">{t("forYoungAdults.independence.baseline.text")}</p></article>
          <article className="card"><p className="eyebrow">{t("forYoungAdults.independence.boundary.label")}</p><h2 className="mt-3 text-lg font-bold text-ink">{t("forYoungAdults.independence.boundary.title")}</h2><p className="mt-3 text-sm leading-7 text-muted">{t("forYoungAdults.independence.boundary.text")}</p></article>
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
