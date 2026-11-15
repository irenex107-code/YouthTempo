import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { gardenStage } from "../lib/tempoGarden";
import { unlockedGardenItems, unlockedGardenPositions } from "../lib/gardenCatalog";
import type { TempoGardenData } from "../lib/cloudRecords";
import { syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

type HeldOperation = "read" | "quick" | "refresh" | "care" | "layout" | "keepsake" | "delete" | "reminder";
type Copy = typeof zh | typeof en;

function gardenData(total: number, id: string, type: "lantern" | "stone"): TempoGardenData {
  return {
    total, stage: gardenStage(total), sceneLevel: "base", thisWeek: total, thisMonth: total,
    quickCheckIns: total, fullSweetRecords: 0, todayParticipated: true,
    unlockedPositions: unlockedGardenPositions(total), unlockedItems: unlockedGardenItems(total),
    reminderMode: "off", canCareToday: true, todayCare: null, canAddKeepsakeToday: true,
    layout: {}, keepsakes: [{ id, date: type === "lantern" ? "2037-01-17" : "2026-10-17", type }],
  };
}

async function heldGarden(page: Page, baseURL: string, operation: HeldOperation) {
  const fixture = await syntheticInlineConsent(page, baseURL, { consentState: "active" });
  const first = fixture.state.user.id;
  const second = "00000000-0000-4000-8000-000000000072";
  const oldGarden = gardenData(7, "00000000-0000-4000-8000-000000000097", "lantern");
  const newGarden = gardenData(2, "00000000-0000-4000-8000-000000000098", "stone");
  const requests: Array<{ actor: string; path: string; method: string }> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = false;
  let quickSaved = false;
  await page.route((url) => url.pathname.startsWith("/api/garden"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const token = request.headers().authorization?.split(" ")[1] || "";
    const actor = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
    expect([first, second]).toContain(actor);
    requests.push({ actor, path, method });
    const old = actor === first;
    const shouldHold = old && !held && (
      (operation === "read" && path === "/api/garden" && method === "GET")
      || (operation === "quick" && path === "/api/garden" && method === "POST")
      || (operation === "refresh" && path === "/api/garden" && method === "GET" && quickSaved)
      || (operation === "care" && path === "/api/garden/care")
      || (operation === "layout" && path === "/api/garden/layout")
      || (operation === "keepsake" && path === "/api/garden/keepsakes" && method === "POST")
      || (operation === "delete" && path.startsWith("/api/garden/keepsakes/") && method === "DELETE")
      || (operation === "reminder" && path === "/api/garden" && method === "PATCH")
    );
    if (shouldHold) { held = true; await gate; }
    if (path === "/api/garden" && method === "GET") {
      return route.fulfill({ json: old ? { ...oldGarden, total: quickSaved ? 37 : oldGarden.total } : newGarden });
    }
    if (path === "/api/garden" && method === "POST") {
      if (old) quickSaved = true;
      return route.fulfill({ json: { checkIn: { id: "synthetic-check-in", created_at: "2026-10-28T04:00:00Z" } } });
    }
    if (path === "/api/garden/care") return route.fulfill({ json: {
      care: { date: "2026-10-28", action: request.postDataJSON().action }, created: true,
    } });
    if (path === "/api/garden/layout") {
      const body = request.postDataJSON();
      return route.fulfill({ json: { layoutItem: { slot: body.slot, itemKey: body.itemKey } } });
    }
    if (path === "/api/garden/keepsakes" && method === "POST") return route.fulfill({ json: {
      keepsake: { id: "00000000-0000-4000-8000-000000000099", date: "2038-01-17", type: "flower" }, created: true,
    } });
    if (method === "DELETE") return route.fulfill({ json: { deleted: true, id: path.split("/").at(-1) } });
    if (method === "PATCH") return route.fulfill({ json: { reminderMode: request.postDataJSON().reminderMode } });
    throw new Error("Unexpected synthetic Garden request");
  });
  return { ...fixture, requests, first, second, release, held: () => held };
}

async function openKeepsakes(page: Page, copy: Copy) {
  const options = page.locator("[data-garden-options]");
  if (!await options.evaluate((element) => (element as HTMLDetailsElement).open)) await options.locator("summary").click();
  await options.getByRole("button", { name: copy.garden.keepsakes.open, exact: true }).click();
}

async function trigger(page: Page, copy: Copy, operation: HeldOperation) {
  if (operation === "read") return;
  await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("7");
  if (operation === "quick" || operation === "refresh") {
    await page.getByRole("button", { name: copy.garden.actions.record, exact: true }).click();
    await page.getByRole("radio", { name: copy.garden.quick.heavy, exact: true }).check();
    await page.getByRole("button", { name: copy.garden.quick.submit, exact: true }).click();
  } else if (operation === "care") {
    await page.getByRole("button", { name: copy.garden.actions.care, exact: true }).click();
    await page.getByRole("button", { name: new RegExp(copy.garden.care.options.water.title) }).click();
  } else if (operation === "layout") {
    await page.getByRole("button", { name: copy.garden.actions.layout, exact: true }).click();
    await page.getByRole("button", { name: copy.garden.layout.items.low_fern, exact: true }).click();
  } else if (operation === "keepsake" || operation === "delete") {
    await openKeepsakes(page, copy);
    await page.getByRole("button", { name: operation === "keepsake" ? copy.garden.keepsakes.types.flower : copy.garden.keepsakes.remove, exact: true }).click();
  } else {
    await page.locator("[data-garden-options] summary").click();
    await page.getByRole("combobox", { name: copy.garden.reminders.title }).selectOption("daily");
  }
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const operation of ["read", "quick", "refresh", "care", "layout", "keepsake", "delete", "reminder"] as const) {
    test(`${prefix || "zh"} 花园${operation}迟到结果不进入新账号或触发新账号写入`, async ({ page, baseURL }) => {
      const fixture = await heldGarden(page, baseURL!, operation);
      try {
        await page.goto(`${prefix}/garden`);
        await trigger(page, copy, operation);
        await expect.poll(fixture.held).toBe(true);
        await fixture.changeSession("second_student");
        const panel = page.getByTestId("inline-student-consent");
        await expect(panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true })).toBeVisible();
        await panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }).selectOption("14_17");
        await panel.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
        await panel.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
        await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("2");
        const readsBeforeRelease = fixture.requests.filter((item) => item.actor === fixture.second).length;
        const oldResponse = page.waitForResponse((response) => {
          const token = response.request().headers().authorization?.split(" ")[1] || "";
          return new URL(response.url()).pathname.startsWith("/api/garden")
            && JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub === fixture.first;
        });
        fixture.release();
        await oldResponse;
        await expect(page.locator(".garden-fact-grid dd").last()).toHaveText("2");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.locator('[data-garden-item="low_fern"]')).toHaveCount(0);
        const options = page.locator("[data-garden-options]");
        await options.locator("summary").click();
        await expect(options.getByRole("combobox", { name: copy.garden.reminders.title })).toHaveValue("off");
        await openKeepsakes(page, copy);
        await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(1);
        await expect(page.getByRole("dialog").getByRole("listitem")).toContainText(copy.garden.keepsakes.types.stone);
        await expect(page.getByRole("dialog").getByRole("listitem")).not.toContainText("2037");
        await expect(page.getByRole("dialog").getByRole("listitem")).not.toContainText("2038");
        await expect(page.getByRole("dialog").getByRole("button", { name: copy.garden.keepsakes.types.flower, exact: true })).toBeEnabled();
        expect(fixture.requests.filter((item) => item.actor === fixture.second && item.method !== "GET")).toEqual([]);
        expect(fixture.requests.filter((item) => item.actor === fixture.second)).toHaveLength(readsBeforeRelease);
        expect(fixture.state.blockedExternal).toEqual([]);
      } finally { fixture.release(); }
    });
  }
}

test("Garden请求在取得会话后发现账号变化时不发出读写；纪念物date参数保留兼容", async () => {
  const source = readFileSync("lib/cloudRecords.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  let actor = "second";
  const calls: Array<{ url: string; body?: string }> = [];
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => name === "@/lib/supabaseClient" ? {
      getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: actor }, access_token: "synthetic-token" } } }) } }),
    } : {},
    fetch: async (url: string, init: { body?: string }) => { calls.push({ url, body: init.body }); return { ok: true, json: async () => ({}) }; },
  });
  const operations = [
    () => exports.getTempoGarden("zh-CN", "first"),
    () => exports.saveTempoQuickCheckIn("steady", "zh-CN", "first"),
    () => exports.saveTempoReminderPreference("daily", "zh-CN", "first"),
    () => exports.saveGardenCare("water", "zh-CN", "first"),
    () => exports.saveGardenLayout("flower_border", "low_fern", "zh-CN", "first"),
    () => exports.saveGardenKeepsake("flower", "zh-CN", "2026-10-28", "first"),
    () => exports.deleteGardenKeepsake("old-id", "zh-CN", "first"),
  ];
  for (const operation of operations) {
    let failure = "";
    try { await operation(); } catch (error) { failure = String(error); }
    expect(failure).toContain("账号已变化");
  }
  expect(calls).toEqual([]);
  actor = "first";
  await exports.saveGardenKeepsake("flower", "en", "2026-10-28", "first");
  expect(JSON.parse(calls[0].body!)).toEqual({ type: "flower", date: "2026-10-28", locale: "en" });
});
