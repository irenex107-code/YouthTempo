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

test("云端删除限定本人目标和上海日期范围", async () => {
  const [source, server, migration] = await Promise.all([
    readFile(path.join(process.cwd(), "lib/cloudRecords.ts"), "utf8"),
    readFile(path.join(process.cwd(), "lib/sweetPersistenceServer.ts"), "utf8"),
    readFile(path.join(process.cwd(), "supabase/migrations/20261031153645_sweet_atomic_scope_cas.sql"), "utf8"),
  ]);
  const deletion = source.slice(source.indexOf("export async function deleteCloudSweetRecord("),
    source.indexOf("export async function listPermissions("));
  // Static contract only: actual client guards are tested separately; these
  // source assertions do not establish PostgreSQL/RLS/transaction execution.
  expect(deletion).toContain("if (expectedUserId && user.id !== expectedUserId)");
  expect(deletion).toContain('.eq("id", recordId).eq("user_id", actor)');
  expect(deletion).toContain("const targetDay = sweetStoredDay(target.created_at)");
  expect(deletion).toContain("readCloudSweetScope(actor, targetDay, current)");
  expect(deletion).toContain('throw new SweetPersistenceError("scope_expired")');
  expect(deletion).toContain("operationDay: operationScope.operationDay, targetDay: scope.targetDay, expectedHead: scope.headToken");
  expect(deletion).toContain('intent: "delete_day", recordId');
  expect(deletion).not.toContain(".delete()");
  expect(server).toContain('rpc = "sweet_scope_write"');
  expect(server).toContain("p_actor_user_id: user.id");
  expect(server).toContain("p_expected_head: command.expectedHead");
  expect(migration).toContain("if h.head_token is distinct from p_expected_head then");
  const databaseDelete = migration.slice(migration.indexOf("  if is_delete then"),
    migration.indexOf("  if not private.sweet_records_shape(p_records)"));
  expect(databaseDelete).toContain("delete from public.sweet_records where user_id=p_actor_user_id");
  expect(databaseDelete).toContain("created_at >= (p_target_day::timestamp at time zone 'Asia/Shanghai')");
  expect(databaseDelete).toContain("created_at < ((p_target_day+1)::timestamp at time zone 'Asia/Shanghai')");
});
