const { api, getSession } = require("../../utils/api");

Page({
  data: { loading: true, records: [], deletingId: "", message: "", isError: false },
  onShow() { if (!getSession()) return wx.redirectTo({ url: "/pages/login/index" }); this.loadRecords(); },
  onPullDownRefresh() { this.loadRecords().finally(() => wx.stopPullDownRefresh()); },
  async loadRecords() {
    this.setData({ loading: true, message: "" });
    try {
      const data = await api("/api/mini/records", { retryAuthentication: false });
      const records = (data.records || []).map((record) => ({ ...record, dateLabel: new Date(record.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
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
    const actor = getSession()?.user?.id;
    try {
      const target = this.data.records.find((record) => record.id === recordId);
      if (!target) throw new Error("这条记录已变化，请刷新后再试。");
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(target.created_at));
      const part = (kind) => parts.find((value) => value.type === kind).value;
      const targetDay = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
      const scope = await api(`/api/sweet-records?targetDay=${encodeURIComponent(targetDay)}`, { retryAuthentication: false });
      if (getSession()?.user?.id !== actor) return;
      await api("/api/mini/records", { method: "DELETE", retryAuthentication: false, data: { recordId, operationDay: scope.operationDay,
        targetDay: scope.targetDay, expectedHead: scope.headToken } });
      if (getSession()?.user?.id !== actor) return;
      // A cutoff may also remove older snapshots; show a fresh server result.
      await this.loadRecords(); this.setData({ message: "这条记录已删除。" });
    }
    catch (error) { this.setData({ message: error.message, isError: true }); }
    finally { this.setData({ deletingId: "" }); }
  },
});
