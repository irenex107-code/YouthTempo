import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";
import { syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

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

for (const [prefix, copy] of [["", zhCN], ["/en", en]] as const) {
  test(`家长信箱说明不会暗示能收到学生的留言 ${prefix || "zh-CN"}`, async ({ page, baseURL }) => {
    await syntheticInlineConsent(page, baseURL!, { signedIn: true, role: "家长" });
    await page.goto(`${prefix}/messages`);

    await expect(page.getByText(copy.forParents.messages.description, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.messages.member.hero.supporterDescription, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: copy.forParents.messages.action })).toHaveAttribute(
      "href", `${prefix}/for-parents#conversation-starters`,
    );
  });
}
