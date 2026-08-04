const { getSession, sendOtp, verifyOtp } = require("../../utils/api");

Page({
  data: { email: "", token: "", codeSent: false, sending: false, verifying: false, countdown: 0, message: "", isError: false },
  onShow() { if (getSession()) wx.switchTab({ url: "/pages/home/index" }); },
  setEmail(event) { this.setData({ email: event.detail.value.trim(), message: "" }); },
  setToken(event) { this.setData({ token: event.detail.value.replace(/\D/g, "").slice(0, 8), message: "" }); },
  async sendCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.data.email)) return this.setData({ message: "请先填写正确的邮箱。", isError: true });
    this.setData({ sending: true, message: "", isError: false });
    try {
      await sendOtp(this.data.email.toLowerCase());
      this.setData({ codeSent: true, countdown: 60, message: "验证码已发送，请查看收件箱。" });
      this.timer = setInterval(() => {
        const countdown = this.data.countdown - 1;
        this.setData({ countdown });
        if (countdown <= 0) clearInterval(this.timer);
      }, 1000);
    } catch (error) { this.setData({ message: error.message, isError: true }); }
    finally { this.setData({ sending: false }); }
  },
  async verifyCode() {
    this.setData({ verifying: true, message: "", isError: false });
    try { await verifyOtp(this.data.email.toLowerCase(), this.data.token); wx.switchTab({ url: "/pages/home/index" }); }
    catch (error) { this.setData({ message: "验证码不正确或已过期，请重新获取。", isError: true }); }
    finally { this.setData({ verifying: false }); }
  },
  onUnload() { if (this.timer) clearInterval(this.timer); },
});
