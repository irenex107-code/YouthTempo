import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { otpRequestErrorMessage, otpVerificationErrorMessage } from "../lib/emailOtp";

for (const [locale, copy] of [["zh-CN", zh.account.errors], ["en", en.account.errors]] as const) {
  test(`${locale} Chromium与WebKit断网均返回固定网络提示，其他供应商错误仍安全回退`, () => {
    const request = { unauthorized: copy.otpUnauthorized, rateLimited: copy.otpRateLimited, network: copy.otpSendNetwork, fallback: copy.otpSendFailed };
    const verify = { invalid: copy.otpInvalid, rateLimited: copy.otpVerifyRateLimited, network: copy.otpVerifyNetwork, fallback: copy.otpVerifyFailed };
    for (const error of [new TypeError("Failed to fetch"), new TypeError("Load failed"), { name: "AuthRetryableFetchError", status: 0, message: "Load failed" }]) {
      expect(otpRequestErrorMessage(error, request)).toBe(copy.otpSendNetwork);
      expect(otpVerificationErrorMessage(error, verify)).toBe(copy.otpVerifyNetwork);
    }
    const internal = new Error("SMTP provider load failed for private-user@example.test");
    expect(otpRequestErrorMessage(internal, request)).toBe(copy.otpSendFailed);
    expect(otpVerificationErrorMessage(internal, verify)).toBe(copy.otpVerifyFailed);
    expect(otpRequestErrorMessage({ status: 429, message: "Load failed" }, request)).toBe(copy.otpRateLimited);
    expect(otpVerificationErrorMessage({ status: 429, message: "Load failed" }, verify)).toBe(copy.otpVerifyRateLimited);
  });
}
