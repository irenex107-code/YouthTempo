import Link from "next/link";
import { useState } from "react";
import { GardenScene, type GardenSceneInteraction } from "@/components/garden/GardenScene";
import { useTranslation } from "@/lib/i18n/client";

export function GardenGuide() {
  const { t } = useTranslation();
  return (
    <section id="garden-guide" className="py-8" aria-labelledby="garden-guide-title">
      <h2 id="garden-guide-title" className="text-2xl font-bold text-ink">{t("gardenWelcome.guide")}</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {(["record", "growth", "care", "layout", "privacy", "choice"] as const).map((key) => (
          <article key={key} className="card">
            <h3 className="text-lg font-bold text-ink">{t(`gardenWelcome.${key}.title`)}</h3>
            <p className="mt-3 text-sm leading-7 text-muted">{t(`gardenWelcome.${key}.text`)}</p>
          </article>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold text-sage-dark underline underline-offset-4">
        <Link href="/privacy-safety">{t("gardenWelcome.privacyLink")}</Link>
        <Link href="/sweet-model">{t("gardenWelcome.modelLink")}</Link>
      </div>
    </section>
  );
}

export function GardenWelcome({ home = false }: { home?: boolean }) {
  const { t } = useTranslation();
  const [interaction, setInteraction] = useState<GardenSceneInteraction | null>(null);
  return (
    <div className="garden-page px-4 py-7 sm:px-8 sm:py-10 lg:px-12">
      <div className="container min-w-0">
        <p className="eyebrow">YouthTempo</p>
        <h1 className="mt-3 text-3xl font-bold text-ink sm:text-5xl">{t("home.hero.title")}</h1>
        <p className="mt-4 max-w-3xl leading-8 text-muted">{t("gardenWelcome.description")}</p>
        <div className="my-5 flex flex-wrap gap-3">
          <Link href={home ? "/garden" : "/account?next=garden"} className="button-primary">{t(home ? "gardenWelcome.enter" : "gardenWelcome.login")}</Link>
          <a href="#garden-guide" className="button-secondary">{t("gardenWelcome.guide")}</a>
        </div>
        <GardenScene stage="seed" statusText={t("gardenWelcome.preview")} selectedItems={{}} interaction={interaction}
          onExplore={(place) => setInteraction({ id: Date.now(), kind: place, message: t(`garden.explore.${place}.response`) })} />
        <GardenGuide />
      </div>
    </div>
  );
}
