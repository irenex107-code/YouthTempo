import { randomUUID } from "node:crypto";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import fixture from "./fixtures/permission-boundary.json";

const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD || "";
const aiMode = process.env.E2E_SWEET_AI_MODE;

type RecordRow = {
  id: string;
  user_id: string;
  records: unknown;
  summary: string | null;
  small_step: string | null;
  recommended_next_tool: string | null;
};

test.describe.configure({ mode: "serial" });

function localOrigin(value: string, port: string) {
  const url = new URL(value);
  expect(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === port
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "Only this batch's exact disposable loopback origin is allowed").toBe(true);
  return url.origin;
}

async function studentSession(databaseOrigin: string) {
  const client = createClient(databaseOrigin, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== databaseOrigin) throw new Error("SWEET Auth/Data API request left its local origin");
      return fetch(input, { ...init, redirect: "error" });
    } },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.users.studentOne.email,
    password,
  });
  if (error || !data.session || !data.user) throw new Error("Disposable SWEET fixture password sign-in failed");
  return { client, session: data.session, id: data.user.id };
}

async function ownRecords(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("sweet_records")
    .select("id,user_id,records,summary,small_step,recommended_next_tool")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Disposable SWEET owner record read failed");
  return (data || []) as RecordRow[];
}

async function consentApi(origin: string, session: Session, method: "POST" | "DELETE") {
  try {
    return await fetch(new URL("/api/account/consent", origin), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ action: "student_assent", ageBand: "14_17" }) } : {}),
    });
  } catch { throw new Error("Disposable SWEET consent request failed; request details withheld"); }
}

async function settlePage(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  const outcome = aiMode === "live"
    ? "显式 live 模式真实生成 AI 小结、保存、刷新回看与本人删除"
    : "生成并保存遇 503 仍保存无 AI 记录、草稿保留、幂等保存与本人删除";
  test(`${prefix || "zh"} ${outcome}`, async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "This lifecycle batch covers the two desktop locales.");
    test.skip(!databaseUrl || !anonKey || !password, "Requires explicit disposable fixture credentials; public regression does not create accounts.");
    test.setTimeout(120_000);
    expect(aiMode === "disabled" || aiMode === "live", "Set E2E_SWEET_AI_MODE explicitly to disabled or live").toBe(true);
    const databaseOrigin = localOrigin(databaseUrl, "56321");
    const appOrigin = localOrigin(baseURL || "", "3270");
    expect(Boolean(anonKey && password), "Disposable fixture credentials are required").toBe(true);
    expect(process.env.ALLOW_E2E_FIXTURE_MUTATION, "Reset and authorize only the disposable fixture before this suite").toBe("true");
    const trace = testInfo.project.use.trace;
    expect(trace === "off" || (typeof trace === "object" && trace?.mode === "off"),
      "Real sessions require trace=off so JWTs are never attached").toBe(true);
    expect(process.env.AI_GENERATION_ENABLED, "The runner must explicitly match the local app's AI generation setting")
      .toBe(aiMode === "disabled" ? "false" : "true");

    const owner = await studentSession(databaseOrigin);
    const marker = `SYNTHETIC_SWEET_${randomUUID()}`;
    const createdIds = new Set<string>();
    let aiCalls = 0, recordInserts = 0, recordMutations = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === appOrigin && url.pathname.startsWith("/api/ai/")) aiCalls++;
      if (url.origin === databaseOrigin && url.pathname === "/rest/v1/sweet_records") {
        if (request.method() === "POST") recordInserts++;
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) recordMutations++;
      }
    });
    const authKey = `sb-${new URL(databaseOrigin).hostname.split(".")[0]}-auth-token`;
    await page.addInitScript(({ origin, key, session, once }) => {
      if (location.origin !== origin || sessionStorage.getItem(once)) return;
      localStorage.setItem(key, JSON.stringify(session));
      sessionStorage.setItem(once, "installed");
    }, { origin: appOrigin, key: authKey, session: owner.session, once: marker });

    try {
      expect((await consentApi(appOrigin, owner.session, "DELETE")).status).toBe(200);
      const initialIds = (await ownRecords(owner.client, owner.id)).map((row) => row.id).sort();
      await page.goto(`${prefix}/check-in`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("lang", prefix ? "en" : "zh-CN");
      const choices = [copy.checkIn.steps.sleep.fields.quality.options.veryGood,
        copy.checkIn.steps.wake.fields.state.options.veryEnergized,
        copy.checkIn.steps.eat.fields.rhythm.options.veryRegular,
        copy.checkIn.steps.exercise.fields.duration.options.oneToNine,
        copy.checkIn.steps.task.fields.engagement.options.smooth];
      await page.getByRole("button", { name: choices[0], exact: true }).click();
      await page.locator("main article").getByRole("button", { name: copy.checkIn.form.expandDetails }).click();
      await page.getByPlaceholder(copy.checkIn.steps.sleep.fields.note.placeholder, { exact: true }).fill(marker);
      for (const choice of choices.slice(1)) {
        await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
        await page.getByRole("button", { name: choice, exact: true }).click();
      }

      const panel = page.getByTestId("inline-student-consent");
      await expect(panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true })).toBeVisible();
      await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
      await expect(page.getByText(copy.inlineConsent.consentNeeded, { exact: true })).toBeVisible();
      expect(recordMutations).toBe(0);
      expect(aiCalls).toBe(0);
      await panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }).selectOption("14_17");
      await panel.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
      const confirmed = page.waitForResponse((response) => new URL(response.url()).origin === appOrigin
        && new URL(response.url()).pathname === "/api/account/consent" && response.request().method() === "POST");
      await panel.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
      expect((await confirmed).status()).toBe(200);
      await expect(panel.getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
      const aiNotice = page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true });
      await expect(aiNotice).not.toBeChecked();
      await settlePage(page);
      expect(aiCalls, "Completing consent must not generate or save automatically").toBe(0);
      expect(recordMutations).toBe(0);
      expect((await ownRecords(owner.client, owner.id)).map((row) => row.id).sort()).toEqual(initialIds);

      await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
      await settlePage(page);
      await expect(aiNotice).not.toBeChecked();
      expect(aiCalls, "The unchecked AI notice must prevent any AI request").toBe(0);
      expect(recordMutations, "An unchecked AI notice must also prevent generate-and-save from writing").toBe(0);
      expect((await ownRecords(owner.client, owner.id)).map((row) => row.id).sort()).toEqual(initialIds);

      await aiNotice.check();
      const aiResponse = page.waitForResponse((response) => new URL(response.url()).origin === appOrigin
        && new URL(response.url()).pathname === "/api/ai/check-in" && response.request().method() === "POST");
      const saveResponse = page.waitForResponse((response) => new URL(response.url()).origin === databaseOrigin
        && new URL(response.url()).pathname === "/rest/v1/sweet_records" && response.request().method() === "POST");
      await page.getByRole("button", { name: copy.checkIn.actions.generateAndSave, exact: true }).click();
      const generated = await aiResponse;
      expect(generated.request().postDataJSON()).toMatchObject({
        locale: prefix ? "en" : "zh-CN", sensitiveConsentAccepted: true, aiNoticeAccepted: true,
      });
      expect(generated.request().postDataJSON().records).toHaveLength(5);
      const aiBody = await generated.json() as Record<string, unknown>;
      if (aiMode === "disabled") {
        expect(generated.status()).toBe(503);
        const safeError = prefix
          ? "AI-assisted record summaries are not available right now."
          : "AI 辅助记录整理目前暂未开放。";
        expect(aiBody).toEqual({ error: safeError });
        await expect(page.getByText(safeError, { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: copy.checkIn.result.title, exact: true })).toHaveCount(0);
      } else {
        // Only an explicit live mode is allowed to require real provider output.
        expect(generated.status()).toBe(200);
        for (const field of ["summary", "rhythmClue", "smallStep", "recommendedNextTool", "supportReminder"]) {
          expect(typeof aiBody[field] === "string" && Boolean((aiBody[field] as string).trim()), `Missing real AI response field: ${field}`).toBe(true);
        }
        await expect(page.getByRole("heading", { name: copy.checkIn.result.title, exact: true })).toBeVisible();
      }
      const inserted = await saveResponse;
      const insertedBody = await inserted.json() as { id?: unknown };
      if (typeof insertedBody.id === "string") createdIds.add(insertedBody.id);
      expect(inserted.status()).toBe(201);
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
      const matching = (await ownRecords(owner.client, owner.id)).filter((row) => JSON.stringify(row.records).includes(marker));
      expect(matching).toHaveLength(1);
      const record = matching[0];
      createdIds.add(record.id);
      expect(record.user_id).toBe(owner.id);
      if (aiMode === "disabled") {
        expect(record).toMatchObject({ summary: null, small_step: null, recommended_next_tool: null });
      } else {
        expect(record).toMatchObject({ summary: aiBody.summary, small_step: aiBody.smallStep, recommended_next_tool: aiBody.recommendedNextTool });
      }
      expect(aiCalls).toBe(1);
      expect(recordInserts).toBe(1);

      for (let index = 0; index < 4; index++) await page.getByRole("button", { name: copy.checkIn.actions.previous, exact: true }).click();
      await expect(page.getByPlaceholder(copy.checkIn.steps.sleep.fields.note.placeholder, { exact: true })).toHaveValue(marker);
      await expect(page.getByRole("button", { name: choices[0], exact: true })).toHaveAttribute("aria-pressed", "true");
      for (const choice of choices.slice(1)) {
        await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
        await expect(page.getByRole("button", { name: choice, exact: true })).toHaveAttribute("aria-pressed", "true");
      }
      const mutationsAfterSave = recordMutations;
      await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).first().click();
      await expect(page.getByText(copy.checkIn.messages.alreadySaved, { exact: true })).toBeVisible();
      expect(recordInserts, "Save check-in first must be idempotent after generate-and-save already saved").toBe(1);
      expect(recordMutations).toBe(mutationsAfterSave);
      expect((await ownRecords(owner.client, owner.id)).filter((row) => JSON.stringify(row.records).includes(marker))).toEqual([record]);
      expect(aiCalls).toBe(1);

      await page.goto(`${prefix}/account#records`, { waitUntil: "domcontentloaded" });
      await page.reload({ waitUntil: "domcontentloaded" });
      // The init script installs the session once; this reload must use persisted Auth state.
      const card = page.locator("#records article").filter({ hasText: marker });
      await expect(card).toHaveCount(1);
      await card.locator("summary").click();
      await expect(card.getByText(marker, { exact: true })).toBeVisible();
      if (aiMode === "live") await expect(card.getByText(record.summary!, { exact: true })).toBeVisible();
      expect((await ownRecords(owner.client, owner.id)).some((row) => row.id === record.id)).toBe(true);
      await card.getByRole("button", { name: copy.account.records.delete, exact: true }).click();
      await expect(page.getByText(copy.account.notices.recordDeleted, { exact: true })).toBeVisible();
      await expect(page.locator("#records article").filter({ hasText: marker })).toHaveCount(0);
      expect((await ownRecords(owner.client, owner.id)).some((row) => row.id === record.id)).toBe(false);
      expect(aiCalls, "Reading and deleting must not request another AI response").toBe(1);
    } finally {
      try {
        const marked = (await ownRecords(owner.client, owner.id)).filter((row) => JSON.stringify(row.records).includes(marker));
        for (const row of marked) createdIds.add(row.id);
        for (const recordId of createdIds) {
          const deleted = await owner.client.from("sweet_records").delete().eq("id", recordId).eq("user_id", owner.id);
          expect(deleted.error === null, "Cleanup is scoped to a new synthetic record ID and its owner").toBe(true);
        }
        expect((await ownRecords(owner.client, owner.id)).some((row) => JSON.stringify(row.records).includes(marker))).toBe(false);
      } finally {
        expect((await consentApi(appOrigin, owner.session, "POST")).status, "Restore only this fixture owner's confirmation").toBe(200);
      }
    }
  });
}
