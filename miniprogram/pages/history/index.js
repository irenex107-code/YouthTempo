const { api, getSession } = require("../../utils/api");

Page({
  data: { loading: true, records: [], deletingId: "", message: "", isError: false },
  onShow() { if (!getSession()) return wx.redirectTo({ url: "/pages/login/index" }); this.loadRecords(); },
  onPullDownRefresh() { this.loadRecords().finally(() => wx.stopPullDownRefresh()); },
  async loadRecords() {
    this.setData({ loading: true, message: "" });
    try {
      const data = await api("/api/mini/records");
      const records = (data.records || []).map((record) => ({ ...record, dateLabel: new Date(record.created_at).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
      this.setData({ records });
    } catch (error) { this.setData({ message: error.message, isError: true }); }
    finally { this.setData({ loading: false }); }
  },
  confirmDelete(event) {
    const recordId = event.currentTarget.dataset.id;
    wx.showModal({ title: "删除这条记录？", content: "删除后无法恢复。", confirmText: "确认删除", confirmColor: "#8a4634", success: (result) => { if (result.confirm) this.deleteRecord(recordId); } });
  },
  async deleteRecord(recordId) {
    this.setData({ deletingId: recordId, message: "", isError: false });
    try { await api("/api/mini/records", { method: "DELETE", data: { recordId } }); this.setData({ records: this.data.records.filter((record) => record.id !== recordId), message: "这条记录已删除。" }); }
    catch (error) { this.setData({ message: error.message, isError: true }); }
    finally { this.setData({ deletingId: "" }); }
  },
});
