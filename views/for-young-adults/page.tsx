import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";
import { YOUNG_ADULT_REFERRAL_HREF } from "@/lib/referralDisplayContext";

export default function ForYoungAdultsPage() {
  const { t } = useTranslation();
  const tools = [
    { title: t("ageWorkspace.primary.garden.title"), text: t("ageWorkspace.primary.garden.text"), href: "/garden", action: t("ageWorkspace.primary.garden.action"), image: "/illustrations/system/feature-sweet-rhythm-v2.webp", alt: t("forYoungAdults.tools.items.rhythm.alt") },
    { title: t("ageWorkspace.primary.expression.title"), text: t("ageWorkspace.primary.expression.text"), href: "/mood-journal", action: t("ageWorkspace.primary.expression.action"), image: "/illustrations/system/feature-mood-puzzle.webp", alt: t("forYoungAdults.tools.items.mood.alt") },
    { title: t("ageWorkspace.primary.help.title"), text: t("ageWorkspace.primary.help.text"), href: YOUNG_ADULT_REFERRAL_HREF, action: t("ageWorkspace.primary.help.action"), image: "/illustrations/system/feature-progress-path.webp", alt: t("forYoungAdults.tools.items.support.alt") },
  ];
  const moreCards = [
    { title: t("ageWorkspace.moreTools.cards.sweet.title"), text: t("ageWorkspace.moreTools.cards.sweet.text"), action: t("ageWorkspace.moreTools.cards.sweet.action"), href: "/check-in" },
    { title: t("forYoungAdults.tools.items.worry.title"), text: t("forYoungAdults.tools.items.worry.text"), action: t("forYoungAdults.tools.items.worry.action"), href: "/worry-time" },
    { title: t("ageWorkspace.adult.cards.peers.title"), text: t("ageWorkspace.adult.cards.peers.text"), action: t("ageWorkspace.adult.cards.peers.action"), href: "/community" },
    { title: t("ageWorkspace.adult.cards.support.title"), text: t("ageWorkspace.adult.cards.support.text"), action: t("ageWorkspace.adult.cards.support.action"), href: "/consultation" },
  ];

  return (
    <>
      <PageHero
        label={t("forYoungAdults.hero.label")}
        title={t("forYoungAdults.hero.title")}
        subtitle={t("forYoungAdults.hero.description")}
        action={<><Link href="/garden" className="button-primary">{t("ageWorkspace.primary.garden.action")}</Link><Link href={YOUNG_ADULT_REFERRAL_HREF} className="button-secondary">{t("ageWorkspace.primary.help.action")}</Link></>}
        aside={<IllustrationPanel src="/illustrations/system/feature-progress-path.webp" alt={t("forYoungAdults.hero.imageAlt")} priority />}
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader title={t("forYoungAdults.tools.title")} description={t("forYoungAdults.tools.description")} />
          <div className="grid min-w-0 gap-5 md:grid-cols-2 lg:grid-cols-3" data-primary-tasks>
            {tools.map((tool) => (
              <article key={tool.href} className="card flex min-w-0 flex-col">
                <FeatureIllustration src={tool.image} alt={tool.alt} />
                <h2 className="mt-5 text-xl font-bold text-ink">{tool.title}</h2>
                <p className="mt-3 flex-1 text-sm leading-7 text-muted">{tool.text}</p>
                <Link href={tool.href} className="button-primary mt-5 w-fit">{tool.action}</Link>
              </article>
            ))}
          </div>
          <details className="mt-6 rounded-2xl border border-sage/20 bg-white/70 p-4 sm:p-5" data-public-more-tools>
            <summary className="cursor-pointer font-semibold text-sage-dark">{t("ageWorkspace.moreTools.title")}</summary>
            <p className="mt-3 text-sm leading-7 text-muted">{t("ageWorkspace.moreTools.description")}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {moreCards.map((card) => <article key={card.href} className="card flex flex-col">
                <h3 className="text-lg font-bold text-ink">{card.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-muted">{card.text}</p>
                <Link href={card.href} className="button-secondary mt-5 w-fit text-sm">{card.action}</Link>
              </article>)}
              <article className="card flex flex-col">
                <p className="eyebrow">{t("forYoungAdults.peerSpace.label")}</p>
                <h3 className="mt-3 text-lg font-bold text-ink">{t("forYoungAdults.peerSpace.title")}</h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-muted">{t("siteNavigation.peerEligibility")}</p>
                <Link href="/peer-space" className="button-secondary mt-5 w-fit text-sm">{t("siteNavigation.peerLearnMore")}</Link>
              </article>
            </div>
          </details>
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
