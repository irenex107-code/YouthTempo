import { expect, type Page } from "@playwright/test";
import { syntheticInlineTools } from "./synthetic-inline-tools";

type Method = "GET" | "POST";
type Actor = "A" | "B";
type Reply = { status?: number; eligible?: boolean; urgent?: boolean };
type Gate = {
  method: Method;
  actor: Actor;
  reply: Reply;
  held: boolean;
  settled: boolean;
  release: () => void;
  wait: Promise<void>;
};

/** Only synthetic browser traffic. Never sends Auth, database, mail or AI requests. */
export async function syntheticMicroFeedbackActor(page: Page, baseURL: string) {
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  const base = await syntheticInlineTools(page, baseURL, { consentState: "active" });
  const users = {
    A: structuredClone(base.state.user),
    B: { ...structuredClone(base.state.user), id: "00000000-0000-4000-8000-000000000072",
      email: "inline-072@example.invalid", user_metadata: { display_name: "Second inline account" } },
  };
  const ids = { A: users.A.id, B: users.B.id };
  let tokenVersion = 0;
  const requests: Array<{ method: Method; actor: string; token: string; body: Record<string, unknown> | null }> = [];
  const gates: Gate[] = [];

  await page.addInitScript(() => {
    const runtime = window as typeof window & { microFeedbackParsed: number };
    runtime.microFeedbackParsed = 0;
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === "/api/pilot-experience") {
        const json = response.json.bind(response);
        response.json = async () => {
          try { return await json(); }
          finally { runtime.microFeedbackParsed++; }
        };
      }
      return response;
    };
  });

  await page.route("**/api/pilot-experience*", async (route) => {
    const request = route.request();
    const method = request.method() as Method;
    expect(["GET", "POST"]).toContain(method);
    const token = request.headers().authorization?.replace(/^Bearer\s+/i, "") || "";
    const actor = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
    expect([ids.A, ids.B]).toContain(actor);
    requests.push({ method, actor, token, body: method === "POST" ? request.postDataJSON() as Record<string, unknown> : null });
    const gate = gates.find((item) => !item.held && item.method === method && ids[item.actor] === actor);
    if (gate) { gate.held = true; await gate.wait; }
    const reply = gate?.reply || {};
    try {
      await route.fulfill({ status: reply.status || 200, json: reply.status && reply.status >= 400
        ? { error: "Synthetic feedback service unavailable" }
        : method === "GET" ? { eligible: reply.eligible !== false } : { saved: true, urgent: reply.urgent === true } });
    } finally { if (gate) gate.settled = true; }
  });

  function hold(method: Method, actor: Actor, reply: Reply = {}) {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const gate = { method, actor, reply, held: false, settled: false, release, wait };
    gates.push(gate);
    return gate;
  }

  async function changeActor(actor: Actor | "signed_out", broadcast = true, event = "SIGNED_IN") {
    if (actor !== "signed_out") {
      base.state.user = structuredClone(users[actor]);
      base.state.consentOwner = ids[actor];
      base.state.consentState = "active";
    }
    base.state.signedIn = actor !== "signed_out";
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: base.state.user.id, exp: expiresAt, role: "authenticated" })).toString("base64url");
    const session = actor === "signed_out" ? null : {
      access_token: `${header}.${payload}.synthetic-micro-${++tokenVersion}`, refresh_token: "synthetic-micro-refresh",
      token_type: "bearer", expires_at: expiresAt, expires_in: 3600, user: base.state.user,
    };
    await page.evaluate(({ key, session, broadcast, event }) => {
      if (session) localStorage.setItem(key, JSON.stringify(session));
      else localStorage.removeItem(key);
      if (broadcast) {
        const channel = new BroadcastChannel(key);
        channel.postMessage({ event: session ? event : "SIGNED_OUT", session });
        channel.close();
      }
    }, { key: base.storageKey, session, broadcast, event });
    return session?.access_token || "";
  }

  async function parsedCount() {
    return page.evaluate(() => (window as typeof window & { microFeedbackParsed: number }).microFeedbackParsed);
  }

  async function releaseAndSettle(gate: Gate) {
    const before = await parsedCount();
    gate.release();
    await expect.poll(() => gate.settled).toBe(true);
    await page.waitForFunction((count) => (window as typeof window & { microFeedbackParsed: number }).microFeedbackParsed > count, before);
    // Drain the response continuation and React work, following the existing AI draft harness.
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0)));
  }

  return { ...base, ids, requests, hold, changeActor, releaseAndSettle,
    releaseAll: () => gates.forEach((gate) => gate.release()) };
}
