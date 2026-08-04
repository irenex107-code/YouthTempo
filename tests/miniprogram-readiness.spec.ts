import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = path.resolve(process.cwd(), "miniprogram");

test("小程序声明登录、首页、SWEET、历史和支持五个页面", () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")) as { pages: string[] };
  expect(app.pages).toEqual([
    "pages/login/index",
    "pages/home/index",
    "pages/sweet/index",
    "pages/history/index",
    "pages/support/index",
  ]);
  for (const page of app.pages) {
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      expect(fs.existsSync(path.join(root, `${page}.${extension}`)), `${page}.${extension} 应存在`).toBe(true);
    }
  }
});

test("小程序配置不会误带服务端密钥", () => {
  const config = fs.readFileSync(path.join(root, "config.js"), "utf8");
  expect(config).not.toContain("service_role");
  expect(config).not.toContain("sb_secret_");
  expect(config).toContain("supabasePublishableKey: \"\"");
});

test("SWEET 页面要求本次 AI 确认并通过本人 API 保存", () => {
  const script = fs.readFileSync(path.join(root, "pages/sweet/index.js"), "utf8");
  const markup = fs.readFileSync(path.join(root, "pages/sweet/index.wxml"), "utf8");
  expect(markup).toContain("consentAccepted");
  expect(script).toContain('api("/api/ai/check-in"');
  expect(script).toContain('api("/api/mini/records"');
});

test("历史记录通过服务端本人范围接口读取和删除", () => {
  const script = fs.readFileSync(path.join(root, "pages/history/index.js"), "utf8");
  expect(script).toContain('api("/api/mini/records")');
  expect(script).toContain('method: "DELETE"');
});
