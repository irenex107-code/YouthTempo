import { expect, test } from "@playwright/test";

const expiredToken = [
  { alg: "HS256", typ: "JWT" },
  { sub: "synthetic-user", exp: 1 },
].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".synthetic-signature";

for (const token of ["invalid-synthetic-token", expiredToken]) {
  test(`失效 token 返回未登录，不触发账户或支持接口的 5xx (${token === expiredToken ? "expired" : "malformed"})`, async ({ request }) => {
    const headers = { Authorization: `Bearer ${token}` };
    for (const path of ["/api/account/data", "/api/support/cases"]) {
      const response = await request.get(path, { headers });
      expect(response.status(), path).toBe(401);
      const payload = await response.json();
      expect(payload.error).toEqual(expect.any(String));
      expect(JSON.stringify(payload)).not.toContain(token);
    }
  });
}
