import type { GardenItemKey, GardenLayoutSlot } from "@/lib/gardenCatalog";

type GardenPlacedItemProps = {
  item: GardenItemKey;
  slot: GardenLayoutSlot;
};

const slotClasses: Record<GardenLayoutSlot, string> = {
  flower_border: "garden-placed-item-flower_border",
  hill_path: "garden-placed-item-hill_path",
  pond_edge: "garden-placed-item-pond_edge",
  bench_corner: "garden-placed-item-bench_corner",
};

const itemClasses: Record<GardenItemKey, string> = {
  wildflower_patch: "garden-placed-item-wildflower_patch",
  low_fern: "garden-placed-item-low_fern",
  flat_stones: "garden-placed-item-flat_stones",
  wooden_sign: "garden-placed-item-wooden_sign",
  water_grass: "garden-placed-item-water_grass",
  small_birdbath: "garden-placed-item-small_birdbath",
  linen_cushion: "garden-placed-item-linen_cushion",
  warm_lantern: "garden-placed-item-warm_lantern",
};

export function GardenPlacedItem({ item, slot }: GardenPlacedItemProps) {
  return (
    <span
      aria-hidden="true"
      className={`garden-placed-item ${slotClasses[slot]} ${itemClasses[item]}`}
      data-garden-item={item}
    >
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
