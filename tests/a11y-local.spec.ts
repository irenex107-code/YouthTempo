import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import zh from "@/locales/zh-CN.json";
import en from "@/locales/en.json";
import { a11yLocalState, openA11yLocalPage, type A11yLocalOptions } from "./fixtures/a11y-local-browser";
import { gardenState, openGarden } from "./fixtures/garden-copy-local-browser";

const evidenceRoot = path.join(process.cwd(), "audit-records/2026-11-11/product01_a11y_local");
const screenshots = path.join(evidenceRoot, "screenshots");
const locales = ["zh-CN", "en"] as const;
const widths = [320, 375, 390] as const;

test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
});

function copyFor(locale: typeof locales[number]) {
  return locale === "en" ? en : zh;
}

async function expectNoHorizontalClipping(page: Page, scope = "main") {
  const violations = await page.locator(scope).evaluate((root) => {
    const viewportWidth = document.documentElement.clientWidth;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(
      "button, a[href], input, textarea, select, [role='dialog']",
    ));
    const failures: string[] = [];
    for (const element of candidates) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) continue;
      const label = `${element.tagName.toLowerCase()}#${element.id}.${element.className}`.slice(0, 180);
      if (rect.left < -1 || rect.right > viewportWidth + 1) failures.push(`${label}: element ${rect.left}-${rect.right}/${viewportWidth}`);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.textContent?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const textRect of Array.from(range.getClientRects())) {
            if (textRect.left < Math.max(0, rect.left) - 1 || textRect.right > Math.min(viewportWidth, rect.right) + 1) {
              failures.push(`${label}: text ${textRect.left}-${textRect.right}/${rect.left}-${rect.right}`);
              break;
            }
          }
        }
        node = walker.nextNode();
      }
    }
    return failures;
  });
  expect(violations).toEqual([]);
}

async function dialogFocusables(dialog: Locator) {
  return dialog.locator([
    "button:not([disabled])",
    "a[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(","));
}

test("P01-20 keeps the application shell as the only main landmark", async ({ page }) => {
  const app = await readFile("pages/_app.tsx", "utf8");
  expect(app.match(/<main(?:\s|>)/g) || []).toHaveLength(1);
  for (const file of [
    "views/garden/page.tsx",
    "views/support/CasePortal.tsx",
    "views/peer-space/live.tsx",
  ]) {
    const source = await readFile(file, "utf8");
    expect(source.match(/<main(?:\s|>)/g) || [], file).toHaveLength(0);
  }
  for (const locale of locales) {
    for (const options of [
      { route: "community", locale, signedOut: false },
      { route: "community", locale, signedOut: true },
      { route: "mood-journal", locale },
      { route: "worry-time", locale },
    ] satisfies A11yLocalOptions[]) {
      const result = await openA11yLocalPage(page, options);
      await expect(page.locator("main")).toHaveCount(1);
      expect(result.network, JSON.stringify(options)).toEqual([]);
      expect(result.errors, JSON.stringify(options)).toEqual([]);
    }
  }
});

for (const locale of locales) {
  test(`P01-21 community dialogs contain focus and restore it (${locale})`, async ({ page }) => {
    const copy = copyFor(locale);
    const result = await openA11yLocalPage(page, { route: "community", locale });
    const background = page.getByTestId("community-background");
    const header = page.locator(".page-shell > header");
    const footer = page.locator(".page-shell > footer");

    const reportTrigger = page.getByRole("button", { name: copy.community.actions.report, exact: true }).first();
    await reportTrigger.focus();
    await reportTrigger.press("Enter");
    const reportDialog = page.getByTestId("community-report-dialog");
    await expect(reportDialog).toBeVisible();
    await expect(reportDialog.locator("input[type='radio']:checked")).toBeFocused();
    await expect(background).toHaveAttribute("inert", "");
    await expect(background).toHaveAttribute("aria-hidden", "true");
    await expect(header).toHaveAttribute("inert", "");
    await expect(footer).toHaveAttribute("inert", "");
    const reportFocusable = await dialogFocusables(reportDialog);
    const reportFirst = reportDialog.locator("input[type='radio']:checked");
    const reportLast = reportFocusable.last();
    await reportFirst.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(reportLast).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(reportFirst).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(reportDialog).toBeHidden();
    await expect(reportTrigger).toBeFocused();
    await expect(background).not.toHaveAttribute("inert", "");
    await expect(header).not.toHaveAttribute("inert", "");
    await expect(footer).not.toHaveAttribute("inert", "");

    const deleteTrigger = page.getByRole("button", { name: copy.community.actions.deletePost, exact: true });
    await deleteTrigger.focus();
    await deleteTrigger.press("Enter");
    const deleteDialog = page.getByTestId("community-delete-dialog");
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog.getByRole("button", { name: copy.community.actions.keep, exact: true })).toBeFocused();
    const deleteFocusable = await dialogFocusables(deleteDialog);
    await deleteFocusable.first().focus();
    await page.keyboard.press("Shift+Tab");
    await expect(deleteFocusable.last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(deleteFocusable.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(deleteDialog).toBeHidden();
    await expect(deleteTrigger).toBeFocused();

    await deleteTrigger.press("Enter");
    await deleteDialog.locator("button").last().click();
    await expect(deleteDialog).toBeHidden();
    const deletionStatus = page.locator("p[role='status']").filter({ hasText: locale === "en" ? "deleted" : "已删除" });
    await expect(deletionStatus).toBeVisible();
    await expect(deletionStatus).toBeFocused();
    await expect(page.getByRole("button", { name: copy.community.actions.deletePost, exact: true })).toHaveCount(0);
    expect(result.network).toEqual([]);
    expect(result.errors).toEqual([]);
    expect((await a11yLocalState(page)).unexpected).toEqual([]);
  });
}

for (const locale of locales) {
  test(`P01-22 mood journal announces validation and service errors (${locale})`, async ({ page }) => {
    const copy = copyFor(locale);
    await openA11yLocalPage(page, { route: "mood-journal", locale });
    const organize = page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true });
    await organize.focus();
    await organize.press("Enter");
    const validation = page.locator("#mood-journal-validation");
    await expect(validation).toHaveAttribute("role", "alert");
    await expect(validation).toHaveText(copy.moodJournal.messages.completeRequired);
    for (const id of ["context", "body", "understanding", "support"]) {
      await expect(page.locator(`#mood-journal-${id}`)).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(`#mood-journal-${id}`)).toHaveAttribute("aria-describedby", "mood-journal-validation");
    }

    await openA11yLocalPage(page, { route: "mood-journal", locale, serviceFailure: true });
    await page.getByRole("button", { name: copy.moodJournal.emotions.groups.pressure.words.tense, exact: true }).click();
    await page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true }).check();
    const serviceOrganize = page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true });
    await serviceOrganize.focus();
    await serviceOrganize.press("Enter");
    const error = page.locator("#mood-journal-error");
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toBeVisible();
    await expect(page.locator("#mood-journal-context")).toHaveAttribute("aria-invalid", "false");
    await expect(page.locator("#mood-journal-context")).toHaveAttribute("aria-describedby", "mood-journal-error");
    await expect(serviceOrganize).toHaveAttribute("aria-describedby", "mood-journal-error");
    expect((await a11yLocalState(page)).unexpected).toEqual([]);
  });

  test(`P01-22 worry time announces validation and service errors (${locale})`, async ({ page }) => {
    const copy = copyFor(locale);
    await openA11yLocalPage(page, { route: "worry-time", locale });
    const organize = page.getByRole("button", { name: copy.worryTime.actions.organize, exact: true });
    await organize.focus();
    await organize.press("Enter");
    const validation = page.locator("#worry-time-validation");
    await expect(validation).toHaveAttribute("role", "alert");
    await expect(validation).toHaveText(copy.worryTime.messages.addWorry);
    for (const index of [1, 2, 3]) {
      await expect(page.locator(`#worry-time-worry-${index}`)).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(`#worry-time-worry-${index}`)).toHaveAttribute("aria-describedby", "worry-time-validation");
    }

    await openA11yLocalPage(page, { route: "worry-time", locale, serviceFailure: true });
    await page.locator("#worry-time-worry-1").fill(locale === "en" ? "A public synthetic worry" : "一条公开合成担心");
    const serviceOrganize = page.getByRole("button", { name: copy.worryTime.actions.organize, exact: true });
    await serviceOrganize.focus();
    await serviceOrganize.press("Enter");
    const error = page.locator("#worry-time-error");
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toBeVisible();
    await expect(page.locator("#worry-time-worry-1")).toHaveAttribute("aria-invalid", "false");
    await expect(page.locator("#worry-time-worry-1")).toHaveAttribute("aria-describedby", "worry-time-error");
    await expect(serviceOrganize).toHaveAttribute("aria-describedby", "worry-time-error");
    expect((await a11yLocalState(page)).unexpected).toEqual([]);
  });
}

test("P01-23 reduced motion disables smooth scroll and base button motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openA11yLocalPage(page, { route: "community", locale: "en" });
  const regular = await page.locator(".button-primary").first().evaluate((element) => ({
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    duration: getComputedStyle(element).transitionDuration,
  }));
  expect(regular.scroll).toBe("smooth");
  expect(regular.duration).not.toBe("0s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedButton = page.locator(".button-primary").first();
  await reducedButton.hover();
  const reduced = await reducedButton.evaluate((element) => ({
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    duration: getComputedStyle(element).transitionDuration,
    transform: getComputedStyle(element).transform,
  }));
  expect(reduced).toEqual({ scroll: "auto", duration: "0s", transform: "none" });
});

test("P01-23 reduced motion keeps Garden state visible without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const result = await openGarden(page, { locale: "en", total: 7, intro: false });
  const styles = await page.evaluate(() => ({
    plantAnimation: getComputedStyle(document.querySelector(".garden-main-plant")!).animationName,
    actionTransition: getComputedStyle(document.querySelector(".garden-action-button")!).transitionDuration,
    sceneVisible: document.querySelector(".garden-scene")?.getBoundingClientRect().height || 0,
  }));
  expect(styles.plantAnimation).toBe("none");
  expect(styles.actionTransition).toBe("0s");
  expect(styles.sceneVisible).toBeGreaterThan(0);
  expect(result.network).toEqual([]);
  expect(result.errors).toEqual([]);
  expect((await gardenState(page)).unexpected).toEqual([]);
});

for (const locale of locales) {
  for (const width of widths) {
    test(`P01-24 Garden heading is readable at ${width}px (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const result = await openGarden(page, { locale, total: 7, intro: false });
      const failures = await page.locator(".garden-scene-heading").evaluate((heading) => {
        const scene = heading.closest(".garden-scene")!.getBoundingClientRect();
        const box = heading.getBoundingClientRect();
        const values: string[] = [];
        if (box.left < scene.left - 1 || box.right > scene.right + 1) values.push(`heading ${box.left}-${box.right}/${scene.left}-${scene.right}`);
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node.textContent?.trim()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of Array.from(range.getClientRects())) {
              if (rect.left < box.left - 1 || rect.right > box.right + 1) values.push(`text ${rect.left}-${rect.right}/${box.left}-${box.right}`);
            }
          }
          node = walker.nextNode();
        }
        return values;
      });
      expect(failures).toEqual([]);
      await page.screenshot({ path: path.join(screenshots, `garden-${locale}-${width}.png`), fullPage: true, animations: "disabled" });
      expect(result.network).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    for (const route of ["community", "mood-journal", "worry-time"] as const) {
      test(`P01-24 ${route} controls remain readable at ${width}px (${locale})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        const result = await openA11yLocalPage(page, { route, locale });
        if (route === "community") {
          await page.getByRole("button", { name: copyFor(locale).community.actions.report, exact: true }).first().click();
          await expect(page.getByTestId("community-report-dialog")).toBeVisible();
        }
        await expectNoHorizontalClipping(page);
        await page.screenshot({ path: path.join(screenshots, `${route}-${locale}-${width}.png`), fullPage: true, animations: "disabled" });
        expect(result.network).toEqual([]);
        expect(result.errors).toEqual([]);
      });
    }
  }
}

for (const locale of locales) {
  for (const route of ["community", "mood-journal", "worry-time"] as const) {
    test(`simulated page scale 2.0 remains keyboard-operable on ${route} (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const result = await openA11yLocalPage(page, { route, locale });
      const session = await page.context().newCDPSession(page);
      await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
      const scale = await page.evaluate(() => window.visualViewport?.scale || 1);
      expect(scale).toBeCloseTo(2, 1);
      if (route === "community") {
        const trigger = page.getByRole("button", { name: copyFor(locale).community.actions.report, exact: true }).first();
        await trigger.focus();
        await trigger.press("Enter");
        const dialog = page.getByTestId("community-report-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator("input[type='radio']:checked")).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      } else {
        const name = route === "mood-journal" ? copyFor(locale).moodJournal.actions.organize : copyFor(locale).worryTime.actions.organize;
        const action = page.getByRole("button", { name, exact: true });
        await action.focus();
        await action.press("Enter");
        await expect(page.getByRole("alert")).toBeVisible();
      }
      await page.screenshot({ path: path.join(screenshots, `scale-2-${route}-${locale}.png`), animations: "disabled" });
      expect(result.network).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  }
}
