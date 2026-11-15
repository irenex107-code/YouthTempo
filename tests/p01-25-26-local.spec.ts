import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import zh from "@/locales/zh-CN.json";
import en from "@/locales/en.json";
import { a11yLocalState, openA11yLocalPage } from "./fixtures/a11y-local-browser";

const evidenceRoot = path.join(process.cwd(), "audit-records/2026-11-11/product01_p01_25_26_local");
const screenshots = path.join(evidenceRoot, "screenshots");
const locales = ["zh-CN", "en"] as const;
const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "narrow-320", width: 320, height: 844 },
] as const;

test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
});

function copyFor(locale: typeof locales[number]) {
  return locale === "en" ? en : zh;
}

function localizedPath(locale: typeof locales[number], pathname: string) {
  return `${locale === "en" ? "/en" : ""}${pathname}`;
}

async function expectInsideViewport(page: Page, controls: Locator[]) {
  const layout = await page.evaluate(() => {
    const pageWidth = document.documentElement.clientWidth;
    const overflow = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: String(element.className).slice(0, 160),
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
        };
      })
      .filter((item) => item.width > 0 && (item.left < -1 || item.right > pageWidth + 1));
    return { pageWidth, scrollWidth: document.documentElement.scrollWidth, overflow };
  });
  expect(layout.overflow).toEqual([]);
  const pageWidth = layout.pageWidth;
  const scrollWidth = layout.scrollWidth;
  expect(scrollWidth).toBeLessThanOrEqual(pageWidth + 1);
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(pageWidth + 1);
  }
}

async function allowSyntheticNavigation(page: Page, pathname: string) {
  const target = `https://a11y-local.invalid${pathname}`;
  await page.route(target, (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: "<html><body><main><h1>Offline navigation target</h1></main></body></html>",
  }));
  return target;
}

for (const locale of locales) {
  for (const viewport of viewports) {
    test(`P01-25 result actions preserve the draft and navigate (${locale}, ${viewport.name})`, async ({ page }) => {
      const copy = copyFor(locale);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const result = await openA11yLocalPage(page, { route: "mood-journal", locale });
      const draft = locale === "en" ? "A public synthetic draft." : "一段公开合成草稿。";
      const input = page.locator("#mood-journal-context");
      await input.fill(draft);
      await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
      const organize = page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true });
      await organize.focus();
      await organize.press("Enter");

      const resultHeading = page.getByRole("heading", { name: copy.moodJournal.result.title, exact: true });
      await expect(resultHeading).toBeVisible();
      const resultCard = resultHeading.locator("..");
      const garden = resultCard.getByRole("link", { name: copy.moodJournal.actions.backToGarden, exact: true });
      const continueEditing = resultCard.getByRole("button", { name: copy.moodJournal.actions.continueEditing, exact: true });
      await expect(garden).toHaveAttribute("href", localizedPath(locale, "/garden"));
      await expect(garden).toHaveClass(/button-primary/);
      await expect(continueEditing).toHaveClass(/button-secondary/);

      const beforeContinue = await a11yLocalState(page);
      expect(beforeContinue.calls.filter((call) => {
        const item = call as { kind?: string; path?: string; method?: string };
        return item.kind === "fetch" && item.path === "/api/ai/mood-journal" && item.method === "POST";
      })).toHaveLength(1);

      await continueEditing.focus();
      await continueEditing.press("Enter");
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(draft);
      await expect(resultHeading).toBeVisible();
      const afterContinue = await a11yLocalState(page);
      expect(afterContinue.calls.filter((call) => {
        const item = call as { kind?: string; path?: string; method?: string };
        return item.kind === "fetch" && item.path === "/api/ai/mood-journal" && item.method === "POST";
      })).toHaveLength(1);
      expect(afterContinue.unexpected).toEqual([]);

      await resultCard.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, [garden, continueEditing]);
      await resultCard.screenshot({ path: path.join(screenshots, `p01-25-${locale}-${viewport.name}.png`) });

      const target = await allowSyntheticNavigation(page, localizedPath(locale, "/garden"));
      await garden.focus();
      await Promise.all([page.waitForURL(target), garden.press("Enter")]);
      expect(page.url()).toBe(target);
      expect(result.network).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    test(`P01-26 teacher account CTA is exact and keyboard navigable (${locale}, ${viewport.name})`, async ({ page }) => {
      const copy = copyFor(locale);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const result = await openA11yLocalPage(page, { route: "for-teachers", locale });
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const account = page.getByRole("link", { name: copy.forTeachers.hero.primaryAction, exact: true });
      await expect(account).toHaveCount(1);
      await expect(account).toHaveAttribute("href", localizedPath(locale, "/account"));
      await expect(account).toHaveClass(/button-primary/);
      await expectInsideViewport(page, [account]);
      await page.screenshot({ path: path.join(screenshots, `p01-26-${locale}-${viewport.name}.png`), fullPage: true });

      const state = await a11yLocalState(page);
      expect(state.calls).toEqual([]);
      expect(state.unexpected).toEqual([]);
      const target = await allowSyntheticNavigation(page, localizedPath(locale, "/account"));
      await account.focus();
      await Promise.all([page.waitForURL(target), account.press("Enter")]);
      expect(page.url()).toBe(target);
      expect(result.network).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  }
}
