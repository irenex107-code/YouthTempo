import { expect, test } from "@playwright/test";
import {
  gardenCareActions,
  gardenItems,
  gardenKeepsakeTypes,
  gardenLayoutSlots,
  unlockedGardenItems,
  unlockedGardenPositions,
} from "@/lib/gardenCatalog";

test("庭院目录使用稳定内部键和唯一解锁规则", () => {
  expect(gardenCareActions).toEqual(["water", "sunlight", "invite_visitor"]);
  expect(gardenLayoutSlots).toHaveLength(4);
  expect(gardenItems).toHaveLength(8);
  expect(gardenKeepsakeTypes).toEqual(["flower", "stone", "lantern"]);

  expect(new Set(gardenLayoutSlots.map((slot) => slot.key)).size).toBe(gardenLayoutSlots.length);
  expect(new Set(gardenItems.map((item) => item.key)).size).toBe(gardenItems.length);
  for (const item of gardenItems) {
    expect(gardenLayoutSlots.some((slot) => slot.key === item.slot)).toBe(true);
    expect(Number.isInteger(item.unlockDay)).toBe(true);
  }
});

test("庭院目录不包含展示文案 emoji 或用户信息", () => {
  const serialized = JSON.stringify({
    gardenCareActions,
    gardenLayoutSlots,
    gardenItems,
    gardenKeepsakeTypes,
  });
  expect(serialized).not.toMatch(/[\p{Extended_Pictographic}]/u);
  expect(serialized).not.toMatch(/label|title|description|user_?id|display_name/i);
  expect(serialized).toMatch(/^[\x20-\x7E]+$/);
});

test("固定位置与物件按参与日逐步解锁", () => {
  expect(unlockedGardenPositions(0)).toEqual([]);
  expect(unlockedGardenPositions(3)).toEqual(["flower_border"]);
  expect(unlockedGardenPositions(14)).toEqual(["flower_border", "hill_path", "pond_edge"]);
  expect(unlockedGardenPositions(28)).toHaveLength(4);
  expect(unlockedGardenItems(3)).toEqual(["wildflower_patch"]);
  expect(unlockedGardenItems(28)).toHaveLength(8);
});
