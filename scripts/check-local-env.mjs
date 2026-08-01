const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_PERMISSION_TEST_PASSWORD",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(`缺少本机环境变量：${missing.join("、")}`);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.trim();
const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
const testPassword = process.env.E2E_PERMISSION_TEST_PASSWORD;

let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL 不是有效网址。");
}

if (parsedUrl.protocol !== "https:") {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL 必须使用 https://。");
}

if (serverKey.startsWith("sb_publishable_") || serverKey.startsWith("eyJ") === false && !serverKey.startsWith("sb_secret_")) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY 必须是 sb_secret_ 密钥或旧版 service_role JWT，不能使用 publishable key。");
}

if (serverKey.startsWith("eyJ")) {
  const parts = serverKey.split(".");
  if (parts.length !== 3) throw new Error("旧版 SUPABASE_SERVICE_ROLE_KEY 的 JWT 格式不正确。");
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (payload.role !== "service_role") {
      throw new Error("旧版 SUPABASE_SERVICE_ROLE_KEY 不是 service_role 角色。");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("service_role")) throw error;
    throw new Error("无法验证旧版 SUPABASE_SERVICE_ROLE_KEY。");
  }
}

if (testPassword.length < 16) {
  throw new Error("E2E_PERMISSION_TEST_PASSWORD 至少需要 16 个字符。");
}

if (/your_|replace|password|123456|youthtempo/i.test(testPassword)) {
  throw new Error("E2E_PERMISSION_TEST_PASSWORD 看起来像示例或弱密码，请换成随机值。");
}

console.log("本机 Supabase 配置检查通过：URL、服务端密钥和虚拟测试密码均已配置。");
console.log("检查过程未输出任何密钥值。");
