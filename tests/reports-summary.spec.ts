import { expect, test } from "@playwright/test";
import { adaptSweetReportSources, parseReportInstant } from "../lib/reports/source";
import { buildReportSummary } from "../lib/reports/summary";
import { reportDimensions, type BuildReportSummaryInput, type ReportAnswers, type ReportSourceRecord } from "../lib/reports/types";

const effectiveAt = "2026-10-01T07:30:00.000Z";
const expiresAt = "2026-10-31T07:30:00.000Z";
const firstEnd = "2026-10-08T07:30:00.000Z";
const secondEnd = "2026-10-15T07:30:00.000Z";
const answers: ReportAnswers = {
  sleep: "sleep_good", wake: "wake_energized", eat: "eat_regular",
  exercise: "exercise_ten_to_nineteen", task: "task_smooth",
};

function normalized(createdAt: string, changes: Partial<ReportAnswers> = {}): ReportSourceRecord {
  return { createdAt, answers: { ...answers, ...changes } };
}

function raw(created_at = "2026-10-02T08:00:00.000Z") {
  return {
    id: "PRIVATE-SOURCE-ID", user_id: "PRIVATE-OWNER-ID", school_id: "PRIVATE-SCHOOL-ID",
    created_at, summary: "PRIVATE-AI-TEXT", small_step: "PRIVATE-STEP", recommended_next_tool: "PRIVATE-TOOL",
    records: [
      { id: "sleep", title: "PRIVATE-TITLE", label: "PRIVATE-LABEL", fields: [{ id: "quality", title: "PRIVATE-TITLE", value: "比较好" }, { id: "note", value: "PRIVATE-JOURNAL" }] },
      { id: "wake", fields: [{ id: "state", value: "比较有精神" }, { id: "factors", value: ["PRIVATE-FACTOR"] }] },
      { id: "eat", fields: [{ id: "rhythm", value: "比较规律" }, { id: "foodDetails", value: "PRIVATE-FOOD" }] },
      { id: "exercise", fields: [{ id: "duration", value: "10–19 分钟" }] },
      { id: "task", fields: [{ id: "engagement", value: "比较顺利" }] },
    ],
  };
}

function summarize(records: readonly ReportSourceRecord[], overrides: Partial<BuildReportSummaryInput> = {}) {
  return buildReportSummary({ records, effectiveAt, expiresAt, now: firstEnd, dimensions: reportDimensions, ...overrides });
}

const firstRecords = [2, 3, 4].map((day) => normalized(`2026-10-${String(day).padStart(2, "0")}T08:00:00.000Z`));
const secondRecords = [9, 10, 11].map((day) => normalized(`2026-10-${String(day).padStart(2, "0")}T08:00:00.000Z`));

test("精确中文固定选项映射，不复制身份、原文、AI或字段标题", () => {
  const input = raw();
  const result = adaptSweetReportSources([input]);
  expect(result).toEqual([normalized(input.created_at)]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE-");
  expect(input.records[0].fields[1].value).toBe("PRIVATE-JOURNAL");
});

test("英文UI仍保存中文canonical值，不按英文显示值或相似文字猜测", () => {
  const englishDisplay = raw();
  englishDisplay.records[0].fields[0].value = "Good";
  const extraSpace = raw();
  extraSpace.records[0].fields[0].value = " 比较好 ";
  const freeText = raw();
  freeText.records[0].fields[0].value = "比较好 PRIVATE-SECRET";
  expect(adaptSweetReportSources([englishDisplay, extraSpace, freeText])).toEqual([]);
});

test("不完整记录、未知主值、数组答案、重复步骤和重复必答字段均拒绝", () => {
  const incomplete = raw(); incomplete.records.pop();
  const unknown = raw(); unknown.records[3].fields[0].value = "未来选项";
  const array = raw(); array.records[0].fields[0].value = ["比较好"];
  const duplicateStep = raw(); duplicateStep.records[4] = duplicateStep.records[0];
  const duplicateField = raw(); duplicateField.records[0].fields.push({ id: "quality", value: "不太好" });
  expect(adaptSweetReportSources([incomplete, unknown, array, duplicateStep, duplicateField, null, {}, []])).toEqual([]);
});

test("兼容ISO时区和微秒，拒绝无时区、非法日历和非法时分秒", () => {
  expect(adaptSweetReportSources([raw("2026-10-02T16:00:00.123456+08:00")])[0].createdAt).toBe("2026-10-02T08:00:00.123456Z");
  for (const invalid of ["2026-02-30T08:00:00Z", "2026-10-02T24:00:00Z", "2026-10-02T08:60:00Z", "2026-10-02T08:00:60Z", "2026-10-02T08:00:00", "2026-10-02", "wrong", "2026-10-02T08:00:00+14:01"]) {
    expect(parseReportInstant(invalid)).toBeNull();
    expect(adaptSweetReportSources([raw(invalid)])).toEqual([]);
  }
});

test("26个主选择类别均可精确映射，不把运动不确定当零分钟", () => {
  const options = [
    ["睡得很好", "比较好", "一般", "不太好", "很不好"],
    ["很有精神", "比较有精神", "一般", "有点疲惫", "很疲惫"],
    ["很规律", "比较规律", "一般", "不太规律", "很不规律"],
    ["0 分钟", "1–9 分钟", "10–19 分钟", "20–29 分钟", "30 分钟以上", "不太确定"],
    ["很顺利", "比较顺利", "一般", "不太顺利", "很不顺利"],
  ];
  const categories = new Set<string>();
  options.forEach((values, step) => values.forEach((value) => {
    const row = raw(); row.records[step].fields[0].value = value;
    const result = adaptSweetReportSources([row]);
    expect(result).toHaveLength(1);
    categories.add(result[0].answers[reportDimensions[step]]);
  }));
  expect(categories.size).toBe(26);
  const unsure = raw(); unsure.records[3].fields[0].value = "不太确定";
  expect(adaptSweetReportSources([unsure])[0].answers.exercise).toBe("exercise_unsure");
});

test("没有完整7日窗口时等待，不泄露部分周期和来源", () => {
  const before = summarize(firstRecords, { now: "2026-10-08T07:29:59.999Z" });
  expect(before).toEqual({ version: "sweet-period-report-v1", status: "waiting", dimensions: [] });
  expect(summarize(firstRecords, { now: "2026-09-30T07:30:00Z" })).toEqual(before);
});

test("生效时刻锚定精确7日半开窗口，不按自然周回填", () => {
  const records = [normalized("2026-10-01T07:29:59.999Z", { sleep: "sleep_poor" }),
    normalized(effectiveAt), normalized("2026-10-02T07:30:00Z"), normalized("2026-10-03T07:30:00Z"),
    normalized(firstEnd, { sleep: "sleep_poor" })];
  const result = summarize(records, { dimensions: ["sleep"] });
  expect(result.period).toEqual({ start: effectiveAt, end: firstEnd });
  expect(result.dimensions).toEqual([{ id: "sleep", state: "category", category: "sleep_good", comparison: "unavailable" }]);
});

test("只计算最近完成周期及其紧邻前期，进行类别同异比较", () => {
  const result = summarize([...firstRecords, ...secondRecords.map((row) => ({ ...row, answers: { ...row.answers, sleep: "sleep_poor" as const } })),
    normalized(secondEnd, { sleep: "sleep_very_good" })], { now: "2026-10-18T07:30:00Z", dimensions: ["sleep", "wake"] });
  expect(result.period).toEqual({ start: firstEnd, end: secondEnd });
  expect(result.dimensions).toEqual([
    { id: "sleep", state: "category", category: "sleep_poor", previousCategory: "sleep_good", comparison: "different" },
    { id: "wake", state: "category", category: "wake_energized", previousCategory: "wake_energized", comparison: "same" },
  ]);
});

test("3个不同上海日期为门槛，同日多份仅最后有效记录计一次", () => {
  const twoDays = [normalized("2026-10-02T08:00:00Z"), normalized("2026-10-02T09:00:00Z", { sleep: "sleep_poor" }), normalized("2026-10-03T08:00:00Z")];
  expect(summarize(twoDays, { dimensions: ["sleep"] }).dimensions).toEqual([{ id: "sleep", state: "insufficient", comparison: "unavailable" }]);
  const rows = [...twoDays, normalized("2026-10-04T08:00:00Z", { sleep: "sleep_poor" })];
  expect(summarize(rows, { dimensions: ["sleep"] }).dimensions[0].category).toBe("sleep_poor");
  expect(summarize([...rows].reverse(), { dimensions: ["sleep"] })).toEqual(summarize(rows, { dimensions: ["sleep"] }));
});

test("上海零点划分日期，UTC同日可为两个上海日", () => {
  const rows = [normalized("2026-10-02T15:59:59.999Z"), normalized("2026-10-02T16:00:00Z"), normalized("2026-10-03T16:00:00Z")];
  expect(summarize(rows, { dimensions: ["sleep"] }).dimensions[0].state).toBe("category");
});

test("重复同时间一致记录幂等，冲突时间记录拒绝该日而不依赖输入顺序", () => {
  const same = [firstRecords[0], { ...firstRecords[0] }, ...firstRecords.slice(1)];
  expect(summarize(same)).toEqual(summarize(firstRecords));
  const conflict = [...firstRecords, normalized(firstRecords[0].createdAt, { sleep: "sleep_poor" }), normalized("2026-10-02T09:00:00Z")];
  expect(summarize(conflict, { dimensions: ["sleep"] }).dimensions[0].state).toBe("insufficient");
  expect(summarize(conflict)).toEqual(summarize([...conflict].reverse()));
});

test("微秒不同的来源按真实先后选择，不误判为同时间冲突", () => {
  const rows = [...firstRecords.slice(1), normalized("2026-10-02T08:00:00.123456Z", { sleep: "sleep_poor" }), normalized("2026-10-02T08:00:00.123457Z")];
  expect(summarize(rows, { dimensions: ["sleep"] }).dimensions[0].category).toBe("sleep_good");
});

test("众数并列给出mixed，不按类别排序强行选出且不作跨期判断", () => {
  const rows = [...firstRecords, normalized("2026-10-05T08:00:00Z", { sleep: "sleep_poor" }), normalized("2026-10-06T08:00:00Z", { sleep: "sleep_poor" }), normalized("2026-10-07T08:00:00Z", { sleep: "sleep_poor" })];
  expect(summarize(rows, { dimensions: ["sleep"] }).dimensions).toEqual([{ id: "sleep", state: "mixed", comparison: "unavailable" }]);
  const result = summarize([...firstRecords.slice(0, 2), ...secondRecords], { now: secondEnd, dimensions: ["sleep"] });
  expect(result.dimensions).toEqual([{ id: "sleep", state: "category", category: "sleep_good", comparison: "unavailable" }]);
});

test("删除或更正后从当前来源重算，不保留旧概括或旁路缓存", () => {
  expect(summarize(firstRecords).dimensions[0].state).toBe("category");
  expect(summarize(firstRecords.slice(1)).dimensions[0].state).toBe("insufficient");
  const corrected = firstRecords.map((row) => normalized(row.createdAt, { sleep: "sleep_poor" }));
  expect(summarize(corrected, { dimensions: ["sleep"] }).dimensions[0].category).toBe("sleep_poor");
});

test("到期立即无报告，短于一个周期的授权不形成报告", () => {
  expect(summarize(firstRecords, { now: expiresAt })).toEqual({ version: "sweet-period-report-v1", status: "expired", dimensions: [] });
  expect(summarize(firstRecords, { expiresAt: "2026-10-05T00:00:00Z", now: "2026-10-04T23:59:59Z" }).status).toBe("waiting");
});

test("非法授权、非法时刻、空字段或未知维度返回无来源的invalid", () => {
  const invalidCases: Partial<BuildReportSummaryInput>[] = [
    { effectiveAt: "2026-02-30T00:00:00Z" }, { expiresAt: effectiveAt }, { now: new Date("bad") },
    { dimensions: [] }, { dimensions: ["sleep", "sleep"] }, { dimensions: ["unknown" as "sleep"] },
  ];
  for (const invalid of invalidCases) expect(summarize(firstRecords, invalid)).toEqual({ version: "sweet-period-report-v1", status: "invalid", dimensions: [] });
});

test("纯聚合不信任伪造normalized来源，非法或不完整来源不计日", () => {
  const invalid = [normalized("bad"), { createdAt: firstRecords[0].createdAt, answers: { sleep: "sleep_good" } },
    normalized(firstRecords[0].createdAt, { sleep: "PRIVATE-FREE-TEXT" as "sleep_good" })] as ReportSourceRecord[];
  expect(summarize([...firstRecords.slice(1), ...invalid], { dimensions: ["sleep"] }).dimensions[0].state).toBe("insufficient");
});

test("接收版只返回选定维度的受限枚举，不泄漏原文、计数、身份或逐日日期", () => {
  const records = adaptSweetReportSources([raw("2026-10-02T08:00:00Z"), raw("2026-10-03T08:00:00Z"), raw("2026-10-04T08:00:00Z")]);
  const result = summarize(records, { dimensions: ["task", "sleep"] });
  expect(result.dimensions.map((dimension) => dimension.id)).toEqual(["sleep", "task"]);
  expect(Object.keys(result).sort()).toEqual(["dimensions", "period", "status", "version"]);
  expect(Object.keys(result.dimensions[0]).sort()).toEqual(["category", "comparison", "id", "state"]);
  const serialized = JSON.stringify(result);
  for (const secret of ["PRIVATE-", "createdAt", "answers", "count", "user_id", "school_id", "records", "2026-10-02", "2026-10-03", "2026-10-04"]) expect(serialized).not.toContain(secret);
  expect(firstRecords[0].answers.sleep).toBe("sleep_good");
});
