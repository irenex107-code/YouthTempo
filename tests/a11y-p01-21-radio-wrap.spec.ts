import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import zh from "@/locales/zh-CN.json";
import en from "@/locales/en.json";
import { a11yLocalState, openA11yLocalPage } from "./fixtures/a11y-local-browser";

const evidenceRoot = path.join(
  process.cwd(),
  "audit-records/2026-11-11/product01_p01_21_radio_wrap_supplement",
);
const locales = ["zh-CN", "en"] as const;

test.beforeAll(async () => {
  await mkdir(path.join(evidenceRoot, "focus-sequences"), { recursive: true });
});

function copyFor(locale: typeof locales[number]) {
  return locale === "en" ? en : zh;
}

async function focusSnapshot(page: Page, dialog: Locator, step: string) {
  return dialog.evaluate((root, currentStep) => {
    const active = document.activeElement as HTMLElement | null;
    const selected = root.querySelector<HTMLInputElement>("input[type='radio']:checked");
    return {
      step: currentStep,
      active: active ? {
        tag: active.tagName.toLowerCase(),
        type: active.getAttribute("type"),
        name: active.getAttribute("name"),
        value: active instanceof HTMLInputElement ? active.value : null,
        checked: active instanceof HTMLInputElement ? active.checked : null,
        text: (active.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
      } : null,
      selectedValue: selected?.value || null,
      focusInsideDialog: Boolean(active && root.contains(active)),
    };
  }, step);
}

for (const locale of locales) {
  test(`P01-21 selected report radio remains the wrap target (${locale})`, async ({ page }) => {
    const copy = copyFor(locale);
    const result = await openA11yLocalPage(page, { route: "community", locale });
    const reportTrigger = page.getByRole("button", { name: copy.community.actions.report, exact: true }).first();
    await reportTrigger.focus();
    await reportTrigger.press("Enter");

    const dialog = page.getByTestId("community-report-dialog");
    const radios = dialog.locator("input[type='radio']");
    await expect(dialog).toBeVisible();
    const initialSelected = dialog.locator("input[type='radio']:checked");
    await expect(initialSelected).toHaveCount(1);
    await expect(initialSelected).toBeFocused();

    const sequence = [await focusSnapshot(page, dialog, "initial-default-selected")];
    const initialValue = await initialSelected.inputValue();
    const initialIndex = await radios.evaluateAll((items) => items.findIndex((item) => (item as HTMLInputElement).checked));
    await page.keyboard.press("ArrowDown");
    const selectedRadio = dialog.locator("input[type='radio']:checked");
    await expect(selectedRadio).toHaveCount(1);
    await expect(selectedRadio).toBeFocused();
    const selectedValue = await selectedRadio.inputValue();
    const selectedIndex = await radios.evaluateAll((items) => items.findIndex((item) => (item as HTMLInputElement).checked));
    expect(selectedValue).not.toBe(initialValue);
    expect(selectedIndex).not.toBe(initialIndex);
    expect(selectedIndex).toBeGreaterThan(0);
    sequence.push(await focusSnapshot(page, dialog, "arrow-down-non-first-selected"));

    await page.keyboard.press("Shift+Tab");
    sequence.push(await focusSnapshot(page, dialog, "shift-tab-from-selected"));
    await page.keyboard.press("Tab");
    sequence.push(await focusSnapshot(page, dialog, "tab-from-dialog-last"));

    await writeFile(
      path.join(evidenceRoot, "focus-sequences", `${locale}.json`),
      `${JSON.stringify({ locale, selectedValue, sequence }, null, 2)}\n`,
      "utf8",
    );

    expect(sequence[2].active?.tag, JSON.stringify(sequence, null, 2)).toBe("button");
    expect(sequence[2].active?.text, JSON.stringify(sequence, null, 2)).toBe(copy.community.actions.submitReport);
    expect(sequence[2].selectedValue).toBe(selectedValue);
    expect(sequence[3].active?.value, JSON.stringify(sequence, null, 2)).toBe(selectedValue);
    expect(sequence[3].active?.checked).toBe(true);
    expect(sequence[3].selectedValue).toBe(selectedValue);
    expect(result.network).toEqual([]);
    expect(result.errors).toEqual([]);
    expect((await a11yLocalState(page)).unexpected).toEqual([]);
  });
}
