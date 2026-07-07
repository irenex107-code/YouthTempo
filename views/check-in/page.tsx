import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";

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
    description: "记录昨晚睡了多久、睡得怎么样，以及可能影响睡眠的因素。",
    fields: [
      {
        id: "duration",
        type: "single",
        title: "昨晚大概睡了多久？",
        options: ["少于 5 小时", "5-6 小时", "6-7 小时", "7-8 小时", "8 小时以上", "不太确定"],
      },
      {
        id: "quality",
        type: "single",
        title: "睡眠质量如何？",
        options: ["比较安稳", "还可以", "容易醒", "入睡困难", "睡得很乱"],
      },
      {
        id: "factors",
        type: "multi",
        title: "可能影响睡眠的因素",
        options: ["睡前想太多", "作业或任务压力", "手机使用时间较长", "家庭或人际压力", "身体不舒服", "不太确定"],
      },
      {
        id: "note",
        type: "text",
        title: "可选补充",
        required: false,
        placeholder: "例如：昨晚很晚才睡，睡前一直在想明天的事情。",
      },
    ],
  },
  {
    id: "wake",
    title: "醒来",
    label: "Wake",
    description: "记录今天早晨的状态，以及开始一天时有没有遇到阻力。",
    fields: [
      {
        id: "state",
        type: "single",
        title: "今天醒来后的状态更接近哪一种？",
        options: ["平静", "有精神", "有点疲惫", "紧张或烦躁", "不想开始今天"],
      },
      {
        id: "startDifficulty",
        type: "single",
        title: "今天开始的难度",
        options: ["很容易开始", "需要一点时间", "有点困难", "很难开始"],
      },
      {
        id: "factors",
        type: "multi",
        title: "可能影响晨间状态的因素",
        options: ["没睡够", "一醒来就想到很多事", "早上任务压力大", "身体有点累", "情绪影响", "不太确定"],
      },
      {
        id: "note",
        type: "text",
        title: "可选补充",
        required: false,
        placeholder: "例如：早上一醒来就想到作业，所以有点不想开始。",
      },
    ],
  },
  {
    id: "eat",
    title: "饮食",
    label: "Eat",
    description: "记录今天吃饭的节奏和大概吃了什么，帮助理解精力、专注和日常状态。",
    fields: [
      {
        id: "mealCount",
        type: "single",
        title: "今天大概吃了几餐？",
        options: ["三餐比较规律", "两餐", "一餐", "吃得比较零散", "不太确定"],
      },
      {
        id: "foodDetails",
        type: "text",
        title: "今天吃了什么？",
        placeholder: "例如：\n早餐：牛奶和面包\n午餐：米饭、鸡蛋、青菜\n晚餐：吃得比较少，只吃了面条",
      },
      {
        id: "rhythm",
        type: "single",
        title: "今天饮食节奏如何？",
        options: ["基本规律", "有一餐不太规律", "时间比较乱", "几乎没有好好吃饭"],
      },
      {
        id: "factors",
        type: "multi",
        title: "饮食状态可能和什么有关？",
        options: ["太忙了", "没胃口", "作息太乱", "情绪影响", "忘记吃饭", "家里或学校选择有限", "不太确定"],
      },
      {
        id: "energyConnection",
        type: "single",
        title: "今天精力和饮食有关系吗？",
        options: ["感觉有关系", "好像有一点", "不太确定", "没什么关系"],
      },
    ],
  },
  {
    id: "exercise",
    title: "运动",
    label: "Exercise",
    description: "记录今天身体有没有动一动，以及身体紧绷、久坐或压力释放的状态。",
    fields: [
      {
        id: "duration",
        type: "single",
        title: "今天大概活动了多久？",
        options: ["几乎没有活动", "5-10 分钟", "10-20 分钟", "20-30 分钟", "30 分钟以上", "不太确定"],
      },
      {
        id: "activityTypes",
        type: "multi",
        title: "今天做了什么活动？",
        options: ["走路", "拉伸", "体育课", "球类/跑步/跳操等运动", "上下楼/通勤", "家务或日常活动", "几乎没有", "其他"],
      },
      {
        id: "activityNote",
        type: "text",
        title: "活动补充",
        required: false,
        placeholder: "例如：今天走路回家，大概 15 分钟；或者体育课跑了一会儿。",
      },
      {
        id: "bodyState",
        type: "single",
        title: "今天身体状态更像哪种？",
        options: ["比较放松", "有点紧绷", "久坐后不太舒服", "很累，不想动", "不太确定"],
      },
      {
        id: "factors",
        type: "multi",
        title: "活动较少可能和什么有关？",
        options: ["太累了", "没有时间", "没有动力", "一直坐着学习或工作", "情绪影响", "身体不舒服", "不太确定"],
      },
    ],
  },
  {
    id: "task",
    title: "任务投入",
    label: "Task",
    description: "记录今天学习或生活任务是否容易开始，以及有没有一个已经完成的小任务。",
    fields: [
      {
        id: "engagement",
        type: "single",
        title: "今天学习或生活任务完成得怎么样？",
        options: ["比较顺利", "能完成基本任务", "开始有点困难", "很难开始，或一直拖着"],
      },
      {
        id: "difficultyReasons",
        type: "multi",
        title: "最卡住的是哪一部分？",
        options: ["任务太多", "不知道从哪里开始", "担心做不好", "被催促后更抗拒", "情绪很累", "不太确定"],
      },
      {
        id: "completedSmallTask",
        type: "text",
        title: "今天有没有一个完成的小任务？",
        required: false,
        placeholder: "例如：完成了一页作业、整理了书包、回复了一条消息。",
      },
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

function fieldValueToText(value: FieldValue) {
  return Array.isArray(value) ? value.join("、") : value;
}

export default function CheckInPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");
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
    setAnswers((current) => ({
      ...current,
      [step.id]: { ...current[step.id], [fieldId]: value },
    }));
    setValidation("");
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
    setAiResult(null);
  }

  function setTextValue(fieldId: string, value: string) {
    setAnswers((current) => ({
      ...current,
      [step.id]: { ...current[step.id], [fieldId]: value },
    }));
    setValidation("");
    setAiResult(null);
  }

  function goNext() {
    if (!canGoNext) {
      setValidation("请先完成这一页的必要记录，再继续。");
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
  }

  async function generateSummary() {
    if (!allRequiredDone) {
      setValidation("请先完成五个 SWEET 维度的必要记录，再生成回应。");
      return;
    }

    setLoading(true);
    setError("");
    setValidation("");
    try {
      const payload = {
        currentDate: new Date().toISOString(),
        records: steps.map((item) => ({
          id: item.id,
          title: item.title,
          label: item.label,
          dimension: `${item.label} ${item.title}`,
          fields: item.fields.map((field) => ({
            id: field.id,
            title: field.title,
            value: answers[item.id][field.id],
          })),
        })),
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
        subtitle="从睡眠、醒来、饮食、运动和任务投入五个维度，记录今天的生活节奏，并生成 AI 节律小结。"
        aside={
          <div className="card">
            <h2 className="text-2xl font-bold">这不是测试，也不是正式评估。</h2>
            <p className="mt-3 text-[0.95rem] leading-7 text-muted">
              SWEET 只是帮助你看见今天的生活节奏。AI 回应用于整理状态和下一步，不替代专业人员或可信任的大人的支持。
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

            <div className="mb-5 grid grid-cols-5 gap-2">
              {steps.map((item, index) => {
                const active = index === currentStep;
                const done = item.fields
                  .filter((field) => field.required !== false)
                  .every((field) => isFieldComplete(answers[item.id][field.id]));
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => goToStep(index)}
                    className={`rounded-2xl border px-2 py-3 text-center transition ${
                      active
                        ? "border-sage bg-mist text-sage-dark"
                        : done
                          ? "border-sage/35 bg-white/85 text-ink/70"
                          : "border-ink/10 bg-white/60 text-muted"
                    }`}
                  >
                    <span className="block text-xs font-bold">{item.label}</span>
                    <span className="mt-1 block text-[0.7rem] font-bold">{item.title}</span>
                  </button>
                );
              })}
            </div>

            <article ref={questionCardRef} className="card scroll-mt-28">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-[1.8rem] font-bold leading-[1.25] text-ink">{step.label} {step.title}</h2>
                  <p className="mt-2 text-sm font-bold text-sage">SWEET daily record</p>
                </div>
                <p className="max-w-md text-sm leading-7 text-muted">{step.description}</p>
              </div>

              <div className="mt-8 grid gap-7">
                {step.fields.map((field) => {
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
                        <div className="mt-4 flex flex-wrap gap-2">
                          {field.options?.map((option) => {
                            const selected = selectedValues.includes(option);
                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => toggleMultiValue(field.id, option)}
                                className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                                  selected
                                    ? "border-sage bg-mist text-sage-dark"
                                    : "border-ink/10 bg-white/80 text-muted hover:border-sage/50"
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
                                selected
                                  ? "border-sage bg-mist text-sage-dark"
                                  : "border-ink/10 bg-white/80 text-ink/75 hover:border-sage/50"
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

              <div className="mt-8 rounded-2xl bg-cream p-4">
                <p className="text-xs font-bold text-sage">当前记录</p>
                <p className="mt-2 text-sm leading-7 text-muted">
                  {step.fields
                    .filter((field) => isFieldComplete(currentAnswer[field.id]))
                    .map((field) => `${field.title}：${fieldValueToText(currentAnswer[field.id])}`)
                    .join(" / ") || "还没有填写这一维度的记录。"}
                </p>
              </div>

              {validation ? <p className="mt-4 text-sm font-bold text-sage-dark">{validation}</p> : null}

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={currentStep === 0}
                  onClick={() => goToStep(currentStep - 1)}
                >
                  上一步
                </button>
                {currentStep < steps.length - 1 ? (
                  <button
                    type="button"
                    className="button-primary disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45"
                    disabled={!canGoNext}
                    onClick={goNext}
                  >
                    下一步
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button-primary disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45"
                    disabled={!allRequiredDone || loading}
                    onClick={generateSummary}
                  >
                    {loading ? "正在生成 AI 节律小结……" : "生成 AI SWEET 节律小结"}
                  </button>
                )}
              </div>
            </article>

            {error ? <div className="mt-6 rounded-2xl bg-white/80 p-5 text-sm font-bold text-sage-dark">{error}</div> : null}

            {aiResult ? (
              <section className="mt-8 rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:p-8">
                <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">今日 SWEET 节律小结</h2>
                <p className="mt-4 text-base leading-8 text-muted">{aiResult.summary}</p>
                <div className="mt-6 grid gap-5 md:grid-cols-2">
                  <div>
                    <h3 className="text-lg font-bold text-ink">今天主要波动的维度</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{mainAffectedAreas}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-ink">五个维度的简要观察</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.fiveDimensionObservation}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-ink">营养与精力支持观察</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.nutritionEnergyObservation}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-ink">身体活动与压力释放观察</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.bodyActivityObservation}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-ink">今天可以先做的一件小事</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.smallStep}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-ink">推荐下一步</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.recommendedNextTool}</p>
                  </div>
                </div>
                <p className="mt-6 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">
                  {aiResult.supportReminder}
                </p>
                <p className="mt-4 text-xs leading-6 text-muted">
                  这里的回应不能替代专业支持，但可以帮助你先整理当前状态和下一步选择。
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href="/mood-journal" className="button-primary">进入情绪表达</Link>
                  <Link href="/worry-time" className="button-secondary">做睡前整理</Link>
                  <Link href="/referral" className="button-secondary">查看支持路径</Link>
                  <button type="button" className="button-secondary" onClick={reset}>重新填写</button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
