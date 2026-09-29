import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

type GardenAsset = {
  key: string;
  file: string;
  kind: "scene" | "plant";
  width: number;
  height: number;
  decorative: boolean;
  crop?: "desktop" | "mobile";
  stage?: "seed" | "sprout" | "leaves" | "bloom";
};

test("庭院正式资产完整、本地且具有桌面和手机构图", async () => {
  const directory = path.join(process.cwd(), "public/illustrations/garden");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
    assets: GardenAsset[];
  };
  const keys = manifest.assets.map((asset) => asset.key);
  const files = manifest.assets.map((asset) => asset.file);

  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(files).size).toBe(files.length);
  expect(manifest.assets.filter((asset) => asset.kind === "scene").map((asset) => asset.crop).sort())
    .toEqual(["desktop", "mobile"]);
  expect(manifest.assets.filter((asset) => asset.kind === "plant").map((asset) => asset.stage).sort())
    .toEqual(["bloom", "leaves", "seed", "sprout"]);

  for (const asset of manifest.assets) {
    expect(asset.file).toMatch(/^[a-z0-9-]+\.png$/);
    expect(asset.file).not.toMatch(/^https?:/);
    expect(asset.key).not.toMatch(/[\p{Extended_Pictographic}]/u);
    expect(asset.width).toBeGreaterThan(900);
    expect(asset.height).toBeGreaterThan(900);
    await expect(stat(path.join(directory, asset.file))).resolves.toMatchObject({ isFile: expect.any(Function) });
  }
});

test("四阶段植物使用透明 PNG 图层", async () => {
  const directory = path.join(process.cwd(), "public/illustrations/garden");
  for (const file of ["plant-seed.png", "plant-sprout.png", "plant-leaves.png", "plant-bloom.png"]) {
    const png = await readFile(path.join(directory, file));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png[25]).toBe(6);
  }
});
