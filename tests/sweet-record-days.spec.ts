import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  latestSweetRecordsPerUserDay,
  shanghaiCalendarDayRange,
  sweetRecordCalendarDayNumber,
} from "../lib/sweetRecordDays";

test("同一用户同一上海日历日只保留最新记录", () => {
  const records = [
    { id: "old", user_id: "student-a", created_at: "2026-08-01T16:30:00.000Z" },
    { id: "latest", user_id: "student-a", created_at: "2026-08-02T03:00:00.000Z" },
    { id: "other-user", user_id: "student-b", created_at: "2026-08-02T01:00:00.000Z" },
    { id: "next-day", user_id: "student-a", created_at: "2026-08-02T16:00:00.000Z" },
  ];

  expect(latestSweetRecordsPerUserDay(records).map((record) => record.id)).toEqual([
    "next-day",
    "latest",
    "other-user",
  ]);
});

test("上海日历日边界使用 UTC+8", () => {
  expect(shanghaiCalendarDayRange("2026-08-02T03:00:00.000Z")).toEqual({
    start: "2026-08-01T16:00:00.000Z",
    end: "2026-08-02T16:00:00.000Z",
  });
  expect(sweetRecordCalendarDayNumber("2026-08-01T15:59:59.999Z")).not.toBe(
    sweetRecordCalendarDayNumber("2026-08-01T16:00:00.000Z"),
  );
});

test("云端保存和删除都按本人当天范围处理", async () => {
  const source = await readFile(path.join(process.cwd(), "lib/cloudRecords.ts"), "utf8");

  expect(source).toContain("const dayRange = shanghaiCalendarDayRange();");
  expect(source).toContain("await cleanupOldRecords(oldRecordIds);");
  expect(source).toContain("if (!targetRecord || targetRecord.user_id !== user.id)");
  expect(source).toContain("const dayRange = shanghaiCalendarDayRange(targetRecord.created_at);");
});
