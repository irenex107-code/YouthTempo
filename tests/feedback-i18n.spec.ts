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

test("Feedback 登录后中英文文案结构一致且英文保持简洁克制", () => {
  const chinese = flatten(zhCN.feedback.member);
  const english = flatten(en.feedback.member);

  expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
  expect(Object.values(english).join(" ")).not.toMatch(/[\u3400-\u9fff]/u);
  expect(Object.values(english).join(" ").toLowerCase()).not.toMatch(/\b(solve|fix|guaranteed)\b/);
});

test("Feedback 国际化不改变提交字段和 payload", async () => {
  const source = await readFile(path.join(process.cwd(), "views/feedback/page.tsx"), "utf8");
  for (const field of ["overallExperience", "clarity", "safety", "mostHelpful", "hardToUse", "suggestion", "mayContact"]) {
    expect(source).toContain(`${field}:`);
  }
  expect(source).toContain("body: JSON.stringify(form)");
});
