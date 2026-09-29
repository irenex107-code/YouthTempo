import type { ReactNode } from "react";
import type { TempoGardenData } from "@/lib/cloudRecords";
import { useTranslation } from "@/lib/i18n/client";

type GardenSceneProps = {
  stage: TempoGardenData["stage"];
  statusText: string;
  onExplore: (place: "pond" | "bench" | "bird") => void;
  overlay?: ReactNode;
};

const plantSources: Record<TempoGardenData["stage"], string> = {
  seed: "/illustrations/garden/plant-seed.png",
  sprout: "/illustrations/garden/plant-sprout.png",
  leaves: "/illustrations/garden/plant-leaves.png",
  bloom: "/illustrations/garden/plant-bloom.png",
};

const plantClasses: Record<TempoGardenData["stage"], string> = {
  seed: "garden-main-plant garden-main-plant-seed",
  sprout: "garden-main-plant garden-main-plant-sprout",
  leaves: "garden-main-plant garden-main-plant-leaves",
  bloom: "garden-main-plant garden-main-plant-bloom",
};

const hotspotClasses = {
  pond: "garden-hotspot garden-hotspot-pond",
  bench: "garden-hotspot garden-hotspot-bench",
  bird: "garden-hotspot garden-hotspot-bird",
} as const;

export function GardenScene({ stage, statusText, onExplore, overlay }: GardenSceneProps) {
  const { t } = useTranslation();
  return (
    <section className="garden-scene" aria-labelledby="garden-scene-title">
      <picture aria-hidden="true">
        <source media="(max-width: 640px)" srcSet="/illustrations/garden/garden-background-mobile.png" />
        <img className="garden-scene-background" src="/illustrations/garden/garden-background-desktop.png" alt="" />
      </picture>
      <img className={plantClasses[stage]} src={plantSources[stage]} alt="" aria-hidden="true" />
      <div className="garden-scene-heading">
        <p className="eyebrow">{t("garden.scene.eyebrow")}</p>
        <h1 id="garden-scene-title" className="mt-1 text-2xl font-bold text-ink sm:text-3xl">{t("garden.scene.title")}</h1>
        <p className="mt-2 text-sm font-semibold text-sage-dark">{statusText}</p>
      </div>
      <p className="sr-only">{t(`garden.scene.alt.${stage}`)}</p>
      {(["pond", "bench", "bird"] as const).map((place) => (
        <button
          key={place}
          type="button"
          className={hotspotClasses[place]}
          onClick={() => onExplore(place)}
          aria-label={t(`garden.explore.${place}.label`)}
        ><span aria-hidden="true" /></button>
      ))}
      {overlay}
    </section>
  );
}
