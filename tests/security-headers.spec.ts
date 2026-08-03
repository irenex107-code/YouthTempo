import { expect, test } from "@playwright/test";

test("页面和 API 返回试点所需的安全响应头", async ({ request }) => {
  const [page, api] = await Promise.all([
    request.get("/privacy-safety"),
    request.get("/api/account/status"),
  ]);

  expect(page.status()).toBe(200);
  expect(api.status()).toBe(401);

  for (const response of [page, api]) {
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  }
});
