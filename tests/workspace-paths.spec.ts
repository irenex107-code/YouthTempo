import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticPathsGarden } from "./fixtures/synthetic-paths-garden";

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const [ageBand, invited] of [["14_17", false], ["18_plus", false], ["18_plus", true]] as const) {
    test(`${prefix || "zh"} ${ageBand} invited=${invited} 三个主要任务独立可达，次级工具与资格边界保留`, async ({ page }, testInfo) => {
      const state = await syntheticPathsGarden(page, { ageBand, peerSpaceAvailable: invited, consentActive: false });
      await page.goto(`${prefix}/account`);
      const workspace = page.locator('section[aria-labelledby="age-path-title"]');
      await expect(workspace.getByRole("heading", { name: ageBand === "14_17" ? copy.ageWorkspace.minor.title : copy.ageWorkspace.adult.title, exact: true })).toBeVisible();
      const referralRoute = ageBand === "18_plus" ? "/referral?displayContext=young_adult" : "/referral";
      for (const [label, route] of [[copy.ageWorkspace.primary.garden.action, "/garden"], [copy.ageWorkspace.primary.expression.action, "/mood-journal"], [copy.ageWorkspace.primary.help.action, referralRoute]]) {
        await expect(workspace.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", `${prefix}${route}`);
      }
      await expect(workspace.locator('a[href$="/garden"]')).toHaveCount(1);
      const more = workspace.locator("[data-workspace-tools]");
      await expect(more).not.toHaveAttribute("open", "");
      await expect(more.locator('a[href$="/check-in"]')).toHaveCount(1);
      await expect(more.locator('a[href$="/check-in"]')).not.toBeVisible();
      await expect(workspace.getByRole("link", { name: copy.ageWorkspace.minor.cards.urgent.action, exact: true })).toHaveAttribute("href", `${prefix}/resources`);
      if (ageBand === "14_17" && process.env.YOUTHTEMPO_CAPTURE_ROUND2 === "true") {
        const output = path.join(process.cwd(), "deliverables/round2-2026-10-26");
        await mkdir(output, { recursive: true });
        await workspace.screenshot({ path: path.join(output, `${prefix ? "en" : "zh"}-workspace-${testInfo.project.name}.png`) });
      }
      await more.locator("summary").click();
      await expect(more.getByRole("link", { name: copy.ageWorkspace.moreTools.cards.sweet.action, exact: true })).toHaveAttribute("href", `${prefix}/check-in`);
      await expect(more.getByRole("link", { name: copy.ageWorkspace.moreTools.cards.worry.action, exact: true })).toHaveAttribute("href", `${prefix}/worry-time`);
      await expect(more.locator('a[href$="/community"]')).toBeVisible();
      if (ageBand === "18_plus") {
        await expect.poll(() => state.accessReads).toBeGreaterThan(0);
        if (invited) await expect(more.getByRole("link", { name: copy.ageWorkspace.adult.cards.room.action, exact: true })).toHaveAttribute("href", `${prefix}/peer-space`);
        else await expect(more.locator('a[href$="/peer-space"]')).toHaveCount(0);
      } else {
        await expect(more.locator('a[href$="/messages"]')).toBeVisible();
        await expect(more.locator('a[href$="/support-request"]')).toBeVisible();
        expect(state.accessReads).toBe(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(state.otpCalls).toBe(0);
      expect(state.aiCalls).toBe(0);
      expect(state.blockedExternal).toEqual([]);
    });
  }
}
