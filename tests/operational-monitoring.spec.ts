import { expect, test } from "@playwright/test";

test("监控接口只接受固定的脱敏错误事件", async ({ request }) => {
  const accepted = await request.post("/api/monitoring/client-error", {
    data: {
      area: "auth",
      operation: "auth_otp_send",
      failureKind: "network",
    },
  });
  expect(accepted.status()).toBe(202);
  await expect(accepted.json()).resolves.toEqual({ accepted: true });

  const rejected = await request.post("/api/monitoring/client-error", {
    data: {
      area: "auth",
      operation: "auth_otp_send",
      failureKind: "network",
      email: "must-not-be-accepted@example.com",
      message: "raw error content must not be accepted",
    },
  });
  expect(rejected.status()).toBe(400);
});

test("监控接口拒绝非 POST 请求", async ({ request }) => {
  const response = await request.get("/api/monitoring/client-error");
  expect(response.status()).toBe(405);
  expect(response.headers().allow).toBe("POST");
});
