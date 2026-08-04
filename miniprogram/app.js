const { getSession, refreshSession } = require("./utils/api");

App({
  globalData: { session: null, profile: null },
  async onLaunch() {
    const session = getSession();
    if (!session) return;
    this.globalData.session = await refreshSession(session).catch(() => null);
    if (!this.globalData.session) wx.removeStorageSync("yt_session");
  },
});
