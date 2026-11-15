import { expect, test } from "@playwright/test";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { isOtpRateLimitError, otpRequestErrorMessage, otpVerificationErrorMessage } from "../lib/emailOtp";

const cases = [
  { id: "REPRO supplier.invalid", error: new Error("SMTP provider failed for original@provider.invalid"), request: "fallback", verify: "fallback" },
  { id: "REPRO structured expiry", error: { status: 403, code: "otp_expired", message: "Private diagnostic only" }, request: "fallback", verify: "invalid" },
  { id: "expired message alone", error: new Error("Token has expired"), request: "fallback", verify: "fallback" },
  { id: "429 status", error: { status: 429, message: "Private diagnostic only" }, request: "rateLimited", verify: "rateLimited" },
  { id: "rate code", error: { code: "over_email_send_rate_limit", message: "Private diagnostic only" }, request: "rateLimited", verify: "rateLimited" },
  { id: "request rate code", error: { code: "over_request_rate_limit" }, request: "rateLimited", verify: "rateLimited" },
  { id: "rate beats expired", error: { status: 429, code: "otp_expired" }, request: "rateLimited", verify: "rateLimited" },
  { id: "service beats expired", error: { status: 503, code: "otp_expired", message: "OTP service invalid" }, request: "service", verify: "service" },
  { id: "retryable service", error: { name: "AuthRetryableFetchError", status: 502, message: "fetch upstream" }, request: "service", verify: "service" },
  { id: "structured unavailable", error: { status: 500, code: "unexpected_failure" }, request: "service", verify: "service" },
  { id: "not authorized code", error: { status: 400, code: "email_address_not_authorized" }, request: "unauthorized", verify: "fallback" },
  { id: "not authorized message alone", error: new Error("Email address not authorized"), request: "fallback", verify: "fallback" },
  { id: "SDK transport", error: { name: "AuthRetryableFetchError", status: 0, message: "Private OTP transport detail" }, request: "network", verify: "network" },
  { id: "Chromium transport", error: new TypeError("Failed to fetch"), request: "network", verify: "network" },
  { id: "WebKit transport", error: new TypeError("Load failed"), request: "network", verify: "network" },
  { id: "Firefox transport", error: new TypeError("NetworkError when attempting to fetch resource."), request: "network", verify: "network" },
  { id: "network text alone", error: new Error("Network failed while checking OTP token"), request: "fallback", verify: "fallback" },
  { id: "unknown invalid credentials", error: { status: 400, code: "invalid_credentials", message: "invalid OTP" }, request: "fallback", verify: "fallback" },
  { id: "unknown status 403", error: { status: 403, message: "invalid token" }, request: "fallback", verify: "fallback" },
  { id: "unknown validation code", error: { status: 422, code: "validation_failed", message: "invalid email OTP" }, request: "fallback", verify: "fallback" },
  { id: "unknown future code", error: { code: "new_provider_error", message: "429 OTP expired network" }, request: "fallback", verify: "fallback" },
  { id: "wrong field types", error: { status: "429", code: 429, message: "429 rate limit OTP" }, request: "fallback", verify: "fallback" },
  { id: "null error", error: null, request: "fallback", verify: "fallback" },
] as const;

for (const [locale, copy] of [["zh-CN", zh.account.errors], ["en", en.account.errors]] as const) {
  for (const item of cases) test(`${locale} classification ${item.id}`, () => {
    const request = { unauthorized: copy.otpUnauthorized, rateLimited: copy.otpRateLimited, network: copy.otpSendNetwork, service: "SAFE_SERVICE_REQUEST", fallback: copy.otpSendFailed };
    const verify = { invalid: copy.otpInvalid, rateLimited: copy.otpVerifyRateLimited, network: copy.otpVerifyNetwork, service: "SAFE_SERVICE_VERIFY", fallback: copy.otpVerifyFailed };
    expect(otpRequestErrorMessage(item.error, request)).toBe(request[item.request]);
    expect(otpVerificationErrorMessage(item.error, verify)).toBe(verify[item.verify]);
    expect(isOtpRateLimitError(item.error)).toBe(item.request === "rateLimited");
  });
}
