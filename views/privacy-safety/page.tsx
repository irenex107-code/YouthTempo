import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const principles: Array<[TranslationKey, TranslationKey]> = [
  ["privacySafety.principles.noLabels.title", "privacySafety.principles.noLabels.text"],
  ["privacySafety.principles.minimum.title", "privacySafety.principles.minimum.text"],
  ["privacySafety.principles.safety.title", "privacySafety.principles.safety.text"],
  ["privacySafety.principles.control.title", "privacySafety.principles.control.text"],
];

const accountPlan: Array<[TranslationKey, TranslationKey]> = [
  ["privacySafety.account.email.title", "privacySafety.account.email.text"],
  ["privacySafety.account.records.title", "privacySafety.account.records.text"],
  ["privacySafety.account.school.title", "privacySafety.account.school.text"],
  ["privacySafety.account.delete.title", "privacySafety.account.delete.text"],
  ["privacySafety.account.export.title", "privacySafety.account.export.text"],
];

const retentionRules: Array<[TranslationKey, TranslationKey]> = [
  ["privacySafety.retention.active.title", "privacySafety.retention.active.text"],
  ["privacySafety.retention.deletion.title", "privacySafety.retention.deletion.text"],
  ["privacySafety.retention.audit.title", "privacySafety.retention.audit.text"],
  ["privacySafety.retention.backups.title", "privacySafety.retention.backups.text"],
];

const schoolExitItems: Array<[TranslationKey, TranslationKey]> = [
  ["privacySafety.schoolExit.access.title", "privacySafety.schoolExit.access.text"],
  ["privacySafety.schoolExit.personal.title", "privacySafety.schoolExit.personal.text"],
  ["privacySafety.schoolExit.relationships.title", "privacySafety.schoolExit.relationships.text"],
  ["privacySafety.schoolExit.notes.title", "privacySafety.schoolExit.notes.text"],
];

const consentSteps: Array<[TranslationKey, TranslationKey]> = [
  ["privacySafety.consent.student.title", "privacySafety.consent.student.text"],
  ["privacySafety.consent.guardian.title", "privacySafety.consent.guardian.text"],
  ["privacySafety.consent.summary.title", "privacySafety.consent.summary.text"],
  ["privacySafety.consent.withdraw.title", "privacySafety.consent.withdraw.text"],
];

const dataTypes: Array<[TranslationKey, TranslationKey]> = [
  ["privacySafety.dataTypes.sweet.title", "privacySafety.dataTypes.sweet.text"],
  ["privacySafety.dataTypes.account.title", "privacySafety.dataTypes.account.text"],
  ["privacySafety.dataTypes.school.title", "privacySafety.dataTypes.school.text"],
  ["privacySafety.dataTypes.summary.title", "privacySafety.dataTypes.summary.text"],
];

export default function PrivacySafetyPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero
        title={t("privacySafety.hero.title")}
        subtitle={t("privacySafety.hero.description")}
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title={t("privacySafety.principles.title")}
            description={t("privacySafety.principles.description")}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
            {principles.map(([title, text]) => (
              <InfoCard key={title} title={t(title)}>{t(text)}</InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section id="community-safety" className="section">
        <div className="container">
          <SectionHeader
            title={t("privacySafety.community.title")}
            description={t("privacySafety.community.description")}
          />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <InfoCard title={t("privacySafety.community.urgent.title")} label={t("privacySafety.community.reviewLabel")}>
              {t("privacySafety.community.urgent.text")}
            </InfoCard>
            <InfoCard title={t("privacySafety.community.high.title")} label={t("privacySafety.community.reviewLabel")}>
              {t("privacySafety.community.high.text")}
            </InfoCard>
            <InfoCard title={t("privacySafety.community.standard.title")} label={t("privacySafety.community.reviewLabel")}>
              {t("privacySafety.community.standard.text")}
            </InfoCard>
          </div>
          <div className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-4 text-sm leading-7 text-muted">
            {t("privacySafety.community.legalPrefix")}
            <a className="ml-1 font-bold text-sage-dark underline decoration-sage/40 underline-offset-4" href="https://www.gov.cn/zhengce/content/202310/content_6911288.htm" target="_blank" rel="noreferrer">{t("privacySafety.laws.minorProtection")}</a>。
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title={t("privacySafety.account.title")}
            description={t("privacySafety.account.description")}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {accountPlan.map(([title, text]) => (
              <InfoCard key={title} title={t(title)}>{t(text)}</InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section id="student-consent" className="section section-muted scroll-mt-24">
        <div className="container">
          <SectionHeader
            title={t("privacySafety.consent.title")}
            description={t("privacySafety.consent.description")}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {consentSteps.map(([title, text]) => <InfoCard key={title} title={t(title)}>{t(text)}</InfoCard>)}
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-sage/20 bg-white/80 px-5 py-5 text-sm leading-7 text-muted">
              <p className="font-bold text-ink">{t("privacySafety.consent.coverage.title")}</p>
              <p className="mt-2">{t("privacySafety.consent.coverage.text")}</p>
            </div>
            <div className="rounded-2xl border border-sage/20 bg-white/80 px-5 py-5 text-sm leading-7 text-muted">
              <p className="font-bold text-ink">{t("privacySafety.consent.afterWithdrawal.title")}</p>
              <p className="mt-2">{t("privacySafety.consent.afterWithdrawal.text")}</p>
            </div>
          </div>
          <p className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-4 text-sm leading-7 text-muted">
            {t("privacySafety.consent.legalPrefix")}
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.npc.gov.cn/WZWSREL25wYy9jMi9jMzA4MzQvMjAyMTA4L3QyMDIxMDgyMF8zMTMwODguaHRtbD9yZWY9aW1i" target="_blank" rel="noreferrer">{t("privacySafety.laws.personalInformation")}</a>。
          </p>
        </div>
      </section>

      <section id="account-data" className="section scroll-mt-24">
        <div className="container">
          <SectionHeader
            title={t("privacySafety.retention.title")}
            description={t("privacySafety.retention.description")}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {retentionRules.map(([title, text]) => <InfoCard key={title} title={t(title)}>{t(text)}</InfoCard>)}
          </div>
          <div className="mt-6">
            <div className="rounded-2xl border border-sage/20 bg-mint/35 px-5 py-5 text-sm leading-7 text-muted">
              <p className="font-bold text-ink">{t("privacySafety.retention.deletionScope.title")}</p>
              <p className="mt-2">{t("privacySafety.retention.deletionScope.text")}</p>
            </div>
          </div>
          <p className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-4 text-sm leading-7 text-muted">
            {t("privacySafety.retention.legalPrefix")}
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.npc.gov.cn/WZWSREL25wYy9jMzA4MzQvMjAyMTA4L3QyMDIxMDgyMF8zMTMwODguaHRtbD9yZWY9aW1i" target="_blank" rel="noreferrer">{t("privacySafety.laws.personalInformation")}</a>
            <span>{t("privacySafety.laws.and")}</span>
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm" target="_blank" rel="noreferrer">{t("privacySafety.laws.networkData")}</a>。
          </p>
        </div>
      </section>

      <section id="school-exit" className="section section-muted scroll-mt-24">
        <div className="container">
          <SectionHeader
            title={t("privacySafety.schoolExit.title")}
            description={t("privacySafety.schoolExit.description")}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {schoolExitItems.map(([title, text]) => <InfoCard key={title} title={t(title)}>{t(text)}</InfoCard>)}
          </div>
          <p className="mt-6 rounded-2xl border border-sage/20 bg-white/80 px-5 py-4 text-sm leading-7 text-muted">
            {t("privacySafety.schoolExit.legalPrefix")}
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.npc.gov.cn/WZWSREL25wYy9jMzA4MzQvMjAyMTA4L3QyMDIxMDgyMF8zMTMwODguaHRtbD9yZWY9aW1i" target="_blank" rel="noreferrer">{t("privacySafety.laws.personalInformation")}</a>
            <span>{t("privacySafety.laws.and")}</span>
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm" target="_blank" rel="noreferrer">{t("privacySafety.laws.networkData")}</a>。
          </p>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="eyebrow">{t("privacySafety.dataTypes.label")}</p>
            <h2 className="mt-3 text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.2rem]">{t("privacySafety.dataTypes.title")}</h2>
            <p className="mt-4 text-base leading-8 text-muted">
              {t("privacySafety.dataTypes.description")}
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {dataTypes.map(([title, text]) => (
              <InfoCard key={title} title={t(title)}>{t(text)}</InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <InfoCard title={t("privacySafety.emergency.title")} label="Safety first">
            {t("privacySafety.emergency.text")}
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">{t("privacySafety.contact.title")}</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">{t("privacySafety.contact.text")}</p>
            <Link href="/contact" className="button-secondary mt-6">{t("privacySafety.contact.action")}</Link>
          </div>
        </div>
      </section>
    </>
  );
}
