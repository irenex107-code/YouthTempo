import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce<Record<string, string>>((copy, [key, child]) => ({
    ...copy,
    ...flatten(child, prefix ? `${prefix}.${key}` : key),
  }), {});
}

test("Messages 登录后中英文文案结构一致且英文不含中文或过度承诺", () => {
  const chinese = flatten({
    member: zhCN.messages.member,
    compose: zhCN.messages.compose,
    lists: zhCN.messages.lists,
    notices: zhCN.messages.notices,
    errors: zhCN.messages.errors,
  });
  const english = flatten({
    member: en.messages.member,
    compose: en.messages.compose,
    lists: en.messages.lists,
    notices: en.messages.notices,
    errors: en.messages.errors,
  });

  expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
  expect(Object.values(english).join(" ")).not.toMatch(/[\u3400-\u9fff]/u);
  expect(Object.values(english).join(" ").toLowerCase()).not.toMatch(/\b(solve|fix|guaranteed)\b/);
});

test("Messages 日期格式跟随当前 locale", async () => {
  const source = await readFile(path.join(process.cwd(), "views/messages/page.tsx"), "utf8");
  expect(source).toContain('locale === "en" ? "en-US" : "zh-CN"');
  expect(source).toContain("formatDate(message.created_at, locale)");
});
