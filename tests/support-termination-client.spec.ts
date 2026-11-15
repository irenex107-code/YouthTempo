import { mkdir } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { openTermination, controlTermination, terminationState } from "./fixtures/support-termination-local-browser";

type Copy = typeof zh | typeof en;
const A = "00000000-0000-4000-8000-000000000011", B = "00000000-0000-4000-8000-000000000012";
const ACTIVE = "00000000-0000-4000-8000-000000000102";
const caseArticle = (page: Page, original: "assigned" | "active" | "closed" = "active", owner = "A") =>
  page.locator("article").filter({ hasText: `${owner} PRIVATE ${original}` });
const actionButton = (item: Locator, copy: Copy, action: keyof Copy["supportFlow"]["portal"]["actions"]) =>
  item.getByRole("button", { name: copy.supportFlow.portal.actions[action], exact: true });
async function history(page: Page, owner = "A") {
  await expect(page.locator("article")).toHaveCount(3);
  await expect(caseArticle(page, "active", owner)).toBeVisible();
}
async function posts(page: Page, action?: string) {
  return (await terminationState(page)).calls.filter((call) => call.method === "POST" && (!action || call.body?.action === action));
}
async function reload(page: Page, copy: Copy) {
  await page.getByRole("button", { name: copy.supportFlow.portal.historyRetry, exact: true }).first().click();
}
async function verify(page: Page, copy: Copy) {
  await page.getByTestId("support-history-error").getByRole("button", { name: copy.supportFlow.portal.historyVerify, exact: true }).click();
}
async function shot(page: Page, name: string, project: string) {
  const dir = process.env.YOUTHTEMPO_TERMINATION_SCREENSHOT_DIR || "audit-records/2026-11-03/product01_support_termination_implementation/screenshots";
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${project}-${name}.png`, fullPage: true, animations: "disabled" });
}
async function noEscape(page: Page, fixture: { network: string[]; errors: string[] }) {
  expect((await terminationState(page)).unexpected).toEqual([]);
  expect(fixture.network).toEqual([]); expect(fixture.errors).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
}

// Paired visual combinations deliberately cover both routes/locales; narrow project only runs these.
const visualCases: Array<{ locale: "zh-CN" | "en"; copy: Copy; mode: "youth" | "adult" }> = [
  { locale: "zh-CN", copy: zh, mode: "youth" }, { locale: "en", copy: en, mode: "adult" },
  { locale: "zh-CN", copy: zh, mode: "adult" }, { locale: "en", copy: en, mode: "youth" },
];
for (const { locale, copy, mode } of visualCases) {
  test(`visual ${locale} ${mode} termination remains available after withdrawal; saved and no new feedback`, async ({ page }, info) => {
    const fixture = await openTermination(page, { locale, mode, consent: "withdrawn", adultClosed: mode === "adult" });
    await history(page); await expect(page.locator("form")).toHaveCount(0);
    const active = caseArticle(page);
    await expect(actionButton(active, copy, "withdraw_authorization")).toBeEnabled();
    await expect(actionButton(active, copy, "request_change")).toBeDisabled();
    await actionButton(active, copy, "withdraw_authorization").click();
    await expect(active).toContainText(copy.supportFlow.portal.status.paused);
    await expect(actionButton(active, copy, "withdraw_authorization")).toBeDisabled();
    await actionButton(active, copy, "close").click();
    await expect(active).toContainText(copy.supportFlow.portal.status.closed);
    await expect(active.locator("textarea")).toHaveCount(0);
    await expect(page.getByTestId("micro-feedback")).toHaveCount(0);
    expect(await posts(page)).toHaveLength(2);
    await page.locator("#support-immediate-help").scrollIntoViewIfNeeded();
    await expect(page.locator("#support-immediate-help")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator("html").getAttribute("lang")).toBe(locale);
    await shot(page, `${locale}-${mode}-withdraw-close`, info.project.name); await noEscape(page, fixture);
  });
  test(`visual ${locale} ${mode} token failure hides private history; identity and GET recover read-only`, async ({ page }, info) => {
    const fixture = await openTermination(page, { locale, mode, consent: "withdrawn" }); await history(page);
    await controlTermination(page, "sessionError", true);
    await actionButton(caseArticle(page), copy, "withdraw_authorization").click();
    await expect(page.locator("article")).toHaveCount(0);
    await expect(page.getByTestId("support-history-error")).toContainText(copy.supportFlow.portal.terminationNotSent);
    expect(await posts(page)).toHaveLength(0);
    await shot(page, `${locale}-${mode}-identity-hidden`, info.project.name);
    await controlTermination(page, "sessionError", false); await controlTermination(page, "set", "userFailure", true);
    await verify(page, copy); await expect(page.locator("article")).toHaveCount(0);
    await controlTermination(page, "set", "userFailure", false); await controlTermination(page, "set", "readFailure", 503);
    await verify(page, copy); await expect(page.locator("article")).toHaveCount(0);
    await controlTermination(page, "set", "readFailure", 0); await verify(page, copy); await history(page);
    expect((await terminationState(page)).authCalls.some((call) => call.kind === "user")).toBe(true);
    expect(await posts(page)).toHaveLength(0);
    await shot(page, `${locale}-${mode}-identity-recovered`, info.project.name); await noEscape(page, fixture);
  });
}

for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  for (const failure of [401, 403] as const) {
    test(`UI ${locale} ${failure} immediately hides history before body; old GET cannot restore`, async ({ page }) => {
      const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
      await controlTermination(page, "set", "actionFailure", failure); await controlTermination(page, "set", "holdBody", true);
      await actionButton(caseArticle(page), copy, "withdraw_authorization").click();
      await expect(page.locator("article")).toHaveCount(0);
      await expect.poll(async () => (await terminationState(page)).pending.includes("body")).toBe(true);
      await controlTermination(page, "consent", "active");
      await expect(page.locator("article")).toHaveCount(0); // Automatic consent GET must not reopen a blocked identity.
      await controlTermination(page, "release", "body");
      await expect(page.getByTestId("support-history-error")).toContainText(copy.supportFlow.portal.terminationDenied);
      await controlTermination(page, "set", "holdBody", false); await controlTermination(page, "set", "actionFailure", 0);
      await verify(page, copy); await history(page); expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
    });
  }
  test(`UI ${locale} 409 is a state refusal, not an identity failure`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
    await controlTermination(page, "set", "actionFailure", 409);
    await actionButton(caseArticle(page), copy, "withdraw_authorization").click();
    await expect(page.locator("main")).toContainText(copy.supportFlow.portal.terminationDenied); await history(page);
    await expect(page.getByTestId("support-history-error")).toHaveCount(0);
    await controlTermination(page, "set", "actionFailure", 0); await reload(page, copy); await history(page);
    expect(await posts(page)).toHaveLength(1); expect((await terminationState(page)).authCalls.filter((call) => call.kind === "user")).toHaveLength(0);
    await noEscape(page, fixture);
  });
  for (const failure of [403, 409, 503] as const) {
    test(`UI ${locale} confirmed withdrawal survives close ${failure}, GET and consent changes`, async ({ page }) => {
      const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
      await actionButton(caseArticle(page), copy, "withdraw_authorization").click();
      await expect(caseArticle(page)).toContainText(copy.supportFlow.portal.status.paused);
      await controlTermination(page, "set", "actionFailure", failure);
      await actionButton(caseArticle(page), copy, "close").click();
      if (failure === 403) { await expect(page.locator("article")).toHaveCount(0); await controlTermination(page, "set", "actionFailure", 0); await verify(page, copy); }
      else { await expect(page.locator("main")).toContainText(failure === 409 ? copy.supportFlow.portal.terminationDenied : copy.supportFlow.portal.terminationUnknown); await controlTermination(page, "set", "actionFailure", 0); await reload(page, copy); }
      await history(page); await controlTermination(page, "consent", "active"); await history(page);
      await controlTermination(page, "consent", "withdrawn"); await history(page);
      await expect(actionButton(caseArticle(page), copy, "withdraw_authorization")).toBeDisabled();
      // Native dispatch deliberately bypasses Playwright's disabled-button click protection.
      await actionButton(caseArticle(page), copy, "withdraw_authorization").evaluate((node: HTMLButtonElement) => {
        const key = Object.keys(node).find((value) => value.startsWith("__reactProps$"));
        if (!key) throw new Error("Actual React event props missing");
        const props = (node as unknown as Record<string, { onClick?: () => unknown }>)[key];
        if (!props.onClick) throw new Error("Actual React click handler missing");
        props.onClick(); // Direct actual event entry bypasses disabled DOM suppression.
      });
      expect(await posts(page, "withdraw_authorization")).toHaveLength(1);
      expect(await posts(page, "close")).toHaveLength(1);
      await expect(page.locator("main")).toContainText(copy.supportFlow.portal.actionSaved); await noEscape(page, fixture);
    });
  }
  test(`UI ${locale} saved receipt survives subsequent GET failure and never resends`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
    await controlTermination(page, "set", "postReadFailure", 503);
    await actionButton(caseArticle(page), copy, "withdraw_authorization").click();
    await expect(page.getByTestId("support-history-error")).toBeVisible(); await expect(page.locator("article")).toHaveCount(0);
    await expect(page.locator("main")).toContainText(copy.supportFlow.portal.actionSaved);
    await controlTermination(page, "set", "readFailure", 0); await reload(page, copy); await history(page);
    await expect(actionButton(caseArticle(page), copy, "withdraw_authorization")).toBeDisabled();
    expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
  });
  test(`UI ${locale} malformed 200 and network rejection are unknown; GET and reconsent do not rePOST`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
    await controlTermination(page, "set", "malformed", true);
    await actionButton(caseArticle(page), copy, "withdraw_authorization").click();
    await expect(page.locator("main")).toContainText(copy.supportFlow.portal.terminationUnknown);
    await controlTermination(page, "set", "malformed", false); await reload(page, copy); await history(page);
    await controlTermination(page, "consent", "active"); await history(page);
    await expect(actionButton(caseArticle(page), copy, "withdraw_authorization")).toBeDisabled();
    await expect(actionButton(caseArticle(page), copy, "close")).toBeDisabled();
    expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
  });
  test(`UI ${locale} pending POST remains saving without claiming a timeout`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
    await controlTermination(page, "set", "holdWrite", true);
    await actionButton(caseArticle(page), copy, "withdraw_authorization").evaluate((node: HTMLButtonElement) => {
      const key = Object.keys(node).find((value) => value.startsWith("__reactProps$"));
      if (!key) throw new Error("Actual React event props missing");
      const click = (node as unknown as Record<string, { onClick?: () => unknown }>)[key].onClick;
      if (!click) throw new Error("Actual React click handler missing");
      click(); click(); // Same turn: verify the synchronous ref guard before React commits.
    });
    await expect.poll(async () => (await terminationState(page)).pending.includes("write")).toBe(true);
    await expect(page.locator("main")).toContainText(copy.supportFlow.portal.saving);
    await expect(actionButton(caseArticle(page), copy, "withdraw_authorization")).toBeDisabled();
    expect(await posts(page)).toHaveLength(1);
    // Only release the simulated response; no fake clock/reject is used as proof of POST timeout handling.
    await controlTermination(page, "set", "holdWrite", false); await controlTermination(page, "release", "write");
    await expect(page.locator("main")).toContainText(copy.supportFlow.portal.actionSaved); await noEscape(page, fixture);
  });
  test(`UI ${locale} cancellation sends displayed revision; new proposal is a distinct target`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
    await actionButton(caseArticle(page), copy, "cancel_appointment").click();
    await expect(caseArticle(page)).toContainText(copy.supportFlow.portal.appointmentStatus.cancelled);
    const first = (await posts(page, "cancel_appointment"))[0]; expect(first.body?.caseId).toBe(ACTIVE);
    expect(first.body?.expectedAppointmentRevision).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.body).not.toHaveProperty("appointmentAt"); expect(first.body).not.toHaveProperty("authorizationActive");
    await controlTermination(page, "propose"); await reload(page, copy); await history(page);
    await expect(actionButton(caseArticle(page), copy, "cancel_appointment")).toBeEnabled();
    await actionButton(caseArticle(page), copy, "cancel_appointment").click();
    const requests = await posts(page, "cancel_appointment"); expect(requests).toHaveLength(2);
    expect(requests[1].body?.expectedAppointmentRevision).not.toBe(first.body?.expectedAppointmentRevision); await noEscape(page, fixture);
  });
  test(`UI ${locale} stale appointment revision gets 409 and does not cancel a new proposal`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
    await controlTermination(page, "propose"); // Server memory changes; visible object still has old token.
    await actionButton(caseArticle(page), copy, "cancel_appointment").click();
    await expect(page.locator("main")).toContainText(copy.supportFlow.portal.terminationDenied); await history(page);
    await reload(page, copy); await history(page);
    await expect(caseArticle(page)).toContainText(copy.supportFlow.portal.appointmentStatus.proposed);
    expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
  });
  test(`UI ${locale} post-dispatch A-B-A and signout cannot publish late receipts`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, consent: "withdrawn" }); await history(page);
    await controlTermination(page, "set", "holdWrite", true); await actionButton(caseArticle(page), copy, "withdraw_authorization").click();
    await expect.poll(async () => (await terminationState(page)).pending.includes("write")).toBe(true);
    await controlTermination(page, "actor", B); await history(page, "B");
    await controlTermination(page, "actor", A); await history(page);
    await controlTermination(page, "release", "write");
    await expect(page.locator("main")).not.toContainText(copy.supportFlow.portal.actionSaved);
    await controlTermination(page, "actor", ""); await expect(page.locator("article")).toHaveCount(0);
    expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
  });
  test(`UI ${locale} replaced local transport keeps create, continuation, feedback and urgent contracts`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, consent: "active" }); await history(page);
    await controlTermination(page, "set", "urgent", true);
    await page.locator("form textarea").fill("Synthetic request"); await page.locator("form button[type=submit]").click();
    await expect(page.locator("#support-immediate-help [role=alert]")).toBeVisible();
    await actionButton(caseArticle(page, "assigned"), copy, "accept_assignment").click();
    await expect(caseArticle(page, "assigned")).toContainText(copy.supportFlow.portal.status.active);
    await actionButton(caseArticle(page), copy, "accept_appointment").click();
    await expect(caseArticle(page)).toContainText(copy.supportFlow.portal.appointmentStatus.accepted);
    await caseArticle(page, "closed").getByRole("button", { name: copy.supportFlow.portal.feedbackSubmit, exact: true }).click();
    await expect(caseArticle(page, "closed")).toContainText(copy.supportFlow.portal.feedbackDone);
    const requests = await posts(page); expect(requests.map((call) => call.path)).toEqual(["/api/support/cases", "/api/support/case-action", "/api/support/case-action", "/api/support/feedback"]);
    await expect(page.getByTestId("micro-feedback")).toHaveAttribute("data-trigger", "0"); await noEscape(page, fixture);
  });
}

// Receipt corruption focused once: identity/locales are separately covered above.
for (const [name, patch] of [
  ["array appointment status", { appointmentStatus: ["proposed"] }], ["array referral", { referralType: ["school"] }],
  ["invalid actual time", { appointmentAt: "not-a-time" }], ["wrong case", { caseId: "00000000-0000-4000-8000-000000000999" }],
  ["wrong matched appointment revision", { matchedRevision: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001" }],
] as const) {
  test(`UI receipt ${name} is unknown`, async ({ page }) => {
    const fixture = await openTermination(page, { locale: "en", consent: "withdrawn" }); await history(page);
    await controlTermination(page, "set", "receiptPatch", patch);
    await actionButton(caseArticle(page), en, name === "wrong matched appointment revision" ? "cancel_appointment" : "withdraw_authorization").click();
    await expect(page.locator("main")).toContainText(en.supportFlow.portal.terminationUnknown);
    await expect(page.locator("main")).not.toContainText(en.supportFlow.portal.actionSaved);
    expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
  });
}

test("UI old in-flight GET is retired when a held 401 action response arrives", async ({ page }) => {
  const fixture = await openTermination(page, { locale: "en", consent: "withdrawn" }); await history(page);
  await controlTermination(page, "set", "actionFailure", 401); await controlTermination(page, "set", "holdActionHeaders", true);
  await actionButton(caseArticle(page), en, "withdraw_authorization").click();
  await expect.poll(async () => (await terminationState(page)).pending.includes("write")).toBe(true);
  await controlTermination(page, "set", "holdRead", true); await controlTermination(page, "consent", "error");
  await expect.poll(async () => (await terminationState(page)).pending.includes("read")).toBe(true);
  await controlTermination(page, "release", "write"); await expect(page.getByTestId("support-history-error")).toBeVisible();
  await controlTermination(page, "set", "holdRead", false); await controlTermination(page, "release", "read");
  await expect(page.locator("article")).toHaveCount(0); expect(await posts(page)).toHaveLength(1);
  await controlTermination(page, "set", "holdActionHeaders", false); await controlTermination(page, "set", "actionFailure", 0);
  await verify(page, en); await history(page); expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
});
test("UI actual network rejection is unknown without implying a POST timeout", async ({ page }) => {
  const fixture = await openTermination(page, { locale: "en", consent: "withdrawn" }); await history(page);
  await controlTermination(page, "set", "actionNetwork", true);
  await actionButton(caseArticle(page), en, "withdraw_authorization").click();
  await expect(page.locator("main")).toContainText(en.supportFlow.portal.terminationUnknown);
  await controlTermination(page, "set", "actionNetwork", false); await reload(page, en); await history(page);
  await expect(actionButton(caseArticle(page), en, "withdraw_authorization")).toBeDisabled();
  expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
});
for (const source of ["create", "continue", "feedback"] as const) {
  test(`UI local ${source} transport 403 hides historical body and only read-only recovery restores it`, async ({ page }) => {
    const fixture = await openTermination(page, { locale: "en", consent: "active" }); await history(page);
    if (source === "continue") {
      await controlTermination(page, "set", "actionFailure", 403);
      await actionButton(caseArticle(page, "assigned"), en, "accept_assignment").click();
    } else {
      await controlTermination(page, "set", "serviceFailure", 403);
      if (source === "create") { await page.locator("form textarea").fill("Synthetic request"); await page.locator("form button[type=submit]").click(); }
      else await caseArticle(page, "closed").getByRole("button", { name: en.supportFlow.portal.feedbackSubmit, exact: true }).click();
    }
    await expect(page.locator("article")).toHaveCount(0);
    await controlTermination(page, "set", "serviceFailure", 0); await controlTermination(page, "set", "actionFailure", 0);
    await verify(page, en); await history(page); expect(await posts(page)).toHaveLength(1); await noEscape(page, fixture);
  });
}

const p01AvailabilityCopy = {
  "zh-CN": {
    not_open: "这项新增支持服务尚未开放。你仍可查看已有事项；如需其他帮助，请使用下方的自我记录、同伴空间或支持转介。",
    ineligible: "当前账号不具备发起这项新增支持的资格。你仍可查看已有事项；如需其他帮助，请使用下方的支持路径。",
    unavailable: "暂时无法核对当前账号能否发起新增支持。请重新读取已有事项后再确认；如需立即帮助，请查看现实支持信息。",
    unknown: "这次提交已发送，但结果无法确认。它可能已经收到；请勿再次提交，先重新读取已有事项。",
    offline: "发送后连接中断，未收到可核验回执。",
    timeout: "等待确认已到时限，仍未收到可核验回执。",
    service: "服务未返回可核验回执。",
  },
  en: {
    not_open: "This service is not open for new requests. You can still view existing cases. For other help, use the self-reflection, Peer Space, or support and referral options below.",
    ineligible: "This account is not eligible to start a new request. You can still view existing cases. For other help, use the support options below.",
    unavailable: "We could not check whether this account can start a new request. Reload your existing cases before deciding what to do next. For immediate help, see the real-world support information.",
    unknown: "The request was sent, but the result could not be confirmed. It may have been received. Do not submit it again; reload your existing cases first.",
    offline: "The connection ended after the request was sent, so no verifiable receipt arrived.",
    timeout: "The confirmation wait ended before a verifiable receipt arrived.",
    service: "The service did not return a verifiable receipt.",
  },
} as const;

for (const [locale, copy] of [["zh-CN", zh], ["en", en]] as const) {
  const expected = p01AvailabilityCopy[locale];
  for (const reason of ["not_open", "ineligible", "unavailable"] as const) {
    test(`P01 merged UI ${locale} adult ${reason} has an explicit reason and next step`, async ({ page }, info) => {
      const fixture = await openTermination(page, { locale, mode: "adult", adultAvailabilityReason: reason });
      await history(page);
      await expect(page.locator("#root > section")).toContainText(expected[reason]);
      await expect(page.getByTestId("support-history-only")).toContainText(expected[reason]);
      await expect(page.getByRole("heading", { name: copy.supportFlow.portal.newTitle, exact: true })).toHaveCount(0);
      if (reason === "unavailable") {
        await expect(page.getByTestId("support-history-only").getByRole("button", { name: copy.supportFlow.portal.historyRetry, exact: true })).toBeEnabled();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `p01-${locale}-${reason}`, info.project.name);
      expect(await posts(page)).toHaveLength(0);
      await noEscape(page, fixture);
    });
  }

  for (const failure of ["offline", "timeout", "nonjson503"] as const) {
    test(`P01 merged UI ${locale} create ${failure} stays unknown and never rePOSTs`, async ({ page }, info) => {
      if (failure === "timeout") await page.clock.install();
      const fixture = await openTermination(page, { locale, mode: "adult", createFailure: failure });
      await history(page);
      const draft = `Synthetic ${failure} request`;
      await page.locator("form textarea").fill(draft);
      await page.locator("form button[type=submit]").click();
      if (failure === "timeout") await page.clock.runFor(10_050);
      const recovery = page.getByTestId("support-create-recovery");
      await expect(recovery).toContainText(expected.unknown);
      await expect(recovery).toContainText(expected[failure === "nonjson503" ? "service" : failure]);
      await expect(recovery).not.toContainText(/not saved|未保存/i);
      await expect(page.locator("form textarea")).toHaveValue(draft);
      await expect(page.locator("form button[type=submit]")).toBeDisabled();
      expect(await posts(page)).toHaveLength(1);
      await controlTermination(page, "set", "createFailure", undefined);
      await recovery.getByRole("button", { name: copy.supportFlow.portal.historyRetry, exact: true }).click();
      await expect(page.locator("article")).toHaveCount(4);
      await expect(recovery).toBeVisible();
      await recovery.getByTestId("support-create-acknowledge").click();
      await expect(recovery).toHaveCount(0);
      expect(await posts(page)).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `p01-${locale}-create-${failure}`, info.project.name);
      await noEscape(page, fixture);
    });
  }

  for (const status of [401, 403, 429] as const) {
    test(`P01 merged UI ${locale} create ${status} keeps the fixed safe branch`, async ({ page }) => {
      const fixture = await openTermination(page, { locale, mode: "adult", createFailure: status });
      await history(page);
      const draft = `Synthetic ${status} request`;
      await page.locator("form textarea").fill(draft);
      await page.locator("form button[type=submit]").click();
      if (status === 401) {
        await expect(page.locator("article")).toHaveCount(0);
        await expect(page.getByTestId("support-history-error")).toContainText(copy.supportFlow.portal.historyIdentity);
        await controlTermination(page, "set", "createFailure", undefined);
        await verify(page, copy); await history(page);
      } else {
        await expect(page.locator("article")).toHaveCount(3);
        await expect(page.locator("#root")).toContainText(status === 403 ? copy.supportFlow.errors.noAccess : copy.supportFlow.errors.tooMany);
      }
      await expect(page.locator("form textarea")).toHaveValue(draft);
      expect(await posts(page)).toHaveLength(1);
      await noEscape(page, fixture);
    });
  }

  test(`P01 merged UI ${locale} confirmed create survives its refresh failure`, async ({ page }) => {
    const fixture = await openTermination(page, { locale, mode: "adult", postCreateReadFailure: 503 });
    await history(page);
    await page.locator("form textarea").fill("Synthetic confirmed request");
    await page.locator("form button[type=submit]").click();
    await expect(page.locator("#root")).toContainText(copy.supportFlow.portal.submitted);
    await expect(page.getByTestId("support-history-error")).toContainText(copy.supportFlow.errors.unavailable);
    expect(await posts(page)).toHaveLength(1);
    await controlTermination(page, "set", "readFailure", 0);
    await page.getByTestId("support-history-error").getByRole("button", { name: copy.supportFlow.portal.historyRetry, exact: true }).click();
    await expect(page.locator("article")).toHaveCount(4);
    await expect(page.locator("#root")).toContainText(copy.supportFlow.portal.submitted);
    expect(await posts(page)).toHaveLength(1);
    await noEscape(page, fixture);
  });
}
