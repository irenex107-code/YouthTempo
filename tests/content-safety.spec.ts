import { expect, test } from "@playwright/test";
import { moderateCommunityContent, moderateStudentMessage } from "../lib/messageSafety";

test("辱骂内容会被阻止发送", () => {
  expect(moderateStudentMessage("你就是个废物").status).toBe("blocked");
  expect(moderateCommunityContent("滚开").status).toBe("blocked");
});

test("转述被辱骂的经历不会被误拦截", () => {
  expect(moderateStudentMessage("有人说我是废物，我很难受").status).toBe("sent");
});

test("安全信号进入人工关注流程", () => {
  expect(moderateStudentMessage("我最近觉得活不下去").status).toBe("safety_review");
  expect(moderateCommunityContent("我有伤害自己的想法").status).toBe("safety_review");
});
