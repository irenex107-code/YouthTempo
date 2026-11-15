import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { daysAgo, history, NOW, OTHER, OWNER, participationFixture, TABLES, uuid } from "./fixtures/garden-participation-transport";

const fixtures: ReturnType<typeof participationFixture>[] = [];
function fixture(options: Parameters<typeof participationFixture>[0] = {}) {
  const sharedSource = process.env.GARDEN_PARTICIPATION_BASELINE === "1"
    ? readFileSync("audit-records/2026-11-04/product01_p01_19_participation/before/pages/api/garden/_shared.ts", "utf8") : undefined;
  const f = participationFixture({ ...options, sharedSource }); fixtures.push(f); return f;
}
test.beforeEach(() => { fixtures.length = 0; });
test.afterEach(async () => {
  await test.info().attach("in-memory-sdk-queries", { contentType: "application/json", body: Buffer.from(JSON.stringify(fixtures.map((f) => ({
    queries: f.queries.map(({ signal, ...q }) => ({ ...q, aborted: signal?.aborted })),
    returnedCounts: Object.fromEntries(Object.entries(f.returnedIds).map(([key, ids]) => [key, ids.length])),
    deadlines: f.deadlines.map((d) => ({ ms: d.ms, cleared: d.cleared })), operations: f.operations, rateLimitCalls: f.limits,
  })), null, 2)) });
});

for (const table of TABLES) {
  test(`REPRO ${table}: more than 1000 saved dates must all contribute`, async () => {
    const source = history(1205, (i) => daysAgo(i));
    const f = fixture(table === "tempo_check_ins" ? { quick: source } : { sweet: source });
    const result = await f.read();
    expect(result.summary.total).toBe(1205);
    expect(result.summary.quickCheckIns).toBe(table === "tempo_check_ins" ? 1205 : 0);
    expect(result.summary.fullSweetRecords).toBe(table === "sweet_records" ? 1205 : 0);
  });
}

test("REPRO mixed: dense same-day history must not hide older days or unlocks", async () => {
  const f = fixture({
    quick: [...history(1001, () => NOW), ...history(30, (i) => daysAgo(i + 1), OWNER, 2000)],
    sweet: [...history(1001, () => NOW), ...history(30, (i) => daysAgo(i + 15), OWNER, 2000)],
  });
  const result = await f.read();
  expect(result.summary.total).toBe(45);
  expect(result.summary.quickCheckIns).toBe(1031);
  expect(result.summary.fullSweetRecords).toBe(1031);
  expect(result.summary.stage).toBe("bloom"); expect(result.summary.sceneLevel).toBe("mature");
  expect(result.summary.unlockedPositions).toContain("bench_corner");
});

test("REPRO keepsake: an older retained participation date remains usable", async () => {
  const f = fixture({ quick: [...history(1001, () => NOW), ...history(1, () => daysAgo(60), OWNER, 2000)] });
  const r = await f.request("pages/api/garden/keepsakes/index.ts", "POST", { type: "stone", date: "2026-09-04" });
  expect(r.status).toBe(201);
  expect(r.body.created).toBe(true);
});

for (const count of [0, 1, 499, 500, 501, 1000, 1001, 1500, 1501]) {
  test(`Boundary ${count} per source: tied timestamps have no missing or duplicated IDs`, async () => {
    const source = history(count, () => "2026-11-02T16:00:00.123456+00:00").reverse();
    const f = fixture({ quick: source, sweet: [...source] });
    const r = await f.read();
    expect(r.quickRows).toHaveLength(count); expect(r.sweetRows).toHaveLength(count);
    expect(r.summary.total).toBe(count ? 1 : 0);
    expect(r.summary.stage).toBe(count ? "sprout" : "seed");
    for (const table of TABLES) {
      const queries = f.queries.filter((q) => q.table === table);
      expect(queries).toHaveLength(Math.ceil(count / 500) + 1);
      expect(queries.at(-1)?.returned).toBe(0);
      expect(f.returnedIds[table]).toEqual(source.map((row) => row.id).sort());
      expect(new Set(f.returnedIds[table]).size).toBe(count);
      for (const [index, q] of queries.entries()) {
        expect(q.select).toBe("id,created_at"); expect(q.order).toBe("id.asc"); expect(q.limit).toBe(500);
        expect(q.filters).toContainEqual(["user_id", `eq.${OWNER}`]);
        expect(q.filters).not.toContainEqual(["offset", expect.anything()]);
        expect(q.signal).toBeDefined();
        if (index) expect(q.filters).toContainEqual(["id", `gt.${f.returnedIds[table][Math.min(index * 500, count) - 1]}`]);
      }
    }
    expect(r.quickRows.every((row) => Object.keys(row).join() === "created_at")).toBe(true);
  });
}

test("A server cap smaller than the requested size cannot terminate history early", async () => {
  const f = fixture({ quick: history(1205, (i) => daysAgo(i)), sweet: history(1050, (i) => daysAgo(i)), serverPageCap: 137 });
  const r = await f.read();
  expect(r.summary.total).toBe(1205); expect(r.summary.quickCheckIns).toBe(1205); expect(r.summary.fullSweetRecords).toBe(1050);
  for (const table of TABLES) {
    const qs = f.queries.filter((q) => q.table === table);
    expect(qs[0].returned).toBe(137); expect(qs.at(-1)?.returned).toBe(0);
  }
});

test("Every page filters the server owner; other-user history and deleted rows stay absent", async () => {
  const own = history(1205, (i) => daysAgo(i % 2));
  own.splice(3, 1); // This row is no longer saved; no tombstones or old snapshots are read.
  const others = history(1205, (i) => daysAgo(5000 + i), OTHER, 10_000);
  const f = fixture({ quick: [...own, ...others], sweet: [...own, ...others] });
  const r = await f.read();
  expect(r.summary.total).toBe(2); expect(r.summary.quickCheckIns).toBe(1204); expect(r.summary.fullSweetRecords).toBe(1204);
  for (const table of TABLES) {
    expect(f.returnedIds[table]).not.toContain(uuid(4));
    expect(f.returnedIds[table]).toEqual(own.map((row) => row.id));
  }
  for (const q of f.queries) expect(q.filters).toContainEqual(["user_id", `eq.${OWNER}`]);
});

test("Shanghai day, Monday week and month boundaries plus future-date handling stay intact", async () => {
  const dates = ["2026-10-31T15:59:59.999Z", "2026-10-31T16:00:00.000Z", "2026-11-01T16:00:00.000Z",
    "2026-11-02T15:59:59.999Z", "2026-11-02T16:00:00.000Z", "2026-11-03T15:59:59.999Z", "2026-11-03T16:00:00.000Z"];
  const f = fixture({ quick: history(1204, (i) => dates[i % dates.length]), sweet: history(1003, (i) => dates[i % dates.length]) });
  const r = await f.read();
  expect(r.dateKeys).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
  expect(r.summary).toMatchObject({ total: 4, thisWeek: 2, thisMonth: 3, todayParticipated: true, quickCheckIns: 1204, fullSweetRecords: 1003 });
  expect(r.summary.unlockedPositions).toEqual(["flower_border"]);
});

test("The year/month boundary retains dates from the Monday in the previous year", async () => {
  const dates = ["2026-12-27T16:00:00Z", "2026-12-31T15:59:59Z", "2026-12-31T16:00:00Z", "2027-01-01T16:00:00Z"];
  const f = fixture({ quick: history(1004, (i) => dates[i % dates.length]) });
  const r = await f.read(new Date("2027-01-01T01:00:00Z"));
  expect(r.dateKeys).toEqual(["2026-12-28", "2026-12-31", "2027-01-01"]);
  expect(r.summary).toMatchObject({ total: 3, thisWeek: 3, thisMonth: 1, todayParticipated: true });
});

for (const table of TABLES) {
  for (const kind of ["error", "network", "non-json", "null", "object", "empty-body", "overfull", "duplicate", "unordered",
    "missing-id", "invalid-id", "missing-date", "invalid-date"] as const) {
    test(`Fail closed ${table}: later ${kind} page rejects the whole read`, async () => {
      const f = fixture({ quick: history(1001, () => NOW), sweet: history(1001, () => NOW), faults: [{ table, page: 2, kind }] });
      await expect(f.read()).rejects.toBeDefined();
      expect(f.queries.find((q) => q.table === table && q.page === 1)?.returned).toBe(500);
      expect(f.queries.every((q) => q.method === "GET")).toBe(true);
      expect(f.queries.every((q) => q.signal?.aborted)).toBe(true);
    });
  }
  test(`Fail closed ${table}: page protection limit rejects partial history`, async () => {
    const f = fixture({ [table === "tempo_check_ins" ? "quick" : "sweet"]: history(201, () => NOW), serverPageCap: 1 });
    await expect(f.read()).rejects.toBeDefined();
    expect(f.queries.filter((q) => q.table === table)).toHaveLength(200);
    expect(f.returnedIds[table]).toHaveLength(200);
  });
}

for (const kind of ["hang", "ignore-abort"] as const) {
  test(`Fail closed total deadline: later ${kind} cannot produce partial or late success`, async () => {
    const f = fixture({ quick: history(1001, () => NOW), sweet: history(1001, () => NOW), manualDeadline: true,
      faults: [{ table: "tempo_check_ins", page: 2, kind }] });
    const result = f.read();
    await expect.poll(() => f.queries.some((q) => q.table === "tempo_check_ins" && q.page === 2)).toBe(true);
    expect(f.deadlines.map((d) => d.ms)).toEqual([10_000]);
    const rejected = expect(result).rejects.toBeDefined(); f.fireDeadline(); await rejected;
    const count = f.queries.length; f.releasePending(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.queries).toHaveLength(count); expect(f.deadlines.every((d) => d.cleared)).toBe(true);
    expect(f.queries.every((q) => q.signal?.aborted)).toBe(true);
  });
}

test("A failed reader aborts its still-pending sibling without fetching more pages", async () => {
  const f = fixture({ quick: history(1001, () => NOW), sweet: history(1001, () => NOW), faults: [
    { table: "tempo_check_ins", page: 2, kind: "error" }, { table: "sweet_records", page: 2, kind: "hang" },
  ] });
  await expect(f.read()).rejects.toBeDefined();
  expect(f.queries.every((q) => q.signal?.aborted)).toBe(true);
  expect(f.queries.every((q) => q.page <= 2)).toBe(true);
});

const callers = [
  ["pages/api/garden.ts", "GET", {}],
  ["pages/api/garden/care.ts", "POST", { action: "water" }],
  ["pages/api/garden/layout.ts", "PUT", { slot: "flower_border", itemKey: "wildflower_patch" }],
  ["pages/api/garden/keepsakes/index.ts", "POST", { type: "flower" }],
] as const;

for (const locale of ["zh-CN", "en"]) {
  for (const [file, method, body] of callers) {
    for (const table of TABLES) {
      test(`Caller ${locale} ${file} ${table}: later read failure returns only safe error and no business write`, async () => {
        const f = fixture({ quick: history(1001, (i) => daysAgo(i % 60)), sweet: history(1001, () => NOW),
          faults: [{ table, page: 2, kind: "error" }] });
        const r = await f.request(file, method, { ...body, user_id: OTHER, role: "admin" }, locale);
        expect(r.status).toBe(503); expect(r.body).toEqual({ error: (locale === "en" ? en : zh).garden.errors.unavailable });
        expect(r.headers["Cache-Control"]).toContain("no-store");
        expect(f.queries.every((q) => q.method === "GET")).toBe(true);
        expect(f.operations).toHaveLength(1); expect(f.operations[0].statusCode).toBe(503);
        for (const q of f.queries.filter((q) => TABLES.includes(q.table as typeof TABLES[number]))) {
          expect(q.filters).toContainEqual(["user_id", `eq.${OWNER}`]);
        }
      });
    }
    test(`Caller ${locale} ${file}: timeout stays an error with no business write`, async () => {
      const f = fixture({ quick: history(1001, (i) => daysAgo(i % 60)), manualDeadline: true,
        faults: [{ table: "tempo_check_ins", page: 2, kind: "hang" }] });
      const promise = f.request(file, method, body, locale);
      await expect.poll(() => f.queries.some((q) => q.page === 2)).toBe(true); f.fireDeadline();
      const r = await promise;
      expect(r.status).toBe(503); expect(Object.keys(r.body)).toEqual(["error"]);
      expect(f.queries.every((q) => q.method === "GET")).toBe(true);
    });
  }

  test(`Management ${locale}: withdrawal or consent failure retains own GET and DELETE but all five new uses remain denied`, async () => {
    for (const consent of ["withdrawn", "error"]) {
      const f = fixture({ consent, quick: history(1001, (i) => daysAgo(i % 2)), sweet: history(1001, () => NOW) });
      f.rows.tempo_garden_keepsakes.push({ id: uuid(8000), user_id: OWNER, keepsake_date: "2026-11-03", keepsake_type: "flower" },
        { id: uuid(8001), user_id: OTHER, keepsake_date: "2026-11-03", keepsake_type: "stone" });
      const r = await f.request(undefined, "GET", { user_id: OTHER, role: "admin" }, locale, "synthetic-A", { user_id: OTHER });
      expect(r.status).toBe(200); expect(r.body).toMatchObject({ total: 2, quickCheckIns: 1001, fullSweetRecords: 1001,
        canUseGarden: false, canCareToday: false, canAddKeepsakeToday: false });
      expect(f.queries.every((q) => q.method === "GET")).toBe(true);
      const pageCount = f.queries.filter((q) => q.page).length;
      for (const [file, method, body] of [...callers.slice(1), ["pages/api/garden.ts", "POST", { feeling: "steady" }],
        ["pages/api/garden.ts", "PATCH", { reminderMode: "daily" }]] as const) {
        expect((await f.request(file, method, body, locale)).status).toBe(consent === "withdrawn" ? 403 : 503);
      }
      expect(f.queries.filter((q) => q.page)).toHaveLength(pageCount);
      expect(f.queries.every((q) => q.method === "GET")).toBe(true);
      const own = await f.request("pages/api/garden/keepsakes/[id].ts", "DELETE", {}, locale, "synthetic-A", { id: uuid(8000) });
      const other = await f.request("pages/api/garden/keepsakes/[id].ts", "DELETE", {}, locale, "synthetic-A", { id: uuid(8001) });
      expect(own.body).toEqual({ deleted: true, id: uuid(8000) }); expect(other.status).toBe(404);
      expect(f.rows.tempo_garden_keepsakes.map((row) => row.user_id)).toEqual([OTHER]);
    }
  });
}

test("Authentication and database role still reject all four callers before participation reads", async () => {
  for (const [file, method, body] of callers) {
    const unauthenticated = fixture(); expect((await unauthenticated.request(file, method, body, "en", null)).status).toBe(401);
    expect(unauthenticated.queries).toEqual([]);
    const teacher = fixture({ role: "学校支持人员" }); expect((await teacher.request(file, method, { ...body, role: "学生" })).status).toBe(403);
    expect(teacher.queries.filter((q) => q.page)).toEqual([]);
  }
});

test("Large history reaches all four callers; care remains once daily and keepsake uniqueness stays intact", async () => {
  const f = fixture({ quick: history(1205, (i) => daysAgo(i % 60)), sweet: history(1205, (i) => daysAgo(i % 60)) });
  const read = await f.request(); expect(read.status).toBe(200);
  expect(read.body).toMatchObject({ total: 60, quickCheckIns: 1205, fullSweetRecords: 1205, sceneLevel: "mature", canCareToday: true });
  expect((await f.request("pages/api/garden/layout.ts", "PUT", { slot: "bench_corner", itemKey: "warm_lantern" })).status).toBe(200);
  const care = await f.request("pages/api/garden/care.ts", "POST", { action: "water" }); expect(care.status).toBe(201);
  const twice = await f.request("pages/api/garden/care.ts", "POST", { action: "sunlight" });
  expect(twice.status).toBe(200); expect(twice.body).toEqual({ care: { date: "2026-11-03", action: "water" }, created: false });
  expect(f.rows.tempo_garden_care_events).toHaveLength(1);
  expect((await f.request("pages/api/garden/keepsakes/index.ts", "POST", { type: "flower", date: "2026-11-03" })).status).toBe(201);
  const keepsake = await f.request("pages/api/garden/keepsakes/index.ts", "POST", { type: "stone", date: "2026-11-03" });
  expect(keepsake.body).toMatchObject({ keepsake: { type: "flower", date: "2026-11-03" }, created: false });
  expect(f.rows.tempo_garden_keepsakes).toHaveLength(1);
});

test("Dense one-day history does not unlock extra positions; no-today and future dates remain denied", async () => {
  const f = fixture({ quick: history(1205, () => daysAgo(1)), sweet: history(1205, () => daysAgo(1)) });
  const read = await f.request(); expect(read.body).toMatchObject({ total: 1, thisWeek: 1, todayParticipated: false, canCareToday: false });
  expect((await f.request("pages/api/garden/care.ts", "POST", { action: "water" })).status).toBe(409);
  expect((await f.request("pages/api/garden/layout.ts", "PUT", { slot: "flower_border", itemKey: "wildflower_patch" })).status).toBe(409);
  expect((await f.request("pages/api/garden/keepsakes/index.ts", "POST", { type: "flower", date: "2026-11-04" })).status).toBe(409);
  expect(f.queries.every((q) => q.method === "GET")).toBe(true);
});

test("Invalid actions and rate limits still precede history reads and writes", async () => {
  for (const [file, method, body] of callers.slice(1)) {
    const f = fixture({ rateLimited: true }); expect((await f.request(file, method, body)).status).toBe(429);
    expect(f.queries.filter((q) => q.page)).toEqual([]); expect(f.queries.every((q) => q.method === "GET")).toBe(true);
  }
  const f = fixture();
  for (const [file, method, body] of [
    ["pages/api/garden/care.ts", "POST", { action: "invalid" }],
    ["pages/api/garden/care.ts", "POST", { action: "water", date: "2020-01-01" }],
    ["pages/api/garden/layout.ts", "PUT", { slot: "flower_border", itemKey: "warm_lantern" }],
    ["pages/api/garden/keepsakes/index.ts", "POST", { type: "invalid" }],
  ] as const) expect((await f.request(file, method, body)).status).toBe(400);
  expect(f.queries.filter((q) => q.page)).toEqual([]);
});
