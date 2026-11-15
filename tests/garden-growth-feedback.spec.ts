import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticPathsGarden } from "./fixtures/synthetic-paths-garden";
import { gardenSummary } from "../lib/tempoGarden";

const artifactRoot = path.join(process.cwd(), "deliverables/round2-2026-10-26");

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  async function record(page: Page) {
    await page.getByRole("button", { name: copy.garden.actions.record, exact: true }).click();
    await page.getByRole("radio", { name: copy.garden.quick.heavy, exact: true }).check();
    await page.getByRole("button", { name: copy.garden.quick.submit, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  const totalMessage = (total: number) => (total === 1 ? copy.garden.growth.totalOne : copy.garden.growth.totalOther).replace("{{count}}", String(total));
  const openedMessage = (slot: "flower_border" | "hill_path" | "pond_edge" | "bench_corner") => copy.garden.growth.positionOpened.replace("{{position}}", copy.garden.layout.slots[slot]);

  for (const [start, next, milestone, slot] of [[2, 3, "leaves", "flower_border"], [6, 7, "bloom", "hill_path"]] as const) {
    test(`${prefix || "zh"} ${start}→${next}非连续参与显示早期变化，可跳过布置且保留原样`, async ({ page }, testInfo) => {
      const state = await syntheticPathsGarden(page, { total: start });
      const records = Array.from({ length: start }, (_, index) => ({
        created_at: new Date(Date.UTC(2026, 9, 2 + index * 2, 4)).toISOString(),
      }));
      state.garden = { ...state.garden, ...gardenSummary(records, [], new Date("2026-10-27T04:00:00Z")) };
      if (start === 6) state.garden.layout = { flower_border: "wildflower_patch" };
      const originalLayout = { ...state.garden.layout };
      expect(state.garden.thisWeek).toBe(0);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${prefix}/garden`);
      await expect(page.getByRole("region", { name: copy.garden.growth.savedTitle })).toHaveCount(0);
      await record(page);
      const feedback = page.getByRole("region", { name: copy.garden.growth.savedTitle });
      await expect(feedback.getByText(totalMessage(next), { exact: true })).toBeVisible();
      await expect(feedback.getByText(copy.garden.growth.milestones[milestone], { exact: true })).toBeVisible();
      await expect(feedback.getByText(copy.garden.growth.sameDay, { exact: true })).toHaveCount(0);
      await expect(page.locator(".garden-main-plant")).toHaveAttribute("src", new RegExp(`plant-${milestone}\\.png`));
      await expect(page.locator(".garden-main-plant")).toHaveCSS("animation-name", "none");
      const decorate = feedback.getByRole("button", { name: copy.garden.growth.arrangePosition.replace("{{position}}", copy.garden.layout.slots[slot]), exact: true });
      await expect(decorate).toBeVisible();
      if (process.env.YOUTHTEMPO_CAPTURE_EARLY_FEEDBACK === "true" && (
        (next === 3 && testInfo.project.name === "desktop-chromium") || (next === 7 && testInfo.project.name === "mobile-chromium")
      )) {
        const earlyArtifacts = path.join(process.cwd(), "deliverables/garden-early-feedback-2026-10-27");
        await mkdir(earlyArtifacts, { recursive: true });
        await page.screenshot({ path: path.join(earlyArtifacts, `${prefix ? "en" : "zh"}-day${next}-${testInfo.project.name}.png`) });
      }
      await feedback.getByRole("button", { name: copy.garden.growth.keepAsIs, exact: true }).click();
      await expect(feedback.getByRole("button")).toHaveCount(0);
      expect(state.garden.layout).toEqual(originalLayout);
      expect(state.layoutWrites).toEqual([]);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.reload();
      await expect(page.getByRole("region", { name: copy.garden.growth.savedTitle })).toHaveCount(0);
      expect(state.garden.total).toBe(next);
      expect(state.garden.unlockedPositions).toContain(slot);
      expect(state.posts).toBe(1);
      expect(state.aiCalls).toBe(0);
      expect(state.otpCalls).toBe(0);
      expect(state.blockedExternal).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 13→14明确开放池塘，定位布置且失败不覆盖原选择`, async ({ page }, testInfo) => {
    const state = await syntheticPathsGarden(page, { total: 13, failedLayouts: 1 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${prefix}/garden`);
    await record(page);
    const feedback = page.getByRole("region", { name: copy.garden.growth.savedTitle });
    await expect(feedback.getByText(totalMessage(14), { exact: true })).toBeVisible();
    await expect(feedback.getByText(openedMessage("pond_edge"), { exact: true })).toBeVisible();
    expect(state.layoutWrites).toEqual([]);
    expect(state.garden.layout).toEqual({ flower_border: "low_fern", hill_path: "flat_stones" });
    if (process.env.YOUTHTEMPO_CAPTURE_ROUND2 === "true") {
      await mkdir(artifactRoot, { recursive: true });
      await page.screenshot({ path: path.join(artifactRoot, `${prefix ? "en" : "zh"}-unlock14-${testInfo.project.name}.png`) });
    }
    await feedback.getByRole("button", { name: copy.garden.growth.arrangePosition.replace("{{position}}", copy.garden.layout.slots.pond_edge), exact: true }).click();
    const pond = page.locator('[role="dialog"] [data-layout-slot="pond_edge"]');
    await expect(pond).toBeFocused();
    const waterGrass = pond.getByRole("button", { name: copy.garden.layout.items.water_grass, exact: true });
    await page.keyboard.press("Tab");
    await expect(waterGrass).toBeFocused();
    await waterGrass.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    expect(state.garden.layout).toEqual({ flower_border: "low_fern", hill_path: "flat_stones" });
    await expect(waterGrass).toBeEnabled();
    await waterGrass.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-garden-item="water_grass"]')).toBeVisible();
    expect(state.garden.layout).toEqual({ flower_border: "low_fern", hill_path: "flat_stones", pond_edge: "water_grass" });
    expect(state.layoutWrites).toEqual([
      { slot: "pond_edge", itemKey: "water_grass" }, { slot: "pond_edge", itemKey: "water_grass" },
    ]);
    await page.reload();
    await expect(page.locator('[data-garden-item="water_grass"]')).toBeVisible();
    await expect(page.getByRole("region", { name: copy.garden.growth.savedTitle })).toHaveCount(0);
    await expect(page.getByText(copy.garden.growth.nextPosition.replace("{{count}}", "28").replace("{{position}}", copy.garden.layout.slots.bench_corner), { exact: true })).toBeVisible();
    await expect(page.locator(".garden-main-plant")).toHaveCSS("animation-name", "none");
    expect(state.posts).toBe(1);
    expect(state.aiCalls).toBe(0);
    expect(state.blockedExternal).toEqual([]);
  });

  test(`${prefix || "zh"} 27→28可以先保持原样，重载后仍可查看全部开放位置`, async ({ page }) => {
    const state = await syntheticPathsGarden(page, { total: 27 });
    await page.goto(`${prefix}/garden`);
    await record(page);
    const feedback = page.getByRole("region", { name: copy.garden.growth.savedTitle });
    await expect(feedback.getByText(openedMessage("bench_corner"), { exact: true })).toBeVisible();
    await feedback.getByRole("button", { name: copy.garden.growth.keepAsIs, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(feedback.getByText(totalMessage(28), { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.garden.growth.arrangePosition.replace("{{position}}", copy.garden.layout.slots.bench_corner), exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(copy.garden.growth.allPositionsOpen, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.garden.growth.viewPositions, exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: copy.garden.layout.slots.bench_corner, exact: true })).toBeVisible();
    expect(state.layoutWrites).toEqual([]);
    expect(state.garden.layout).toEqual({ flower_border: "low_fern", hill_path: "flat_stones" });
  });

  for (const total of [1, 3, 7, 14]) {
    test(`${prefix || "zh"} 累计${total}日同日重记不重复提示新成长或增加天数`, async ({ page }) => {
      const state = await syntheticPathsGarden(page, { total, todayParticipated: true });
      await page.goto(`${prefix}/garden`);
      await record(page);
      const feedback = page.getByRole("region", { name: copy.garden.growth.savedTitle });
      await expect(feedback.getByText(totalMessage(total), { exact: true })).toBeVisible();
      await expect(feedback.getByText(copy.garden.growth.sameDay, { exact: true })).toBeVisible();
      await expect(feedback.getByRole("button")).toHaveCount(0);
      for (const message of Object.values(copy.garden.growth.milestones)) {
        await expect(feedback.getByText(message, { exact: true })).toHaveCount(0);
      }
      expect(state.garden.total).toBe(total);
      expect(state.layoutWrites).toEqual([]);
    });
  }

  for (const [total, slot] of [[2, "flower_border"], [13, "pond_edge"]] as const) {
    test(`${prefix || "zh"} ${total}日保存后的读取重试保留成长比较起点，不重复提交`, async ({ page }) => {
      const state = await syntheticPathsGarden(page, { total, failedReadsAfterSave: 2 });
      await page.goto(`${prefix}/garden`);
      await record(page);
      await expect(page.getByText(copy.garden.quick.savedRefreshPending, { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: copy.garden.growth.savedTitle })).toHaveCount(0);
      await page.getByRole("button", { name: copy.garden.quick.refreshGarden, exact: true }).click();
      await expect(page.getByRole("button", { name: copy.garden.quick.refreshGarden, exact: true })).toBeEnabled();
      await expect(page.getByRole("region", { name: copy.garden.growth.savedTitle })).toHaveCount(0);
      await page.getByRole("button", { name: copy.garden.quick.refreshGarden, exact: true }).click();
      const feedback = page.getByRole("region", { name: copy.garden.growth.savedTitle });
      await expect(feedback.getByText(total === 2 ? copy.garden.growth.milestones.leaves : openedMessage(slot), { exact: true })).toBeVisible();
      expect(state.posts).toBe(1);
      expect(state.reads).toBe(4);
    });
  }

  for (const total of [6, 13]) {
    test(`${prefix || "zh"} ${total}日保存响应丢失时不把重新读取的状态说成这次获得的成长`, async ({ page }) => {
      const state = await syntheticPathsGarden(page, { total, lostSaveResponse: true });
      await page.goto(`${prefix}/garden`);
      await record(page);
      await expect(page.getByText(copy.garden.quick.saveUnconfirmed, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: copy.garden.quick.refreshGarden, exact: true }).click();
      await expect(page.getByText(copy.garden.quick.refreshedUnconfirmed, { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: copy.garden.growth.savedTitle })).toHaveCount(0);
      await expect(page.getByText(openedMessage("pond_edge"), { exact: true })).toHaveCount(0);
      await expect(page.getByText(copy.garden.growth.milestones.bloom, { exact: true })).toHaveCount(0);
      expect(state.posts).toBe(1);
    });
  }

  for (const [start, next] of [[0, 1], [28, 29]] as const) {
    test(`${prefix || "zh"} ${start}→${next}只呈现真实参与与植物状态，不新增压力等级`, async ({ page }) => {
      const state = await syntheticPathsGarden(page, { total: start });
      await page.goto(`${prefix}/garden`);
      await record(page);
      const feedback = page.getByRole("region", { name: copy.garden.growth.savedTitle });
      await expect(feedback.getByText(totalMessage(next), { exact: true })).toBeVisible();
      await expect(feedback.getByText(next === 1 ? copy.garden.growth.milestones.sprout : copy.garden.growth.plant.replace("{{stage}}", copy.garden.stage.bloom), { exact: true })).toBeVisible();
      await expect(feedback.getByRole("button")).toHaveCount(0);
      await expect(page.getByTestId("garden-care-invitation")).toHaveText(copy.garden.care.available);
      await page.getByRole("button", { name: copy.garden.actions.care, exact: true }).click();
      await expect(page.getByRole("dialog").getByText(copy.garden.care.available, { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: copy.garden.actions.close, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", prefix ? "en" : "zh-CN");
      await expect(page.getByRole("navigation", { name: copy.garden.support.ariaLabel }).getByRole("link", { name: copy.garden.support.expression, exact: true })).toHaveAttribute("href", `${prefix}/mood-journal`);
      await expect(page.getByRole("navigation", { name: copy.garden.support.ariaLabel }).getByRole("link", { name: copy.garden.support.help, exact: true })).toHaveAttribute("href", `${prefix}/referral`);
      await expect(page.locator("[data-garden-options]")).not.toHaveAttribute("open", "");
      await page.locator("[data-garden-options] > summary").click();
      await expect(page.getByRole("button", { name: copy.garden.keepsakes.open, exact: true })).toBeVisible();
      await expect(page.getByText(copy.garden.reminders.description, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(state.aiCalls).toBe(0);
      expect(state.otpCalls).toBe(0);
      expect(state.blockedExternal).toEqual([]);
    });
  }
}
