import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import type { GardenCareAction, GardenLayoutSlot } from "../lib/gardenCatalog";
import { syntheticPathsGarden } from "./fixtures/synthetic-paths-garden";

type Copy = typeof zh | typeof en;
type GardenState = Awaited<ReturnType<typeof syntheticPathsGarden>>;
type Stage = "seed" | "sprout" | "leaves" | "bloom";
const slots = ["flower_border", "hill_path", "pond_edge", "bench_corner"] as const;

async function localCare(page: Page, state: GardenState, locale: "zh-CN" | "en") {
  const calls: GardenCareAction[] = [];
  await page.route("**/api/garden/care*", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as { action: GardenCareAction; locale: string };
    expect(Object.keys(body).sort()).toEqual(["action", "locale"]);
    expect(body.locale).toBe(locale);
    expect(new URL(route.request().url()).searchParams.get("locale")).toBe(locale);
    expect(["water", "sunlight", "invite_visitor"]).toContain(body.action);
    calls.push(body.action);
    if (!state.garden.todayParticipated) {
      return route.fulfill({ status: 409, json: { error: "Synthetic record required" } });
    }
    const created = !state.garden.todayCare;
    state.garden = {
      ...state.garden,
      canCareToday: false,
      todayCare: state.garden.todayCare || { date: "2026-10-30", action: body.action },
    };
    return route.fulfill({ status: created ? 201 : 200, json: { care: state.garden.todayCare, created } });
  });
  return calls;
}

async function checkGarden(page: Page, copy: Copy, total: number, stage: Stage) {
  const facts = page.locator(".garden-facts");
  await expect(facts.locator("dl > div").filter({ hasText: copy.garden.stats.totalLabel }).locator("dd")).toHaveText(String(total));
  await expect(facts.getByRole("heading", { name: copy.garden.stage[stage], exact: true })).toBeVisible();
  await expect(page.locator(".garden-main-plant")).toHaveAttribute("src", new RegExp(`plant-${stage}\\.png`));
}

async function checkPositions(page: Page, copy: Copy, available: readonly GardenLayoutSlot[]) {
  await page.locator(".garden-facts").getByRole("button", { name: copy.garden.growth.viewPositions, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy.garden.layout.title, exact: true });
  for (const slot of slots) {
    const position = dialog.locator(`[data-layout-slot="${slot}"]`);
    if (available.includes(slot)) {
      await expect(position.getByText(copy.garden.layout.unlocked, { exact: true })).toBeVisible();
      expect(await position.getByRole("button").count()).toBeGreaterThan(0);
    } else {
      await expect(position.getByRole("button")).toHaveCount(0);
    }
  }
  await dialog.getByRole("button", { name: copy.garden.actions.close, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function record(page: Page, copy: Copy) {
  await page.getByRole("navigation", { name: copy.garden.actions.ariaLabel, exact: true })
    .getByRole("button", { name: copy.garden.actions.record, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy.garden.quick.title, exact: true });
  await dialog.getByRole("radio", { name: copy.garden.quick.heavy, exact: true }).check();
  await dialog.getByRole("button", { name: copy.garden.quick.submit, exact: true }).click();
  await expect(page.getByRole("region", { name: copy.garden.growth.savedTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("garden-care-invitation")).toHaveText(copy.garden.care.available);
}

async function capture(page: Page, name: string, info: TestInfo) {
  if (process.env.FINAL_FEEDBACK_CAPTURE !== "1") return;
  const directory = path.join(process.cwd(), "deliverables/final-bugfix-feedback-2026-10-29/screenshots");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}-${info.project.name}.png`), fullPage: true, animations: "disabled" });
}

function noExternalActions(state: GardenState) {
  expect(state.aiCalls).toBe(0);
  expect(state.otpCalls).toBe(0);
  expect(state.layoutWrites).toEqual([]);
  expect(state.blockedExternal).toEqual([]);
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const milestone of [
    { action: "water", before: 0, total: 1, stage: "sprout", positions: [] },
    { action: "sunlight", before: 2, total: 3, stage: "leaves", positions: ["flower_border"] },
    { action: "invite_visitor", before: 6, total: 7, stage: "bloom", positions: ["flower_border", "hill_path"] },
  ] as const) {
    test(`${prefix || "zh"} ${milestone.action}须先有今日记录，成长在记录时发生，照料不加天数或位置`, async ({ page }, info) => {
      const state = await syntheticPathsGarden(page, { total: milestone.before, todayParticipated: false });
      const careCalls = await localCare(page, state, prefix ? "en" : "zh-CN");
      await page.goto(`${prefix}/garden`);
      const dock = page.getByRole("navigation", { name: copy.garden.actions.ariaLabel, exact: true });
      await dock.getByRole("button", { name: copy.garden.actions.care, exact: true }).click();
      const care = page.getByRole("dialog", { name: copy.garden.care.title, exact: true });
      await expect(care.getByText(copy.garden.care.description, { exact: true })).toBeVisible();
      await expect(care.getByText(copy.garden.care.unavailable, { exact: true })).toBeVisible();
      for (const action of ["water", "sunlight", "invite_visitor"] as const) {
        await expect(care.getByRole("button", { name: copy.garden.care.options[action].title })).toBeDisabled();
      }
      expect(careCalls).toEqual([]);
      expect(state.posts).toBe(0);
      await care.getByRole("button", { name: copy.garden.actions.close, exact: true }).click();

      await record(page, copy);
      const feedback = page.getByRole("region", { name: copy.garden.growth.savedTitle, exact: true });
      const totalCopy = milestone.total === 1 ? copy.garden.growth.totalOne : copy.garden.growth.totalOther;
      await expect(feedback.getByText(totalCopy.replace("{{count}}", String(milestone.total)), { exact: true })).toBeVisible();
      await checkGarden(page, copy, milestone.total, milestone.stage);
      expect(state.garden.total).toBe(milestone.total);
      expect(state.garden.unlockedPositions).toEqual([...milestone.positions]);
      const beforeCare = { total: state.garden.total, stage: state.garden.stage, positions: [...state.garden.unlockedPositions] };
      expect(careCalls).toEqual([]);
      await dock.getByRole("button", { name: copy.garden.actions.care, exact: true }).click();
      await expect(care.getByText(copy.garden.care.available, { exact: true })).toHaveCount(0);
      await care.getByRole("button", { name: copy.garden.care.options[milestone.action].title }).click();
      await expect(care).toHaveCount(0);
      await expect(page.locator(".garden-scene").getByRole("status")).toContainText(copy.garden.care.options[milestone.action].response);
      await checkGarden(page, copy, milestone.total, milestone.stage);
      expect({ total: state.garden.total, stage: state.garden.stage, positions: state.garden.unlockedPositions }).toEqual(beforeCare);
      expect(careCalls).toEqual([milestone.action]);
      expect(state.posts).toBe(1);
      await checkPositions(page, copy, milestone.positions);

      await page.reload();
      await checkGarden(page, copy, milestone.total, milestone.stage);
      await dock.getByRole("button", { name: copy.garden.actions.care, exact: true }).click();
      await expect(care.getByText(copy.garden.care.completed.replace("{{action}}", copy.garden.care.options[milestone.action].title), { exact: true })).toBeVisible();
      for (const action of ["water", "sunlight", "invite_visitor"] as const) {
        await expect(care.getByRole("button", { name: copy.garden.care.options[action].title })).toBeDisabled();
      }
      await care.getByRole("button", { name: copy.garden.actions.close, exact: true }).click();
      expect(careCalls).toEqual([milestone.action]);
      expect(state.posts).toBe(1);
      expect(state.garden.unlockedPositions).toEqual([...milestone.positions]);
      if (milestone.action === "water") await capture(page, `care-record-${prefix ? "en" : "zh"}`, info);
      noExternalActions(state);
    });
  }

  for (const target of [
    { before: 13, total: 14, positions: ["flower_border", "hill_path", "pond_edge"] },
    { before: 27, total: 28, positions: ["flower_border", "hill_path", "pond_edge", "bench_corner"] },
  ] as const) {
    test(`${prefix || "zh"} ${target.total}日只新增布置位置，规则留在介绍、折叠设置和三个支持入口保持`, async ({ page }, info) => {
      const state = await syntheticPathsGarden(page, { total: target.before, todayParticipated: false });
      const careCalls = await localCare(page, state, prefix ? "en" : "zh-CN");
      await page.goto(`${prefix}/garden`);
      const facts = page.locator(".garden-facts");
      await expect(page.getByTestId("inline-student-consent")).toHaveCount(0);
      const summary = facts.locator("p").filter({ hasText: copy.garden.growth.rhythmSummary });
      await expect(summary).toHaveCount(0);
      const guide = page.locator("#garden-guide");
      const guideToggle = page.locator("details").filter({ has: guide }).locator("summary");
      await guideToggle.click();
      await expect(guide.getByText(copy.gardenWelcome.growth.text, { exact: true })).toBeVisible();
      await expect(guide.getByText(copy.gardenWelcome.layout.text, { exact: true })).toBeVisible();
      await expect(guide.getByText(copy.gardenWelcome.care.text, { exact: true })).toBeVisible();
      expect(copy.gardenWelcome.growth.text.match(/\d+/g)).toEqual(["1", "3", "7"]);
      expect(copy.gardenWelcome.layout.text.match(/\d+/g)).toEqual(["3", "7", "14", "28"]);
      await guideToggle.click();

      const options = page.locator("[data-garden-options]");
      await expect(options).not.toHaveAttribute("open", "");
      await expect(options.getByRole("combobox")).not.toBeVisible();
      await expect(options.getByRole("button", { name: copy.garden.keepsakes.open, exact: true })).not.toBeVisible();
      const support = page.getByRole("navigation", { name: copy.garden.support.ariaLabel, exact: true });
      await expect(support.getByRole("link")).toHaveCount(3);
      expect(await support.getByRole("link").evaluateAll((links) => links.map((link) =>
        new URL((link as HTMLAnchorElement).href).pathname.replace(/^\/en(?=\/|$)/, "")))).toEqual(["/mood-journal", "/referral", "/resources"]);
      await expect(page.getByRole("navigation", { name: copy.garden.actions.ariaLabel, exact: true }).getByRole("button")).toHaveCount(3);
      if (target.total === 14) await capture(page, `growth-explanation-${prefix ? "en" : "zh"}`, info);
      await options.locator("summary").click();
      await expect(options.getByRole("combobox")).toBeVisible();
      await expect(options.getByRole("button", { name: copy.garden.keepsakes.open, exact: true })).toBeVisible();
      await options.locator("summary").click();
      await expect(options.getByRole("combobox")).not.toBeVisible();

      await checkGarden(page, copy, target.before, "bloom");
      await record(page, copy);
      await page.getByRole("navigation", { name: copy.garden.actions.ariaLabel, exact: true })
        .getByRole("button", { name: copy.garden.actions.care, exact: true }).click();
      const care = page.getByRole("dialog", { name: copy.garden.care.title, exact: true });
      await expect(care.getByText(copy.garden.care.description, { exact: true })).toBeVisible();
      await checkGarden(page, copy, target.total, "bloom");
      await care.getByRole("button", { name: copy.garden.actions.close, exact: true }).click();
      await checkPositions(page, copy, target.positions);
      await page.reload();
      await checkGarden(page, copy, target.total, "bloom");
      expect(state.garden.unlockedPositions).toEqual([...target.positions]);
      expect(state.posts).toBe(1);
      expect(careCalls).toEqual([]);
      noExternalActions(state);
    });
  }
}
