import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { gardenSummary, gardenStage, shanghaiDateKey } from "@/lib/tempoGarden";

test("花园只按参与成长，答案好坏不改变奖励", () => {
  const quick = [{ created_at: "2026-09-19T09:00:00Z", feeling: "heavy" }];
  const sweet = [{ created_at: "2026-09-18T09:00:00Z", score: 0 }];
  expect(gardenSummary(quick, sweet, new Date("2026-09-19T12:00:00Z"))).toMatchObject({
    stage: "sprout", total: 2, thisWeek: 2, thisMonth: 2,
  });
  expect(gardenSummary(
    [{ ...quick[0], feeling: "steady" }],
    [{ ...sweet[0], score: 100 }],
    new Date("2026-09-19T12:00:00Z"),
  )).toEqual(gardenSummary(quick, sweet, new Date("2026-09-19T12:00:00Z")));
});

test("漏记不倒退，建议频率不阻止随时完成完整 SWEET", async () => {
  const records = Array.from({ length: 10 }, (_, index) => ({
    created_at: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
  }));
  expect(gardenSummary(records, [], new Date("2026-08-10T12:00:00Z")).stage).toBe("bloom");
  expect(gardenSummary(records, [], new Date("2026-09-19T12:00:00Z")).stage).toBe("bloom");
  expect(gardenStage(0)).toBe("seed");
  expect(shanghaiDateKey("2026-09-18T16:01:00Z")).toBe("2026-09-19");
  const cloud = await readFile(path.join(process.cwd(), "lib/cloudRecords.ts"), "utf8");
  expect(cloud).not.toContain("weeklySweetLimit");
});

test("花园数据只保留私有记录和提醒偏好，删除账户时级联清理", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/20260919135223_add_tempo_garden_self_tracking.sql"),
    "utf8",
  );
  expect(sql).toContain("references auth.users(id) on delete cascade");
  expect(sql).toContain("alter table public.tempo_check_ins enable row level security");
  expect(sql).toContain("alter table public.tempo_reminder_preferences enable row level security");
  expect(sql).toContain("revoke all on table public.tempo_check_ins, public.tempo_reminder_preferences from public, anon, authenticated");
  expect(sql).toContain("using ((select auth.uid()) = user_id)");
  expect(sql).not.toContain("create table public.garden_scores");
});

test("未登录无法读取或提交私有花园数据", async ({ request }) => {
  expect((await request.get("/api/garden")).status()).toBe(401);
  expect((await request.post("/api/garden", { data: { feeling: "steady" } })).status()).toBe(401);
  expect((await request.patch("/api/garden", { data: { reminderMode: "off" } })).status()).toBe(401);
});

test("花园的中英文访客入口可用，移动端没有横向溢出", async ({ page, isMobile }) => {
  await page.goto("/garden");
  await expect(page.getByRole("heading", { name: "每一次照顾自己，都算数" })).toBeVisible();
  await page.goto("/en/garden");
  await expect(page.getByRole("heading", { name: "Every moment of care counts" })).toBeVisible();
  if (isMobile) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
});
