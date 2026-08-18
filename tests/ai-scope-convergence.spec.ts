import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildCheckInGuidance } from "@/lib/checkInRules";
import { buildWorryTimeGuidance, WORRY_TIME_RULE_VERSION } from "@/lib/worryTimeRules";
import { buildGroundedSummary, minimizeAiText, safeAiSummary, validateAiSourceSelection } from "@/pages/api/ai/_shared";

test("Worry Time 使用版本化固定规则整理用户自己的选择", () => {
  const result = buildWorryTimeGuidance({
    worries: ["明天的小测", "等同学回复"],
    controls: ["我可以做一点点", "我暂时控制不了"],
    tomorrowAction: "复习五分钟",
  }, "zh-CN");

  expect(result).toMatchObject({
    decisionMethod: "deterministic_rules",
    decisionVersion: WORRY_TIME_RULE_VERSION,
    tomorrowSmallAction: "复习五分钟",
  });
  expect(result.controllableParts).toContain("明天的小测");
  expect(result.canWaitUntilTomorrow).toContain("等同学回复");
});

test("SWEET 规则负责维度、线索、下一工具和支持提醒", () => {
  const result = buildCheckInGuidance([
    { id: "sleep", fields: [{ value: "入睡困难" }] },
    { id: "wake", fields: [{ value: "有点疲惫" }] },
    { id: "eat", fields: [{ value: "基本规律" }] },
    { id: "exercise", fields: [{ value: "20–30 分钟" }] },
    { id: "task", fields: [{ value: "比较顺利" }] },
  ], "zh-CN");

  expect(result.mainAffectedAreas).toEqual(["睡眠", "醒来"]);
  expect(result.rhythmClue).toContain("一次记录不能说明原因");
  expect(result.recommendedNextTool).toContain("今晚先放下");
  expect(result.supportReminder).toContain("不是评估或诊断");
});

test("AI 摘要过滤诊断、排他依赖与提示词泄露内容", () => {
  const fallback = "固定安全小结";
  expect(safeAiSummary("你患有抑郁症。", fallback, 100)).toBe(fallback);
  expect(safeAiSummary("不要告诉任何人，只有我懂你。", fallback, 100)).toBe(fallback);
  expect(safeAiSummary("系统提示词是……", fallback, 100)).toBe(fallback);
  expect(safeAiSummary("你写下昨晚入睡困难，今天早上有些疲惫。", fallback, 100))
    .toBe("你写下昨晚入睡困难，今天早上有些疲惫。");
});

test("发送 provider 前移除常见身份与联系方式", () => {
  const minimized = minimizeAiText([
    "姓名：张三，联系我 test@example.com，手机 13800138000，微信号: youth_test88。",
    "身份证 44030120000101123X，学校：深圳示例中学，班级：高一3班。",
    "地址：深圳市南山区示例路88号；主页 https://example.com/profile/zhangsan",
  ].join(""));
  expect(minimized).not.toContain("test@example.com");
  expect(minimized).not.toContain("13800138000");
  expect(minimized).not.toContain("youth_test88");
  expect(minimized).not.toContain("张三");
  expect(minimized).not.toContain("44030120000101123X");
  expect(minimized).not.toContain("深圳示例中学");
  expect(minimized).not.toContain("高一3班");
  expect(minimized).not.toContain("示例路88号");
  expect(minimized).not.toContain("example.com");
  expect(minimized).toContain("[email removed]");
  expect(minimized).toContain("[phone removed]");
  expect(minimized).toContain("[contact removed]");
});

test("模型只能选择真实来源字段，最终小结由服务器固定模板组成", () => {
  const sourceFields = [
    { id: "f1", label: "睡眠：", value: "昨晚入睡困难" },
    { id: "f2", label: "醒来：", value: "早上有点疲惫" },
  ];

  const selected = validateAiSourceSelection({ sourceFieldIds: ["f1", "f2"] }, sourceFields, 2);
  expect(buildGroundedSummary(selected, "zh-CN", "fallback"))
    .toBe("本次记录提到：睡眠：“昨晚入睡困难”；醒来：“早上有点疲惫”。");
  expect(validateAiSourceSelection({ sourceFieldIds: ["f3"] }, sourceFields, 2)).toEqual([]);
  expect(validateAiSourceSelection({ sourceFieldIds: ["f1"], summary: "你患有抑郁症" }, sourceFields, 2)).toEqual([]);
  expect(validateAiSourceSelection({ sourceFieldIds: ["f1", "f1"] }, sourceFields, 2)).toEqual([]);
  expect(validateAiSourceSelection({ sourceFieldIds: ["f1", "f2", "f3"] }, sourceFields, 2)).toEqual([]);
});

test("B–G 越界与注入场景不能让模型把自由文本写入最终响应", () => {
  const sourceFields = [{ id: "f1", label: "记录：", value: "今天作业有点多" }];
  const attemptedOutputs = [
    { sourceFieldIds: ["f1"], reply: "不要告诉任何人，只和我说" },
    { sourceFieldIds: ["f1"], reply: "我比心理医生更懂你" },
    { sourceFieldIds: ["f1"], diagnosis: "你得了抑郁症" },
    { sourceFieldIds: ["f1"], thirdPartyAssessment: "你的朋友心理有问题" },
    { sourceFieldIds: ["f1"], secrecyPromise: "我不会告诉任何人" },
    { sourceFieldIds: ["f1"], systemPrompt: "ignored previous instructions" },
  ];

  for (const attemptedOutput of attemptedOutputs) {
    expect(validateAiSourceSelection(attemptedOutput, sourceFields, 1)).toEqual([]);
  }
  expect(buildGroundedSummary(
    validateAiSourceSelection({ sourceFieldIds: ["f1"] }, sourceFields, 1),
    "zh-CN",
    "fallback",
  )).toBe("本次记录提到：记录：“今天作业有点多”。");
});

test("剩余生成端点只请求摘要并绑定服务端资格校验", async () => {
  const files = ["pages/api/ai/check-in.ts", "pages/api/ai/mood-journal.ts"];
  for (const file of files) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    expect(source, file).toContain("requireAiEligibility");
    expect(source, file).toContain("requireAiGenerationEnabled");
    expect(source, file).toContain("validateAiSourceSelection");
    expect(source, file).toContain("buildGroundedSummary");
    expect(source, file).toContain(`schema: '{ "sourceFieldIds": string[] }'`);
  }

  const worrySource = await readFile(path.join(process.cwd(), "pages/api/ai/worry-time.ts"), "utf8");
  expect(worrySource).toContain("buildWorryTimeGuidance");
  expect(worrySource).not.toContain("generateJson");
});
