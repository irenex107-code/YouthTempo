import { expect, test } from "@playwright/test";
import { localizedStoredCheckInValue, storedCheckInLabel } from "@/lib/checkInHistoryCopy";

test("当前相同中文选项按 SWEET 字段显示正确英文", () => {
  expect(localizedStoredCheckInValue("一般", "en", "sleep", "quality")).toBe("Neither well nor poorly");
  expect(localizedStoredCheckInValue("一般", "en", "wake", "state")).toBe("Neither energized nor tired");
  expect(localizedStoredCheckInValue("一般", "en", "eat", "rhythm")).toBe("Neither regular nor irregular");
  expect(localizedStoredCheckInValue("一般", "en", "exercise", "bodyState")).toBe("Neither energized nor tired");
  expect(localizedStoredCheckInValue("一般", "en", "task", "engagement")).toBe("Neither smoothly nor poorly");
});

test("旧版 Web 记录中的已删除题目和旧选项仍有英文显示", () => {
  expect(storedCheckInLabel(
    "en",
    "checkIn.steps.wake.fields.startDifficulty.title",
    "今天开始的难度",
  )).toBe("How hard was it to get started today?");
  expect(localizedStoredCheckInValue("很难开始", "en", "wake", "startDifficulty")).toBe("Very difficult");
  expect(localizedStoredCheckInValue("比较安稳", "en", "sleep", "quality")).toBe("Fairly restful");
  expect(localizedStoredCheckInValue("吃得比较零散", "en", "eat", "mealCount")).toBe("Small amounts at different times");
  expect(localizedStoredCheckInValue("20-30 分钟", "en", "exercise", "duration")).toBe("20–30 minutes");
  expect(localizedStoredCheckInValue("很难开始，或一直拖着", "en", "task", "engagement"))
    .toBe("It was very hard to start, or I kept putting it off");
});

test("小程序 state 字段映射到各维度主问题且不翻译自由文本", () => {
  expect(localizedStoredCheckInValue("睡得很好", "en", "sleep", "state")).toBe("Very well");
  expect(localizedStoredCheckInValue("基本规律", "en", "eat", "state")).toBe("Mostly regular");
  expect(localizedStoredCheckInValue("10–20 分钟", "en", "exercise", "state")).toBe("10–20 minutes");
  expect(localizedStoredCheckInValue("今天和朋友聊了很久", "en", "sleep", "note"))
    .toBe("今天和朋友聊了很久");
  expect(localizedStoredCheckInValue("比较安稳", "zh-CN", "sleep", "quality")).toBe("比较安稳");
});
