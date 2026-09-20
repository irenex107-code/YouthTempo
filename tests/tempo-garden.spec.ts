import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gardenSummary, gardenStage, shanghaiDateKey } from "@/lib/tempoGarden";

const projectRef = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co",
).hostname.split(".")[0];

async function useIllustrativeGarden(page: Page, initialTotal = 0) {
  const user = {
    id: "00000000-0000-4000-8000-000000000017",
    aud: "authenticated",
    role: "authenticated",
    email: "garden@example.invalid",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
  let total = initialTotal;

  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: `sb-${projectRef}-auth-token`,
    value: {
      access_token: "local-garden-test-token",
      refresh_token: "local-garden-test-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    },
  });
  await page.route("**/auth/v1/user", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/api/garden?**", async (route) => {
    if (route.request().method() === "POST") {
      total += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ checkIn: { id: "example-check-in", created_at: new Date().toISOString() } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage: total > 0 ? "sprout" : "seed", total, thisWeek: total, thisMonth: total,
        quickCheckIns: total, fullSweetRecords: 0, recentRhythm: null, reminderMode: "off",
      }),
    });
  });
}

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

test("首次登录先看三页介绍，再开始记录；再次进入直接显示花园", async ({ page, isMobile }) => {
  await useIllustrativeGarden(page);
  await page.goto("/garden");

  await expect(page.getByRole("heading", { name: "欢迎来到你的 SWEET 花园" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "轻量记录" })).toHaveCount(0);
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("heading", { name: "一滴水，来自一次参与" })).toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("heading", { name: "按自己的节奏开始" })).toBeVisible();
  await page.getByRole("button", { name: "开始第一次记录" }).click();
  await expect(page.getByRole("heading", { name: "轻量记录" })).toBeVisible();

  await page.getByRole("radio", { name: "有些沉重" }).check();
  await page.getByRole("button", { name: "记录这一刻" }).click();
  await expect(page.getByText("这一刻已记下。")).toBeVisible();
  await expect(page.getByText("累计记录 1 次")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "轻量记录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "欢迎来到你的 SWEET 花园" })).toHaveCount(0);
  if (isMobile) expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("已有记录不会重看介绍", async ({ page }) => {
  await useIllustrativeGarden(page, 1);
  await page.goto("/garden");
  await expect(page.getByRole("heading", { name: "轻量记录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "欢迎来到你的 SWEET 花园" })).toHaveCount(0);
});

test("英文首次介绍、跳过和减少动态效果可用", async ({ page }) => {
  await useIllustrativeGarden(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/en/garden");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Welcome to your SWEET Garden" })).toBeVisible();
  await expect(page.locator(".garden-slide-enter")).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Skip introduction" }).click();
  await expect(page.getByRole("heading", { name: "A quick check-in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "A quick check-in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to your SWEET Garden" })).toHaveCount(0);
});
