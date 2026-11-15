import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { draftCanary, inlineConsentTraffic, syntheticInlineConsent } from "./fixtures/synthetic-inline-consent";

type Copy = typeof zh | typeof en;

async function openTask(page: Page, prefix: string, copy: Copy) {
  await page.goto(`${prefix}/mood-journal`);
  await page.getByRole("textbox", { name: copy.moodJournal.reflection.context }).fill(draftCanary);
  await page.getByRole("button", { name: copy.moodJournal.actions.organize, exact: true }).click();
  await expect(page.getByRole("dialog", { name: copy.inlineConsent.title, exact: true })).toBeVisible();
  return page.getByTestId("inline-student-consent");
}

test.afterEach(async ({ page }) => {
  const traffic = inlineConsentTraffic.get(page);
  if (traffic) {
    expect(traffic.blockedExternal).toEqual([]);
    expect(traffic.unexpectedApi).toEqual([]);
  }
});

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  for (const failure of ["rate_limit", "network"] as const) {
    test(`${prefix || "zh"} 原页OTP ${failure}后显式使用已收码，不自动重发或验证`, async ({ page, baseURL }) => {
      const fixture = await syntheticInlineConsent(page, baseURL!, { signedIn: false });
      await page.route("**/auth/v1/otp*", (route) => {
        fixture.state.otpSends++;
        return failure === "rate_limit"
          ? route.fulfill({ status: 429, json: { code: "over_email_send_rate_limit", msg: "PRIVATE_INLINE_OTP_PROVIDER" } })
          : route.abort("internetdisconnected");
      });
      const verificationEmails: string[] = [];
      await page.route("**/auth/v1/verify*", (route) => {
        verificationEmails.push(route.request().postDataJSON().email);
        return route.fallback();
      });
      const panel = await openTask(page, prefix, copy);
      const email = panel.getByRole("textbox", { name: copy.account.visitor.email, exact: true });
      await email.fill(fixture.state.user.email);
      const send = panel.locator("form").first().locator("button[type='submit']");
      await send.click();
      await expect(panel.getByRole("alert")).toHaveText(failure === "rate_limit" ? copy.account.errors.otpRateLimited : copy.account.errors.otpSendNetwork);
      await expect(panel).not.toContainText("PRIVATE_INLINE_OTP_PROVIDER");
      const code = panel.getByRole("textbox", { name: copy.account.visitor.otp, exact: true });
      await expect(code).toHaveCount(0);
      await expect(send).toBeDisabled();
      expect(fixture.state.otpSends).toBe(1);
      expect(fixture.state.otpVerifies).toBe(0);

      await panel.getByRole("button", { name: copy.account.visitor.alreadyReceivedOtp, exact: true }).click();
      await expect(code).toBeFocused();
      await expect(code).toHaveAttribute("maxlength", "8");
      await expect(code).toHaveAttribute("inputmode", "numeric");
      await expect(email).toBeDisabled();
      await expect(send).toBeDisabled();
      await expect(panel.getByRole("alert")).toHaveCount(0);
      expect(fixture.state.otpSends).toBe(1);
      expect(fixture.state.otpVerifies).toBe(0);
      const signIn = panel.getByRole("button", { name: copy.account.visitor.signIn, exact: true });
      await code.fill("12a34");
      await expect(code).toHaveValue("1234");
      await expect(signIn).toBeDisabled();
      await code.fill("12345678");
      await signIn.click();
      await expect(panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: copy.moodJournal.reflection.context })).toHaveValue(draftCanary);
      await expect(page).toHaveURL(`${baseURL}${prefix}/mood-journal`);
      expect(verificationEmails).toEqual([fixture.state.user.email]);
      expect(fixture.state.otpSends).toBe(1);
      expect(fixture.state.otpVerifies).toBe(1);
      expect(fixture.state.consentPosts).toEqual([]);
      expect(fixture.state.profileWrites).toEqual([]);
      expect(fixture.state.aiCalls).toEqual([]);
    });
  }

  test(`${prefix || "zh"} 原页可直接输入已有验证码，且更换邮箱不沿用旧码或绕过冷却`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineConsent(page, baseURL!, { signedIn: false });
    const submitted: Array<{ email: string; token: string }> = [];
    await page.route("**/auth/v1/verify*", (route) => {
      fixture.state.otpVerifies++;
      const body = route.request().postDataJSON();
      submitted.push({ email: body.email, token: body.token });
      return route.fulfill({ status: 403, json: { code: "otp_expired", msg: "Token has expired" } });
    });
    const panel = await openTask(page, prefix, copy);
    const email = panel.getByRole("textbox", { name: copy.account.visitor.email, exact: true });
    const useCode = panel.getByRole("button", { name: copy.account.visitor.alreadyReceivedOtp, exact: true });
    await expect(useCode).toBeDisabled();
    await email.fill("not-an-email");
    await useCode.click();
    await expect(panel.getByRole("textbox", { name: copy.account.visitor.otp, exact: true })).toHaveCount(0);
    expect(fixture.state.otpSends).toBe(0);
    expect(fixture.state.otpVerifies).toBe(0);
    await email.fill(fixture.state.user.email);
    await useCode.click();
    const code = panel.getByRole("textbox", { name: copy.account.visitor.otp, exact: true });
    await code.fill("87654321");
    await panel.getByRole("button", { name: copy.account.visitor.changeEmail, exact: true }).click();
    await expect(code).toHaveCount(0);
    await expect(email).toBeEditable();
    const otherEmail = "second-inline-code@example.invalid";
    await email.fill(otherEmail);
    const send = panel.locator("form").first().locator("button[type='submit']");
    await expect(send).toBeDisabled();
    await useCode.click();
    await expect(code).toHaveValue("");
    await expect(code).toBeFocused();
    await expect(email).toHaveValue(otherEmail);
    await expect(send).toBeDisabled();
    expect(fixture.state.otpSends).toBe(0);
    expect(fixture.state.otpVerifies).toBe(0);
    await code.fill("12345678");
    await panel.getByRole("button", { name: copy.account.visitor.signIn, exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveText(copy.account.errors.otpInvalid);
    await expect(email).toHaveValue(otherEmail);
    expect(submitted).toEqual([{ email: otherEmail, token: "12345678" }]);
    expect(fixture.state.otpSends).toBe(0);
    expect(fixture.state.consentPosts).toEqual([]);
    expect(fixture.state.profileWrites).toEqual([]);
    expect(fixture.state.aiCalls).toEqual([]);
  });

  test(`${prefix || "zh"} 旧原页OTP请求迟到时不重置B账号确认或邮箱状态`, async ({ page, baseURL }) => {
    const fixture = await syntheticInlineConsent(page, baseURL!, { signedIn: false });
    await page.addInitScript(() => {
      const runtime = window as typeof window & { inlineOtpSettled: number };
      runtime.inlineOtpSettled = 0;
      const original = window.fetch.bind(window);
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!new URL(url, location.href).pathname.endsWith("/auth/v1/otp")) return original(...args);
        try { return await original(...args); }
        finally { runtime.inlineOtpSettled++; }
      };
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/auth/v1/otp*", async (route) => {
      fixture.state.otpSends++;
      await gate;
      return route.fulfill({ status: 429, json: { code: "over_email_send_rate_limit", msg: "PRIVATE_OLD_INLINE_OTP" } });
    });
    const panel = await openTask(page, prefix, copy);
    await panel.getByRole("textbox", { name: copy.account.visitor.email, exact: true }).fill(fixture.state.user.email);
    try {
      await panel.getByRole("button", { name: copy.account.visitor.sendOtp, exact: true }).click();
      await expect.poll(() => fixture.state.otpSends).toBe(1);
      await fixture.changeSession("second_student");
      const age = panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true });
      await expect(age).toBeVisible();
      await age.selectOption("18_plus");
      const acknowledgement = panel.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true });
      await acknowledgement.check();
      release();
      await page.waitForFunction(() => (window as typeof window & { inlineOtpSettled: number }).inlineOtpSettled === 1);
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0)));
      await expect(age).toHaveValue("18_plus");
      await expect(acknowledgement).toBeChecked();
      await expect(panel.getByRole("alert")).toHaveCount(0);
      await expect(panel.getByRole("textbox", { name: copy.account.visitor.otp, exact: true })).toHaveCount(0);
      expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).user.id, fixture.storageKey)).toBe(fixture.state.user.id);
      expect(fixture.state.otpSends).toBe(1);
      expect(fixture.state.otpVerifies).toBe(0);
      expect(fixture.state.consentPosts).toEqual([]);
      expect(fixture.state.aiCalls).toEqual([]);
      await expect(page.locator("body")).not.toContainText("PRIVATE_OLD_INLINE_OTP");
    } finally { release(); }
  });
}
