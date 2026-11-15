import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { gardenState, openGarden } from "./fixtures/garden-copy-local-browser";

const artifactRoot = process.env.YT_COPY_ARTIFACTS || path.join(process.cwd(), "test-results/garden-copy");

// Measure the rendered characters after scrolling each paragraph into view.
// Document scrollWidth alone cannot detect text clipped inside a card or dialog.
async function readable(locator: Locator, text: string, info: TestInfo, label: string) {
  await expect(locator).toHaveText(text);
  await locator.scrollIntoViewIfNeeded();
  const measurement = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const clips: Array<{ left: number; right: number; top: number; bottom: number; x: boolean; y: boolean }> = [];
    for (let ancestor = element.parentElement; ancestor && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect();
      const x = /hidden|clip|auto|scroll/.test(style.overflowX), y = /hidden|clip|auto|scroll/.test(style.overflowY);
      if (x || y) clips.push({ left: rect.left + ancestor.clientLeft, right: rect.left + ancestor.clientLeft + ancestor.clientWidth,
        top: rect.top + ancestor.clientTop, bottom: rect.top + ancestor.clientTop + ancestor.clientHeight, x, y });
    }
    let chars = 0, outside = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let i = 0; i < (node.textContent?.length || 0); i++) {
        if (/\s/.test(node.textContent![i])) continue;
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect(); chars++;
        if (rect.width === 0 || rect.height === 0 || rect.left < -1 || rect.right > innerWidth + 1
          || rect.top < -1 || rect.bottom > innerHeight + 1
          || clips.some((clip) => (clip.x && (rect.left < clip.left - 1 || rect.right > clip.right + 1))
            || (clip.y && (rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1)))) outside++;
      }
    }
    return { text: element.textContent, chars, outside, box: { x: box.x, y: box.y, width: box.width, height: box.height },
      fontSize: getComputedStyle(element).fontSize, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clips };
  });
  await mkdir(info.outputPath("measurements"), { recursive: true });
  await writeFile(info.outputPath("measurements", `${label}.json`), JSON.stringify(measurement, null, 2));
  expect(measurement.chars, label).toBeGreaterThan(0);
  expect(measurement.outside, `${label}: all rendered characters must fit the viewport and clipping ancestors`).toBe(0);
}

async function capture(page: Page, info: TestInfo, label: string) {
  const directory = path.join(artifactRoot, info.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${label}.png`), fullPage: label.endsWith("-guide") });
}

for (const [locale, copy, approved17, approved18] of [
  ["zh-CN", zh, "今天已经记录过了。要不要看看今天可以怎样照料花园？", "水轻轻落进土里。"],
  ["en", en, "You've already made a record today. Would you like to see how you can care for your garden today?", "The water settles gently into the soil."],
] as const) {
  const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
  const careButtons = (page: Page) => page.getByRole("dialog").locator(".garden-care-choice");
  async function record(page: Page) {
    await button(page, copy.garden.actions.record).click();
    await page.getByRole("radio", { name: copy.garden.quick.heavy, exact: true }).check();
    await button(page, copy.garden.quick.submit).click();
    await expect(page.getByRole("region", { name: copy.garden.growth.savedTitle, exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  async function safe(page: Page, observed: { network: string[]; errors: string[] }) {
    expect(observed.network).toEqual([]);
    expect(observed.errors).toEqual([]);
    expect((await gardenState(page)).unexpected).toEqual([]);
  }

  test(`${locale} approved invitation and expanded choices stay complete; closing skips care`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, total: 28 });
    expect(copy.garden.care.available).toBe(approved17);
    await readable(page.getByTestId("garden-care-invitation"), approved17, info, "approved-17-page");
    await capture(page, info, `${locale}-page-invitation`);
    await expect(page.getByRole("navigation", { name: copy.garden.actions.ariaLabel }).getByRole("button")).toHaveCount(3);
    await button(page, copy.garden.actions.care).click();
    const dialog = page.getByRole("dialog");
    await readable(dialog.locator("#garden-sheet-title"), copy.garden.care.title, info, "care-title");
    await readable(dialog.locator("#garden-sheet-description"), copy.garden.care.description, info, "care-description");
    await expect(dialog.getByText(approved17, { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("region", { name: copy.garden.growth.savedTitle, exact: true })).toHaveCount(0);
    await capture(page, info, `${locale}-care-top`);
    await expect(careButtons(page)).toHaveCount(3);
    for (const action of ["water", "sunlight", "invite_visitor"] as const) {
      const choice = dialog.getByRole("button", { name: `${copy.garden.care.options[action].title} ${copy.garden.care.options[action].description}`, exact: true });
      await expect(choice).toBeEnabled();
      await readable(choice.locator("span").first(), copy.garden.care.options[action].title, info, `choice-${action}-title`);
      await readable(choice.locator("span").last(), copy.garden.care.options[action].description, info, `choice-${action}-description`);
    }
    await capture(page, info, `${locale}-care-options`);
    await button(page, copy.garden.actions.close).click();
    await expect(dialog).toHaveCount(0);
    expect((await gardenState(page)).calls.filter((call) => call.method !== "GET")).toEqual([]);
    await safe(page, observed);
  });

  test(`${locale} no record keeps care unavailable and all choices disabled`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, total: 0, todayParticipated: false });
    await button(page, copy.garden.actions.care).click();
    const dialog = page.getByRole("dialog");
    await expect(page.getByTestId("garden-care-invitation")).toHaveCount(0);
    await expect(dialog.getByText(approved17, { exact: true })).toHaveCount(0);
    await readable(dialog.getByText(copy.garden.care.unavailable, { exact: true }), copy.garden.care.unavailable, info, "unavailable");
    for (const choice of await careButtons(page).all()) await expect(choice).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect((await gardenState(page)).calls.filter((call) => call.method !== "GET")).toEqual([]);
    await safe(page, observed);
  });

  test(`${locale} record result preserves totals milestone unlock and skip; same-day record adds no day`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, total: 2, todayParticipated: false });
    await record(page);
    const feedback = page.getByRole("region", { name: copy.garden.growth.savedTitle, exact: true });
    await readable(feedback.getByText(copy.garden.growth.totalOther.replace("{{count}}", "3"), { exact: true }), copy.garden.growth.totalOther.replace("{{count}}", "3"), info, "result-total");
    await readable(feedback.getByText(copy.garden.growth.milestones.leaves, { exact: true }), copy.garden.growth.milestones.leaves, info, "result-milestone");
    await expect(feedback.getByText(copy.garden.growth.sameDay, { exact: true })).toHaveCount(0);
    await expect(page.locator(".garden-facts").getByText(copy.garden.growth.rhythmSummary, { exact: true })).toHaveCount(0);
    await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("3");
    await expect(page.getByText(copy.garden.growth.nextPosition.replace("{{count}}", "7").replace("{{position}}", copy.garden.layout.slots.hill_path), { exact: true })).toBeVisible();
    await expect(feedback.getByRole("button", { name: copy.garden.growth.arrangePosition.replace("{{position}}", copy.garden.layout.slots.flower_border), exact: true })).toBeVisible();
    await readable(page.getByTestId("garden-care-invitation"), approved17, info, "result-invitation");
    await capture(page, info, `${locale}-record-invitation`);
    await feedback.scrollIntoViewIfNeeded();
    await capture(page, info, `${locale}-record-result-page`);
    await button(page, copy.garden.actions.care).click();
    await expect(page.getByRole("dialog").getByText(approved17, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("region", { name: copy.garden.growth.savedTitle, exact: true })).toHaveCount(0);
    await expect(careButtons(page)).toHaveCount(3);
    await button(page, copy.garden.actions.close).click();
    await feedback.getByRole("button", { name: copy.garden.growth.keepAsIs, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    let state = await gardenState(page);
    expect(state.garden.total).toBe(3);
    expect(state.garden.unlockedPositions).toEqual(["flower_border"]);
    expect(state.garden.layout).toEqual({});
    expect(state.calls.filter((call) => call.method !== "GET")).toHaveLength(1);
    await record(page);
    await expect(feedback.getByText(copy.garden.growth.milestones.leaves, { exact: true })).toHaveCount(0);
    await expect(feedback.getByText(copy.garden.growth.totalOther.replace("{{count}}", "3"), { exact: true })).toBeVisible();
    await readable(feedback.getByText(copy.garden.growth.sameDay, { exact: true }), copy.garden.growth.sameDay, info, "same-day-explanation");
    await capture(page, info, `${locale}-same-day-result`);
    state = await gardenState(page);
    expect(state.garden.total).toBe(3);
    expect(state.calls.filter((call) => call.path === "/api/garden/care")).toHaveLength(0);
    expect(state.calls.filter((call) => call.path === "/api/garden/layout")).toHaveLength(0);
    await safe(page, observed);
  });

  test(`${locale} approved water response effect layout refresh and second-care limit`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, total: 28 });
    const scene = page.locator(".garden-scene");
    await button(page, copy.garden.actions.care).click();
    await button(page, `${copy.garden.care.options.water.title} ${copy.garden.care.options.water.description}`).click();
    expect(copy.garden.care.options.water.response).toBe(approved18);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(scene.getByRole("status")).toContainText(approved18);
    await expect(scene.locator(".garden-scene-effect-water")).toBeVisible();
    await readable(scene.getByRole("status"), approved18, info, "approved-18-response");
    await capture(page, info, `${locale}-water-response`);
    await button(page, copy.garden.actions.layout).click();
    await button(page, copy.garden.layout.items.wildflower_patch).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(scene.locator('[data-garden-item="wildflower_patch"]')).toBeVisible();
    await expect(scene.getByRole("status")).toContainText(copy.garden.layout.saved);
    await expect(scene.locator(".garden-scene-effect-layout")).toBeVisible();
    await page.reload();
    await expect(scene.locator('[data-garden-item="wildflower_patch"]')).toBeVisible();
    await expect(page.getByTestId("garden-care-invitation")).toHaveCount(0);
    await button(page, copy.garden.actions.care).click();
    const completed = copy.garden.care.completed.replace("{{action}}", copy.garden.care.options.water.title);
    await readable(page.getByRole("dialog").getByText(completed, { exact: true }), completed, info, "completed");
    for (const choice of await careButtons(page).all()) await expect(choice).toBeDisabled();
    await capture(page, info, `${locale}-completed-after-refresh`);
    const state = await gardenState(page);
    expect(state.garden.total).toBe(28);
    expect(state.garden.todayCare?.action).toBe("water");
    expect(state.calls.filter((call) => call.path === "/api/garden/care" && call.method === "POST")).toHaveLength(1);
    expect(state.calls.filter((call) => call.path === "/api/garden/layout" && call.method === "PUT")).toHaveLength(1);
    await safe(page, observed);
  });

  test(`${locale} garden guide retains full growth care privacy and support boundaries`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, visitor: true, total: 0 });
    for (const key of ["record", "growth", "care", "layout", "privacy", "choice"] as const) {
      const card = page.locator("#garden-guide article").filter({ has: page.getByRole("heading", { name: copy.gardenWelcome[key].title, exact: true }) });
      await readable(card.locator("h3"), copy.gardenWelcome[key].title, info, `guide-${key}-title`);
      await readable(card.locator("p"), copy.gardenWelcome[key].text, info, `guide-${key}-text`);
    }
    await page.locator("#garden-guide").scrollIntoViewIfNeeded();
    await capture(page, info, `${locale}-guide`);
    expect((await gardenState(page)).calls.filter((call) => call.method !== "GET")).toEqual([]);
    await safe(page, observed);
  });

  test(`${locale} first-visit introduction can be skipped and stays skipped after refresh`, async ({ page }, info) => {
    const observed = await openGarden(page, { locale, intro: true, total: 0, todayParticipated: false });
    const intro = page.locator(".garden-intro-overlay");
    await readable(intro.locator("h2"), copy.garden.intro.slides.first.title, info, "intro-first-title");
    await readable(intro.locator("p").last(), copy.garden.intro.slides.first.description, info, "intro-first-description");
    await button(page, copy.garden.intro.next).click();
    await readable(intro.locator("h2"), copy.garden.intro.slides.second.title, info, "intro-second-title");
    await readable(intro.locator("p").last(), copy.garden.intro.slides.second.description, info, "intro-second-description");
    await capture(page, info, `${locale}-intro-second`);
    await button(page, copy.garden.intro.skip).click();
    await expect(intro).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".garden-scene")).toBeVisible();
    await expect(intro).toHaveCount(0);
    expect((await gardenState(page)).calls.filter((call) => call.method !== "GET")).toEqual([]);
    await safe(page, observed);
  });
}
