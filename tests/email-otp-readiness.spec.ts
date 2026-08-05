import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  emailOtpLength,
  otpRequestErrorMessage,
  otpVerificationErrorMessage,
} from "../lib/emailOtp";

test("登录邮件模板保持纯 OTP 且不加载外部内容", async () => {
  const template = await readFile(path.join(process.cwd(), "supabase/email-templates/otp.html"), "utf8");
  expect(template.match(/{{ \.Token }}/g)).toHaveLength(1);
  expect(template).not.toContain(".ConfirmationURL");
  expect(template).not.toMatch(/https?:\/\//i);
  expect(template).not.toMatch(/<img\b/i);
  expect(template).toContain("1 小时后失效");
  expect(template).toContain("不会通过电话、微信或邮件向你索要验证码");
});

test("OTP 错误文案不会向页面透传服务端原始消息", async () => {
  const raw = "SMTP host smtp.internal.example failed for private-user@example.com";
  expect(otpRequestErrorMessage(new Error(raw))).toBe("验证码发送失败，请稍后重试。");
  expect(otpRequestErrorMessage(new Error("Email address not authorized"))).toContain("暂时无法收到");
  expect(otpRequestErrorMessage(new Error("429 rate limit"))).toContain("频繁");
  expect(otpVerificationErrorMessage(new Error("Token has expired"))).toContain("不正确或已过期");
  expect(otpVerificationErrorMessage(new Error(raw))).not.toContain("private-user");

  expect(otpRequestErrorMessage(new Error("429 rate limit"), {
    unauthorized: "unauthorized",
    rateLimited: "rate limited",
    network: "network",
    fallback: "fallback",
  })).toBe("rate limited");
  expect(otpVerificationErrorMessage(new Error("Token has expired"), {
    invalid: "invalid or expired",
    rateLimited: "rate limited",
    network: "network",
    fallback: "fallback",
  })).toBe("invalid or expired");
});

test("账户页与 8 位 OTP 配置一致", async ({ page }) => {
  await page.goto("/account");
  await page.getByPlaceholder("name@example.com").fill("otp-readiness@example.com");
  expect(emailOtpLength).toBe(8);
  await expect(page.getByRole("button", { name: "发送验证码" })).toBeEnabled();
});
