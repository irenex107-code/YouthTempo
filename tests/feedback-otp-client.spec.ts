import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { openLocal, controlLocal, localState } from "./fixtures/feedback-otp-local-browser";

const A = "00000000-0000-4000-8000-000000000011", B = "00000000-0000-4000-8000-000000000012";
async function settle(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function doubleSubmit(page: Page, index = 0) {
  await page.locator("form").nth(index).evaluate(form => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function postCount(page: Page) { return (await localState(page)).calls.filter(c => c.method === "POST").length; }
async function authCount(page: Page, kind: string) { return (await localState(page)).authCalls.filter(c => c.kind === kind).length; }

for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  const f = copy.feedback.member, a = copy.account;
  const field = (page: Page) => page.getByRole("textbox", { name: f.textQuestions.mostHelpful.label, exact: true });
  const save = (page: Page) => page.getByRole("button", { name: f.saveChanges, exact: true });
  async function feedback(page: Page) {
    const guard = await openLocal(page, { locale, route: "feedback" });
    await expect(field(page)).toHaveValue("A saved feedback");
    return guard;
  }

  test(`${locale} REPRO feedback new edits survive delayed success`, async ({ page }) => {
    const guard = await feedback(page);
    await field(page).fill("submitted A");
    await controlLocal(page, "set", "holdPost", true);
    await save(page).click();
    await expect.poll(() => postCount(page)).toBe(1);
    await field(page).fill("new unsaved A");
    await page.locator("textarea").nth(1).fill("new difficulty");
    await page.locator("textarea").nth(2).fill("new suggestion");
    await page.locator("input[type=checkbox]").check();
    await page.locator("fieldset").first().locator("label").last().click();
    await field(page).focus();
    await controlLocal(page, "release", "post");
    await expect(save(page)).toBeEnabled();
    await expect(field(page)).toHaveValue("new unsaved A");
    await expect(page.locator("textarea").nth(1)).toHaveValue("new difficulty");
    await expect(page.locator("textarea").nth(2)).toHaveValue("new suggestion");
    await expect(page.locator("input[type=checkbox]")).toBeChecked();
    await expect(page.locator("fieldset").first().getByRole("radio").last()).toBeChecked();
    await expect(field(page)).toBeFocused();
    await expect(page.getByRole("status")).not.toContainText(f.notices.received);
    expect((await localState(page)).calls.find(c => c.method === "POST")?.body).toMatchObject({ mostHelpful: "submitted A", mayContact: false, overallExperience: 4 });
    expect(await postCount(page)).toBe(1);
    expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
  });

  test(`${locale} feedback unchanged success and edits after success`, async ({ page }) => {
    const guard = await feedback(page);
    await field(page).fill("  submitted unchanged  ");
    await save(page).click();
    await expect(page.getByRole("status")).toContainText(f.notices.received);
    await expect(field(page)).toHaveValue("submitted unchanged");
    await field(page).fill("edit after success");
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await postCount(page)).toBe(1);
    expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
  });

  test(`${locale} feedback synchronous duplicate submit and token wait protect edits`, async ({ page }) => {
    await feedback(page);
    await field(page).fill("snapshot before token");
    await controlLocal(page, "set", "holdToken", true);
    await doubleSubmit(page);
    await expect.poll(async () => (await localState(page)).pending.filter(p => p.kind === "token").length).toBe(1);
    await field(page).fill("edit during token");
    await controlLocal(page, "release", "token");
    await expect(save(page)).toBeEnabled();
    await expect(field(page)).toHaveValue("edit during token");
    expect(await postCount(page)).toBe(1);
    expect((await localState(page)).calls.find(c => c.method === "POST")?.body?.mostHelpful).toBe("snapshot before token");
  });

  for (const mode of ["refused", "server", "network", "json", "missing", "mismatch"] as const) {
    test(`${locale} feedback ${mode} keeps newer draft without retry or success`, async ({ page }) => {
      const guard = await feedback(page);
      await field(page).fill("submitted uncertain");
      await controlLocal(page, "set", "postMode", mode);
      await controlLocal(page, "set", "holdPost", true);
      await save(page).click();
      await expect.poll(() => postCount(page)).toBe(1);
      await field(page).fill("keep after uncertain");
      await controlLocal(page, "release", "post");
      await expect(save(page)).toBeEnabled();
      await expect(field(page)).toHaveValue("keep after uncertain");
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(0);
      expect(await postCount(page)).toBe(1);
      await expect(page.locator("body")).not.toContainText("Synthetic private fault");
      expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
    });
  }

  for (const transition of ["B", "ABA", "unknown", "out", "unmount"] as const) {
    test(`${locale} feedback late old save retires on ${transition}`, async ({ page }) => {
      const guard = await feedback(page);
      await field(page).fill("old A pending");
      await controlLocal(page, "set", "holdPost", true);
      await save(page).click();
      await expect.poll(() => postCount(page)).toBe(1);
      const first = (await localState(page)).pending.find(p => p.kind === "post")!.id;
      if (transition === "unknown") await controlLocal(page, "identityFailure");
      else if (transition === "out") await controlLocal(page, "actor", "");
      else if (transition === "unmount") await controlLocal(page, "unmount");
      else {
        await controlLocal(page, "actor", B);
        await expect(field(page)).toHaveValue("B saved feedback");
        if (transition === "ABA") {
          await controlLocal(page, "actor", A);
          await expect(field(page)).toHaveValue("old A pending");
        }
        await field(page).fill("new actor pending");
        await save(page).click();
        await expect.poll(() => postCount(page)).toBe(2);
      }
      await controlLocal(page, "release", "post", first);
      await settle(page);
      if (["B", "ABA"].includes(transition)) {
        await expect(field(page)).toHaveValue("new actor pending");
        await expect(page.getByRole("button", { name: f.saving, exact: true })).toBeDisabled();
        await expect(page.getByRole("status")).toHaveCount(0);
        await controlLocal(page, "release", "post");
        await expect(page.getByRole("status")).toContainText(f.notices.received);
      } else {
        await expect(page.locator("form")).toHaveCount(0);
        await expect(page.getByRole("status")).toHaveCount(0);
      }
      expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
      expect((await localState(page)).unexpected).toEqual([]);
    });
  }

  test(`${locale} feedback late read and same actor token refresh`, async ({ page }) => {
    await feedback(page);
    await controlLocal(page, "set", "holdRead", true);
    await controlLocal(page, "actor", B);
    await expect.poll(async () => (await localState(page)).pending.filter(p => p.kind === "read").length).toBe(1);
    await controlLocal(page, "set", "holdRead", false);
    await controlLocal(page, "actor", A);
    await expect(field(page)).toHaveValue("A saved feedback");
    await field(page).fill("A new draft");
    await controlLocal(page, "release", "read");
    await controlLocal(page, "refreshToken");
    await save(page).click();
    await expect(page.getByRole("status")).toContainText(f.notices.received);
    await expect(field(page)).toHaveValue("A new draft");
    expect(await postCount(page)).toBe(1);
  });

  for (const route of ["account", "inline"] as const) {
    const email = (page: Page) => page.getByRole("textbox", { name: a.visitor.email, exact: true });
    const otp = (page: Page) => page.getByRole("textbox", { name: a.visitor.otp, exact: true });
    async function auth(page: Page) {
      const guard = await openLocal(page, { locale, route });
      await expect(email(page)).toBeEnabled();
      await email(page).fill("otp-original@provider.invalid");
      return guard;
    }
    async function enterCode(page: Page) {
      await page.getByRole("button", { name: a.visitor.alreadyReceivedOtp, exact: true }).click();
      await otp(page).fill("12345678");
    }

    test(`${locale} ${route} REPRO verify duplicate protects one request`, async ({ page }) => {
      const guard = await auth(page);
      await enterCode(page);
      await controlLocal(page, "set", "authError", { code: "otp_expired", status: 403 });
      await controlLocal(page, "set", "holdAuth", true);
      await doubleSubmit(page, route === "inline" ? 1 : 0);
      await expect.poll(() => authCount(page, "verify")).toBe(1);
      await settle(page);
      expect(await authCount(page, "verify")).toBe(1);
      await controlLocal(page, "release", "verify");
      await expect(page.getByText(a.errors.otpInvalid, { exact: true })).toBeVisible();
      await expect(otp(page)).toHaveValue("12345678");
      expect(await authCount(page, "send")).toBe(0);
      expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
    });

    for (const kind of ["rate", "invalid", "network", "service", "unknown"] as const) {
      test(`${locale} ${route} OTP ${kind} request and verify safe errors`, async ({ page }) => {
        const guard = await auth(page);
        const error = {
          rate: { status: 429, code: "over_email_send_rate_limit", message: "PRIVATE OTP" },
          invalid: { status: 403, code: "otp_expired", message: "PRIVATE OTP" },
          network: { name: "AuthRetryableFetchError", status: 0, message: "PRIVATE OTP" },
          service: { status: 503, message: "PRIVATE OTP service invalid" },
          unknown: { status: 400, code: "future_error", message: "PRIVATE supplier@provider.invalid" },
        }[kind];
        await controlLocal(page, "set", "authError", error);
        await doubleSubmit(page);
        await expect.poll(() => authCount(page, "send")).toBe(1);
        const sendText = { rate: a.errors.otpRateLimited, invalid: a.errors.otpSendFailed, network: a.errors.otpSendNetwork, service: a.errors.otpServiceUnavailable, unknown: a.errors.otpSendFailed }[kind];
        await expect(page.getByText(sendText, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /\d+.*(秒|s)/ }).first()).toBeDisabled();
        await enterCode(page);
        await page.getByRole("button", { name: a.visitor.signIn, exact: true }).click();
        const verifyText = { rate: a.errors.otpVerifyRateLimited, invalid: a.errors.otpInvalid, network: a.errors.otpVerifyNetwork, service: a.errors.otpServiceUnavailable, unknown: a.errors.otpVerifyFailed }[kind];
        await expect(page.getByText(verifyText, { exact: true })).toBeVisible();
        await expect(otp(page)).toHaveValue("12345678");
        expect(await authCount(page, "verify")).toBe(1);
        expect(await authCount(page, "send")).toBe(1);
        await expect(page.locator("body")).not.toContainText("PRIVATE");
        expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
        expect((await localState(page)).unexpected).toEqual([]);
      });
    }

    test(`${locale} ${route} input and successful send keep sixty second resend limit`, async ({ page }) => {
      await auth(page);
      await page.clock.install();
      await page.getByRole("button", { name: a.visitor.sendOtp, exact: true }).click();
      await expect(otp(page)).toBeVisible();
      await otp(page).fill("a12b34");
      await expect(otp(page)).toHaveValue("1234");
      if (route === "account") {
        await page.getByRole("button", { name: a.visitor.signIn, exact: true }).click();
        await expect(page.getByText(a.errors.otpIncomplete.replace("{{count}}", "8"), { exact: true })).toBeVisible();
      } else await expect(page.getByRole("button", { name: a.visitor.signIn, exact: true })).toBeDisabled();
      expect(await authCount(page, "verify")).toBe(0);
      for (let i = 0; i < 60; i++) await page.clock.runFor(1_000);
      const resend = page.getByRole("button", { name: route === "account" ? a.visitor.resend : a.visitor.sendOtp, exact: true });
      await expect(resend).toBeEnabled();
      await resend.click();
      expect(await authCount(page, "send")).toBe(2);
      await expect(page.getByRole("button", { name: /\d+.*(秒|s)/ }).first()).toBeDisabled();
    });

    test(`${locale} ${route} auth regression successful verify keeps session handoff`, async ({ page }) => {
      const guard = await auth(page);
      await enterCode(page);
      await page.getByRole("button", { name: a.visitor.signIn, exact: true }).click();
      await expect(otp(page)).toHaveCount(0);
      await expect(email(page)).toHaveCount(0);
      expect(await authCount(page, "verify")).toBe(1);
      expect(await authCount(page, "send")).toBe(0);
      if (route === "account") await expect.poll(async () => (await localState(page)).navigation.length).toBe(1);
      expect((await localState(page)).unexpected).toEqual([]);
      expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
    });

    test(`${locale} ${route} auth regression late error retires after actor change`, async ({ page }) => {
      const guard = await auth(page);
      await enterCode(page);
      await controlLocal(page, "set", "authError", { status: 503, message: "PRIVATE OLD OTP" });
      await controlLocal(page, "set", "holdAuth", true);
      await page.getByRole("button", { name: a.visitor.signIn, exact: true }).click();
      await expect.poll(() => authCount(page, "verify")).toBe(1);
      await controlLocal(page, "actor", B);
      await expect(otp(page)).toHaveCount(0);
      await controlLocal(page, "release", "verify");
      await settle(page);
      await expect(page.getByText(a.errors.otpServiceUnavailable, { exact: true })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("PRIVATE");
      expect(await authCount(page, "verify")).toBe(1);
      expect(await authCount(page, "send")).toBe(0);
      expect((await localState(page)).unexpected).toEqual([]);
      expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
    });

    test(`${locale} ${route} visual safe service and invalid verification`, async ({ page }, info) => {
      const guard = await auth(page);
      await controlLocal(page, "set", "authError", { status: 503, message: "PRIVATE OTP fault" });
      await page.getByRole("button", { name: a.visitor.sendOtp, exact: true }).click();
      await expect(page.getByText(a.errors.otpServiceUnavailable, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: a.visitor.alreadyReceivedOtp, exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (info.project.name === "local-narrow") {
        await page.screenshot({ path: info.outputPath(`${locale}-${route}-service.png`), fullPage: true, animations: "disabled" });
      }
      await enterCode(page);
      await controlLocal(page, "set", "authError", { status: 403, code: "otp_expired" });
      await page.getByRole("button", { name: a.visitor.signIn, exact: true }).click();
      await expect(page.getByText(a.errors.otpInvalid, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: a.visitor.signIn, exact: true })).toBeEnabled();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${locale}-${route}-invalid.png`), fullPage: true, animations: "disabled" });
      expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
    });
  }

  test(`${locale} feedback visual earlier save and current unsaved edits`, async ({ page }, info) => {
    const guard = await feedback(page);
    await field(page).fill("submitted feedback");
    await controlLocal(page, "set", "holdPost", true);
    await save(page).click();
    await expect.poll(() => postCount(page)).toBe(1);
    await field(page).fill("new unsaved edits");
    await controlLocal(page, "release", "post");
    await expect(page.getByRole("status")).toContainText(f.notices.receivedWithNewEdits);
    await expect(page.getByText(f.unsavedChanges, { exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${locale}-feedback-unsaved.png`), fullPage: true, animations: "disabled" });
    expect(guard.network).toEqual([]); expect(guard.errors).toEqual([]);
  });
}
