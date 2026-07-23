import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { getCurrentUser, saveCloudSweetRecord } from "@/lib/cloudRecords";
import { saveSweetRecord } from "@/lib/localRecords";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

type StepId = "sleep" | "wake" | "eat" | "exercise" | "task";
type FieldType = "single" | "multi" | "text";
type FieldValue = string | string[];

type RecordField = {
  id: string;
  type: FieldType;
  title: string;
  options?: string[];
  placeholder?: string;
  required?: boolean;
};

type CheckStep = {
  id: StepId;
  title: string;
  label: string;
  description: string;
  fields: RecordField[];
};

type StepAnswers = Record<string, FieldValue>;
type Answers = Record<StepId, StepAnswers>;

type AiResult = {
  summary: string;
  mainAffectedAreas: string[];
  fiveDimensionObservation: string;
  nutritionEnergyObservation: string;
  bodyActivityObservation: string;
  smallStep: string;
  recommendedNextTool: string;
  supportReminder: string;
};

const steps: CheckStep[] = [
  {
    id: "sleep",
    title: "睡眠",
    label: "Sleep",
    description: "先选一个最接近昨晚睡眠的状态。",
    fields: [
      { id: "quality", type: "single", title: "睡眠质量如何？", options: ["比较安稳", "还可以", "容易醒", "入睡困难", "睡得很乱"] },
      { id: "duration", type: "single", title: "昨晚大概睡了多久？", required: false, options: ["少于 5 小时", "5-6 小时", "6-7 小时", "7-8 小时", "8 小时以上", "不太确定"] },
      { id: "factors", type: "multi", title: "可能影响睡眠的因素", required: false, options: ["睡前想太多", "作业或任务压力", "手机使用时间较长", "家庭或人际压力", "身体不舒服", "不太确定"] },
      { id: "note", type: "text", title: "可选补充", required: false, placeholder: "例如：昨晚很晚才睡，睡前一直在想明天的事情。" },
    ],
  },
  {
    id: "wake",
    title: "醒来",
    label: "Wake",
    description: "先选一个最接近今天早晨的状态。",
    fields: [
      { id: "state", type: "single", title: "今天醒来后的状态更接近哪一种？", options: ["平静", "有精神", "有点疲惫", "紧张或烦躁", "不想开始今天"] },
      { id: "startDifficulty", type: "single", title: "今天开始的难度", required: false, options: ["很容易开始", "需要一点时间", "有点困难", "很难开始"] },
      { id: "factors", type: "multi", title: "可能影响晨间状态的因素", required: false, options: ["没睡够", "一醒来就想到很多事", "早上任务压力大", "身体有点累", "情绪影响", "不太确定"] },
      { id: "note", type: "text", title: "可选补充", required: false, placeholder: "例如：早上一醒来就想到作业，所以有点不想开始。" },
    ],
  },
  {
    id: "eat",
    title: "饮食",
    label: "Eat",
    description: "先看看今天吃饭的节奏是否规律。",
    fields: [
      { id: "rhythm", type: "single", title: "今天饮食节奏如何？", options: ["基本规律", "有一餐不太规律", "时间比较乱", "几乎没有好好吃饭"] },
      { id: "mealCount", type: "single", title: "今天大概吃了几餐？", required: false, options: ["三餐比较规律", "两餐", "一餐", "吃得比较零散", "不太确定"] },
      { id: "foodDetails", type: "text", title: "今天吃了什么？", required: false, placeholder: "想记录时再写，不需要列出每一样食物。" },
      { id: "factors", type: "multi", title: "饮食状态可能和什么有关？", required: false, options: ["太忙了", "没胃口", "作息太乱", "情绪影响", "忘记吃饭", "家里或学校选择有限", "不太确定"] },
      { id: "energyConnection", type: "single", title: "今天精力和饮食有关系吗？", required: false, options: ["感觉有关系", "好像有一点", "不太确定", "没什么关系"] },
    ],
  },
  {
    id: "exercise",
    title: "运动",
    label: "Exercise",
    description: "先看看今天身体大概活动了多久。",
    fields: [
      { id: "duration", type: "single", title: "今天大概活动了多久？", options: ["几乎没有活动", "5-10 分钟", "10-20 分钟", "20-30 分钟", "30 分钟以上", "不太确定"] },
      { id: "activityTypes", type: "multi", title: "今天做了什么活动？", required: false, options: ["走路", "拉伸", "体育课", "球类/跑步/跳操等运动", "上下楼/通勤", "家务或日常活动", "几乎没有", "其他"] },
      { id: "activityNote", type: "text", title: "活动补充", required: false, placeholder: "例如：今天走路回家，大概 15 分钟；或者体育课跑了一会儿。" },
      { id: "bodyState", type: "single", title: "今天身体状态更像哪种？", required: false, options: ["比较放松", "有点紧绷", "久坐后不太舒服", "很累，不想动", "不太确定"] },
      { id: "factors", type: "multi", title: "活动较少可能和什么有关？", required: false, options: ["太累了", "没有时间", "没有动力", "一直坐着学习或工作", "情绪影响", "身体不舒服", "不太确定"] },
    ],
  },
  {
    id: "task",
    title: "任务投入",
    label: "Task",
    description: "先看看今天开始学习或生活任务是否顺利。",
    fields: [
      { id: "engagement", type: "single", title: "今天学习或生活任务完成得怎么样？", options: ["比较顺利", "能完成基本任务", "开始有点困难", "很难开始，或一直拖着"] },
      { id: "difficultyReasons", type: "multi", title: "最卡住的是哪一部分？", required: false, options: ["任务太多", "不知道从哪里开始", "担心做不好", "被催促后更抗拒", "情绪很累", "不太确定"] },
      { id: "completedSmallTask", type: "text", title: "今天有没有一个完成的小任务？", required: false, placeholder: "例如：完成了一页作业、整理了书包、回复了一条消息。" },
    ],
  },
];

const initialAnswers = steps.reduce<Answers>((result, step) => {
  result[step.id] = {};
  step.fields.forEach((field) => {
    result[step.id][field.id] = field.type === "multi" ? [] : "";
  });
  return result;
}, {} as Answers);

function isFieldComplete(value: FieldValue) {
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

export default function CheckInPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedRecordKey, setSavedRecordKey] = useState("");
  const [detailsOpen, setDetailsOpen] = useState<Record<StepId, boolean>>({
    sleep: false,
    wake: false,
    eat: false,
    exercise: false,
    task: false,
  });
  const questionCardRef = useRef<HTMLElement | null>(null);
  const shouldScrollToQuestionRef = useRef(false);

  const step = steps[currentStep];
  const currentAnswer = answers[step.id];
  const requiredFields = step.fields.filter((field) => field.required !== false);
  const canGoNext = requiredFields.every((field) => isFieldComplete(currentAnswer[field.id]));
  const completedSteps = steps.filter((item) =>
    item.fields.filter((field) => field.required !== false).every((field) => isFieldComplete(answers[item.id][field.id])),
  ).length;
  const allRequiredDone = completedSteps === steps.length;
  const mainAffectedAreas = Array.isArray(aiResult?.mainAffectedAreas) ? aiResult.mainAffectedAreas.join("、") : "";

  useEffect(() => {
    if (!shouldScrollToQuestionRef.current) return;
    shouldScrollToQuestionRef.current = false;
    questionCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentStep]);

  function goToStep(index: number) {
    shouldScrollToQuestionRef.current = true;
    setCurrentStep(Math.max(0, Math.min(index, steps.length - 1)));
  }

  function setSingleValue(fieldId: string, value: string) {
    setAnswers((current) => ({ ...current, [step.id]: { ...current[step.id], [fieldId]: value } }));
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setAiResult(null);
  }

  function toggleMultiValue(fieldId: string, value: string) {
    setAnswers((current) => {
      const existing = current[step.id][fieldId];
      const list = Array.isArray(existing) ? existing : [];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { ...current, [step.id]: { ...current[step.id], [fieldId]: next } };
    });
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setAiResult(null);
  }

  function setTextValue(fieldId: string, value: string) {
    setAnswers((current) => ({ ...current, [step.id]: { ...current[step.id], [fieldId]: value } }));
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setAiResult(null);
  }

  function goNext() {
    if (!canGoNext) {
      setValidation("请先选择一个最接近今天状态的选项。");
      return;
    }
    setValidation("");
    goToStep(currentStep + 1);
  }

  function reset() {
    setAnswers(initialAnswers);
    setCurrentStep(0);
    setAiResult(null);
    setError("");
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setDetailsOpen({ sleep: false, wake: false, eat: false, exercise: false, task: false });
  }

  function getRecordPayload() {
    return steps.map((item) => ({
      id: item.id,
      title: item.title,
      label: item.label,
      fields: item.fields.map((field) => ({ id: field.id, title: field.title, value: answers[item.id][field.id] })),
    }));
  }

  async function saveCurrentRecord() {
    if (saving) return;
    if (!allRequiredDone) {
      setValidation("请先完成五个 SWEET 维度的必要记录，再保存。");
      return;
    }
    const recordPayload = {
      records: getRecordPayload(),
      summary: aiResult?.summary,
      smallStep: aiResult?.smallStep,
      recommendedNextTool: aiResult?.recommendedNextTool,
    };
    const recordKey = JSON.stringify(recordPayload.records);
    if (recordKey === savedRecordKey) {
      setSaveStatus("这次 SWEET 记录已经保存过了。");
      return;
    }
    setSaving(true);
    try {
      if (isSupabaseConfigured()) {
        try {
          const user = await getCurrentUser();
          if (user) {
            await saveCloudSweetRecord(recordPayload);
            setSavedRecordKey(recordKey);
            setSaveStatus("已保存到云端“我的记录”。你可以在账户页回看历史记录。");
            return;
          }
          setSaveStatus("还没有登录，已先保存到当前浏览器。登录后可保存到云端历史记录。");
        } catch (saveError) {
          const message = saveError instanceof Error ? saveError.message : "云端保存暂时失败。";
          setSaveStatus(`${message} 已尝试保存到当前浏览器作为备份。`);
        }
      }
      const saved = saveSweetRecord(recordPayload);
      if (saved) setSavedRecordKey(recordKey);
      if (!isSupabaseConfigured()) {
        setSaveStatus(saved ? "已保存到本地“我的记录”。连接 Supabase 后可保存到云端数据库。" : "当前浏览器暂时无法保存记录。");
        return;
      }
      if (!saved) setSaveStatus("当前浏览器暂时无法保存记录。");
    } finally {
      setSaving(false);
    }
  }

  async function generateSummary() {
    if (!allRequiredDone) {
      setValidation("请先完成五个 SWEET 维度的必要记录，再生成回应。");
      return;
    }

    setLoading(true);
    setError("");
    setValidation("");
    setSaveStatus("");
    try {
      const payload = {
        currentDate: new Date().toISOString(),
        records: getRecordPayload().map((item) => ({ ...item, dimension: `${item.label} ${item.title}` })),
      };
      const response = await fetch("/api/ai/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI request failed");
      setAiResult(data);
    } catch {
      setError("暂时无法生成回应，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHero
        label="SWEET Rhythm Check-in"
        title="SWEET 节律记录"
        subtitle="约 30–60 秒完成。五个维度各选一项，想补充时再展开更多问题。"
        aside={
          <div className="card">
            <h2 className="text-2xl font-bold">这不是测试，也不是正式评估。</h2>
            <p className="mt-3 text-[0.95rem] leading-7 text-muted">
              SWEET 帮助你看见今天的生活节奏。AI 可以帮你理清当前状态，并提示可以尝试的下一步；需要更多帮助时，请联系可信任的大人或专业人员。
            </p>
          </div>
        }
      />

      <section className="section section-muted">
        <div className="container">
          <div className="mx-auto max-w-4xl">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm font-bold text-muted">
              <span>第 {currentStep + 1} 步 / {steps.length}</span>
              <span>已完成 {completedSteps} / {steps.length} 个维度</span>
            </div>

            <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
              <div className="grid min-w-[560px] grid-cols-5 gap-2 sm:min-w-0">
                {steps.map((item, index) => {
                  const active = index === currentStep;
                  const done = item.fields.filter((field) => field.required !== false).every((field) => isFieldComplete(answers[item.id][field.id]));
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => goToStep(index)}
                      className={`rounded-2xl border px-2 py-3 text-center transition ${
                        active ? "border-sage bg-mist text-sage-dark" : done ? "border-sage/35 bg-white/85 text-ink/70" : "border-ink/10 bg-white/60 text-muted"
                      }`}
                    >
                      <span className="block text-xs font-bold">{item.label}</span>
                      <span className="mt-1 block text-[0.7rem] font-bold">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <article ref={questionCardRef} className="card scroll-mt-24 sm:scroll-mt-28">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-[1.55rem] font-bold leading-[1.25] text-ink sm:text-[1.8rem]">{step.label} {step.title}</h2>
                  <p className="mt-2 text-sm font-bold text-sage">SWEET 日常记录</p>
                </div>
                <p className="max-w-md text-sm leading-7 text-muted">{step.description}</p>
              </div>

              <div className="mt-7 grid gap-7 sm:mt-8">
                {step.fields
                  .filter((field) => field.required !== false || detailsOpen[step.id])
                  .map((field) => {
                  const value = currentAnswer[field.id];
                  if (field.type === "text") {
                    return (
                      <label key={field.id} className="grid gap-2">
                        <span className="text-base font-bold text-ink">
                          {field.title}
                          {field.required === false ? <span className="ml-2 text-xs text-muted">可选</span> : null}
                        </span>
                        <textarea
                          className="min-h-28 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage"
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) => setTextValue(field.id, event.target.value)}
                          placeholder={field.placeholder}
                        />
                      </label>
                    );
                  }
                  if (field.type === "multi") {
                    const selectedValues = Array.isArray(value) ? value : [];
                    return (
                      <div key={field.id}>
                        <p className="text-base font-bold text-ink">{field.title}</p>
                        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
                          {field.options?.map((option) => {
                            const selected = selectedValues.includes(option);
                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => toggleMultiValue(field.id, option)}
                                className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition sm:rounded-full sm:py-2 sm:text-center ${
                                  selected ? "border-sage bg-mist text-sage-dark" : "border-ink/10 bg-white/80 text-muted hover:border-sage/50"
                                }`}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={field.id}>
                      <p className="text-base font-bold text-ink">{field.title}</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {field.options?.map((option) => {
                          const selected = value === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => setSingleValue(field.id, option)}
                              className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-sage/15 ${
                                selected ? "border-sage bg-mist text-sage-dark" : "border-ink/10 bg-white/80 text-ink/75 hover:border-sage/50"
                              }`}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                  })}
              </div>

              <button
                type="button"
                aria-expanded={detailsOpen[step.id]}
                className="mt-7 flex w-full items-center justify-between gap-4 rounded-2xl border border-sage/35 bg-mint/70 px-4 py-3 text-left text-sm font-bold text-sage-dark transition hover:border-sage hover:bg-mist focus:outline-none focus:ring-4 focus:ring-sage/15 sm:w-auto sm:min-w-64"
                onClick={() => setDetailsOpen((current) => ({ ...current, [step.id]: !current[step.id] }))}
              >
                <span>{detailsOpen[step.id] ? "收起补充问题" : "想补充更多"}</span>
                <span className="flex items-center gap-2 text-xs">
                  {detailsOpen[step.id] ? "收起" : "可选"}
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-base leading-none shadow-sm">
                    {detailsOpen[step.id] ? "−" : "+"}
                  </span>
                </span>
              </button>

              {validation ? <p className="mt-4 text-sm font-bold text-sage-dark">{validation}</p> : null}

              <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
                <button type="button" className="button-secondary w-full sm:w-auto" disabled={currentStep === 0} onClick={() => goToStep(currentStep - 1)}>
                  上一步
                </button>
                {currentStep < steps.length - 1 ? (
                  <button type="button" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto" disabled={!canGoNext} onClick={goNext}>
                    下一步
                  </button>
                ) : (
                  <>
                    <button type="button" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto" disabled={!allRequiredDone || saving} onClick={saveCurrentRecord}>
                      {saving ? "正在保存..." : "完成并保存"}
                    </button>
                    <button type="button" className="button-secondary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto" disabled={!allRequiredDone || loading} onClick={generateSummary}>
                      {loading ? "正在生成小结……" : "看看 AI 小结（可选）"}
                    </button>
                  </>
                )}
              </div>
            </article>

            {saveStatus ? <p className="mt-5 rounded-2xl bg-white/80 p-4 text-sm font-bold text-sage-dark">{saveStatus}</p> : null}
            {error ? <div className="mt-6 rounded-2xl bg-white/80 p-5 text-sm font-bold text-sage-dark">{error}</div> : null}

            {aiResult ? (
              <section className="mt-8 rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:p-8">
                <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">今日 SWEET 节律小结</h2>
                <p className="mt-4 text-base leading-8 text-muted">{aiResult.summary}</p>
                <div className="mt-6 grid gap-5 md:grid-cols-2">
                  <div><h3 className="text-lg font-bold text-ink">今天主要波动的维度</h3><p className="mt-2 text-[0.95rem] leading-7 text-muted">{mainAffectedAreas}</p></div>
                  <div><h3 className="text-lg font-bold text-ink">五个维度的简要观察</h3><p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.fiveDimensionObservation}</p></div>
                  <div><h3 className="text-lg font-bold text-ink">营养与精力支持观察</h3><p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.nutritionEnergyObservation}</p></div>
                  <div><h3 className="text-lg font-bold text-ink">身体活动与压力释放观察</h3><p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.bodyActivityObservation}</p></div>
                  <div><h3 className="text-lg font-bold text-ink">今天可以先做的一件小事</h3><p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.smallStep}</p></div>
                  <div><h3 className="text-lg font-bold text-ink">推荐下一步</h3><p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.recommendedNextTool}</p></div>
                </div>
                <p className="mt-6 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">{aiResult.supportReminder}</p>
                <p className="mt-4 text-xs leading-6 text-muted">这里的回应只能帮助你理清当前状态和可选的下一步，不能代替专业支持。</p>
                <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap">
                  <Link href="/mood-journal" className="button-primary w-full sm:w-auto">进入情绪表达</Link>
                  <Link href="/worry-time" className="button-secondary w-full sm:w-auto">做睡前整理</Link>
                  <Link href="/referral" className="button-secondary w-full sm:w-auto">查看支持路径</Link>
                  <button type="button" className="button-secondary w-full sm:w-auto" onClick={reset}>重新填写</button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
