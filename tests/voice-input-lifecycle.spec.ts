import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";
import { syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";
import { syntheticVoiceInput } from "./fixtures/synthetic-voice-input";

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} voice 正常累加，stop仍接收当前实例最终文本`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    await syntheticVoiceInput(page);
    await page.goto(`${prefix}/mood-journal`);
    const field = page.getByRole("textbox", { name: copy.moodJournal.reflection.context });
    const area = field.locator("..");
    await field.fill("Typed context");
    await area.getByRole("button", { name: copy.common.voiceInput.start, exact: true }).click();
    await page.evaluate(() => window.__voiceInputProbe.result(0, "first words"));
    await expect(field).toHaveValue("Typed context first words");
    await page.evaluate(() => window.__voiceInputProbe.result(0, "more words"));
    await expect(field).toHaveValue("Typed context first words more words");
    await area.getByRole("button", { name: copy.common.voiceInput.stop, exact: true }).click();
    await page.evaluate(() => window.__voiceInputProbe.result(0, "final words"));
    await expect(field).toHaveValue("Typed context first words more words final words");
    await page.evaluate(() => window.__voiceInputProbe.end(0));
    await expect(area.getByRole("button", { name: copy.common.voiceInput.start, exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.__voiceInputProbe.info()))[0]).toMatchObject({ starts: 1, stops: 1 });
    expect(fixture.state.blockedExternal).toEqual([]);
    expect(fixture.state.unexpectedApi).toEqual([]);
  });

  test(`${prefix || "zh"} voice 旧onend不清新实例，离页取消当前实例并拒绝已排队回调`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
    await syntheticVoiceInput(page);
    await page.goto(`${prefix}/mood-journal`);
    const field = page.getByRole("textbox", { name: copy.moodJournal.reflection.context });
    const area = field.locator("..");
    await area.getByRole("button", { name: copy.common.voiceInput.start, exact: true }).click();
    await area.getByRole("button", { name: copy.common.voiceInput.stop, exact: true }).click();
    await area.getByRole("button", { name: copy.common.voiceInput.start, exact: true }).click();
    await page.evaluate(() => {
      window.__voiceInputProbe.end(0);
      window.__voiceInputProbe.result(0, "OLD private words");
      window.__voiceInputProbe.error(0);
    });
    await expect(area.getByRole("button", { name: copy.common.voiceInput.stop, exact: true })).toBeVisible();
    await expect(field).toHaveValue("");
    await page.evaluate(() => window.__voiceInputProbe.result(1, "Current words"));
    await expect(field).toHaveValue("Current words");
    await page.getByRole("link", { name: copy.common.navbar.homeAria, exact: true }).click();
    await expect(page).not.toHaveURL(/mood-journal/);
    await expect.poll(async () => (await page.evaluate(() => window.__voiceInputProbe.info()))[1].aborts).toBe(1);
    await page.evaluate(() => {
      window.__voiceInputProbe.result(1, "LATE unmounted words");
      window.__voiceInputProbe.end(1);
    });
    await expect(page.getByText("LATE unmounted words", { exact: true })).toHaveCount(0);
    expect(fixture.state.blockedExternal).toEqual([]);
    expect(fixture.state.unexpectedApi).toEqual([]);
  });

  for (const transition of ["second_student", "signed_out"] as const) {
    test(`${prefix || "zh"} voice A→${transition}取消录音并拒绝旧结果，当前匿名或本人仍可转写`, async ({ page, baseURL }) => {
      const fixture = await syntheticInlineConsent(page, baseURL!, { consentState: "active" });
      await syntheticVoiceInput(page);
      await page.goto(`${prefix}/mood-journal`);
      const field = page.getByRole("textbox", { name: copy.moodJournal.reflection.context });
      const area = field.locator("..");
      await field.fill("A private draft");
      await area.getByRole("button", { name: copy.common.voiceInput.start, exact: true }).click();
      await fixture.changeSession(transition);
      await expect.poll(async () => (await page.evaluate(() => window.__voiceInputProbe.info()))[0].aborts).toBe(1);
      await expect(field).toHaveValue("");
      await field.fill("Current independent draft");
      await page.evaluate(() => {
        window.__voiceInputProbe.result(0, "OLD A private words");
        window.__voiceInputProbe.error(0);
        window.__voiceInputProbe.end(0);
      });
      await expect(field).toHaveValue("Current independent draft");
      await area.getByRole("button", { name: copy.common.voiceInput.start, exact: true }).click();
      await page.evaluate(() => window.__voiceInputProbe.result(1, "current words"));
      await expect(field).toHaveValue("Current independent draft current words");
      expect(fixture.state.blockedExternal).toEqual([]);
      expect(fixture.state.unexpectedApi).toEqual([]);
    });
  }
}
