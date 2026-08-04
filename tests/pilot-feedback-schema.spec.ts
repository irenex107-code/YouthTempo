import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("试点反馈表默认不向浏览器 Data API 开放", async () => {
  const migration = await readFile(
    path.join(process.cwd(), "supabase/migrations/20260804045038_add_pilot_feedback.sql"),
    "utf8",
  );

  expect(migration).toContain("alter table public.pilot_feedback enable row level security");
  expect(migration).toContain("revoke all on table public.pilot_feedback from anon, authenticated");
  expect(migration).toContain("create policy pilot_feedback_server_only");
  expect(migration).toContain("using (false) with check (false)");
  expect(migration).toContain("unique (user_id, form_version)");
  expect(migration).toContain("references auth.users(id) on delete cascade");
});
