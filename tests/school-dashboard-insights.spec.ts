import { expect, test } from "@playwright/test";
import {
  buildSchoolMonthlyTrends,
  buildTeacherWeeklySummaries,
  type InsightRecord,
} from "../lib/schoolDashboardInsights";

const now = new Date("2026-08-04T12:00:00.000Z");
const records: InsightRecord[] = [
  { school_id: "school-a", user_id: "student-a", created_at: "2026-08-03T12:00:00.000Z" },
  { school_id: "school-a", user_id: "student-a", created_at: "2026-08-02T12:00:00.000Z" },
  { school_id: "school-a", user_id: "student-b", created_at: "2026-07-26T12:00:00.000Z" },
  { school_id: "school-a", user_id: "student-b", created_at: "2026-07-18T12:00:00.000Z" },
  { school_id: "school-b", user_id: "student-c", created_at: "2026-08-03T12:00:00.000Z" },
];

test("老师周摘要只统计本人负责学生并对比前七天", () => {
  const summaries = buildTeacherWeeklySummaries(records, [
    {
      school_id: "school-a",
      teacher_user_id: "teacher-a",
      teacher_name: "老师甲",
      student_ids: ["student-a"],
    },
    {
      school_id: "school-a",
      teacher_user_id: "teacher-b",
      teacher_name: "老师乙",
      student_ids: ["student-b"],
    },
  ], ["student-b"], now);

  expect(summaries[0]).toMatchObject({
    current_record_count: 2,
    previous_record_count: 0,
    record_change: 2,
    active_student_count: 1,
    attention_student_count: 0,
  });
  expect(summaries[1]).toMatchObject({
    current_record_count: 0,
    previous_record_count: 1,
    record_change: -1,
    attention_student_count: 1,
  });
});

test("学校月趋势按四个互不重叠的滚动周汇总", () => {
  const trends = buildSchoolMonthlyTrends(records, [
    { school_id: "school-a", school_name: "学校 A", student_count: 2 },
    { school_id: "school-b", school_name: "学校 B", student_count: 1 },
  ], now);

  expect(trends[0]).toMatchObject({
    school_id: "school-a",
    record_count: 4,
    active_student_count: 2,
  });
  expect(trends[0].weeks.map((week) => week.record_count)).toEqual([0, 1, 1, 2]);
  expect(trends[1].weeks.map((week) => week.record_count)).toEqual([0, 0, 0, 1]);
});
