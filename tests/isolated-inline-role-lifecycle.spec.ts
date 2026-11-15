import { randomUUID } from "node:crypto";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import fixture from "./fixtures/permission-boundary.json";

const enabled = process.env.E2E_ISOLATED_INLINE_ROLE_LIFECYCLE === "true";
const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const password = process.env.E2E_PERMISSION_TEST_PASSWORD || "";
type UserKey = keyof typeof fixture.users;
type RecordRow = { id: string; user_id: string; school_id: string | null; records: unknown;
  summary: string | null; small_step: string | null; recommended_next_tool: string | null };

test.describe.configure({ mode: "serial" });
test.skip(!enabled, "Requires the explicitly enabled disposable local role lifecycle runner.");

function localOrigin(value: string, port: string) {
  const url = new URL(value);
  expect(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === port
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "Only this batch's exact disposable loopback origin is allowed").toBe(true);
  return url.origin;
}

async function signIn(key: UserKey, databaseOrigin: string) {
  const client = createClient(databaseOrigin, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== databaseOrigin) throw new Error("Isolated Auth/Data API request left its local origin");
      return fetch(input, { ...init, redirect: "error" });
    } },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: fixture.users[key].email, password });
  if (error || !data.session || !data.user) throw new Error("Disposable fixture password sign-in failed");
  return { client, session: data.session, id: data.user.id };
}

async function ownRecords(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("sweet_records")
    .select("id,user_id,school_id,records,summary,small_step,recommended_next_tool")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Disposable owner record read failed");
  return (data || []) as RecordRow[];
}

async function localApi(origin: string, session: Session, path: "/api/account/consent" | "/api/mini/records", method: string, body?: unknown) {
  try {
    return await fetch(new URL(path, origin), { method, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Error("Disposable local account request failed; request details withheld"); }
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 真实本人会话就地确认、无AI保存、刷新读取与撤回后拒绝`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const databaseOrigin = localOrigin(databaseUrl, "56321");
    const appOrigin = localOrigin(baseURL || "", "3270");
    expect(Boolean(anonKey && password), "Disposable fixture credentials are required").toBe(true);
    const trace = testInfo.project.use.trace;
    expect(trace === "off" || (typeof trace === "object" && trace?.mode === "off"),
      "This real-session suite requires runner trace=off so JWTs are never attached").toBe(true);
    // Distinct owners prevent desktop/mobile projects from changing each other's confirmation.
    const ownerKey = testInfo.project.name.includes("mobile") ? "studentThree" : "studentOne";
    const [owner, otherStudent, teacher, guardian] = await Promise.all([
      signIn(ownerKey, databaseOrigin), signIn("studentTwo", databaseOrigin),
      signIn("teacherOne", databaseOrigin), signIn("guardianOne", databaseOrigin),
    ]);
    const marker = `SYNTHETIC_INLINE_${randomUUID()}`;
    const attemptedId = randomUUID();
    const createdIds = new Set<string>();
    let aiCalls = 0, recordWrites = 0;
    await page.route("**/api/ai/**", async (route) => { aiCalls++; await route.abort(); });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === databaseOrigin && url.pathname === "/rest/v1/sweet_records" && request.method() !== "GET") recordWrites++;
    });
    const authKey = `sb-${new URL(databaseOrigin).hostname.split(".")[0]}-auth-token`;
    await page.addInitScript(({ origin, key, session, once }) => {
      if (location.origin !== origin || sessionStorage.getItem(once)) return;
      localStorage.setItem(key, JSON.stringify(session));
      sessionStorage.setItem(once, "installed");
    }, { origin: appOrigin, key: authKey, session: owner.session, once: marker });

    try {
      expect((await localApi(appOrigin, owner.session, "/api/account/consent", "DELETE")).status).toBe(200);
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
      expect(recordWrites).toBe(0);
      await panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true }).selectOption("14_17");
      await panel.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
      const confirmed = page.waitForResponse((response) => new URL(response.url()).origin === appOrigin
        && new URL(response.url()).pathname === "/api/account/consent" && response.request().method() === "POST");
      await panel.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
      expect((await confirmed).status()).toBe(200);
      await expect(panel.getByText(copy.inlineConsent.ready, { exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: copy.aiTransparency.confirm, exact: true })).not.toBeChecked();
      for (let index = 0; index < 4; index++) await page.getByRole("button", { name: copy.checkIn.actions.previous, exact: true }).click();
      await expect(page.getByPlaceholder(copy.checkIn.steps.sleep.fields.note.placeholder, { exact: true })).toHaveValue(marker);
      await expect(page.getByRole("button", { name: choices[0], exact: true })).toHaveAttribute("aria-pressed", "true");
      for (let index = 0; index < 4; index++) await page.getByRole("button", { name: copy.checkIn.actions.next, exact: true }).click();
      expect(recordWrites).toBe(0);
      expect(aiCalls).toBe(0);
      expect((await ownRecords(owner.client, owner.id)).map((row) => row.id).sort()).toEqual(initialIds);
      const savedResponse = page.waitForResponse((response) => new URL(response.url()).origin === databaseOrigin
        && new URL(response.url()).pathname === "/rest/v1/sweet_records" && response.request().method() === "POST");
      await page.getByRole("button", { name: copy.checkIn.actions.saveFirst, exact: true }).click();
      const inserted = await savedResponse;
      const insertedBody = await inserted.json() as { id?: unknown };
      if (typeof insertedBody.id === "string") createdIds.add(insertedBody.id);
      expect(inserted.status()).toBe(201);
      await expect(page.getByText(copy.checkIn.messages.saved, { exact: true })).toBeVisible();
      const record = (await ownRecords(owner.client, owner.id)).find((row) => JSON.stringify(row.records).includes(marker));
      expect(Boolean(record), "The owner must read the browser's actual saved record").toBe(true);
      createdIds.add(record!.id);
      expect(record).toMatchObject({ user_id: owner.id, summary: null, small_step: null, recommended_next_tool: null });
      for (const reader of [otherStudent, teacher, guardian]) {
        const result = await reader.client.from("sweet_records").select("id").eq("id", record!.id);
        expect(result.error === null, "Denied readers still get an empty RLS-filtered result").toBe(true);
        expect(result.data).toEqual([]);
      }
      await page.goto(`${prefix}/account#records`, { waitUntil: "domcontentloaded" });
      await page.reload({ waitUntil: "domcontentloaded" });
      const card = page.locator("#records article").filter({ hasText: marker });
      await expect(card).toHaveCount(1);
      await card.locator("summary").click();
      await expect(card.getByText(marker, { exact: true })).toBeVisible();
      expect((await ownRecords(owner.client, owner.id)).some((row) => row.id === record!.id)).toBe(true);

      expect((await localApi(appOrigin, owner.session, "/api/account/consent", "DELETE")).status).toBe(200);
      createdIds.add(attemptedId);
      const denied = await owner.client.from("sweet_records").insert({ id: attemptedId, user_id: owner.id,
        school_id: record!.school_id, records: record!.records }).select("id");
      expect(denied.error?.code).toBe("42501");
      expect(denied.data).toBeNull();
      expect((await localApi(appOrigin, owner.session, "/api/mini/records", "POST", { records: record!.records })).status).toBe(403);
      expect((await ownRecords(owner.client, owner.id)).some((row) => row.id === attemptedId)).toBe(false);
      expect(aiCalls).toBe(0);
    } finally {
      try {
        const marked = (await ownRecords(owner.client, owner.id)).filter((row) => JSON.stringify(row.records).includes(marker));
        for (const row of marked) createdIds.add(row.id);
        for (const recordId of createdIds) {
          const deleted = await owner.client.from("sweet_records").delete().eq("id", recordId).eq("user_id", owner.id);
          expect(deleted.error === null, "Cleanup is scoped to a new synthetic record ID and its owner").toBe(true);
        }
        expect((await ownRecords(owner.client, owner.id)).some((row) => JSON.stringify(row.records).includes(marker))).toBe(false);
        expect(aiCalls, "No AI route may be called during the real local lifecycle").toBe(0);
      } finally {
        const restored = await localApi(appOrigin, owner.session, "/api/account/consent", "POST", { action: "student_assent", ageBand: "14_17" });
        expect(restored.status, "Restore only this synthetic owner's confirmation").toBe(200);
      }
    }
  });
}
