import { expect, test, type Page } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { syntheticInlineConsent, draftCanary } from "./fixtures/synthetic-inline-consent";

const roomId = "00000000-0000-4000-8000-000000000081";
const messageBody = "Synthetic private peer message from the first account.";
async function peerFixture(page: Page, baseURL: string, options: { active?: boolean; invited?: boolean; rulesAccepted?: boolean } = {}) {
  const fixture = await syntheticInlineConsent(page, baseURL, { ageBand: "18_plus", consentState: options.active ? "active" : "not_started" });
  const firstActor = fixture.state.user.id;
  const peer = {
    invited: options.invited !== false, rulesAccepted: options.rulesAccepted === true,
    accessReads: 0, roomReads: 0, messageReads: 0,
    messageGate: null as Promise<void> | null, postGate: null as Promise<void> | null,
    rulePosts: [] as Record<string, unknown>[], messagePosts: [] as { actor: string; body: string }[],
    unexpected: [] as string[],
  };
  await page.route("**/api/peer-space/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/peer-space/access") {
      peer.accessReads += 1;
      return route.fulfill({ json: peer.invited && fixture.state.user.id === firstActor
        ? { available: true, rulesAccepted: peer.rulesAccepted, rulesVersion: "synthetic-room-v1" } : { available: false } });
    }
    if (url.pathname === "/api/peer-space/rules" && method === "POST") {
      const body = route.request().postDataJSON();
      peer.rulePosts.push(body);
      expect(body).toMatchObject({ accepted: true, rulesVersion: "synthetic-room-v1" });
      peer.rulesAccepted = true;
      return route.fulfill({ json: { saved: true } });
    }
    if (url.pathname === "/api/peer-space/rooms" && method === "GET") {
      peer.roomReads += 1;
      return route.fulfill({ json: { rulesAccepted: true, rooms: [{ id: roomId, code: "synthetic-room", title: "Synthetic room",
        description: "Synthetic room description", guidelines: "Synthetic room rules", status: "staffed_open", joined: true,
      }] } });
    }
    if (url.pathname === "/api/peer-space/messages") {
      if (method === "GET") {
        peer.messageReads += 1;
        if (peer.messageGate) await peer.messageGate;
        return route.fulfill({ json: { roomStatus: "staffed_open", messages: [{
          id: "00000000-0000-4000-8000-000000000082", body: messageBody, authorLabel: "Synthetic peer",
          own: false, status: "visible", createdAt: "2026-10-01T00:00:00Z",
        }] } });
      }
      if (method === "POST") {
        const body = route.request().postDataJSON();
        const encoded = route.request().headers().authorization?.split(".")[1];
        const actor = encoded ? (JSON.parse(Buffer.from(encoded, "base64url").toString()).sub as string) : "missing";
        peer.messagePosts.push({ actor, body: body.body });
        if (peer.postGate) await peer.postGate;
        return route.fulfill({ json: { safetyNotice: false, reviewPending: false } });
      }
    }
    if (url.pathname === "/api/peer-space/controls" && method === "GET") return route.fulfill({ json: { controls: [] } });
    peer.unexpected.push(`${method} ${url.pathname}`);
    return route.abort();
  });
  return { ...fixture, peer, firstActor };
}

for (const [prefix, copy] of [["", zh], ["/en", en]] as const) {
  test(`${prefix || "zh"} 解忧室原页完成基础确认，房间规则仍独立且不自动发送`, async ({ page, baseURL }) => {
    const { state, peer } = await peerFixture(page, baseURL!);
    await page.goto(`${prefix}/peer-space`);
    const panel = page.getByTestId("inline-student-consent");
    const age = panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true });
    await expect(age).toBeVisible();
    expect(peer.accessReads).toBe(0);
    await age.selectOption("18_plus");
    await panel.getByRole("checkbox", { name: copy.account.consent.acknowledgement, exact: true }).check();
    await panel.getByRole("button", { name: copy.account.consent.completeStudent, exact: true }).click();
    const rules = page.getByRole("checkbox", { name: copy.peerSpace.rules.confirmation, exact: true });
    await expect(rules).toBeVisible();
    await expect(rules).not.toBeChecked();
    expect(peer.rulePosts).toEqual([]);
    expect(peer.roomReads).toBe(0);
    await rules.check();
    await page.getByRole("button", { name: copy.peerSpace.rules.enterAction, exact: true }).click();
    const composer = page.getByRole("textbox", { name: copy.peerSpace.room.composer.label, exact: true });
    await expect(composer).toBeVisible();
    await composer.fill(draftCanary);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(panel.getByRole("status")).toBeVisible();
    await expect(composer).toHaveValue(draftCanary);
    await expect(page).toHaveURL(new RegExp(`${prefix}/peer-space$`));
    expect(state.consentPosts).toEqual([{ action: "student_assent", ageBand: "18_plus" }]);
    expect(peer.rulePosts).toHaveLength(1);
    expect(peer.messagePosts).toEqual([]);
    expect(state.aiCalls).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
    expect(state.unexpectedApi).toEqual([]);
    expect(peer.unexpected).toEqual([]);
  });

  test(`${prefix || "zh"} 有效基础确认不代替解忧室邀请或开放资格`, async ({ page, baseURL }) => {
    const { state, peer } = await peerFixture(page, baseURL!, { active: true, invited: false });
    await page.goto(`${prefix}/peer-space`);
    await expect(page.getByRole("heading", { name: copy.peerSpace.unavailable.title, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: copy.peerSpaceLive.account, exact: true })).toHaveAttribute("href", `${prefix}/account?next=/peer-space`);
    expect(peer.roomReads).toBe(0);
    expect(peer.rulePosts).toEqual([]);
    expect(peer.messagePosts).toEqual([]);
    expect(state.consentPosts).toEqual([]);
    expect(state.blockedExternal).toEqual([]);
    expect(state.unexpectedApi).toEqual([]);
    expect(peer.unexpected).toEqual([]);
  });

  test(`${prefix || "zh"} 换号清房间与草稿，迟到的旧读写响应不能回填`, async ({ page, baseURL }) => {
    const { state, peer, changeSession, firstActor } = await peerFixture(page, baseURL!, { active: true, rulesAccepted: true });
    await page.goto(`${prefix}/peer-space`);
    const composer = page.getByRole("textbox", { name: copy.peerSpace.room.composer.label, exact: true });
    await expect(page.getByText(messageBody, { exact: true })).toBeVisible();
    await composer.fill(draftCanary);
    let releasePost!: () => void;
    let releaseRead!: () => void;
    peer.postGate = new Promise<void>((resolve) => { releasePost = resolve; });
    peer.messageGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    await page.getByRole("button", { name: copy.peerSpace.room.composer.action, exact: true }).click();
    await expect.poll(() => peer.messagePosts.length).toBe(1);
    await expect.poll(() => peer.messageReads).toBeGreaterThan(1);
    await changeSession("second_student");
    const panel = page.getByTestId("inline-student-consent");
    await expect(panel.getByRole("combobox", { name: copy.account.consent.ageRange, exact: true })).toBeVisible();
    releasePost(); releaseRead();
    await expect(page.getByText(messageBody, { exact: true })).toHaveCount(0);
    await expect(composer).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Synthetic room", exact: true })).toHaveCount(0);
    expect(peer.messagePosts).toEqual([{ actor: firstActor, body: draftCanary }]);
    const stores = await page.evaluate(() => Object.values(localStorage).concat(Object.values(sessionStorage)).join(" "));
    expect(stores).not.toContain(draftCanary);
    expect(stores).not.toContain(messageBody);
    await changeSession("signed_out");
    await expect(panel.getByRole("textbox", { name: copy.account.visitor.email, exact: true })).toBeVisible();
    await expect(page.getByText(messageBody, { exact: true })).toHaveCount(0);
    expect(state.blockedExternal).toEqual([]);
    expect(state.unexpectedApi).toEqual([]);
    expect(peer.unexpected).toEqual([]);
  });
}
