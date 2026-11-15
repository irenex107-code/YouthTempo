export const emailOtpLength = 8;

type OtpRequestMessages = {
  unauthorized: string;
  rateLimited: string;
  network: string;
  service?: string;
  fallback: string;
};

type OtpVerificationMessages = {
  invalid: string;
  rateLimited: string;
  network: string;
  service?: string;
  fallback: string;
};

const defaultRequestMessages: OtpRequestMessages = {
  unauthorized: "当前邮箱暂时无法收到登录验证码，请联系平台负责人处理。",
  rateLimited: "验证码请求有些频繁，请稍后再试。",
  network: "网络连接不稳定，请检查网络后重新发送。",
  fallback: "验证码发送失败，请稍后重试。",
};

const defaultVerificationMessages: OtpVerificationMessages = {
  invalid: "验证码不正确或已过期，请重新输入，或重新发送。",
  rateLimited: "验证尝试有些频繁，请稍后再试。",
  network: "网络连接不稳定，请检查网络后重新验证。",
  fallback: "验证码验证失败，请稍后重试。",
};

function errorDetails(error: unknown): { status?: unknown; code?: unknown; name?: unknown; message?: unknown } {
  return error && typeof error === "object" ? error : {};
}

function isServiceError(error: unknown) {
  const { status } = errorDetails(error);
  return typeof status === "number" && status >= 500 && status <= 599;
}

function isNetworkError(error: unknown) {
  const { name, status, message } = errorDetails(error);
  // auth-js 2.70 wraps fetch failures with status 0; 502/503/504 are service failures.
  if (name === "AuthRetryableFetchError" && status === 0) return true;
  return name === "TypeError" && typeof message === "string" && [
    "Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.",
  ].includes(message);
}

export function isOtpRateLimitError(error: unknown) {
  const { status, code } = errorDetails(error);
  if (isServiceError(error)) return false;
  return status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit";
}

export function otpRequestErrorMessage(error: unknown, messages: OtpRequestMessages = defaultRequestMessages) {
  if (isOtpRateLimitError(error)) return messages.rateLimited;
  if (isServiceError(error)) return messages.service || messages.fallback;
  if (errorDetails(error).code === "email_address_not_authorized") {
    return messages.unauthorized;
  }
  if (isNetworkError(error)) return messages.network;
  return messages.fallback;
}

export function otpVerificationErrorMessage(error: unknown, messages: OtpVerificationMessages = defaultVerificationMessages) {
  if (isOtpRateLimitError(error)) return messages.rateLimited;
  if (isServiceError(error)) return messages.service || messages.fallback;
  if (errorDetails(error).code === "otp_expired") {
    return messages.invalid;
  }
  if (isNetworkError(error)) return messages.network;
  return messages.fallback;
}
