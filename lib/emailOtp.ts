export const emailOtpLength = 8;

function errorText(error: unknown) {
  return error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
}

function isNetworkError(message: string) {
  return message.includes("fetch") || message.includes("network") || message.includes("网络");
}

function isRateLimitError(message: string) {
  return message.includes("429") || message.includes("rate limit") || message.includes("too many") || message.includes("频繁");
}

export function otpRequestErrorMessage(error: unknown) {
  const message = errorText(error);
  if (message.includes("not authorized") || message.includes("unauthorized email")) {
    return "当前邮箱暂时无法收到登录验证码，请联系平台负责人处理。";
  }
  if (isRateLimitError(message)) return "验证码请求有些频繁，请稍后再试。";
  if (isNetworkError(message)) return "网络连接不稳定，请检查网络后重新发送。";
  return "验证码发送失败，请稍后重试。";
}

export function otpVerificationErrorMessage(error: unknown) {
  const message = errorText(error);
  if (
    message.includes("token")
    || message.includes("otp")
    || message.includes("invalid")
    || message.includes("expired")
    || message.includes("验证码")
  ) {
    return "验证码不正确或已过期，请重新输入，或重新发送。";
  }
  if (isRateLimitError(message)) return "验证尝试有些频繁，请稍后再试。";
  if (isNetworkError(message)) return "网络连接不稳定，请检查网络后重新验证。";
  return "验证码验证失败，请稍后重试。";
}
