import { expect, test } from "@playwright/test";
import {
  history,
  NOW,
  OWNER,
  participationFixture,
  TABLES,
  type ParticipationTable,
} from "./fixtures/garden-participation-transport";

const independentDateKeys = ["2026-09-04", "2026-10-31", "2026-11-01", "2026-11-03"];
const olderTimestamps = [
  "2026-09-03T16:00:00.000Z",
  "2026-10-31T15:59:59.999Z",
  "2026-10-31T16:00:00.000Z",
];

function sourceFor999() {
  // The older unique dates have high IDs, so they are returned only after
  // 500 dense same-day rows and the remaining 496 same-day rows.
  return [
    ...history(996, () => NOW),
    ...history(3, (index) => olderTimestamps[index], OWNER, 50_000),
  ].reverse();
}

for (const table of TABLES) {
  test(`P01-19 supplement ${table}: 999 rows reach the independent date set`, async ({}, testInfo) => {
    const source = sourceFor999();
    const fixture = participationFixture(table === "tempo_check_ins" ? { quick: source } : { sweet: source });
    const result = await fixture.read(new Date(NOW));

    expect(result.dateKeys).toEqual(independentDateKeys);
    expect(result.summary).toMatchObject({
      total: independentDateKeys.length,
      thisWeek: 1,
      thisMonth: 2,
      todayParticipated: true,
      stage: "leaves",
      sceneLevel: "base",
      quickCheckIns: table === "tempo_check_ins" ? 999 : 0,
      fullSweetRecords: table === "sweet_records" ? 999 : 0,
      unlockedPositions: ["flower_border"],
      unlockedItems: ["wildflower_patch"],
    });

    const targetRows = table === "tempo_check_ins" ? result.quickRows : result.sweetRows;
    const otherRows = table === "tempo_check_ins" ? result.sweetRows : result.quickRows;
    expect(targetRows).toHaveLength(999);
    expect(otherRows).toEqual([]);
    expect(targetRows.every((row) => Object.keys(row).join() === "created_at")).toBe(true);

    const targetQueries = fixture.queries.filter((query) => query.table === table);
    expect(targetQueries.map((query) => query.returned)).toEqual([500, 499, 0]);
    const expectedIds = source.map((row) => String(row.id)).sort();
    expect(fixture.returnedIds[table]).toEqual(expectedIds);
    expect(new Set(fixture.returnedIds[table]).size).toBe(999);
    for (const [index, query] of targetQueries.entries()) {
      expect(query.select).toBe("id,created_at");
      expect(query.order).toBe("id.asc");
      expect(query.limit).toBe(500);
      expect(query.filters).toContainEqual(["user_id", `eq.${OWNER}`]);
      expect(query.filters.some(([key]) => key === "offset")).toBe(false);
      if (index > 0) {
        expect(query.filters).toContainEqual(["id", `gt.${expectedIds[Math.min(index * 500, 999) - 1]}`]);
      }
    }

    const otherTable = TABLES.find((candidate) => candidate !== table) as ParticipationTable;
    const otherQueries = fixture.queries.filter((query) => query.table === otherTable);
    expect(otherQueries).toHaveLength(1);
    expect(otherQueries[0].returned).toBe(0);
    expect(otherQueries[0].filters).toContainEqual(["user_id", `eq.${OWNER}`]);

    await testInfo.attach("public-synthetic-query-evidence", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        table,
        inputRows: source.length,
        independentDateKeys,
        summary: result.summary,
        queries: fixture.queries.map(({ signal, ...query }) => ({ ...query, aborted: signal?.aborted })),
        returnedIds: Object.fromEntries(Object.entries(fixture.returnedIds).map(([name, ids]) => [name, ids.length])),
      }, null, 2)),
    });
  });
}
