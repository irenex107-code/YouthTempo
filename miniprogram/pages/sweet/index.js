const { api, getSession } = require("../../utils/api");
const AI_NOTICE_VERSION = "ai-notice-2026-08-18-v2";

const steps = [
  { id: "sleep", title: "睡眠", label: "Sleep", question: "昨晚整体睡得怎么样？", options: ["睡得很好", "比较好", "一般", "不太好", "很不好"] },
  { id: "wake", title: "醒来", label: "Wake", question: "今天醒来后的精力怎么样？", options: ["很有精神", "比较有精神", "一般", "有点疲惫", "很疲惫"] },
  { id: "eat", title: "饮食", label: "Eat", question: "今天吃饭的节奏怎么样？", options: ["很规律", "比较规律", "一般", "不太规律", "很不规律"] },
  { id: "exercise", title: "运动", label: "Exercise", question: "今天一共活动了多久？", options: ["0 分钟", "1–9 分钟", "10–19 分钟", "20–29 分钟", "30 分钟以上", "不太确定"] },
  { id: "task", title: "任务投入", label: "Task", question: "今天投入学习或生活任务顺利吗？", options: ["很顺利", "比较顺利", "一般", "不太顺利", "很不顺利"] },
];

function recordPayload(answers) {
  return steps.map((step) => ({ id: step.id, title: step.title, label: step.label, fields: [{ id: "state", title: step.question, value: answers[step.id] || "" }] }));
}

Page({
  data: { steps, answers: {}, completed: 0, consentAccepted: false, submitting: false, result: null, message: "", isError: false },
  onShow() {
    const actor = getSession()?.user?.id;
    if (!actor) return wx.redirectTo({ url: "/pages/login/index" });
    if (this._actor && this._actor !== actor) this.reset();
    this._actor = actor; this._disposed = false;
  },
  onHide() { this._disposed = true; this._revision = (this._revision || 0) + 1; this._operation = (this._operation || 0) + 1; this.setData({ submitting: false }); },
  onUnload() { this._disposed = true; this._revision = (this._revision || 0) + 1; this._operation = (this._operation || 0) + 1; },
  selectAnswer(event) {
    this._revision = (this._revision || 0) + 1;
    this._pendingWrite = null;
    const answers = { ...this.data.answers, [event.currentTarget.dataset.step]: event.currentTarget.dataset.value };
    this.setData({ answers, completed: Object.keys(answers).length, result: null, message: "" });
  },
  toggleConsent() { this._revision = (this._revision || 0) + 1; this.setData({ consentAccepted: !this.data.consentAccepted, result: null }); },
  async generateAndSave() {
    if (this.data.submitting) return;
    const actor = getSession()?.user?.id;
    if (!actor || !this.data.consentAccepted) return;
    const revision = this._revision || 0;
    const operation = this._operation = (this._operation || 0) + 1;
    const current = () => !this._disposed && this._operation === operation && getSession()?.user?.id === actor && (this._revision || 0) === revision && this.data.consentAccepted;
    this.setData({ submitting: true, message: "", isError: false, result: null });
    const records = recordPayload(this.data.answers);
    const recordsKey = JSON.stringify(records);
    let write = this._pendingWrite;
    try {
      if (!write || write.actor !== actor || write.recordsKey !== recordsKey) {
        const scope = await api("/api/sweet-records", { retryAuthentication: false });
        if (!current()) return;
        const result = await api("/api/ai/check-in", { method: "POST", retryAuthentication: false, data: { currentDate: new Date().toISOString(), sensitiveConsentAccepted: true, aiNoticeAccepted: true, aiNoticeVersion: AI_NOTICE_VERSION, records } });
        if (!current()) return;
        write = { actor, recordsKey, scope, result, record: { records, summary: result.summary, smallStep: result.smallStep, recommendedNextTool: result.recommendedNextTool } };
        // A failed/unknown dispatch is retried only with this original head
        // and payload. A real edit/reset is the explicit new-operation boundary.
        this._pendingWrite = write;
      }
      await api("/api/mini/records", { method: "POST", retryAuthentication: false, data: {
        operationDay: write.scope.operationDay, targetDay: write.scope.targetDay, expectedHead: write.scope.headToken,
        intent: "replace_summary", record: write.record,
      } });
      if (this._pendingWrite === write) this._pendingWrite = null;
      if (!current()) return;
      this.setData({ result: write.result, message: "已经保存到你的历史记录。" });
    } catch (error) { if (current()) this.setData({ message: error.message, isError: true }); }
    finally { if (!this._disposed && this._operation === operation && getSession()?.user?.id === actor) this.setData({ submitting: false }); }
  },
  reset() { this._revision = (this._revision || 0) + 1; this._operation = (this._operation || 0) + 1; this._pendingWrite = null; this.setData({ answers: {}, completed: 0, consentAccepted: false, submitting: false, result: null, message: "" }); wx.pageScrollTo({ scrollTop: 0, duration: 250 }); },
});
