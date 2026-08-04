const { api, getSession } = require("../../utils/api");

const steps = [
  { id: "sleep", title: "睡眠", label: "Sleep", question: "昨晚睡得怎么样？", options: ["比较安稳", "还可以", "容易醒", "入睡困难", "睡得很乱"] },
  { id: "wake", title: "醒来", label: "Wake", question: "今天醒来后的状态呢？", options: ["平静", "有精神", "有点疲惫", "紧张或烦躁", "不想开始今天"] },
  { id: "eat", title: "饮食", label: "Eat", question: "今天吃饭的节奏怎么样？", options: ["基本规律", "有一餐不太规律", "时间比较乱", "几乎没有好好吃饭"] },
  { id: "exercise", title: "运动", label: "Exercise", question: "今天大概活动了多久？", options: ["几乎没有活动", "5–10 分钟", "10–20 分钟", "20–30 分钟", "30 分钟以上"] },
  { id: "task", title: "任务投入", label: "Task", question: "今天开始学习、工作或生活任务顺利吗？", options: ["比较顺利", "能完成基本任务", "开始有点困难", "很难开始，或一直拖着"] },
];

function recordPayload(answers) {
  return steps.map((step) => ({ id: step.id, title: step.title, label: step.label, dimension: `${step.label} ${step.title}`, fields: [{ id: "state", title: step.question, value: answers[step.id] || "" }] }));
}

Page({
  data: { steps, answers: {}, completed: 0, consentAccepted: false, submitting: false, result: null, message: "", isError: false },
  onShow() { if (!getSession()) wx.redirectTo({ url: "/pages/login/index" }); },
  selectAnswer(event) {
    const answers = { ...this.data.answers, [event.currentTarget.dataset.step]: event.currentTarget.dataset.value };
    this.setData({ answers, completed: Object.keys(answers).length, result: null, message: "" });
  },
  toggleConsent() { this.setData({ consentAccepted: !this.data.consentAccepted }); },
  async generateAndSave() {
    this.setData({ submitting: true, message: "", isError: false, result: null });
    const records = recordPayload(this.data.answers);
    try {
      const result = await api("/api/ai/check-in", { method: "POST", data: { currentDate: new Date().toISOString(), sensitiveConsentAccepted: true, records } });
      await api("/api/mini/records", { method: "POST", data: { records, summary: result.summary, smallStep: result.smallStep, recommendedNextTool: result.recommendedNextTool } });
      this.setData({ result, message: "已经保存到你的历史记录。" });
    } catch (error) { this.setData({ message: error.message, isError: true }); }
    finally { this.setData({ submitting: false }); }
  },
  reset() { this.setData({ answers: {}, completed: 0, consentAccepted: false, result: null, message: "" }); wx.pageScrollTo({ scrollTop: 0, duration: 250 }); },
});
