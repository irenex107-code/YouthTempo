type WechatSessionResponse = {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
};

type WechatAccessTokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

function getWechatConfig() {
  const appId = process.env.WECHAT_MINI_APP_ID || "";
  const appSecret = process.env.WECHAT_MINI_APP_SECRET || "";
  return { appId, appSecret, configured: Boolean(appId && appSecret) };
}

export function isWechatConfigured() {
  return getWechatConfig().configured;
}

export async function exchangeWechatCode(code: string) {
  const { appId, appSecret, configured } = getWechatConfig();
  if (!configured) throw new Error("WeChat Mini Program credentials are not configured.");

  const params = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    js_code: code,
    grant_type: "authorization_code",
  });
  const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`);
  const data = (await response.json()) as WechatSessionResponse;
  if (!response.ok || data.errcode || !data.openid) {
    throw new Error(data.errmsg || "WeChat code exchange failed.");
  }
  return { openid: data.openid, unionid: data.unionid || null };
}

async function getWechatAccessToken() {
  const { appId, appSecret, configured } = getWechatConfig();
  if (!configured) throw new Error("WeChat Mini Program credentials are not configured.");

  const params = new URLSearchParams({
    grant_type: "client_credential",
    appid: appId,
    secret: appSecret,
  });
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`);
  const data = (await response.json()) as WechatAccessTokenResponse;
  if (!response.ok || data.errcode || !data.access_token) {
    throw new Error(data.errmsg || "WeChat access token request failed.");
  }
  return data.access_token;
}

export async function createWechatMiniCode(scene: string) {
  const accessToken = await getWechatAccessToken();
  const page = process.env.WECHAT_MINI_BIND_PAGE || "pages/index/index";
  const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${accessToken}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scene,
      page,
      width: 430,
      check_path: false,
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as { errcode?: number; errmsg?: string };
    throw new Error(data.errmsg || "WeChat mini code generation failed.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
