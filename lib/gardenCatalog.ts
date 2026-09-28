export const gardenCareActions = ["water", "sunlight", "invite_visitor"] as const;
export type GardenCareAction = (typeof gardenCareActions)[number];

export const gardenLayoutSlots = [
  { key: "flower_border", unlockDay: 3 },
  { key: "hill_path", unlockDay: 7 },
  { key: "pond_edge", unlockDay: 14 },
  { key: "bench_corner", unlockDay: 28 },
] as const;
export type GardenLayoutSlot = (typeof gardenLayoutSlots)[number]["key"];

export const gardenItems = [
  { key: "wildflower_patch", slot: "flower_border", unlockDay: 3 },
  { key: "low_fern", slot: "flower_border", unlockDay: 7 },
  { key: "flat_stones", slot: "hill_path", unlockDay: 7 },
  { key: "wooden_sign", slot: "hill_path", unlockDay: 14 },
  { key: "water_grass", slot: "pond_edge", unlockDay: 14 },
  { key: "small_birdbath", slot: "pond_edge", unlockDay: 28 },
  { key: "linen_cushion", slot: "bench_corner", unlockDay: 28 },
  { key: "warm_lantern", slot: "bench_corner", unlockDay: 28 },
] as const satisfies readonly { key: string; slot: GardenLayoutSlot; unlockDay: number }[];
export type GardenItemKey = (typeof gardenItems)[number]["key"];

export const gardenKeepsakeTypes = ["flower", "stone", "lantern"] as const;
export type GardenKeepsakeType = (typeof gardenKeepsakeTypes)[number];

export function unlockedGardenPositions(participationDays: number): GardenLayoutSlot[] {
  return gardenLayoutSlots
    .filter((slot) => participationDays >= slot.unlockDay)
    .map((slot) => slot.key);
}

export function unlockedGardenItems(participationDays: number): GardenItemKey[] {
  return gardenItems
    .filter((item) => participationDays >= item.unlockDay)
    .map((item) => item.key);
}
