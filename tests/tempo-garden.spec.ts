import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  gardenSceneLevel,
  gardenSummary,
  gardenStage,
  participationDateKeys,
  shanghaiDateKey,
} from "@/lib/tempoGarden";

const projectRef = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saqkzfsmabsgbwdvuras.supabase.co",
).hostname.split(".")[0];

async function useIllustrativeGarden(page: Page, initialTotal = 0, loadStatus = 200, introSeen = false) {
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
    if (value.introSeen) window.localStorage.setItem(`youthtempo:garden:intro:v2:${value.user.id}`, "seen");
  }, {
    key: `sb-${projectRef}-auth-token`,
    value: {
      access_token: "local-garden-test-token",
      refresh_token: "local-garden-test-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
      introSeen,
    },
  });
  await page.route("**/auth/v1/user", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/api/garden?**", async (route) => {
    if (route.request().method() === "POST") {
      total += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ checkIn: { id: "example-check-in", created_at: new Date().toISOString() } }) });
      return;
    }
    if (loadStatus !== 200) {
      await route.fulfill({
        status: loadStatus,
        contentType: "application/json",
        body: JSON.stringify({ error: loadStatus === 403 ? "请先完成适用的学生知情确认。" : "花园暂时不可用，请稍后再试。" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage: total > 0 ? "sprout" : "seed", total, thisWeek: total, thisMonth: total,
        sceneLevel: "base", quickCheckIns: total, fullSweetRecords: 0,
        todayParticipated: total > 0, unlockedPositions: [], unlockedItems: [], reminderMode: "off",
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

test("同一上海日历日的记录只算一个参与日", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const quick = [
    { created_at: "2026-09-18T16:01:00Z" },
    { created_at: "2026-09-19T09:00:00Z" },
  ];
  const sweet = [
    { created_at: "2026-09-19T10:00:00Z" },
    { created_at: "2026-09-17T16:00:00Z" },
  ];

  expect(participationDateKeys(quick, sweet, now)).toEqual(["2026-09-18", "2026-09-19"]);
  expect(gardenSummary(quick, sweet, now)).toMatchObject({
    total: 2,
    thisWeek: 2,
    thisMonth: 2,
    todayParticipated: true,
  });
});

test("参与日跨周跨月边界正确，未来记录不计入当前统计", () => {
  const summary = gardenSummary([
    { created_at: "2026-08-30T16:30:00Z" },
    { created_at: "2026-08-31T16:30:00Z" },
    { created_at: "2026-09-01T15:59:00Z" },
    { created_at: "2026-09-01T16:01:00Z" },
  ], [], new Date("2026-09-01T12:00:00Z"));

  expect(summary).toMatchObject({ total: 2, thisWeek: 2, thisMonth: 1 });
});

test("成长节点保留四阶段主植物并独立扩展庭院场景", () => {
  expect([
    { days: 0, stage: gardenStage(0), scene: gardenSceneLevel(0) },
    { days: 1, stage: gardenStage(1), scene: gardenSceneLevel(1) },
    { days: 3, stage: gardenStage(3), scene: gardenSceneLevel(3) },
    { days: 7, stage: gardenStage(7), scene: gardenSceneLevel(7) },
    { days: 14, stage: gardenStage(14), scene: gardenSceneLevel(14) },
    { days: 28, stage: gardenStage(28), scene: gardenSceneLevel(28) },
  ]).toEqual([
    { days: 0, stage: "seed", scene: "base" },
    { days: 1, stage: "sprout", scene: "base" },
    { days: 3, stage: "leaves", scene: "base" },
    { days: 7, stage: "bloom", scene: "base" },
    { days: 14, stage: "bloom", scene: "settled" },
    { days: 28, stage: "bloom", scene: "mature" },
  ]);
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

test("花园不读取、返回或展示 AI 小结", async () => {
  const [api, cloud, page, zh, en] = await Promise.all([
    readFile(path.join(process.cwd(), "pages/api/garden.ts"), "utf8"),
    readFile(path.join(process.cwd(), "lib/cloudRecords.ts"), "utf8"),
    readFile(path.join(process.cwd(), "views/garden/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "locales/zh-CN.json"), "utf8"),
    readFile(path.join(process.cwd(), "locales/en.json"), "utf8"),
  ]);
  expect(api).toContain('.from("sweet_records").select("created_at")');
  expect(api).not.toContain('select("created_at,summary")');
  expect(`${api}\n${cloud}\n${page}`).not.toContain("recentRhythm");
  expect(page).not.toContain("/api/ai/");
  expect(JSON.parse(zh).garden.rhythm).toBeUndefined();
  expect(JSON.parse(en).garden.rhythm).toBeUndefined();
});

test("未登录无法读取或提交私有花园数据", async ({ request }) => {
  expect((await request.get("/api/garden")).status()).toBe(401);
  expect((await request.post("/api/garden", { data: { feeling: "steady" } })).status()).toBe(401);
  expect((await request.patch("/api/garden", { data: { reminderMode: "off" } })).status()).toBe(401);
});

test("花园的中英文访客入口可用，移动端没有横向溢出", async ({ page, isMobile }) => {
  await page.goto("/garden");
  await expect(page.getByRole("link", { name: "请先登录，再查看自己的花园。" })).toBeVisible();
  await page.goto("/en/garden");
  await expect(page.getByRole("link", { name: "Sign in to see your own garden." })).toBeVisible();
  if (isMobile) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
});

test("首次登录在庭院内看两步提示，再次进入直接显示庭院", async ({ page, isMobile }) => {
  await useIllustrativeGarden(page);
  await page.goto("/garden");

  await expect(page.getByRole("heading", { name: "欢迎来到你的 SWEET 花园" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的疗愈庭院" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "轻量记录" })).toHaveCount(0);
  await page.getByRole("button", { name: "继续看看" }).click();
  await expect(page.getByRole("heading", { name: "记录之后，可以照料一次" })).toBeVisible();
  await page.getByRole("button", { name: "记录一下" }).click();
  await expect(page.getByRole("heading", { name: "轻量记录" })).toBeVisible();

  await page.getByRole("radio", { name: "有些沉重" }).check();
  await page.getByRole("button", { name: "记录这一刻" }).click();
  await expect(page.getByRole("heading", { name: "今天想怎样照料？" })).toBeVisible();
  await expect(page.getByText("今天已经有一条记录，可以选择一次照料。")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "我的疗愈庭院" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "欢迎来到你的 SWEET 花园" })).toHaveCount(0);
  if (isMobile) expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("已有记录不会重看介绍", async ({ page }) => {
  await useIllustrativeGarden(page, 1, 200, true);
  await page.goto("/garden");
  await expect(page.getByRole("heading", { name: "我的疗愈庭院" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "欢迎来到你的 SWEET 花园" })).toHaveCount(0);
});

test("英文首次介绍、跳过和减少动态效果可用", async ({ page }) => {
  await useIllustrativeGarden(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/en/garden");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Welcome to your SWEET Garden" })).toBeVisible();
  await expect(page.locator(".garden-main-plant")).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Skip introduction" }).click();
  await expect(page.getByRole("heading", { name: "My quiet garden" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "My quiet garden" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to your SWEET Garden" })).toHaveCount(0);
});

test("庭院是主视觉，操作区只有记录、照料和布置", async ({ page, isMobile }) => {
  await useIllustrativeGarden(page, 3, 200, true);
  await page.goto("/garden");
  await expect(page.locator(".garden-scene")).toBeVisible();
  const dock = page.getByRole("navigation", { name: "庭院操作" });
  await expect(dock.getByRole("button")).toHaveCount(3);
  await expect(dock.getByRole("button", { name: "记录" })).toBeVisible();
  await expect(dock.getByRole("button", { name: "照料" })).toBeVisible();
  await expect(dock.getByRole("button", { name: "布置" })).toBeVisible();
  await expect(page.getByText("最近发现的节律")).toHaveCount(0);
  await page.getByRole("button", { name: "看看池塘" }).click();
  await expect(page.getByText("水面轻轻动了一下。")).toBeVisible();
});

test("账号没有花园资格时显示明确原因，不误报为加载故障", async ({ page }) => {
  await useIllustrativeGarden(page, 0, 403);
  await page.goto("/garden");
  await expect(page.locator("main [role='alert']")).toContainText("花园只向已完成适用知情确认的学生账号开放");
  await expect(page.getByText("花园暂时无法加载。")).toHaveCount(0);
});

test("真正的服务端故障仍显示暂时无法加载", async ({ page }) => {
  await useIllustrativeGarden(page, 0, 503);
  await page.goto("/garden");
  await expect(page.locator("main [role='alert']")).toContainText("花园暂时无法加载。");
});
