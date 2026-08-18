import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readDictionaries() {
  const [zhText, enText] = await Promise.all([
    readFile(path.join(process.cwd(), "locales/zh-CN.json"), "utf8"),
    readFile(path.join(process.cwd(), "locales/en.json"), "utf8"),
  ]);
  return {
    zh: JSON.parse(zhText) as Record<string, any>,
    en: JSON.parse(enText) as Record<string, any>,
    zhText,
    enText,
  };
}

test("中文紧急文案优先连接家庭、学校与可信任成年人", async () => {
  const { zh, zhText } = await readDictionaries();
  const urgentCopy = [
    zh.talk.urgent.description,
    zh.privacySafety.community.urgent.text,
    zh.privacySafety.emergency.text,
    zh.community.rules.targetDisclaimer,
    zh.community.report.targetSuffix,
    zh.community.messages.postSafety,
    zh.community.messages.commentSafety,
    zh.messages.notices.safetySent,
  ].join("\n");

  expect(urgentCopy).toMatch(/家长/);
  expect(urgentCopy).toMatch(/老师/);
  expect(urgentCopy).toMatch(/可信任/);
  expect(urgentCopy).toMatch(/110/);
  expect(urgentCopy).toMatch(/120/);
  expect(zh.privacySafety.emergency.text).toContain("12356");
  expect(zhText).not.toMatch(/家庭(?:本身)?不安全|学校(?:本身)?不安全/);
});

test("英文紧急文案使用当地服务且不固定中国大陆号码", async () => {
  const { en, enText } = await readDictionaries();
  const urgentCopy = [
    en.talk.urgent.description,
    en.privacySafety.community.urgent.text,
    en.privacySafety.emergency.text,
    en.community.rules.targetDisclaimer,
    en.community.report.targetSuffix,
    en.community.messages.postSafety,
    en.community.messages.commentSafety,
    en.messages.notices.safetySent,
  ].join("\n");

  expect(urgentCopy).toMatch(/parent or guardian/i);
  expect(urgentCopy).toMatch(/teacher/i);
  expect(urgentCopy).toMatch(/trusted adult/i);
  expect(urgentCopy).toMatch(/local (?:medical or )?emergency services/i);
  expect(enText).not.toMatch(/\b(?:110|120|12356)\b/);
});

test("公开说明准确区分 AI 摘要、固定规则与关闭功能", async () => {
  const { zh, en } = await readDictionaries();
  const zhSummary = zh.privacySafety.consent.summary.text as string;
  const enSummary = en.privacySafety.consent.summary.text as string;

  expect(zhSummary).toContain("SWEET 节律记录和心情拼图");
  expect(zhSummary).toContain("今晚先放下和下一步找谁使用固定规则，不调用 AI");
  expect(zhSummary).toContain("陪我捋一捋在首轮学校试点期间关闭");
  expect(enSummary).toContain("SWEET Check-in or Mood Journal");
  expect(enSummary).toContain("Worry Time and Find the Right Support use fixed rules and do not call AI");
  expect(enSummary).toContain("Talk It Through is closed");

  expect(zh.checkIn.result.disclaimer).toContain("AI 只整理你本次明确填写的内容");
  expect(zh.checkIn.result.disclaimer).toContain("固定规则");
  expect(en.checkIn.result.disclaimer).toContain("AI only summarizes what you explicitly entered");
  expect(en.checkIn.result.disclaimer).toContain("fixed rules");
});
