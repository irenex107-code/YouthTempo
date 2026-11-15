import { expect, type Page } from "@playwright/test";
import { syntheticInlineConsent } from "./synthetic-inline-consent";

export const feedbackA = "Synthetic private feedback from account A";
export const feedbackB = "Synthetic private feedback from account B";

export function feedbackRow(text: string) {
  return { id: "synthetic-feedback", role: "student", form_version: "2026-08", overall_experience: 5,
    clarity: 4, safety: 5, most_helpful: text, hard_to_use: "", suggestion: "", may_contact: false,
    created_at: "2026-10-29T01:00:00Z", updated_at: "2026-10-29T01:00:00Z" };
}

/** Browser Auth/API traffic is intercepted. No live Auth, database or mail calls. */
export async function syntheticFeedbackActor(page: Page, baseURL: string, hold?: "GET" | "POST") {
  expect(new URL(baseURL).hostname).toBe("127.0.0.1");
  const fixture = await syntheticInlineConsent(page, baseURL, { consentState: "active" });
  const firstId = fixture.state.user.id;
  const requests: Array<{ method: string; token: string; actor: string; body: Record<string, unknown> | null }> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = false;
  let settled = false;
  await page.route("**/api/pilot-feedback", async (route) => {
    const request = route.request();
    const token = request.headers().authorization?.replace(/^Bearer\s+/i, "") || "";
    const actor = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
    const method = request.method();
    const body = method === "POST" ? request.postDataJSON() as Record<string, unknown> : null;
    requests.push({ method, token, actor, body });
    const shouldHold = actor === firstId && method === hold && !held;
    if (shouldHold) { held = true; await gate; }
    try {
      await route.fulfill({ json: { role: "student", feedback: feedbackRow(method === "POST"
        ? String(body?.mostHelpful || "") : actor === firstId ? feedbackA : feedbackB) } });
    } finally { if (shouldHold) settled = true; }
  });
  return { ...fixture, firstId, requests, release, held: () => held, settled: () => settled };
}
