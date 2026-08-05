import Link from "next/link";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { useTranslation } from "@/lib/i18n/client";

export default function ForTeachersPage() {
  const { t } = useTranslation();
  const capabilityCards = [
    { title: t("forTeachers.capabilities.items.week.title"), description: t("forTeachers.capabilities.items.week.description"), illustration: "/illustrations/system/teacher-overview-v2.webp", alt: t("forTeachers.capabilities.items.week.alt") },
    { title: t("forTeachers.capabilities.items.details.title"), description: t("forTeachers.capabilities.items.details.description"), illustration: "/illustrations/system/teacher-student-view-v3.webp", alt: t("forTeachers.capabilities.items.details.alt") },
    { title: t("forTeachers.capabilities.items.listen.title"), description: t("forTeachers.capabilities.items.listen.description"), illustration: "/illustrations/system/feature-mailbox.webp", alt: t("forTeachers.capabilities.items.listen.alt") },
  ];

  return (
    <>
      <PageHero
        label={t("forTeachers.hero.label")}
        title={t("forTeachers.hero.title")}
        subtitle={t("forTeachers.hero.description")}
        action={
          <>
            <Link href="/account" className="button-primary">{t("forTeachers.hero.primaryAction")}</Link>
            <Link href="/sweet-model" className="button-secondary">{t("forTeachers.hero.secondaryAction")}</Link>
          </>
        }
        aside={
          <IllustrationPanel
            src="/illustrations/system/role-teacher.webp"
            alt={t("forTeachers.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section">
        <div className="container">
          <SectionHeader title={t("forTeachers.capabilities.title")} />
          <div className="grid gap-5 md:grid-cols-3">
            {capabilityCards.map((item) => (
              <article key={item.title} className="card flex h-full flex-col border-t-4 border-t-sage/50">
                <FeatureIllustration src={item.illustration} alt={item.alt} compact />
                <h2 className="mt-5 text-xl font-bold text-ink">{item.title}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container max-w-4xl">
          <SectionHeader title={t("forTeachers.conversation.title")} />
          <div className="card">
            <p className="text-base leading-8 text-muted">
              {t("forTeachers.conversation.text")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/account" className="button-primary">{t("forTeachers.conversation.recordsAction")}</Link>
              <Link href="/messages" className="button-secondary">{t("forTeachers.conversation.messagesAction")}</Link>
              <Link href="/referral" className="button-secondary">{t("forTeachers.conversation.referralAction")}</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section pt-8 sm:pt-12">
        <div className="container rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div><h2 className="text-lg font-bold text-ink">{t("forTeachers.feedback.title")}</h2><p className="mt-2 text-sm leading-7 text-muted">{t("forTeachers.feedback.description")}</p></div>
          <Link href="/feedback" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">{t("forTeachers.feedback.action")}</Link>
        </div>
      </section>
    </>
  );
}
