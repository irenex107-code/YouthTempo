import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const contactReasons: Array<{ titleKey: TranslationKey; textKey: TranslationKey }> = [
  { titleKey: "contact.reasons.school.title", textKey: "contact.reasons.school.text" },
  { titleKey: "contact.reasons.feedback.title", textKey: "contact.reasons.feedback.text" },
  { titleKey: "contact.reasons.privacy.title", textKey: "contact.reasons.privacy.text" },
  { titleKey: "contact.reasons.promotion.title", textKey: "contact.reasons.promotion.text" },
];

const messageTipKeys: TranslationKey[] = [
  "contact.messageTips.identity",
  "contact.messageTips.topic",
  "contact.messageTips.reply",
];

export default function ContactPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero
        title={t("contact.hero.title")}
        subtitle={t("contact.hero.description")}
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title={t("contact.reasons.title")}
            description={t("contact.reasons.description")}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {contactReasons.map((item) => (
              <InfoCard key={item.titleKey} title={t(item.titleKey)}>
                {t(item.textKey)}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-8 lg:grid-cols-[1fr_0.85fr]">
          <div className="card">
            <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("contact.details.title")}</h2>
            <p className="mt-3 text-sm font-bold text-sage">{t("contact.details.project")}</p>
            <p className="mt-5 text-[0.95rem] leading-7 text-muted">{t("contact.details.description")}</p>
            <div className="mt-6 grid gap-3 text-sm font-bold text-ink/80">
              <p className="rounded-2xl bg-cream px-4 py-3">{t("contact.details.owner")}</p>
              <p className="rounded-2xl bg-cream px-4 py-3">{t("contact.details.purpose")}</p>
            </div>
          </div>

          <div className="card">
            <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("contact.messageTips.title")}</h2>
            <div className="mt-6 grid gap-3">
              {messageTipKeys.map((key) => (
                <p key={key} className="rounded-2xl border border-ink/10 bg-white/70 p-4 text-sm font-bold leading-7 text-muted">
                  {t(key)}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <InfoCard title={t("contact.privacy.title")} label="Privacy & account">
            {t("contact.privacy.text")}
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">{t("contact.privacy.cardTitle")}</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              {t("contact.privacy.cardText")}
            </p>
            <Link href="/privacy-safety" className="button-secondary mt-6">
              {t("contact.privacy.action")}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
