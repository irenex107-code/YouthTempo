import { InfoCard } from "@/components/Cards";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { sweetModules } from "@/data/site";
import { useTranslation } from "@/lib/i18n/client";

export default function SweetModelPage() {
  const { t } = useTranslation();

  return (
    <>
      <PageHero
        label="SWEET Framework"
        title={t("sweetModel.hero.title")}
        subtitle={t("sweetModel.hero.description")}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-sweet-rhythm-v2.webp"
            alt={t("sweetModel.hero.imageAlt")}
            priority
          />
        }
      />
      <section className="section section-muted">
        <div className="container">
          <SectionHeader title={t("sweetModel.modules.title")} description={t("sweetModel.modules.description")} />
          <div className="grid gap-6 md:grid-cols-2">
            {sweetModules.map((item) => (
              <InfoCard key={item.key} title={t(item.titleKey)} label={item.label} showLabel>
                <p>{t(item.summaryKey)}</p>
                <p className="mt-4 font-bold text-ink/80">{t("sweetModel.modules.observationPrefix")}{t(item.exampleKey)}</p>
              </InfoCard>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
