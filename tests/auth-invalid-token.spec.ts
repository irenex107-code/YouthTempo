import { expect, test } from "@playwright/test";

test("失效 token 返回未登录，不触发账户或支持接口的 5xx", async ({ request }) => {
  const headers = { Authorization: "Bearer invalid-synthetic-token" };
  for (const path of ["/api/account/data", "/api/support/cases"]) {
    const response = await request.get(path, { headers });
    expect(response.status(), path).toBe(401);
    const payload = await response.json();
    expect(payload.error).toEqual(expect.any(String));
    expect(JSON.stringify(payload)).not.toContain("invalid-synthetic-token");
  }
});
