import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { isOtpRateLimitError, otpRequestErrorMessage, otpVerificationErrorMessage } from "../lib/emailOtp";

test("结构化限流不依赖服务端文字，验证限流优先于 OTP 关键词", () => {
  const message = "For security purposes, you can only request this after 60 seconds.";
  for (const error of [{ status: 429, message }, { code: "over_email_send_rate_limit", message }]) {
    expect(isOtpRateLimitError(error)).toBe(true);
    expect(otpRequestErrorMessage(error)).toBe(zh.account.errors.otpRateLimited);
  }
  expect(otpVerificationErrorMessage({ status: 429, message: "Too many OTP attempts" }))
    .toBe(zh.account.errors.otpVerifyRateLimited);
  expect(otpRequestErrorMessage({ status: 500, message: "private SMTP details" }))
    .toBe(zh.account.errors.otpSendFailed);
});

for (const [locale, copy] of [["zh-CN", zh.account], ["en", en.account]] as const) {
  for (const status of [429, 500]) {
    test(`${locale} 发送返回 ${status} 后仍可输入已有验证码，冷却和服务端验证保留`, async ({ page }) => {
      let sends = 0;
      let verifications = 0;
      const telemetry: unknown[] = [];
      // All auth requests are intercepted; these tests never send email.
      await page.route("**/auth/v1/**", async (route) => {
        if (new URL(route.request().url()).pathname.endsWith("/otp")) {
          sends += 1;
          return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({
            code: status === 429 ? "over_email_send_rate_limit" : "unexpected_failure",
            msg: status === 429 ? "For security purposes, you can only request this after 60 seconds." : "private SMTP details",
          }) });
        }
        if (new URL(route.request().url()).pathname.endsWith("/verify")) {
          verifications += 1;
          expect(route.request().postDataJSON()).toMatchObject({ email: "otp-recovery@example.invalid", type: "email", token: "12345678" });
          return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "otp_expired", msg: "Token has expired" }) });
        }
        return route.abort();
      });
      await page.route("**/api/monitoring/client-error", async (route) => {
        telemetry.push(route.request().postDataJSON());
        await route.fulfill({ status: 204 });
      });
      await page.goto(locale === "en" ? "/en/account" : "/account");
      await page.getByPlaceholder("name@example.com").fill("otp-recovery@example.invalid");
      await page.getByRole("button", { name: copy.visitor.sendOtp, exact: true }).click();
      await expect(page.getByText(status === 429 ? copy.errors.otpRateLimited : copy.errors.otpSendFailed, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /\d+.*(秒|s)/ })).toBeDisabled();
      if (status === 429) await expect.poll(() => telemetry).toContainEqual({ area: "auth", operation: "auth_otp_send", failureKind: "rate_limited" });
      await page.getByRole("button", { name: copy.visitor.alreadyReceivedOtp, exact: true }).click();
      const code = page.getByPlaceholder("12345678");
      await expect(code).toBeVisible();
      await expect(code).toBeFocused();
      await expect(page.getByText(copy.notices.otpSent, { exact: true })).toHaveCount(0);
      await expect(page.getByPlaceholder("name@example.com")).toBeDisabled();
      await code.fill("123");
      await page.getByRole("button", { name: copy.visitor.signIn, exact: true }).click();
      await expect(page.getByText(copy.errors.otpIncomplete.replace("{{count}}", "8"), { exact: true })).toBeVisible();
      expect(verifications).toBe(0);
      await code.fill("12345678");
      await page.getByRole("button", { name: copy.visitor.signIn, exact: true }).click();
      await expect(page.getByText(copy.errors.otpInvalid, { exact: true })).toBeVisible();
      expect(verifications).toBe(1);
      expect(sends).toBe(1);
      await expect(code).toHaveValue("12345678");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.getByRole("button", { name: copy.visitor.changeEmail, exact: true }).click();
      await expect(page.getByPlaceholder("name@example.com")).toBeEnabled();
      await expect(code).toHaveCount(0);
      await expect(page.getByRole("button", { name: /\d+.*(秒|s)/ })).toBeDisabled();
    });
  }

  test(`${locale} 已收码入口无需再次发信，正常发送与重发仍有冷却`, async ({ page }) => {
    let sends = 0;
    await page.route("**/auth/v1/**", async (route) => {
      if (!new URL(route.request().url()).pathname.endsWith("/otp")) return route.abort();
      sends += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto(locale === "en" ? "/en/account" : "/account");
    await page.getByPlaceholder("name@example.com").fill("not-an-email");
    await page.getByRole("button", { name: copy.visitor.alreadyReceivedOtp, exact: true }).click();
    await expect(page.getByPlaceholder("12345678")).toHaveCount(0);
    await page.getByPlaceholder("name@example.com").fill("otp-recovery@example.invalid");
    await page.getByRole("button", { name: copy.visitor.alreadyReceivedOtp, exact: true }).click();
    await expect(page.getByPlaceholder("12345678")).toBeVisible();
    expect(sends).toBe(0);
    await page.reload();
    await page.clock.install({ time: new Date("2026-10-09T08:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-09T08:00:00Z"));
    await page.getByPlaceholder("name@example.com").fill("otp-recovery@example.invalid");
    await page.getByRole("button", { name: copy.visitor.sendOtp, exact: true }).click();
    await expect(page.getByText(copy.notices.otpSent, { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("12345678")).toBeVisible();
    await expect(page.getByRole("button", { name: /\d+.*(秒|s)/ })).toBeDisabled();
    for (let seconds = 59; seconds >= 0; seconds -= 1) {
      await page.clock.runFor(1_000);
      const label = seconds > 0 ? copy.visitor.resendCountdown.replace("{{seconds}}", String(seconds)) : copy.visitor.resend;
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: copy.visitor.resend, exact: true }).click();
    await expect(page.getByText(copy.notices.otpResent, { exact: true })).toBeVisible();
    expect(sends).toBe(2);
  });
}

test("已有验证码验证成功后保存会话，刷新后继续使用该会话", async ({ page }) => {
  const user = { id: "00000000-0000-4000-8000-000000000088", email: "otp-recovery@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt, role: "authenticated" })).toString("base64url")}.synthetic-signature`;
  let userReads = 0;
  let sends = 0;
  await page.route("**/auth/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/otp")) { sends += 1; return route.abort(); }
    if (pathname.endsWith("/verify")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: token, refresh_token: "synthetic-refresh-token", expires_in: 3600, expires_at: expiresAt, token_type: "bearer", user }) });
    if (pathname.endsWith("/user")) {
      userReads += 1;
      expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    }
    return route.abort();
  });
  await page.route("**/rest/v1/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: { id: user.id, display_name: "OTP test", role: "学生" }, displayRole: "学生", identities: [], consent: null }) }));
  await page.goto("/account");
  await page.getByPlaceholder("name@example.com").fill(user.email);
  await page.getByRole("button", { name: zh.account.visitor.alreadyReceivedOtp, exact: true }).click();
  await page.getByPlaceholder("12345678").fill("12345678");
  await page.getByRole("button", { name: zh.account.visitor.signIn, exact: true }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => /^sb-.*-auth-token$/.test(k)).length)).toBe(1);
  await expect.poll(() => userReads).toBeGreaterThan(0);
  const readsBeforeReload = userReads;
  await page.reload();
  await expect.poll(() => userReads).toBeGreaterThan(readsBeforeReload);
  await expect(page.getByPlaceholder("name@example.com")).toHaveCount(0);
  expect(sends).toBe(0);
});
