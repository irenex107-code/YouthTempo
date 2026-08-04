const { api, getSession, signOut } = require("../../utils/api");

Page({
  data: {
    loading: true, saving: false, profile: null, ready: false, displayName: "", agreed: false,
    ageIndex: 0, ageOptions: [{ label: "14–17 岁", value: "14_17" }, { label: "已满 18 岁", value: "18_plus" }], message: "", isError: false,
  },
  onShow() { if (!getSession()) return wx.redirectTo({ url: "/pages/login/index" }); this.loadProfile(); },
  async loadProfile() {
    this.setData({ loading: true, message: "" });
    try { const data = await api("/api/mini/profile"); this.setData({ profile: data.profile, ready: data.ready, displayName: data.profile?.display_name || "" }); }
    catch (error) { this.setData({ message: error.message, isError: true }); }
    finally { this.setData({ loading: false }); }
  },
  setName(event) { this.setData({ displayName: event.detail.value.trim() }); },
  setAge(event) { this.setData({ ageIndex: Number(event.detail.value) }); },
  toggleAgreement() { this.setData({ agreed: !this.data.agreed }); },
  async completeProfile() {
    this.setData({ saving: true, message: "", isError: false });
    try {
      const data = await api("/api/mini/profile", { method: "POST", data: { displayName: this.data.displayName, ageBand: this.data.ageOptions[this.data.ageIndex].value } });
      this.setData({ profile: data.profile, ready: data.ready, message: data.ready ? "确认完成，可以开始记录。" : "个人确认已保存，下一步等待监护人确认。" });
    } catch (error) { this.setData({ message: error.message, isError: true }); }
    finally { this.setData({ saving: false }); }
  },
  openSweet() { wx.switchTab({ url: "/pages/sweet/index" }); },
  openHistory() { wx.switchTab({ url: "/pages/history/index" }); },
  openSupport() { wx.switchTab({ url: "/pages/support/index" }); },
  logout() { signOut(); wx.redirectTo({ url: "/pages/login/index" }); },
});
