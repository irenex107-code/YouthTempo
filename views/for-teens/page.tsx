import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";

export default function ForTeensPage() {
  const { t } = useTranslation();
  const startCards = [
    { title: t("forTeens.start.cards.rhythm.title"), text: t("forTeens.start.cards.rhythm.text"), action: t("forTeens.start.cards.rhythm.action"), href: "/check-in", illustration: "/illustrations/system/feature-sweet-rhythm-v2.webp", illustrationAlt: t("forTeens.start.cards.rhythm.alt") },
    { title: t("forTeens.start.cards.mood.title"), text: t("forTeens.start.cards.mood.text"), action: t("forTeens.start.cards.mood.action"), href: "/mood-journal", illustration: "/illustrations/system/feature-mood-puzzle.webp", illustrationAlt: t("forTeens.start.cards.mood.alt") },
    { title: t("forTeens.start.cards.messages.title"), text: t("forTeens.start.cards.messages.text"), action: t("forTeens.start.cards.messages.action"), href: "/messages", illustration: "/illustrations/system/feature-mailbox.webp", illustrationAlt: t("forTeens.start.cards.messages.alt") },
    { title: t("forTeens.start.cards.worry.title"), text: t("forTeens.start.cards.worry.text"), action: t("forTeens.start.cards.worry.action"), href: "/worry-time", illustration: "/illustrations/system/feature-worry-time.webp", illustrationAlt: t("forTeens.start.cards.worry.alt") },
    { title: t("forTeens.start.cards.referral.title"), text: t("forTeens.start.cards.referral.text"), action: t("forTeens.start.cards.referral.action"), href: "/referral", illustration: "/illustrations/system/feature-progress-path.webp", illustrationAlt: t("forTeens.start.cards.referral.alt") },
  ];

  return (
    <>
      <PageHero
        label={t("forTeens.hero.label")}
        title={t("forTeens.hero.title")}
        subtitle={t("forTeens.hero.description")}
        action={
          <>
            <Link href="/account" className="button-primary">{t("forTeens.hero.primaryAction")}</Link>
            <Link href="/sweet-model" className="button-secondary">{t("forTeens.hero.secondaryAction")}</Link>
          </>
        }
        aside={
          <IllustrationPanel
            src="/illustrations/system/role-student-v2.webp"
            alt={t("forTeens.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container">
          <SectionHeader
            title={t("forTeens.start.title")}
            description={t("forTeens.start.description")}
          />
          <div className="grid gap-5 md:grid-cols-2">
            {startCards.map((card) => (
              <article key={card.title} className="card flex flex-col p-5 sm:min-h-60">
                {card.illustration ? (
                  <div className="mb-5">
                    <FeatureIllustration src={card.illustration} alt={card.illustrationAlt || ""} />
                  </div>
                ) : null}
                <h3 className="text-lg font-bold leading-snug text-ink sm:text-xl">{card.title}</h3>
                <p className="mt-3 text-[0.95rem] leading-7 text-muted">{card.text}</p>
                <Link href={card.href} className="button-primary mt-5 w-fit px-4 py-2 text-xs">
                  {card.action}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section pt-8 sm:pt-12">
        <div className="container rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div><h2 className="text-lg font-bold text-ink">{t("forTeens.youngAdults.title")}</h2><p className="mt-2 text-sm leading-7 text-muted">{t("forTeens.youngAdults.description")}</p></div>
          <Link href="/for-young-adults" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">{t("forTeens.youngAdults.action")}</Link>
        </div>
      </section>

      <section className="section">
        <div className="container rounded-[1.75rem] border border-sage/25 bg-mist/60 p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <h2 className="text-lg font-bold text-ink">{t("forTeens.support.title")}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{t("forTeens.support.description")}</p>
          </div>
          <Link href="/referral" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">
            {t("forTeens.support.action")}
          </Link>
        </div>
      </section>

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div><h2 className="text-lg font-bold text-ink">{t("forTeens.feedback.title")}</h2><p className="mt-2 text-sm leading-7 text-muted">{t("forTeens.feedback.description")}</p></div>
          <Link href="/feedback" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">{t("forTeens.feedback.action")}</Link>
        </div>
      </section>
    </>
  );
}
