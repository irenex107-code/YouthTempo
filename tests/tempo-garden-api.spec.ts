import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const apiFiles = [
  "pages/api/garden/care.ts",
  "pages/api/garden/layout.ts",
  "pages/api/garden/keepsakes/index.ts",
  "pages/api/garden/keepsakes/[id].ts",
];

test("花园互动接口未登录时全部拒绝", async ({ request }) => {
  expect((await request.post("/api/garden/care", { data: { action: "water" } })).status()).toBe(401);
  expect((await request.put("/api/garden/layout", {
    data: { slot: "flower_border", itemKey: "wildflower_patch" },
  })).status()).toBe(401);
  expect((await request.post("/api/garden/keepsakes", { data: { type: "flower" } })).status()).toBe(401);
  expect((await request.delete("/api/garden/keepsakes/00000000-0000-4000-8000-000000000001")).status()).toBe(401);
});

test("花园互动接口限制方法并设置小请求体", async ({ request }) => {
  expect((await request.get("/api/garden/care")).status()).toBe(405);
  expect((await request.post("/api/garden/layout", { data: {} })).status()).toBe(405);
  expect((await request.get("/api/garden/keepsakes")).status()).toBe(405);
  expect((await request.post("/api/garden/keepsakes/00000000-0000-4000-8000-000000000001", { data: {} })).status()).toBe(405);

  for (const file of apiFiles) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    expect(source).toContain('sizeLimit: "4kb"');
  }
});

test("花园互动写入由服务端身份、参与事实和目录解锁共同决定", async () => {
  const [shared, care, layout, keepsakes, remove, mainApi, account] = await Promise.all([
    readFile(path.join(process.cwd(), "pages/api/garden/_shared.ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/garden/care.ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/garden/layout.ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/garden/keepsakes/index.ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/garden/keepsakes/[id].ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/garden.ts"), "utf8"),
    readFile(path.join(process.cwd(), "pages/api/account/data.ts"), "utf8"),
  ]);

  expect(shared).toContain("requireActiveStudentConsent");
  expect(shared).toContain("participationDateKeys");
  expect(`${care}\n${layout}\n${keepsakes}`).not.toContain("req.body?.userId");
  expect(care).toContain("context.user.id");
  expect(care).toContain("todayParticipated");
  expect(layout).toContain("unlockedPositions");
  expect(layout).toContain("unlockedItems");
  expect(keepsakes).toContain("participation.dateKeys.includes");
  expect(remove).toContain('.eq("user_id", context.user.id)');
  expect(mainApi).toContain('from("tempo_garden_care_events")');
  expect(mainApi).toContain('from("tempo_garden_layout_items")');
  expect(mainApi).toContain('from("tempo_garden_keepsakes")');
  expect(account).toContain("tempoGardenCareEvents");
  expect(account).toContain("tempoGardenLayoutItems");
  expect(account).toContain("tempoGardenKeepsakes");
  expect(`${care}\n${layout}\n${keepsakes}\n${mainApi}`).not.toContain('select("created_at,summary")');
  expect(`${care}\n${layout}\n${keepsakes}\n${mainApi}`).not.toContain("/api/ai/");
});
