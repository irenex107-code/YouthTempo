import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { getCurrentUser, saveCloudSweetRecord } from "@/lib/cloudRecords";
import { reportClientOperationFailure } from "@/lib/clientMonitoring";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

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
  rhythmClue: string;
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

type FieldCopyKeys = {
  title: TranslationKey;
  placeholder?: TranslationKey;
  options?: readonly TranslationKey[];
};

type StepCopyKeys = {
  title: TranslationKey;
  description: TranslationKey;
  fields: Record<string, FieldCopyKeys>;
};

const stepCopyKeys: Record<StepId, StepCopyKeys> = {
  sleep: {
    title: "checkIn.steps.sleep.title",
    description: "checkIn.steps.sleep.description",
    fields: {
      quality: { title: "checkIn.steps.sleep.fields.quality.title", options: ["checkIn.steps.sleep.fields.quality.options.steady", "checkIn.steps.sleep.fields.quality.options.okay", "checkIn.steps.sleep.fields.quality.options.waking", "checkIn.steps.sleep.fields.quality.options.fallingAsleep", "checkIn.steps.sleep.fields.quality.options.irregular"] },
      duration: { title: "checkIn.steps.sleep.fields.duration.title", options: ["checkIn.steps.sleep.fields.duration.options.underFive", "checkIn.steps.sleep.fields.duration.options.fiveToSix", "checkIn.steps.sleep.fields.duration.options.sixToSeven", "checkIn.steps.sleep.fields.duration.options.sevenToEight", "checkIn.steps.sleep.fields.duration.options.overEight", "checkIn.steps.sleep.fields.duration.options.unsure"] },
      factors: { title: "checkIn.steps.sleep.fields.factors.title", options: ["checkIn.steps.sleep.fields.factors.options.overthinking", "checkIn.steps.sleep.fields.factors.options.tasks", "checkIn.steps.sleep.fields.factors.options.phone", "checkIn.steps.sleep.fields.factors.options.relationships", "checkIn.steps.sleep.fields.factors.options.physical", "checkIn.steps.sleep.fields.factors.options.unsure"] },
      note: { title: "checkIn.steps.sleep.fields.note.title", placeholder: "checkIn.steps.sleep.fields.note.placeholder" },
    },
  },
  wake: {
    title: "checkIn.steps.wake.title",
    description: "checkIn.steps.wake.description",
    fields: {
      state: { title: "checkIn.steps.wake.fields.state.title", options: ["checkIn.steps.wake.fields.state.options.calm", "checkIn.steps.wake.fields.state.options.energized", "checkIn.steps.wake.fields.state.options.tired", "checkIn.steps.wake.fields.state.options.tense", "checkIn.steps.wake.fields.state.options.reluctant"] },
      startDifficulty: { title: "checkIn.steps.wake.fields.startDifficulty.title", options: ["checkIn.steps.wake.fields.startDifficulty.options.easy", "checkIn.steps.wake.fields.startDifficulty.options.time", "checkIn.steps.wake.fields.startDifficulty.options.difficult", "checkIn.steps.wake.fields.startDifficulty.options.veryDifficult"] },
      factors: { title: "checkIn.steps.wake.fields.factors.title", options: ["checkIn.steps.wake.fields.factors.options.sleep", "checkIn.steps.wake.fields.factors.options.thoughts", "checkIn.steps.wake.fields.factors.options.tasks", "checkIn.steps.wake.fields.factors.options.physical", "checkIn.steps.wake.fields.factors.options.emotions", "checkIn.steps.wake.fields.factors.options.unsure"] },
      note: { title: "checkIn.steps.wake.fields.note.title", placeholder: "checkIn.steps.wake.fields.note.placeholder" },
    },
  },
  eat: {
    title: "checkIn.steps.eat.title",
    description: "checkIn.steps.eat.description",
    fields: {
      rhythm: { title: "checkIn.steps.eat.fields.rhythm.title", options: ["checkIn.steps.eat.fields.rhythm.options.regular", "checkIn.steps.eat.fields.rhythm.options.oneIrregular", "checkIn.steps.eat.fields.rhythm.options.irregular", "checkIn.steps.eat.fields.rhythm.options.barelyAte"] },
      mealCount: { title: "checkIn.steps.eat.fields.mealCount.title", options: ["checkIn.steps.eat.fields.mealCount.options.three", "checkIn.steps.eat.fields.mealCount.options.two", "checkIn.steps.eat.fields.mealCount.options.one", "checkIn.steps.eat.fields.mealCount.options.scattered", "checkIn.steps.eat.fields.mealCount.options.unsure"] },
      foodDetails: { title: "checkIn.steps.eat.fields.foodDetails.title", placeholder: "checkIn.steps.eat.fields.foodDetails.placeholder" },
      factors: { title: "checkIn.steps.eat.fields.factors.title", options: ["checkIn.steps.eat.fields.factors.options.busy", "checkIn.steps.eat.fields.factors.options.appetite", "checkIn.steps.eat.fields.factors.options.schedule", "checkIn.steps.eat.fields.factors.options.emotions", "checkIn.steps.eat.fields.factors.options.forgot", "checkIn.steps.eat.fields.factors.options.limited", "checkIn.steps.eat.fields.factors.options.unsure"] },
      energyConnection: { title: "checkIn.steps.eat.fields.energyConnection.title", options: ["checkIn.steps.eat.fields.energyConnection.options.yes", "checkIn.steps.eat.fields.energyConnection.options.maybe", "checkIn.steps.eat.fields.energyConnection.options.unsure", "checkIn.steps.eat.fields.energyConnection.options.no"] },
    },
  },
  exercise: {
    title: "checkIn.steps.exercise.title",
    description: "checkIn.steps.exercise.description",
    fields: {
      duration: { title: "checkIn.steps.exercise.fields.duration.title", options: ["checkIn.steps.exercise.fields.duration.options.none", "checkIn.steps.exercise.fields.duration.options.fiveToTen", "checkIn.steps.exercise.fields.duration.options.tenToTwenty", "checkIn.steps.exercise.fields.duration.options.twentyToThirty", "checkIn.steps.exercise.fields.duration.options.overThirty", "checkIn.steps.exercise.fields.duration.options.unsure"] },
      activityTypes: { title: "checkIn.steps.exercise.fields.activityTypes.title", options: ["checkIn.steps.exercise.fields.activityTypes.options.walking", "checkIn.steps.exercise.fields.activityTypes.options.stretching", "checkIn.steps.exercise.fields.activityTypes.options.pe", "checkIn.steps.exercise.fields.activityTypes.options.sports", "checkIn.steps.exercise.fields.activityTypes.options.commute", "checkIn.steps.exercise.fields.activityTypes.options.daily", "checkIn.steps.exercise.fields.activityTypes.options.none", "checkIn.steps.exercise.fields.activityTypes.options.other"] },
      activityNote: { title: "checkIn.steps.exercise.fields.activityNote.title", placeholder: "checkIn.steps.exercise.fields.activityNote.placeholder" },
      bodyState: { title: "checkIn.steps.exercise.fields.bodyState.title", options: ["checkIn.steps.exercise.fields.bodyState.options.relaxed", "checkIn.steps.exercise.fields.bodyState.options.tense", "checkIn.steps.exercise.fields.bodyState.options.sitting", "checkIn.steps.exercise.fields.bodyState.options.tired", "checkIn.steps.exercise.fields.bodyState.options.unsure"] },
      factors: { title: "checkIn.steps.exercise.fields.factors.title", options: ["checkIn.steps.exercise.fields.factors.options.tired", "checkIn.steps.exercise.fields.factors.options.time", "checkIn.steps.exercise.fields.factors.options.motivation", "checkIn.steps.exercise.fields.factors.options.sitting", "checkIn.steps.exercise.fields.factors.options.emotions", "checkIn.steps.exercise.fields.factors.options.physical", "checkIn.steps.exercise.fields.factors.options.unsure"] },
    },
  },
  task: {
    title: "checkIn.steps.task.title",
    description: "checkIn.steps.task.description",
    fields: {
      engagement: { title: "checkIn.steps.task.fields.engagement.title", options: ["checkIn.steps.task.fields.engagement.options.smooth", "checkIn.steps.task.fields.engagement.options.basic", "checkIn.steps.task.fields.engagement.options.difficult", "checkIn.steps.task.fields.engagement.options.stuck"] },
      difficultyReasons: { title: "checkIn.steps.task.fields.difficultyReasons.title", options: ["checkIn.steps.task.fields.difficultyReasons.options.tooMany", "checkIn.steps.task.fields.difficultyReasons.options.start", "checkIn.steps.task.fields.difficultyReasons.options.performance", "checkIn.steps.task.fields.difficultyReasons.options.pressure", "checkIn.steps.task.fields.difficultyReasons.options.emotional", "checkIn.steps.task.fields.difficultyReasons.options.unsure"] },
      completedSmallTask: { title: "checkIn.steps.task.fields.completedSmallTask.title", placeholder: "checkIn.steps.task.fields.completedSmallTask.placeholder" },
    },
  },
};

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
  const { locale, t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sensitiveConsentAccepted, setSensitiveConsentAccepted] = useState(false);
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
  const resultRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    if (!aiResult) return;
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [aiResult]);

  function goToStep(index: number) {
    shouldScrollToQuestionRef.current = true;
    setCurrentStep(Math.max(0, Math.min(index, steps.length - 1)));
  }

  function setSingleValue(fieldId: string, value: string) {
    setAnswers((current) => ({ ...current, [step.id]: { ...current[step.id], [fieldId]: value } }));
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setSensitiveConsentAccepted(false);
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
      setValidation(t("checkIn.messages.selectRequired"));
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

  function recordSaveErrorMessage(saveError: unknown) {
    const message = saveError instanceof Error ? saveError.message : "";
    const normalized = message.toLowerCase();
    if (normalized.includes("jwt") || normalized.includes("session") || normalized.includes("登录")) {
      return t("checkIn.messages.sessionExpired");
    }
    if (normalized.includes("row-level security") || normalized.includes("permission") || normalized.includes("42501")) {
      return t("checkIn.messages.permissionDenied");
    }
    if (normalized.includes("fetch") || normalized.includes("network") || normalized.includes("failed to")) {
      return t("checkIn.messages.networkError");
    }
    return t("checkIn.messages.saveFailed");
  }

  async function saveCurrentRecord(result: AiResult | null = aiResult) {
    if (saving) return;
    if (!allRequiredDone) {
      setValidation(t("checkIn.messages.completeBeforeSave"));
      return;
    }
    const recordPayload = {
      records: getRecordPayload(),
      summary: result?.summary,
      smallStep: result?.smallStep,
      recommendedNextTool: result?.recommendedNextTool,
    };
    const recordKey = JSON.stringify(recordPayload.records);
    if (recordKey === savedRecordKey) {
      setSaveStatus(t("checkIn.messages.alreadySaved"));
      return;
    }
    setSaving(true);
    try {
      const user = await getCurrentUser();
      if (!user) {
        setSaveStatus(t("checkIn.messages.signInToSave"));
        return;
      }
      await saveCloudSweetRecord(recordPayload);
      setSavedRecordKey(recordKey);
      setSaveStatus(t("checkIn.messages.saved"));
    } catch (saveError) {
      reportClientOperationFailure("save", "sweet_record_save", saveError);
      console.error("SWEET record save failed", saveError);
      setSaveStatus(recordSaveErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function requestSummary(): Promise<AiResult> {
    const payload = {
      currentDate: new Date().toISOString(),
      sensitiveConsentAccepted,
      records: getRecordPayload().map((item) => ({ ...item, dimension: `${item.label} ${item.title}` })),
    };
    const response = await fetch("/api/ai/check-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("checkIn.messages.summaryFailed"));
    return data as AiResult;
  }

  async function generateSummary() {
    if (loading || saving) return;
    if (!allRequiredDone) {
      setValidation(t("checkIn.messages.completeBeforeGenerate"));
      return;
    }

    setLoading(true);
    setError("");
    setValidation("");
    setSaveStatus("");
    try {
      const result = await requestSummary();
      setAiResult(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("checkIn.messages.responseUnavailable"));
    } finally {
      setLoading(false);
    }
  }

  async function generateAndSave() {
    if (loading || saving) return;
    if (!allRequiredDone) {
      setValidation(t("checkIn.messages.completeRequired"));
      return;
    }

    setLoading(true);
    setError("");
    setValidation("");
    setSaveStatus("");
    try {
      const result = await requestSummary();
      setAiResult(result);
      await saveCurrentRecord(result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("checkIn.messages.summaryUnavailableSaveAllowed"),
      );
      await saveCurrentRecord(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHero
        label="SWEET Rhythm Check-in"
        title={t("checkIn.hero.title")}
        subtitle={t("checkIn.hero.description")}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-sweet-rhythm-v2.webp"
            alt={t("checkIn.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section section-muted">
        <div className="container">
          <div className="mx-auto max-w-4xl">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm font-bold text-muted">
              <span>{t("checkIn.progress.step", { current: currentStep + 1, total: steps.length })}</span>
              <span>{t("checkIn.progress.completed", { completed: completedSteps, total: steps.length })}</span>
            </div>

            <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
              <div className="grid min-w-[560px] grid-cols-5 gap-2 sm:min-w-0">
                {steps.map((item, index) => {
                  const active = index === currentStep;
                  const done = item.fields.filter((field) => field.required !== false).every((field) => isFieldComplete(answers[item.id][field.id]));
                  const translatedTitle = t(stepCopyKeys[item.id].title);
                  const showTranslatedTitle = locale !== "en" || item.label.toLocaleLowerCase() !== translatedTitle.toLocaleLowerCase();
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
                      {showTranslatedTitle ? <span className="mt-1 block text-[0.7rem] font-bold">{translatedTitle}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <article ref={questionCardRef} className="card scroll-mt-24 sm:scroll-mt-28">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-[1.55rem] font-bold leading-[1.25] text-ink sm:text-[1.8rem]">
                    {step.label}
                    {locale !== "en" || step.label.toLocaleLowerCase() !== t(stepCopyKeys[step.id].title).toLocaleLowerCase()
                      ? ` ${t(stepCopyKeys[step.id].title)}`
                      : null}
                  </h2>
                  <p className="mt-2 text-sm font-bold text-sage">{t("checkIn.form.label")}</p>
                </div>
                <p className="max-w-md text-sm leading-7 text-muted">{t(stepCopyKeys[step.id].description)}</p>
              </div>

              <div className="mt-7 grid gap-7 sm:mt-8">
                {step.fields
                  .filter((field) => field.required !== false || detailsOpen[step.id])
                  .map((field) => {
                  const value = currentAnswer[field.id];
                  const fieldCopy = stepCopyKeys[step.id].fields[field.id];
                  if (field.type === "text") {
                    return (
                      <label key={field.id} className="grid gap-2">
                        <span className="text-base font-bold text-ink">
                          {t(fieldCopy.title)}
                          {field.required === false ? <span className="ml-2 text-xs text-muted">{t("checkIn.form.optional")}</span> : null}
                        </span>
                        <textarea
                          className="min-h-28 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage"
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) => setTextValue(field.id, event.target.value)}
                          placeholder={fieldCopy.placeholder ? t(fieldCopy.placeholder) : undefined}
                        />
                      </label>
                    );
                  }
                  if (field.type === "multi") {
                    const selectedValues = Array.isArray(value) ? value : [];
                    return (
                      <div key={field.id}>
                        <p className="text-base font-bold text-ink">{t(fieldCopy.title)}</p>
                        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
                          {field.options?.map((option, optionIndex) => {
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
                                {fieldCopy.options?.[optionIndex] ? t(fieldCopy.options[optionIndex]) : option}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={field.id}>
                      <p className="text-base font-bold text-ink">{t(fieldCopy.title)}</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {field.options?.map((option, optionIndex) => {
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
                              {fieldCopy.options?.[optionIndex] ? t(fieldCopy.options[optionIndex]) : option}
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
                <span>{detailsOpen[step.id] ? t("checkIn.form.collapseDetails") : t("checkIn.form.expandDetails")}</span>
                <span className="flex items-center gap-2 text-xs">
                  {detailsOpen[step.id] ? t("checkIn.form.collapse") : t("checkIn.form.optional")}
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-base leading-none shadow-sm">
                    {detailsOpen[step.id] ? "−" : "+"}
                  </span>
                </span>
              </button>

              {validation ? <p className="mt-4 text-sm font-bold text-sage-dark">{validation}</p> : null}

              {currentStep === steps.length - 1 ? (
                <label className="mt-7 flex items-start gap-3 rounded-2xl border border-sage/25 bg-mist/60 px-4 py-4 text-sm leading-6 text-muted">
                  <input type="checkbox" className="mt-1" checked={sensitiveConsentAccepted} onChange={(event) => setSensitiveConsentAccepted(event.target.checked)} />
                  <span>{t("checkIn.consent.text")}<Link href="/privacy-safety#student-consent" className="ml-1 font-bold text-sage-dark underline underline-offset-4">{t("checkIn.consent.link")}</Link></span>
                </label>
              ) : null}

              <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
                <button type="button" className="button-secondary w-full sm:w-auto" disabled={currentStep === 0} onClick={() => goToStep(currentStep - 1)}>
                  {t("checkIn.actions.previous")}
                </button>
                {currentStep < steps.length - 1 ? (
                  <button type="button" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto" disabled={!canGoNext} onClick={goNext}>
                    {t("checkIn.actions.next")}
                  </button>
                ) : (
                  <button type="button" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto" disabled={!allRequiredDone || !sensitiveConsentAccepted || loading || saving} onClick={generateAndSave}>
                    {loading || saving ? t("checkIn.actions.generatingAndSaving") : t("checkIn.actions.generateAndSave")}
                  </button>
                )}
              </div>
            </article>

            {saveStatus ? <p className="mt-5 rounded-2xl bg-white/80 p-4 text-sm font-bold text-sage-dark">{saveStatus}</p> : null}
            {error ? (
              <div className="mt-6 rounded-2xl bg-white/80 p-5">
                <p className="text-sm font-bold text-sage-dark">{error}</p>
                <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap">
                  <button type="button" className="button-primary w-full sm:w-auto" disabled={loading} onClick={generateSummary}>
                    {loading ? t("checkIn.actions.retrying") : t("checkIn.actions.regenerate")}
                  </button>
                  <button type="button" className="button-secondary w-full sm:w-auto" disabled={saving} onClick={() => saveCurrentRecord()}>
                    {saving ? t("checkIn.actions.saving") : t("checkIn.actions.saveFirst")}
                  </button>
                </div>
              </div>
            ) : null}

            {aiResult ? (
              <section ref={resultRef} className="mt-8 scroll-mt-24 rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:scroll-mt-28 sm:p-8">
                <div className="grid items-center gap-6 lg:grid-cols-[1fr_18rem]">
                  <div>
                    <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("checkIn.result.title")}</h2>
                    <p className="mt-4 text-base leading-8 text-muted">{aiResult.summary}</p>
                  </div>
                  <FeatureIllustration
                    src="/illustrations/system/feature-ai-summary.webp"
                    alt={t("checkIn.result.imageAlt")}
                  />
                </div>
                <div className="mt-6 grid gap-4">
                  {mainAffectedAreas ? (
                    <p className="text-sm font-bold text-sage-dark">{t("checkIn.result.affectedAreas", { areas: mainAffectedAreas })}</p>
                  ) : null}
                  <div className="rounded-2xl border border-ink/10 bg-white/70 p-5">
                    <h3 className="text-base font-bold text-ink">{t("checkIn.result.rhythmClue")}</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.rhythmClue}</p>
                  </div>
                  <div className="rounded-2xl border border-sage/25 bg-mist/65 p-5">
                    <h3 className="text-base font-bold text-ink">{t("checkIn.result.smallStep")}</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.smallStep}</p>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-white/70 p-5">
                    <h3 className="text-base font-bold text-ink">{t("checkIn.result.nextTool")}</h3>
                    <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.recommendedNextTool}</p>
                  </div>
                </div>
                <p className="mt-6 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">{aiResult.supportReminder}</p>
                <p className="mt-4 text-xs leading-6 text-muted">{t("checkIn.result.disclaimer")}</p>
                <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap">
                  <button type="button" className="button-primary w-full sm:w-auto" disabled={saving} onClick={() => saveCurrentRecord()}>
                    {saving ? t("checkIn.actions.saving") : savedRecordKey ? t("checkIn.actions.savedToAccount") : t("checkIn.actions.saveToAccount")}
                  </button>
                  <Link href="/mood-journal" className="button-secondary w-full sm:w-auto">{t("checkIn.actions.openMoodJournal")}</Link>
                  <Link href="/worry-time" className="button-secondary w-full sm:w-auto">{t("checkIn.actions.openWorryTime")}</Link>
                  <Link href="/referral" className="button-secondary w-full sm:w-auto">{t("checkIn.actions.viewReferral")}</Link>
                  <button type="button" className="button-secondary w-full sm:w-auto" onClick={reset}>{t("checkIn.actions.reset")}</button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
