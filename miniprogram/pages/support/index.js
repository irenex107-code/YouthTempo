const { config } = require("../../utils/api");

Page({
  callEmergency() { wx.makePhoneCall({ phoneNumber: "120" }); },
  callPolice() { wx.makePhoneCall({ phoneNumber: "110" }); },
  copySupportLink() { wx.setClipboardData({ data: `${config.apiBaseUrl}/referral`, success: () => wx.showToast({ title: "地址已复制", icon: "success" }) }); },
});
