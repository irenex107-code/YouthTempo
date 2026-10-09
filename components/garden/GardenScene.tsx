import Image, { getImageProps } from "next/image";
import type { ReactNode } from "react";
import type { TempoGardenData } from "@/lib/cloudRecords";
import { GardenPlacedItem } from "@/components/garden/GardenPlacedItem";
import type { GardenItemKey, GardenLayoutSlot } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

export type GardenSceneInteraction = {
  id: number;
  kind: "pond" | "bench" | "bird" | "water" | "sunlight" | "invite_visitor" | "layout";
  message: string;
  slot?: GardenLayoutSlot;
};

type GardenSceneProps = {
  stage: TempoGardenData["stage"];
  statusText: string;
  onExplore: (place: "pond" | "bench" | "bird") => void;
  selectedItems: Partial<Record<GardenLayoutSlot, GardenItemKey>>;
  interaction: GardenSceneInteraction | null;
  overlay?: ReactNode;
};

const plantSources: Record<TempoGardenData["stage"], { src: string; width: number; height: number }> = {
  seed: { src: "/illustrations/garden/plant-seed.png", width: 1536, height: 1024 },
  sprout: { src: "/illustrations/garden/plant-sprout.png", width: 1536, height: 1024 },
  leaves: { src: "/illustrations/garden/plant-leaves.png", width: 1536, height: 1024 },
  bloom: { src: "/illustrations/garden/plant-bloom.png", width: 1312, height: 1199 },
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

const interactionClasses: Record<GardenSceneInteraction["kind"], string> = {
  pond: "garden-scene-effect garden-scene-effect-pond",
  bench: "garden-scene-effect garden-scene-effect-bench",
  bird: "garden-scene-effect garden-scene-effect-bird",
  water: "garden-scene-effect garden-scene-effect-water",
  sunlight: "garden-scene-effect garden-scene-effect-sunlight",
  invite_visitor: "garden-scene-effect garden-scene-effect-invite_visitor",
  layout: "garden-scene-effect garden-scene-effect-layout",
};

const layoutEffectClasses: Record<GardenLayoutSlot, string> = {
  flower_border: "garden-scene-effect-flower_border",
  hill_path: "garden-scene-effect-hill_path",
  pond_edge: "garden-scene-effect-pond_edge",
  bench_corner: "garden-scene-effect-bench_corner",
};

const desktopBackground = getImageProps({
  src: "/illustrations/garden/garden-background-desktop.png",
  alt: "",
  fill: true,
  sizes: "(max-width: 640px) 100vw, 76rem",
  priority: true,
}).props;

const mobileBackground = getImageProps({
  src: "/illustrations/garden/garden-background-mobile.png",
  alt: "",
  fill: true,
  sizes: "100vw",
  priority: true,
}).props;

export function GardenScene({ stage, statusText, onExplore, selectedItems, interaction, overlay }: GardenSceneProps) {
  const { t } = useTranslation();
  const plant = plantSources[stage];
  return (
    <section className="garden-scene" aria-labelledby="garden-scene-title">
      <picture aria-hidden="true">
        <source media="(max-width: 640px)" srcSet={mobileBackground.srcSet} sizes={mobileBackground.sizes} />
        <img {...desktopBackground} className="garden-scene-background" />
      </picture>
      <Image
        className={plantClasses[stage]}
        src={plant.src}
        alt=""
        aria-hidden="true"
        width={plant.width}
        height={plant.height}
        sizes="(max-width: 640px) 82vw, 33vw"
        priority
      />
      {(Object.entries(selectedItems) as [GardenLayoutSlot, GardenItemKey][]).map(([slot, item]) => (
        <GardenPlacedItem key={slot} slot={slot} item={item} />
      ))}
      <div className="garden-scene-heading">
        <p className="eyebrow">{t("garden.scene.eyebrow")}</p>
        <h2 id="garden-scene-title" className="mt-1 text-2xl font-bold text-ink sm:text-3xl">{t("garden.scene.title")}</h2>
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
      {interaction ? (
        <div key={interaction.id} className="garden-interaction-layer">
          <span
            aria-hidden="true"
            className={`${interactionClasses[interaction.kind]}${interaction.slot ? ` ${layoutEffectClasses[interaction.slot]}` : ""}`}
          />
          <p className="garden-scene-feedback" role="status">{interaction.message}</p>
        </div>
      ) : null}
      {overlay}
    </section>
  );
}
