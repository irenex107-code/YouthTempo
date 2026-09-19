import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

test("成年人说明按个人基线理解大学生活习惯", async ({ page }) => {
  expect(zhCN.account.ageGuidance.adult.description).toContain("偏离你平时的状态");
  expect(zhCN.forYoungAdults.independence.baseline.text).toContain("晚睡、晚起、吃外卖");
  expect(zhCN.forYoungAdults.independence.baseline.text).toContain("不要只凭一种习惯下结论");
  expect(en.forYoungAdults.independence.baseline.text).toContain("One habit alone does not support a conclusion");

  await page.goto("/for-young-adults");
  await expect(page.getByRole("heading", { name: zhCN.forYoungAdults.independence.baseline.title })).toBeVisible();
  await expect(page.getByText(zhCN.forYoungAdults.independence.baseline.text)).toBeVisible();
});

test("账户页使用服务端年龄分组显示不同说明和入口", async () => {
  const source = await readFile(path.join(process.cwd(), "views/account/page.tsx"), "utf8");

  expect(source).toContain("accountStatus?.studentAgeBand");
  expect(source).toContain('studentAgeBand === "18_plus"');
  expect(source).toContain('["14_17", "18_plus"].includes');
  expect(source).toContain('href={isAdultStudent ? "/for-young-adults" : "/for-teens"}');
  expect(source).toContain('href={isAdultStudent ? "/referral" : "/messages"}');
});

test("悄悄话信箱按年龄说明收件范围且不宣称进入咨询", async () => {
  const source = await readFile(path.join(process.cwd(), "views/messages/page.tsx"), "utf8");

  expect(source).toContain('t("messages.member.hero.adultStudentDescription")');
  expect(source).toContain('t("messages.member.hero.minorStudentDescription")');
  expect(zhCN.messages.member.hero.minorStudentDescription).toContain("当前试点不创建家长收件关系");
  expect(zhCN.messages.member.hero.adultStudentDescription).toContain("不包含家长收件流程");
  expect(zhCN.account.ageGuidance.minor.description).toContain("不等于进入心理咨询");
  expect(en.account.ageGuidance.minor.description).toContain("does not mean that counselling has begun");
});
