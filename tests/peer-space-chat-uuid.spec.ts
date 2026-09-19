import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { isUuid } from "../lib/peerSpaceChat";

test("解忧室接受真实房间 UUID，并拒绝缺段或非法版本", () => {
  const id = randomUUID();
  expect(isUuid(id)).toBe(true);
  expect(isUuid(id.toUpperCase())).toBe(true);
  expect(isUuid(id.replace(/-/g, ""))).toBe(false);
  expect(isUuid(`${id.slice(0, 14)}0${id.slice(15)}`)).toBe(false);
});
