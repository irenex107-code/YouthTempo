import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { StudentActions } from "@/components/StudentActions";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";

export default function ForTeensPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero
        label={t("forTeens.hero.label")}
        title={t("forTeens.hero.title")}
        subtitle={t("forTeens.hero.description")}
        action={<StudentActions />}
        aside={
          <IllustrationPanel
            src="/illustrations/system/role-student-v2.webp"
            alt={t("forTeens.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section py-6">
        <details className="container rounded-2xl border border-sage/20 p-5">
          <summary className="cursor-pointer font-bold text-sage-dark">{t("studentActions.more")}</summary>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link className="underline" href="/worry-time">{t("forTeens.start.cards.worry.title")}</Link>
            <Link className="underline" href="/messages">{t("forTeens.start.cards.messages.title")}</Link>
            <Link className="underline" href="/sweet-model">{t("forTeens.hero.secondaryAction")}</Link>
            <Link className="underline" href="/feedback">{t("forTeens.feedback.action")}</Link>
          </div>
        </details>
      </section>

      <section className="section pt-8 sm:pt-12">
        <div className="container rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div><h2 className="text-lg font-bold text-ink">{t("forTeens.youngAdults.title")}</h2><p className="mt-2 text-sm leading-7 text-muted">{t("forTeens.youngAdults.description")}</p></div>
          <Link href="/for-young-adults" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">{t("forTeens.youngAdults.action")}</Link>
        </div>
      </section>

    </>
  );
}
