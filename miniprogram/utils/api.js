const config = require("../config");

function request({ url, method = "GET", data, headers = {} }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header: { "content-type": "application/json", ...headers },
      timeout: 15000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(new Error(response.data?.error_description || response.data?.msg || response.data?.error || "请求没有成功，请稍后再试。"));
      },
      fail: () => reject(new Error("网络连接不稳定，请稍后再试。")),
    });
  });
}

function assertPublicConfig() {
  if (!config.supabasePublishableKey || /service_role|sb_secret_/i.test(config.supabasePublishableKey)) {
    throw new Error("小程序登录尚未完成安全配置。请联系 YouthTempo 负责人。");
  }
}

function getSession() { return wx.getStorageSync("yt_session") || null; }
function saveSession(session) { wx.setStorageSync("yt_session", session); getApp().globalData.session = session; }

async function sendOtp(email) {
  assertPublicConfig();
  return request({
    url: `${config.supabaseUrl}/auth/v1/otp`,
    method: "POST",
    headers: { apikey: config.supabasePublishableKey },
    data: { email, create_user: true },
  });
}

async function verifyOtp(email, token) {
  assertPublicConfig();
  const session = await request({
    url: `${config.supabaseUrl}/auth/v1/verify`,
    method: "POST",
    headers: { apikey: config.supabasePublishableKey },
    data: { email, token, type: "email" },
  });
  saveSession(session);
  return session;
}

async function refreshSession(session = getSession()) {
  if (!session?.refresh_token) return null;
  assertPublicConfig();
  const next = await request({
    url: `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
    method: "POST",
    headers: { apikey: config.supabasePublishableKey },
    data: { refresh_token: session.refresh_token },
  });
  saveSession(next);
  return next;
}

async function api(path, options = {}) {
  let session = getSession();
  if (!session?.access_token) throw new Error("请先登录。");
  try {
    return await request({ ...options, url: `${config.apiBaseUrl}${path}`, headers: { authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) } });
  } catch (error) {
    if (!/jwt|token|登录/i.test(error.message)) throw error;
    session = await refreshSession(session);
    return request({ ...options, url: `${config.apiBaseUrl}${path}`, headers: { authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) } });
  }
}

function signOut() { wx.removeStorageSync("yt_session"); getApp().globalData.session = null; }

module.exports = { api, getSession, refreshSession, sendOtp, signOut, verifyOtp, config };
