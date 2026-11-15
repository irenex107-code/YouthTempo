import { expect, test } from "@playwright/test";
import {
  buildCanonicalSweetHistory, buildComprehensiveDetails, buildComprehensiveTrend, detailFieldDefinitions, normalizeSweetDetails,
} from "../lib/reports/comprehensive";
import { isSchoolReportDetails, isSchoolReportTrend, parseSchoolReportDetails, parseSchoolReportTrend } from "../lib/reports/comprehensiveValidation";
import {
  comprehensiveVersion, historyDetailsVersion, maximumDetailTextCharacters,
  type ComprehensiveSourceRow, type HistoryDetailPosition, type SchoolReportDetails, type SchoolReportDetailsCore,
  type SchoolReportTrend, type SchoolReportTrendCore,
} from "../lib/reports/comprehensiveTypes";
import { formatReportInstant, parseReportInstant } from "../lib/reports/source";
import { reportDimensions, type ReportDimension } from "../lib/reports/types";

const asOf = "2026-10-28T04:05:06.123456Z";
const microsPerDay = 86_400_000_000;
const rawMarker = "RAW_SWEET_DETAIL_ONLY";
const token = "opaque_view_context_abcdefghijklmnopqrstuvwxyz";
let sequence = 0;
function source(createdAt: string, choices: Partial<Record<ReportDimension, string>> = {}): ComprehensiveSourceRow {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    user_id: "PRIVATE_OWNER", school_id: null, created_at: createdAt,
    small_step: "PRIVATE_AI_SMALL_STEP", recommended_next_tool: "PRIVATE_OTHER_TOOL",
    summary: rawMarker,
    records: [
      { id: "sleep", title: "PRIVATE_STORED_TITLE", fields: [{ id: "quality", value: choices.sleep ?? "比较好" }] },
      { id: "wake", fields: [{ id: "state", value: choices.wake ?? "比较有精神" }] },
      { id: "eat", fields: [{ id: "rhythm", value: choices.eat ?? "比较规律" }] },
      { id: "exercise", fields: [{ id: "duration", value: choices.exercise ?? "10–19 分钟" }] },
      { id: "task", fields: [{ id: "engagement", value: choices.task ?? "比较顺利" }] },
    ],
  };
}
function atDays(days: number, extraMicros = 0, anchor = asOf) {
  return formatReportInstant(parseReportInstant(anchor)! + days * microsPerDay + extraMicros);
}
function fields(row: ComprehensiveSourceRow, dimension: number) {
  return (row.records as Array<{ id: string; fields: Array<{ id: string; value: unknown; [key: string]: unknown }> }>)[dimension].fields;
}
function dimension(result: SchoolReportTrendCore, id: ReportDimension) { return result.overview.dimensions.find((value) => value.id === id)!; }
function publicTrend(core: SchoolReportTrendCore): SchoolReportTrend {
  return { version: core.version, asOf: core.asOf, viewToken: token, coverage: core.coverage, overview: core.overview,
    recent: core.recent, longTerm: { unit: core.longTerm.unit, bins: core.longTerm.bins, nextCursor: core.longTerm.hasMore ? token : null }, detailsState: core.detailsState };
}
function publicDetails(core: SchoolReportDetailsCore): SchoolReportDetails {
  return { version: core.version, asOf: core.asOf, viewToken: token,
    items: core.items.map((item, index) => ({ ...item, key: `opaque_record_key_${String(index).padStart(20, "0")}` })), nextCursor: core.hasMore ? token : null };
}

/** Exported deterministic vectors for the real isolated SQL/TS comparison runner. */
export function buildHistorySummarySqlVectors(anchor = asOf) {
  const relative = (days: number, extraMicros = 0) => atDays(days, extraMicros, anchor);
  const localDayStart = Math.floor((parseReportInstant(anchor)! + 28_800_000_000) / microsPerDay) * microsPerDay - 28_800_000_000;
  const historyDay = (days: number) => formatReportInstant(localDayStart + days * microsPerDay + 36_000_000_000);
  const canonical = [source(relative(-2)), source(relative(-3)), source(relative(-4))];
  const unknownLatest = source(relative(-2, 1), { sleep: "未知选项" });
  const conflicting = source(canonical[0].created_at as string, { sleep: "很不好" });
  const longHistory = Array.from({ length: 1205 }, (_, index) => source(relative(-index, -3_600_000_000), {
    sleep: index % 5 === 0 ? "不太好" : "比较好",
  }));
  longHistory.forEach((row, index) => { row.school_id = index % 3 === 0 ? null : index % 3 === 1 ? "PREVIOUS_SCHOOL" : "CURRENT_SCHOOL"; });
  // All three are representable PostgreSQL timestamps. The finite old instant
  // exceeds the exact JS-microsecond range and therefore remains undated too.
  const undated = [source("Infinity"), source("-Infinity"), source("1000-01-01T00:00:00.000Z")];
  const exercise = [-2, -3, -4].map((day) => source(relative(day), { exercise: "不太确定" }));
  const previous = [-9, -10, -11].map((day) => source(relative(day), { exercise: "30 分钟以上" }));
  const mixed = [-1, -2, -3, -4].map((day) => source(relative(day), { sleep: day < -2 ? "不太好" : "比较好" }));
  const sameA = source(relative(-1)); const sameB = source(relative(-1));
  fields(sameA, 0).push({ id: "factors", value: ["身体不舒服", "睡前想太多"] });
  fields(sameB, 0).push({ id: "factors", value: ["睡前想太多", "身体不舒服"] });
  const summaryA = source(relative(-1)); const summaryB = source(relative(-1));
  summaryA.summary = ""; summaryB.summary = " ";
  const cases = [
    { name: "empty", rows: [] as ComprehensiveSourceRow[], asOf: anchor },
    { name: "canonical-three-dates", rows: canonical, asOf: anchor },
    { name: "latest-unknown-no-fallback", rows: [...canonical, unknownLatest], asOf: anchor },
    { name: "equal-latest-conflict", rows: [...canonical, conflicting], asOf: anchor },
    { name: "equal-latest-identical-normalized-content", rows: [...canonical, sameA, sameB], asOf: anchor },
    { name: "equal-latest-original-summary-conflict", rows: [...canonical, summaryA, summaryB], asOf: anchor },
    { name: "undated-only", rows: undated, asOf: anchor },
    { name: "finite-future-excluded", rows: [...canonical, source(anchor), source(relative(1))], asOf: anchor },
    { name: "exercise-unsure-comparison", rows: [...exercise, ...previous], asOf: anchor },
    { name: "mixed-equal-modes", rows: mixed, asOf: anchor },
    { name: "exact-rolling-boundaries", rows: [source(relative(-7)), source(relative(-7, -1)), source(relative(-14)), source(relative(-30)), source(relative(-60))], asOf: anchor },
    { name: "shanghai-midnight-boundary", rows: [source(formatReportInstant(localDayStart - microsPerDay - 1)), source(formatReportInstant(localDayStart - microsPerDay)), ...canonical], asOf: anchor },
    { name: "ninety-shanghai-dates-week", rows: [source(historyDay(-89)), ...canonical], asOf: anchor },
    { name: "ninety-one-shanghai-dates-month", rows: [source(historyDay(-90)), ...canonical], asOf: anchor },
    { name: "full-history-1205-with-null-and-former-schools", rows: [...longHistory, ...undated], asOf: anchor },
  ];
  return cases.map((item) => ({ ...item, expectedTrend: buildComprehensiveTrend(item), expectedDetails: buildComprehensiveDetails(item) }));
}

test("v2准确版本与公共DTO边界：趋势没有正文/身份/来源ID/内部游标", () => {
  const rows = [source(atDays(-1)), source(atDays(-2)), source(atDays(-3))];
  fields(rows[0], 0).push({ id: "note", value: rawMarker });
  const core = buildComprehensiveTrend({ rows, asOf, detailsState: "available" });
  expect(core.version).toBe(comprehensiveVersion);
  const dto = publicTrend(core);
  expect(isSchoolReportTrend(dto)).toBe(true);
  expect(parseSchoolReportTrend(dto)).toBe(dto);
  expect(JSON.stringify(dto)).not.toMatch(/RAW_SWEET|PRIVATE_|00000000-0000|source_revision|hasMore|nextBinStart/);
  const details = publicDetails(buildComprehensiveDetails({ rows, asOf }));
  expect(details.version).toBe(historyDetailsVersion);
  expect(isSchoolReportDetails(details)).toBe(true);
  expect(JSON.stringify(details)).toContain(rawMarker);
  expect(JSON.stringify(details)).not.toMatch(/PRIVATE_AI_SMALL_STEP|PRIVATE_OTHER_TOOL|PRIVATE_STORED_TITLE|PRIVATE_OWNER/);
});

test("全历史包括无学校、旧学校与近期所有本人来源，不受授权时刻截断", () => {
  const rows = [source("2024-02-29T02:00:00.000Z"), source("2025-01-02T02:00:00.000Z"), source(atDays(-1))];
  rows[0].school_id = null; rows[1].school_id = "FORMER_SCHOOL"; rows[2].school_id = "CURRENT_SCHOOL";
  const result = buildComprehensiveTrend({ rows, asOf });
  expect(result.coverage.start).toBe("2024-02-29T02:00:00.000Z");
  expect(dimension(result, "sleep")).toEqual({ id: "sleep", state: "category", category: "sleep_good" });
  expect(result.recent.days7.current.dimensions[0].state).toBe("insufficient");
  expect(buildComprehensiveDetails({ rows, asOf }).items).toHaveLength(3);
});

test("微秒最新记录先去重，再按维验证；未知新答案不回退旧值", () => {
  const earlier = source("2026-10-26T08:00:00.123455Z");
  const latest = source("2026-10-26T08:00:00.123456Z", { sleep: "未知新选项" });
  const others = [source(atDays(-3)), source(atDays(-4))];
  const result = buildComprehensiveTrend({ rows: [earlier, latest, ...others], asOf });
  expect(dimension(result, "sleep").state).toBe("insufficient");
  expect(dimension(result, "wake").category).toBe("wake_energized");
  expect(result.coverage.state).toBe("partial");
  const items = buildComprehensiveDetails({ rows: [earlier, latest, ...others], asOf }).items;
  expect(items.find((item) => item.date === "2026-10-26")?.dimensions?.[0].fields[0]).toEqual({ id: "quality", state: "unsupported" });
  expect(items.some((item) => item.key === earlier.id)).toBe(false);
  expect(buildComprehensiveTrend({ rows: [latest, ...others, earlier].reverse(), asOf })).toEqual(result);
});

test("纯聚合按传入的保留行计算；缺失替换行的合成输入不模拟数据库删除", () => {
  // The DB DELETE trigger now removes the same-day retained prefix. Passing an
  // older row alone tests the pure aggregation input contract, not that trigger.
  const older = source(atDays(-1)); const replacement = source(atDays(-1, 1), { sleep: "未知" });
  const others = [source(atDays(-2)), source(atDays(-3))];
  expect(dimension(buildComprehensiveTrend({ rows: [older, replacement, ...others], asOf }), "sleep").state).toBe("insufficient");
  expect(dimension(buildComprehensiveTrend({ rows: [older, ...others], asOf }), "sleep").category).toBe("sleep_good");
  const wholeDayDeleted = buildComprehensiveDetails({ rows: others, asOf });
  expect(wholeDayDeleted.items.some((item) => item.date === "2026-10-27")).toBe(false);
  expect(dimension(buildComprehensiveTrend({ rows: others, asOf }), "sleep").state).toBe("insufficient");
});

test("同刻一致内容合并且忽略标题/学校/rowID；原summary不同产生无正文冲突占位", () => {
  const a = source(atDays(-1)); const b = source(atDays(-1));
  b.school_id = "OTHER_SCHOOL";
  (b.records as Array<{ title?: string }>)[0].title = "DIFFERENT_STORED_TITLE";
  expect(buildCanonicalSweetHistory([a, b], asOf).days[0].conflict).toBe(false);
  b.summary = "DIFFERENT SUMMARY";
  const conflicted = buildComprehensiveDetails({ rows: [a, b], asOf });
  expect(conflicted.items).toEqual([{ key: a.id, date: "2026-10-27", state: "conflict" }]);
  expect(JSON.stringify(conflicted.items)).not.toMatch(/SUMMARY|RAW_SWEET/);
  const newer = source(atDays(-1, 1));
  expect(buildCanonicalSweetHistory([a, b, newer], asOf).days[0].conflict).toBe(false);
});

test("可选多选规范排序，空字段省略；重复字段/错型只标受限而不泄漏原文", () => {
  const row = source(atDays(-1));
  fields(row, 0).push({ id: "factors", value: ["身体不舒服", "睡前想太多"] }, { id: "note", value: "" });
  const a = normalizeSweetDetails(row.records, null);
  expect(a.state).toBe("available");
  expect(a.dimensions[0].fields[1].value).toEqual(["睡前想太多", "身体不舒服"]);
  expect(a.dimensions[0].fields.some((field) => field.id === "note")).toBe(false);
  fields(row, 0).push({ id: "quality", value: "PRIVATE_DUPLICATE" }, { id: "note", value: ["PRIVATE_WRONG_TYPE"] });
  const b = normalizeSweetDetails(row.records, null);
  expect(b.state).toBe("partial");
  expect(b.answers.sleep).toBeUndefined();
  expect(b.answers.wake).toBe("wake_energized");
  expect(JSON.stringify(b)).not.toMatch(/PRIVATE_DUPLICATE|PRIVATE_WRONG_TYPE/);
});

test("全部19字段为显式白名单，正文和summary保留原文，排除其他AI建议", () => {
  const row = source(atDays(-1));
  row.records = reportDimensions.map((id) => ({ id, fields: detailFieldDefinitions[id].map((definition) => ({
    id: definition.id, value: definition.kind === "text" ? `  ${rawMarker} ${id}.${definition.id}  `
      : definition.kind === "multi" ? [definition.options![0]] : definition.options![0],
  })) }));
  fields(row, 4).push({ id: "hiddenChainOfThought", value: "PRIVATE_INTERNAL_REASONING" });
  row.summary = `  ${rawMarker} stored summary\nsecond line  `;
  const item = buildComprehensiveDetails({ rows: [row], asOf }).items[0];
  expect(item.state).toBe("partial");
  expect(item.dimensions?.flatMap((value) => value.fields)).toHaveLength(19);
  expect(item.summary).toBe(row.summary);
  expect(item.dimensions?.[4].fields.find((field) => field.id === "completedSmallTask")?.value).toBe(`  ${rawMarker} task.completedSmallTask  `);
  expect(JSON.stringify(item)).not.toMatch(/PRIVATE_INTERNAL_REASONING|PRIVATE_AI_SMALL_STEP|recommended_next_tool|small_step|title|label/);
});

test("Unicode文字按码点限制，超长正文/summary标unsupported、不静默截短", () => {
  const row = source(atDays(-1));
  fields(row, 0).push({ id: "note", value: "🙂".repeat(maximumDetailTextCharacters) });
  let normalized = normalizeSweetDetails(row.records, null);
  expect(normalized.dimensions[0].fields.find((field) => field.id === "note")?.state).toBe("available");
  fields(row, 0).pop(); fields(row, 0).push({ id: "note", value: "🙂".repeat(maximumDetailTextCharacters + 1) });
  normalized = normalizeSweetDetails(row.records, "x".repeat(maximumDetailTextCharacters + 1));
  expect(normalized.dimensions[0].fields.find((field) => field.id === "note")).toEqual({ id: "note", state: "unsupported" });
  expect(normalized.summaryState).toBe("unsupported"); expect(normalized.summary).toBeNull();
  expect(normalized.state).toBe("partial");
});

test("Infinity和非法日期在单独undated阶段占位，有限未来与asOf精确边界不提前纳入", () => {
  const dated = source(atDays(-1));
  const invalid = [source("Infinity"), source("-Infinity"), source("2026-02-30T00:00:00Z")];
  const rows = [dated, ...invalid, source(asOf), source(atDays(1))];
  const trend = buildComprehensiveTrend({ rows, asOf }); expect(trend.coverage.state).toBe("partial");
  const first = buildComprehensiveDetails({ rows, asOf });
  expect(first.items).toHaveLength(1); expect(first.nextPosition).toEqual({ phase: "undated", afterId: null });
  const last = buildComprehensiveDetails({ rows, asOf, position: first.nextPosition });
  expect(last.items).toEqual(invalid.map((row) => ({ key: row.id, date: null, state: "unsupported" })));
  expect(last.nextPosition).toBeNull();
  const onlyUndated = buildComprehensiveTrend({ rows: invalid, asOf });
  expect(onlyUndated.coverage).toEqual({ start: null, end: asOf, state: "unsupported" });
  expect(onlyUndated.overview.dimensions.every((value) => value.state === "unsupported")).toBe(true);
  expect(onlyUndated.longTerm.bins).toEqual([]);
});

test("滚动7/30精确半开端点、上海日期归属和相邻窗口不重复同一天", () => {
  const rows = [source(atDays(-7, -1)), source(atDays(-7)), source(atDays(-30, -1)), source(atDays(-30))];
  const history = buildCanonicalSweetHistory(rows, asOf);
  expect(history.days).toHaveLength(2);
  const result = buildComprehensiveTrend({ rows, asOf });
  expect(result.recent.days7.current.start).toBe(atDays(-7));
  expect(result.recent.days7.previous.end).toBe(atDays(-7));
  expect(result.recent.days30.previous.start).toBe(atDays(-60));
  expect(result.recent.days30.current.end).toBe(asOf);
  const midnight = [source("2026-10-26T15:59:59.999999Z"), source("2026-10-26T16:00:00.000Z")];
  expect(buildCanonicalSweetHistory(midnight, asOf).days.map((row) => row.date)).toEqual(["2026-10-27", "2026-10-26"]);
});

test("最低3日、并列mixed、缺失unsupported和运动不确定比较均保守", () => {
  const rows = [-1, -2, -3].map((value) => source(atDays(value), { sleep: "不太好", exercise: "不太确定" }));
  const previous = [-8, -9, -10].map((value) => source(atDays(value), { sleep: "比较好", exercise: "30 分钟以上" }));
  const result = buildComprehensiveTrend({ rows: [...rows, ...previous], asOf });
  expect(result.recent.days7.comparisons[0]).toEqual({ id: "sleep", state: "different" });
  expect(result.recent.days7.comparisons[3]).toEqual({ id: "exercise", state: "unavailable" });
  const mixed = [...rows.slice(0, 2), ...[-4, -5].map((value) => source(atDays(value), { sleep: "比较好" }))];
  expect(dimension(buildComprehensiveTrend({ rows: mixed, asOf }), "sleep").state).toBe("mixed");
  expect(dimension(buildComprehensiveTrend({ rows: [source(atDays(-1), { sleep: "未知" })], asOf }), "sleep").state).toBe("unsupported");
  expect(dimension(buildComprehensiveTrend({ rows: rows.slice(0, 2), asOf }), "sleep").state).toBe("insufficient");
});

test("90个上海日含首尾使用周箱，91日改自然月；空箱保留且不伪装趋势", () => {
  const week = buildComprehensiveTrend({ rows: [source("2026-07-31T02:00:00Z")], asOf });
  const month = buildComprehensiveTrend({ rows: [source("2026-07-30T02:00:00Z")], asOf });
  expect(week.longTerm.unit).toBe("week"); expect(month.longTerm.unit).toBe("month");
  expect(week.longTerm.bins.every((bin) => bin.dimensions.every((value) => value.state === "insufficient"))).toBe(true);
  expect(week.longTerm.bins[0].start).toBe("2026-10-25T16:00:00.000Z");
  expect(week.longTerm.bins[0].partial).toBe(true);
  expect(month.longTerm.bins[0].end).toBe("2026-10-31T16:00:00.000Z");
});

test("1,205日期全部遍历且无学校过滤；长程分页不改变全历史或近期计算", () => {
  test.setTimeout(60_000);
  const vector = buildHistorySummarySqlVectors().find((value) => value.name.startsWith("full-history-1205"))!;
  const first = vector.expectedTrend;
  const bins = [...first.longTerm.bins];
  let before = first.longTerm.nextBinStart;
  while (before) {
    const page = buildComprehensiveTrend({ rows: vector.rows, asOf, beforeBinStart: before });
    expect(page.overview).toEqual(first.overview); expect(page.recent).toEqual(first.recent); expect(page.coverage).toEqual(first.coverage);
    bins.push(...page.longTerm.bins); before = page.longTerm.nextBinStart;
  }
  expect(bins.length).toBeGreaterThan(24);
  expect(new Set(bins.map((bin) => bin.start)).size).toBe(bins.length);
  for (let index = 1; index < bins.length; index += 1) expect(bins[index].end).toBe(bins[index - 1].start);
  const items = [];
  let position: HistoryDetailPosition | null = null;
  do {
    const page = buildComprehensiveDetails({ rows: vector.rows, asOf, position });
    expect(page.items.length).toBeLessThanOrEqual(25);
    items.push(...page.items); position = page.nextPosition;
  } while (position);
  expect(items.filter((item) => item.date !== null)).toHaveLength(1205);
  expect(items.filter((item) => item.date === null)).toHaveLength(3);
  expect(new Set(items.map((item) => item.key)).size).toBe(1208);
  expect(items[1204].date).toBe(first.coverage.start!.slice(0, 10));
});

test("所有SQL对照向量公共trend和各明细页都通过严格运行时校验", () => {
  for (const vector of buildHistorySummarySqlVectors()) {
    expect(isSchoolReportTrend(publicTrend(vector.expectedTrend)), vector.name).toBe(true);
    expect(isSchoolReportDetails(publicDetails(vector.expectedDetails)), vector.name).toBe(true);
  }
});

test("trend严格拒绝额外身份/正文/count、错维类别、乱序/重复维、错误时窗/比较/箱及伪状态", () => {
  const dto = publicTrend(buildComprehensiveTrend({ rows: [-1, -2, -3, -8, -9, -10].map((value) => source(atDays(value))), asOf }));
  const mutations: Array<(value: any) => void> = [
    (v) => { v.source_revision = 20; }, (v) => { v.ownerId = "PRIVATE_OWNER"; }, (v) => { v.summary = rawMarker; },
    (v) => { v.longTerm.hasMore = true; }, (v) => { v.coverage.count = 6; }, (v) => { v.coverage.state = ["complete"]; },
    (v) => { v.detailsState = ["off"]; }, (v) => { v.overview.dimensions[0].category = "eat_regular"; },
    (v) => { v.overview.dimensions.reverse(); }, (v) => { v.overview.dimensions[1] = v.overview.dimensions[0]; },
    (v) => { v.recent.days7.current.start = atDays(-6); }, (v) => { v.recent.days7.comparisons[0].state = "different"; },
    (v) => { v.longTerm.bins[0].end = asOf; }, (v) => { v.longTerm.bins[0].partial = false; },
    (v) => { v.longTerm.bins = []; }, (v) => { v.viewToken = "00000000-0000-4000-8000-000000000001"; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(dto); mutate(value);
    expect(isSchoolReportTrend(value)).toBe(false);
    expect(() => parseSchoolReportTrend(value)).toThrow("Invalid comprehensive report DTO");
  }
});

test("detail严格拒绝裸UUID、额外模块/AI字段、未知字段、重复/错型与非法占位正文", () => {
  const dto = publicDetails(buildComprehensiveDetails({ rows: [source(atDays(-1))], asOf }));
  expect(parseSchoolReportDetails(dto)).toBe(dto);
  const mutations: Array<(value: any) => void> = [
    (v) => { v.items[0].key = "00000000-0000-4000-8000-000000000001"; },
    (v) => { v.items[0].user_id = "PRIVATE_OWNER"; }, (v) => { v.items[0].small_step = "PRIVATE_AI_SMALL_STEP"; },
    (v) => { v.items[0].dimensions[0].fields.push({ id: "journal", state: "available", value: rawMarker }); },
    (v) => { v.items[0].dimensions[0].fields.push(v.items[0].dimensions[0].fields[0]); },
    (v) => { v.items[0].dimensions[0].fields[0].value = ["比较好"]; },
    (v) => { v.items[0].dimensions[0].fields[0].state = ["available"]; },
    (v) => { v.items[0].date = "2026-02-30"; }, (v) => { v.items[0].date = "2026-10-29"; },
    (v) => { v.items[0].state = "unsupported"; }, (v) => { v.items[0].summary = {}; },
    (v) => { v.items[0].summaryState = "missing"; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(dto); mutate(value);
    expect(isSchoolReportDetails(value)).toBe(false);
    expect(() => parseSchoolReportDetails(value)).toThrow("Invalid detailed report DTO");
  }
});
