import { expect, test } from "@playwright/test";

const viewports = [320, 360, 375, 390, 414, 768, 1024, 1280, 1440];
const representativeRoutes = ["/", "/for-parents", "/check-in", "/community", "/account", "/admin"];
const accessibilityRoutes = ["/", "/for-teens", "/for-parents", "/for-teachers", "/check-in", "/resources", "/privacy-safety", "/account"];

test("representative public and protected-entry pages do not overflow at pilot viewport widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "All required widths are covered once in the desktop project");
  for (const width of viewports) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const route of representativeRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const geometry = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.scrollWidth, `${route} overflowed at ${width}px`).toBeLessThanOrEqual(geometry.clientWidth + 1);
    }
  }
});

test("public pilot journeys expose basic accessible names, labels, and image alternatives", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Semantic markup is viewport-independent");
  for (const route of accessibilityRoutes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const issues = await page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const accessibleText = (element: Element) =>
        element.getAttribute("aria-label")?.trim()
        || element.getAttribute("title")?.trim()
        || element.textContent?.trim()
        || element.querySelector("img")?.getAttribute("alt")?.trim()
        || "";
      const unnamedInteractive = Array.from(document.querySelectorAll("button, a[href]"))
        .filter(visible)
        .filter((element) => !accessibleText(element)).length;
      const unlabeledInputs = Array.from(document.querySelectorAll("input:not([type=hidden]), textarea, select"))
        .filter(visible)
        .filter((element) => {
          const id = element.getAttribute("id");
          return !element.closest("label")
            && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
            && !element.getAttribute("aria-label")
            && !element.getAttribute("aria-labelledby");
        }).length;
      const imagesWithoutAlt = Array.from(document.images).filter((image) => !image.hasAttribute("alt")).length;
      return { unnamedInteractive, unlabeledInputs, imagesWithoutAlt };
    });
    expect(issues, `${route} has basic accessibility issues`).toEqual({
      unnamedInteractive: 0,
      unlabeledInputs: 0,
      imagesWithoutAlt: 0,
    });
  }
});

test("Sleep to Wake keeps the next question card in view on a phone viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "The exact regression is covered once at 390px");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/check-in");
  await page.getByRole("button", { name: "还可以", exact: true }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  const wakeHeading = page.getByRole("heading", { level: 2, name: "Wake 醒来" });
  await expect(wakeHeading).toBeVisible();
  await expect.poll(async () => {
    const box = await wakeHeading.boundingBox();
    return box?.y ?? Number.POSITIVE_INFINITY;
  }).toBeLessThan(240);
});
