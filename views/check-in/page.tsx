import { GardenGuide } from "@/components/garden/GardenWelcome";
import { InlineStudentConsent } from "@/components/InlineStudentConsent";
import { useInlineStudentConsent } from "@/lib/useInlineStudentConsent";
import { detectCrisisInValues, getCrisisResponse } from "@/lib/safety/crisisDetection";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { AiUrgentNotice } from "@/components/AiUrgentNotice";
import { AiGeneratedLabel, AiTransparencyNotice } from "@/components/AiTransparencyNotice";
import { MicroPilotFeedback } from "@/components/MicroPilotFeedback";
import { AI_NOTICE_VERSION } from "@/lib/aiNotice";
import { aiRequestHeaders } from "@/lib/aiClient";
import { getCurrentUser, readCloudSweetScope, saveCloudSweetRecord } from "@/lib/cloudRecords";
import type { CloudSweetRecord } from "@/lib/cloudRecords";
import { SweetPersistenceError, sweetRecordsKey, sweetStoredDay } from "@/lib/sweetPersistenceProtocol";
import type { SweetScope, SweetIntent, SweetRecordInput } from "@/lib/sweetPersistenceProtocol";
import { getSupabase } from "@/lib/supabaseClient";
import { reportClientOperationFailure } from "@/lib/clientMonitoring";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { isAiUrgentResponse } from "@/lib/safety/aiUrgentResponse";
import type { AiUrgentResponse } from "@/lib/safety/aiUrgentResponse";

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

type SummaryIntent = Extract<SweetIntent, "replace_summary" | "preserve_summary" | "clear_summary">;

type SaveLifecycle = { completedKeys: Set<string> };

type SavedSummary = {
  summary: string | null;
  smallStep: string | null;
  recommendedNextTool: string | null;
};

function savedSummary(record: CloudSweetRecord): SavedSummary | null {
  const result = {
    summary: record.summary || null,
    smallStep: record.small_step || null,
    recommendedNextTool: record.recommended_next_tool || null,
  };
  return Object.values(result).some(Boolean) ? result : null;
}

const steps: CheckStep[] = [
  {
    id: "sleep",
    title: "睡眠",
    label: "Sleep",
    description: "先选一个最接近昨晚整体睡眠质量的选项。",
    fields: [
      { id: "quality", type: "single", title: "昨晚整体睡得怎么样？", options: ["睡得很好", "比较好", "一般", "不太好", "很不好"] },
      { id: "duration", type: "single", title: "昨晚大概睡了多久？", required: false, options: ["少于 5 小时", "5 小时以上、不足 6 小时", "6 小时以上、不足 7 小时", "7 小时以上、不足 8 小时", "8 小时以上", "不太确定"] },
      { id: "factors", type: "multi", title: "可能影响睡眠的因素", required: false, options: ["睡前想太多", "作业或任务压力", "手机使用时间较长", "家庭或人际压力", "身体不舒服", "不太确定"] },
      { id: "note", type: "text", title: "可选补充", required: false, placeholder: "例如：昨晚很晚才睡，睡前一直在想明天的事情。" },
    ],
  },
  {
    id: "wake",
    title: "醒来",
    label: "Wake",
    description: "先选一个最接近今天醒来后精力的选项。",
    fields: [
      { id: "state", type: "single", title: "今天醒来后的精力怎么样？", options: ["很有精神", "比较有精神", "一般", "有点疲惫", "很疲惫"] },
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
      { id: "rhythm", type: "single", title: "今天吃饭的节奏怎么样？", options: ["很规律", "比较规律", "一般", "不太规律", "很不规律"] },
      { id: "mealCount", type: "single", title: "今天大概吃了几餐？", required: false, options: ["3 餐或以上", "2 餐", "1 餐", "没有吃正餐", "不太确定"] },
      { id: "foodDetails", type: "text", title: "今天吃了什么？", required: false, placeholder: "想记录时再写，不需要列出每一样食物。" },
      { id: "factors", type: "multi", title: "饮食状态可能和什么有关？", required: false, options: ["太忙了", "没胃口", "作息太乱", "情绪影响", "忘记吃饭", "家里或学校选择有限", "不太确定"] },
    ],
  },
  {
    id: "exercise",
    title: "运动",
    label: "Exercise",
    description: "先看看今天身体大概活动了多久。",
    fields: [
      { id: "duration", type: "single", title: "今天一共活动了多久？", options: ["0 分钟", "1–9 分钟", "10–19 分钟", "20–29 分钟", "30 分钟以上", "不太确定"] },
      { id: "activityTypes", type: "multi", title: "今天做了什么活动？", required: false, options: ["步行、通勤或上下楼", "拉伸或轻量活动", "体育课", "跑步、球类或跳操等运动", "家务或日常活动", "其他"] },
      { id: "activityNote", type: "text", title: "活动补充", required: false, placeholder: "例如：今天走路回家，大概 15 分钟；或者体育课跑了一会儿。" },
      { id: "bodyState", type: "single", title: "今天身体的精力怎么样？", required: false, options: ["很有活力", "比较有活力", "一般", "有点疲惫", "很疲惫"] },
      { id: "factors", type: "multi", title: "活动较少可能和什么有关？", required: false, options: ["太累了", "没有时间", "没有动力", "一直坐着学习或工作", "情绪影响", "身体不舒服", "不太确定"] },
    ],
  },
  {
    id: "task",
    title: "任务投入",
    label: "Task",
    description: "先看看今天投入学习或生活任务是否顺利。",
    fields: [
      { id: "engagement", type: "single", title: "今天投入学习或生活任务顺利吗？", options: ["很顺利", "比较顺利", "一般", "不太顺利", "很不顺利"] },
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
      quality: { title: "checkIn.steps.sleep.fields.quality.title", options: ["checkIn.steps.sleep.fields.quality.options.veryGood", "checkIn.steps.sleep.fields.quality.options.good", "checkIn.steps.sleep.fields.quality.options.neutral", "checkIn.steps.sleep.fields.quality.options.poor", "checkIn.steps.sleep.fields.quality.options.veryPoor"] },
      duration: { title: "checkIn.steps.sleep.fields.duration.title", options: ["checkIn.steps.sleep.fields.duration.options.underFive", "checkIn.steps.sleep.fields.duration.options.fiveToSix", "checkIn.steps.sleep.fields.duration.options.sixToSeven", "checkIn.steps.sleep.fields.duration.options.sevenToEight", "checkIn.steps.sleep.fields.duration.options.overEight", "checkIn.steps.sleep.fields.duration.options.unsure"] },
      factors: { title: "checkIn.steps.sleep.fields.factors.title", options: ["checkIn.steps.sleep.fields.factors.options.overthinking", "checkIn.steps.sleep.fields.factors.options.tasks", "checkIn.steps.sleep.fields.factors.options.phone", "checkIn.steps.sleep.fields.factors.options.relationships", "checkIn.steps.sleep.fields.factors.options.physical", "checkIn.steps.sleep.fields.factors.options.unsure"] },
      note: { title: "checkIn.steps.sleep.fields.note.title", placeholder: "checkIn.steps.sleep.fields.note.placeholder" },
    },
  },
  wake: {
    title: "checkIn.steps.wake.title",
    description: "checkIn.steps.wake.description",
    fields: {
      state: { title: "checkIn.steps.wake.fields.state.title", options: ["checkIn.steps.wake.fields.state.options.veryEnergized", "checkIn.steps.wake.fields.state.options.energized", "checkIn.steps.wake.fields.state.options.neutral", "checkIn.steps.wake.fields.state.options.tired", "checkIn.steps.wake.fields.state.options.veryTired"] },
      factors: { title: "checkIn.steps.wake.fields.factors.title", options: ["checkIn.steps.wake.fields.factors.options.sleep", "checkIn.steps.wake.fields.factors.options.thoughts", "checkIn.steps.wake.fields.factors.options.tasks", "checkIn.steps.wake.fields.factors.options.physical", "checkIn.steps.wake.fields.factors.options.emotions", "checkIn.steps.wake.fields.factors.options.unsure"] },
      note: { title: "checkIn.steps.wake.fields.note.title", placeholder: "checkIn.steps.wake.fields.note.placeholder" },
    },
  },
  eat: {
    title: "checkIn.steps.eat.title",
    description: "checkIn.steps.eat.description",
    fields: {
      rhythm: { title: "checkIn.steps.eat.fields.rhythm.title", options: ["checkIn.steps.eat.fields.rhythm.options.veryRegular", "checkIn.steps.eat.fields.rhythm.options.regular", "checkIn.steps.eat.fields.rhythm.options.neutral", "checkIn.steps.eat.fields.rhythm.options.irregular", "checkIn.steps.eat.fields.rhythm.options.veryIrregular"] },
      mealCount: { title: "checkIn.steps.eat.fields.mealCount.title", options: ["checkIn.steps.eat.fields.mealCount.options.three", "checkIn.steps.eat.fields.mealCount.options.two", "checkIn.steps.eat.fields.mealCount.options.one", "checkIn.steps.eat.fields.mealCount.options.none", "checkIn.steps.eat.fields.mealCount.options.unsure"] },
      foodDetails: { title: "checkIn.steps.eat.fields.foodDetails.title", placeholder: "checkIn.steps.eat.fields.foodDetails.placeholder" },
      factors: { title: "checkIn.steps.eat.fields.factors.title", options: ["checkIn.steps.eat.fields.factors.options.busy", "checkIn.steps.eat.fields.factors.options.appetite", "checkIn.steps.eat.fields.factors.options.schedule", "checkIn.steps.eat.fields.factors.options.emotions", "checkIn.steps.eat.fields.factors.options.forgot", "checkIn.steps.eat.fields.factors.options.limited", "checkIn.steps.eat.fields.factors.options.unsure"] },
    },
  },
  exercise: {
    title: "checkIn.steps.exercise.title",
    description: "checkIn.steps.exercise.description",
    fields: {
      duration: { title: "checkIn.steps.exercise.fields.duration.title", options: ["checkIn.steps.exercise.fields.duration.options.none", "checkIn.steps.exercise.fields.duration.options.oneToNine", "checkIn.steps.exercise.fields.duration.options.tenToNineteen", "checkIn.steps.exercise.fields.duration.options.twentyToTwentyNine", "checkIn.steps.exercise.fields.duration.options.overThirty", "checkIn.steps.exercise.fields.duration.options.unsure"] },
      activityTypes: { title: "checkIn.steps.exercise.fields.activityTypes.title", options: ["checkIn.steps.exercise.fields.activityTypes.options.walking", "checkIn.steps.exercise.fields.activityTypes.options.stretching", "checkIn.steps.exercise.fields.activityTypes.options.pe", "checkIn.steps.exercise.fields.activityTypes.options.sports", "checkIn.steps.exercise.fields.activityTypes.options.daily", "checkIn.steps.exercise.fields.activityTypes.options.other"] },
      activityNote: { title: "checkIn.steps.exercise.fields.activityNote.title", placeholder: "checkIn.steps.exercise.fields.activityNote.placeholder" },
      bodyState: { title: "checkIn.steps.exercise.fields.bodyState.title", options: ["checkIn.steps.exercise.fields.bodyState.options.veryEnergized", "checkIn.steps.exercise.fields.bodyState.options.energized", "checkIn.steps.exercise.fields.bodyState.options.neutral", "checkIn.steps.exercise.fields.bodyState.options.tired", "checkIn.steps.exercise.fields.bodyState.options.veryTired"] },
      factors: { title: "checkIn.steps.exercise.fields.factors.title", options: ["checkIn.steps.exercise.fields.factors.options.tired", "checkIn.steps.exercise.fields.factors.options.time", "checkIn.steps.exercise.fields.factors.options.motivation", "checkIn.steps.exercise.fields.factors.options.sitting", "checkIn.steps.exercise.fields.factors.options.emotions", "checkIn.steps.exercise.fields.factors.options.physical", "checkIn.steps.exercise.fields.factors.options.unsure"] },
    },
  },
  task: {
    title: "checkIn.steps.task.title",
    description: "checkIn.steps.task.description",
    fields: {
      engagement: { title: "checkIn.steps.task.fields.engagement.title", options: ["checkIn.steps.task.fields.engagement.options.verySmooth", "checkIn.steps.task.fields.engagement.options.smooth", "checkIn.steps.task.fields.engagement.options.neutral", "checkIn.steps.task.fields.engagement.options.difficult", "checkIn.steps.task.fields.engagement.options.veryDifficult"] },
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
  const consent = useInlineStudentConsent();
  const draftOwner = useRef("");
  const draftRequest = useRef({ mounted: false, revision: 0, sequence: 0, controller: null as AbortController | null });
  const saveSequence = useRef(0);
  const activeSave = useRef(0);
  const answerRevision = useRef(0);
  const [saveLifecycle, setSaveLifecycle] = useState<SaveLifecycle>(() => ({ completedKeys: new Set() }));
  const currentSaveLifecycle = useRef(saveLifecycle);
  const resultLifecycle = useRef(new WeakMap<AiResult, SaveLifecycle>());
  const [rawCompleted, setRawCompleted] = useState(false);

  const startSaveLifecycle = useCallback(() => {
    const next: SaveLifecycle = { completedKeys: new Set() };
    currentSaveLifecycle.current = next;
    setSaveLifecycle(next);
    setRawCompleted(false);
    return next;
  }, []);
  // Identity events are synchronous; React may batch a complete A -> B -> A.
  // Unlike consent access epochs, this survives same-account revalidation.
  const identity = useRef({ actor: undefined as string | undefined, epoch: 0 });
  const conflictRequired = useRef(false);
  const [conflicted, setConflicted] = useState(false);
  const previewSequence = useRef(0);
  const [reviewing, setReviewing] = useState(false);
  const [preview, setPreview] = useState<{ scope: SweetScope; current: () => boolean } | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [savableResult, setSavableResult] = useState<AiResult | null>(null);
  const [urgentReply, setUrgentReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [sensitiveConsentAccepted, setSensitiveConsentAccepted] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedRecordKey, setSavedRecordKey] = useState("");
  const [savedContentKey, setSavedContentKey] = useState("");
  const lastSaved = useRef<{
    recordKey: string; contentKey: string; result: SavedSummary | null;
    createdAt: string; operation: number; sameDraft: () => boolean;
    accessCurrent: () => boolean; scope: SweetScope;
  } | null>(null);
  const pendingWrite = useRef<{ scope: SweetScope; contentKey: string; recordKey: string;
    intent: SummaryIntent; record: SweetRecordInput; operation: number; sameDraft: () => boolean } | null>(null);
  const aiPersistence = useRef<{ result: AiResult; scope: SweetScope } | null>(null);
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

  useEffect(() => {
    const scope = draftRequest.current;
    const answersScope = answerRevision;
    scope.mounted = true;
    return () => {
      scope.mounted = false;
      ++scope.sequence;
      ++answersScope.current;
      scope.controller?.abort();
      activeSave.current = 0;
    };
  }, []);

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

  const cancelSummary = useCallback(() => {
    // Retire captured save/generate callbacks, but retain any dispatched
    // command in pendingWrite for reconciliation at its original expected head.
    startSaveLifecycle();
    setSavableResult(null);
    const scope = draftRequest.current;
    ++scope.revision;
    ++scope.sequence;
    scope.controller?.abort();
    scope.controller = null;
    setLoading(false);
    ++previewSequence.current;
    setPreview(null);
    setReviewing(false);
    setAiResult(null);
    aiPersistence.current = null;
    setError("");
    // Storage already dispatched may still finish. Keep its busy state until
    // that operation settles; its old result must not mark this new draft saved.
  }, [startSaveLifecycle]);

  function setSingleValue(fieldId: string, value: string) {
    ++answerRevision.current;
    pendingWrite.current = null;
    cancelSummary();
    setAnswers((current) => ({ ...current, [step.id]: { ...current[step.id], [fieldId]: value } }));
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setSavedContentKey("");
    lastSaved.current = null;
    setSensitiveConsentAccepted(false);
    setAiResult(null);
    setUrgentReply("");
  }

  function toggleMultiValue(fieldId: string, value: string) {
    ++answerRevision.current;
    pendingWrite.current = null;
    cancelSummary();
    setAnswers((current) => {
      const existing = current[step.id][fieldId];
      const list = Array.isArray(existing) ? existing : [];
      const exclusiveOptions = new Set(["不太确定"]);
      const next = list.includes(value)
        ? list.filter((item) => item !== value)
        : exclusiveOptions.has(value)
          ? [value]
          : [...list.filter((item) => !exclusiveOptions.has(item)), value];
      return { ...current, [step.id]: { ...current[step.id], [fieldId]: next } };
    });
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setSavedContentKey("");
    lastSaved.current = null;
    setAiResult(null);
    setUrgentReply("");
  }

  function setTextValue(fieldId: string, value: string) {
    ++answerRevision.current;
    pendingWrite.current = null;
    cancelSummary();
    setAnswers((current) => ({ ...current, [step.id]: { ...current[step.id], [fieldId]: value } }));
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setSavedContentKey("");
    lastSaved.current = null;
    setAiResult(null);
    setUrgentReply("");
  }

  function goNext() {
    if (!canGoNext) {
      setValidation(t("checkIn.messages.selectRequired"));
      return;
    }
    setValidation("");
    goToStep(currentStep + 1);
  }

  const reset = useCallback(() => {
    ++answerRevision.current;
    pendingWrite.current = null;
    cancelSummary();
    setAnswers(initialAnswers);
    setCurrentStep(0);
    setAiResult(null);
    setUrgentReply("");
    setError("");
    setValidation("");
    setSaveStatus("");
    setSavedRecordKey("");
    setSavedContentKey("");
    lastSaved.current = null;
    setSensitiveConsentAccepted(false);
    setDetailsOpen({ sleep: false, wake: false, eat: false, exercise: false, task: false });
  }, [cancelSummary]);

  useEffect(() => {
    if (draftOwner.current && draftOwner.current !== consent.userId) {
      activeSave.current = 0;
      reset();
      setSaving(false);
    }
    draftOwner.current = consent.userId;
  }, [consent.userId, reset]);

  useEffect(() => {
    const subscription = getSupabase()?.auth.onAuthStateChange((event, session) => {
      const actor = session?.user.id || "";
      if (identity.current.actor === undefined) { identity.current.actor = actor; return; }
      if (identity.current.actor === actor && event !== "SIGNED_OUT") return;
      identity.current = { actor, epoch: identity.current.epoch + 1 };
      pendingWrite.current = null;
      aiPersistence.current = null;
      lastSaved.current = null;
      conflictRequired.current = false;
      setConflicted(false);
      activeSave.current = 0;
      setSaving(false);
      reset();
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, [reset]);

  function requireConflictReview() {
    conflictRequired.current = true;
    setConflicted(true);
    ++previewSequence.current;
    setPreview(null);
    setReviewing(false);
  }

  async function reviewLatest() {
    if (!conflictRequired.current || activeSave.current || reviewing || !consent.canProceed) return;
    const sequence = ++previewSequence.current;
    const epoch = identity.current.epoch;
    const answersAtReview = answerRevision.current;
    const revision = draftRequest.current.revision;
    const accessCurrent = consent.trackRequest();
    const current = () => draftRequest.current.mounted && sequence === previewSequence.current
      && epoch === identity.current.epoch && answersAtReview === answerRevision.current
      && revision === draftRequest.current.revision && accessCurrent();
    setPreview(null);
    setReviewing(true);
    try {
      const scope = await readCloudSweetScope(consent.userId, undefined, current);
      if (current()) { setPreview({ scope, current }); setSaveStatus(""); }
    } catch (error) {
      if (current()) setSaveStatus(recordSaveErrorMessage(error));
    } finally {
      if (sequence === previewSequence.current) setReviewing(false);
    }
  }

  function confirmReviewed(result: AiResult | null) {
    if (!preview || activeSave.current) return;
    if (!preview.current() || sweetStoredDay(new Date().toISOString()) !== preview.scope.operationDay) {
      ++previewSequence.current;
      setPreview(null);
      setSaveStatus(t("checkIn.messages.persistenceScopeExpired"));
      return;
    }
    const scope = preview.scope;
    ++previewSequence.current;
    setPreview(null);
    // This is a new, explicit operation against the displayed version.
    // saveCurrentRecord must not read a newer baseline during confirmation.
    const lifecycle = startSaveLifecycle();
    setSavableResult(result);
    if (result) resultLifecycle.current.set(result, lifecycle);
    void saveCurrentRecord(result, undefined, scope, true, lifecycle);
  }

  function getRecordPayload() {
    return steps.map((item) => ({
      id: item.id,
      title: item.title,
      label: item.label,
      fields: item.fields.map((field) => ({ id: field.id, title: field.title, value: answers[item.id][field.id] })),
    }));
  }

  function renderRecords(records: SweetRecordInput["records"]) {
    return records.map((record) => {
      const step = steps.find((item) => item.id === record.id);
      if (!step) return null;
      const copy = stepCopyKeys[step.id];
      return <div key={record.id} className="mt-3">
        <h4 className="font-bold">{t(copy.title)}</h4>
        <dl className="text-sm leading-7">{record.fields.filter((field) => isFieldComplete(field.value)).map((field) => {
          const fieldCopy = copy.fields[field.id];
          const definition = step.fields.find((item) => item.id === field.id);
          const display = (value: string) => {
            const index = definition?.options?.indexOf(value) ?? -1;
            const key = index >= 0 ? fieldCopy?.options?.[index] : undefined;
            return key ? t(key) : value;
          };
          return <div key={field.id}><dt>{fieldCopy ? t(fieldCopy.title) : field.title}</dt>
            <dd className="whitespace-pre-wrap break-words">{Array.isArray(field.value) ? field.value.map(display).join(locale === "en" ? ", " : "、") : display(field.value)}</dd></div>;
        })}</dl>
      </div>;
    });
  }

  function renderSummary(result: SavedSummary | null) {
    return result ? <dl className="mt-3 text-sm leading-7">
      <dt className="font-bold">{t("checkIn.result.title")}</dt><dd className="whitespace-pre-wrap break-words">{result.summary || t("checkIn.conflict.noSummary")}</dd>
      <dt className="font-bold">{t("checkIn.result.smallStep")}</dt><dd className="whitespace-pre-wrap break-words">{result.smallStep || t("checkIn.conflict.noSummary")}</dd>
      <dt className="font-bold">{t("checkIn.result.nextTool")}</dt><dd className="whitespace-pre-wrap break-words">{result.recommendedNextTool || t("checkIn.conflict.noSummary")}</dd>
    </dl> : <p className="mt-3 text-sm">{t("checkIn.conflict.noSummary")}</p>;
  }

  function getContentKey(result: SavedSummary | null) {
    return JSON.stringify({
      records: getRecordPayload(),
      summary: result?.summary || null,
      smallStep: result?.smallStep || null,
      recommendedNextTool: result?.recommendedNextTool || null,
    });
  }

  function recordSaveErrorMessage(saveError: unknown) {
    const message = saveError instanceof Error ? saveError.message : "";
    if (saveError instanceof SweetPersistenceError) {
      if (saveError.code === "conflict") return t("checkIn.messages.persistenceConflict");
      if (saveError.code === "scope_expired") return t("checkIn.messages.persistenceScopeExpired");
      if (saveError.code === "outcome_unknown") return t("checkIn.messages.persistenceUnknown");
      if (saveError.code === "denied") return t("inlineConsent.consentNeeded");
      if (saveError.code === "write_rejected") return t("checkIn.messages.saveFailed");
      // An unavailable read cannot settle a previous write's unknown outcome.
      if (saveError.code === "protocol_unavailable") return t("checkIn.messages.persistenceUnavailable");
      return t("checkIn.messages.persistenceUnavailable");
    }
    const normalized = message.toLowerCase();
    if (normalized.includes("知情") || normalized.includes("使用确认") || normalized.includes("consent")) return t("inlineConsent.consentNeeded");
    if (normalized.includes("jwt") || normalized.includes("session") || normalized.includes("登录")) {
      return t("checkIn.messages.sessionExpired");
    }
    if (normalized.includes("row-level security") || normalized.includes("permission") || normalized.includes("42501")) {
      return t("checkIn.messages.permissionDenied");
    }
    if (normalized.includes("fetch") || normalized.includes("network") || normalized.includes("failed to")) {
      return t("checkIn.messages.networkError");
    }
    // Opaque SDK/auth/read errors provide no evidence about a prior commit.
    return t("checkIn.messages.persistenceUnavailable");
  }

  async function saveCurrentRecord(result: AiResult | null = aiResult, expectedRevision?: number, frozenScope?: SweetScope, reviewed = false, lifecycle = saveLifecycle) {
    // Captured callbacks belong to their original operation, even after a new
    // render, edit, identity change or explicit generation has started.
    if (currentSaveLifecycle.current !== lifecycle) return;
    if (result && resultLifecycle.current.get(result) !== lifecycle) return;
    const requestedKey = getContentKey(result);
    if (lifecycle.completedKeys.has(requestedKey)) return;
    if (saving || activeSave.current) return;
    if (showUrgentIfNeeded()) return;
    if (conflictRequired.current && !reviewed) { setSaveStatus(t("checkIn.messages.persistenceConflict")); return; }
    if (!allRequiredDone) { setValidation(t("checkIn.messages.completeBeforeSave")); return; }
    if (!consent.canProceed) { setSaveStatus(t("inlineConsent.consentNeeded")); return; }
    const ui = draftRequest.current;
    const revision = expectedRevision ?? ui.revision;
    const actor = consent.userId;
    const sameActor = consent.trackRequest();
    const identityAtSave = identity.current.epoch;
    const current = () => ui.mounted && ui.revision === revision && currentSaveLifecycle.current === lifecycle
      && identity.current.epoch === identityAtSave && sameActor();
    if (!current()) return;
    const records = getRecordPayload();
    const recordKey = sweetRecordsKey(records);
    const answersAtSave = answerRevision.current;
    // Persistence facts survive AI choices/access rechecks. Only UI/access
    // guards can confirm a result for the current screen.
    const sameDraft = () => ui.mounted && answerRevision.current === answersAtSave && identity.current.epoch === identityAtSave && consent.isSameActor(actor);
    const receipt = !reviewed && lastSaved.current?.sameDraft() && lastSaved.current.recordKey === recordKey ? lastSaved.current : null;
    const pendingDraft = !reviewed && pendingWrite.current?.sameDraft() && pendingWrite.current.recordKey === recordKey ? pendingWrite.current : null;
    const retry = pendingDraft?.contentKey === requestedKey ? pendingDraft : null;
    const generated = result && aiPersistence.current?.result === result ? aiPersistence.current.scope : undefined;
    const operation = ++saveSequence.current;
    activeSave.current = operation;
    setSaving(true);
    setSaveStatus("");
    try {
      const user = await getCurrentUser();
      if (!current()) return;
      if (!user) { setSaveStatus(t("checkIn.messages.signInToSave")); return; }
      // Every independent action gets a database baseline. An unknown retry or
      // an AI operation uses its already frozen baseline, never a newer token.
      const frozen = frozenScope ?? retry?.scope ?? generated ?? pendingDraft?.scope;
      const basis = frozen ?? await readCloudSweetScope(actor, undefined, current);
      if (!current()) return;
      const sameDayReceipt = receipt?.scope.targetDay === basis.targetDay ? receipt : null;
      const reconciliation = result === null && sameDayReceipt !== null && !sameDayReceipt?.accessCurrent();
      const protectsUnknownSummary = result === null && pendingDraft?.intent === "replace_summary"
        && pendingDraft.scope.targetDay === basis.targetDay;
      let intent: SummaryIntent = retry?.intent ?? (result !== null ? "replace_summary" : !reviewed && (sameDayReceipt || protectsUnknownSummary) ? "preserve_summary" : "clear_summary");
      let acceptedBasis = basis;
      let source = basis.record;
      if (source && source.user_id !== actor) throw new SweetPersistenceError("protocol_unavailable");
      let stored: CloudSweetRecord;
      if (reconciliation || intent === "preserve_summary") {
        // Preserving unchanged answers is a read reconciliation, never a
        // reason to rebase an old mutation or write a null downgrade.
        if (frozen) {
          acceptedBasis = await readCloudSweetScope(actor, basis.targetDay, current);
          if (!current()) return;
          if (acceptedBasis.operationDay !== basis.operationDay) throw new SweetPersistenceError("scope_expired");
          source = acceptedBasis.record;
        }
        // Query errors/missing rows are unknown, not an instruction to clear.
        if (!source && pendingDraft && acceptedBasis.headToken === basis.headToken) {
          // An authoritative empty read allows a fresh raw save at the ORIGINAL
          // expected version. It cannot erase a committed/unknown summary.
          intent = "clear_summary";
          const record = structuredClone({ records });
          pendingWrite.current = { scope: basis, contentKey: requestedKey, recordKey, intent, record, operation, sameDraft };
          stored = await saveCloudSweetRecord(record, actor, { scope: basis, intent, current });
        } else {
          if (!source || sweetRecordsKey(source.records) !== recordKey) throw new SweetPersistenceError("protocol_unavailable");
          stored = source;
        }
      } else {
        const preserving = result;
        const recordPayload = retry?.record ?? structuredClone({ records, summary: preserving?.summary ?? undefined,
          smallStep: preserving?.smallStep ?? undefined, recommendedNextTool: preserving?.recommendedNextTool ?? undefined });
        // This shortcut is a fresh authoritative read, not an old receipt or
        // a cached baseline from an in-flight/unknown operation.
        const alreadyCurrent = !frozen && source && sweetRecordsKey(source.records) === recordKey
          && getContentKey(savedSummary(source)) === getContentKey(preserving);
        if (alreadyCurrent && source) stored = source;
        else {
          pendingWrite.current = { scope: basis, contentKey: requestedKey, recordKey, intent, record: recordPayload, operation, sameDraft };
          stored = await saveCloudSweetRecord(recordPayload, actor, { scope: basis, intent, current });
        }
      }
      if (pendingWrite.current?.operation === operation || (pendingDraft && acceptedBasis.headToken !== pendingDraft.scope.headToken)) pendingWrite.current = null;
      if (!sameDraft() || activeSave.current !== operation || operation < (lastSaved.current?.operation ?? 0)) return;
      if (stored.user_id !== actor) throw new SweetPersistenceError("protocol_unavailable");
      const persistedResult = savedSummary(stored);
      const persistedKey = getContentKey(persistedResult);
      const acceptedScope: SweetScope = { ...acceptedBasis, headToken: stored.id, record: stored };
      lastSaved.current = { recordKey, contentKey: persistedKey, result: persistedResult, scope: acceptedScope,
        createdAt: stored.created_at, operation, sameDraft, accessCurrent: sameActor };
      // Close the mutation even when an AI choice/access recheck invalidated
      // its UI. Read-only preserve reconciliation never completes a null write.
      const canConfirm = current();
      const completesMutation = intent !== "preserve_summary" && persistedKey === requestedKey;
      if (completesMutation) {
        lifecycle.completedKeys.add(requestedKey);
        if (result) setSavableResult((selected) => selected === result ? null : selected);
        if (currentSaveLifecycle.current === lifecycle) {
          const terminal: SaveLifecycle = { completedKeys: new Set(lifecycle.completedKeys) };
          currentSaveLifecycle.current = terminal;
          setSaveLifecycle(terminal);
          if (result === null) setRawCompleted(true);
        }
      }
      if (result !== null && aiPersistence.current?.result === result) aiPersistence.current = null;
      if (!canConfirm) return;
      if (reviewed) { conflictRequired.current = false; setConflicted(false); }
      setSavedRecordKey(recordKey);
      setSavedContentKey(persistedKey);
      const confirmsVisible = !aiResult || persistedKey === getContentKey(result ?? aiResult);
      setSaveStatus(confirmsVisible ? t(reconciliation || (sameDayReceipt && source?.id === stored.id)
        ? "checkIn.messages.alreadySaved" : "checkIn.messages.saved") : "");

    } catch (saveError) {
      // Retain the complete dispatched command on every failure. A fresh read
      // is allowed for reconciliation/review, never to rebase this command.
      if (saveError instanceof SweetPersistenceError && ["conflict", "scope_expired"].includes(saveError.code)
        && sameDraft()) requireConflictReview();
      if (!current()) return;
      if (saveError instanceof SweetPersistenceError && saveError.code === "denied") void consent.refresh();
      reportClientOperationFailure("save", "sweet_record_save", saveError);
      setSaveStatus(recordSaveErrorMessage(saveError));
    } finally {
      if (ui.mounted && activeSave.current === operation) { activeSave.current = 0; setSaving(false); }
    }
  }

  function beginSummaryRequest() {
    const scope = draftRequest.current;
    const revision = scope.revision;
    const sequence = ++scope.sequence;
    const controller = new AbortController();
    scope.controller?.abort();
    scope.controller = controller;
    const sameActor = consent.trackRequest();
    return {
      revision,
      controller,
      current: () => scope.mounted && scope.revision === revision && scope.sequence === sequence && sameActor(),
    };
  }

  function finishSummaryRequest(request: ReturnType<typeof beginSummaryRequest>) {
    const scope = draftRequest.current;
    // Access revalidation can invalidate a response without starting a newer
    // request. The owner must still release its busy state when it settles.
    if (scope.controller === request.controller) {
      scope.controller = null;
      if (scope.mounted) setLoading(false);
    }
  }

  async function requestSummary(request: ReturnType<typeof beginSummaryRequest>): Promise<AiResult | AiUrgentResponse> {
    const payload = {
      locale,
      currentDate: new Date().toISOString(),
      sensitiveConsentAccepted,
      aiNoticeAccepted: sensitiveConsentAccepted,
      aiNoticeVersion: AI_NOTICE_VERSION,
      records: getRecordPayload().map((item) => ({ ...item, dimension: `${item.label} ${item.title}` })),
    };
    const headers = await aiRequestHeaders(consent.userId);
    if (!request.current()) throw new Error("summary_interrupted");
    const response = await fetch("/api/ai/check-in", {
      method: "POST",
      headers,
      signal: request.controller.signal,
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!request.current()) throw new Error("summary_interrupted");
    if (response.status === 401 || response.status === 403) void consent.refresh();
    if (!response.ok) throw new Error(data.error || t("checkIn.messages.summaryFailed"));
    return data as AiResult | AiUrgentResponse;
  }

  async function generateSummary() {
    if (currentSaveLifecycle.current !== saveLifecycle) return;
    if (loading || saving || activeSave.current) return;
    if (showUrgentIfNeeded()) return;
    if (conflictRequired.current) { setSaveStatus(t("checkIn.messages.persistenceConflict")); return; }
    if (!allRequiredDone) {
      setValidation(t("checkIn.messages.completeBeforeGenerate"));
      return;
    }
    if (!consent.studentReady) { setValidation(t("inlineConsent.consentNeeded")); return; }
    if (!sensitiveConsentAccepted) { setValidation(t("aiTransparency.confirm")); return; }
    const lifecycle = startSaveLifecycle();
    setSavableResult(null);
    const request = beginSummaryRequest();
    const current = () => currentSaveLifecycle.current === lifecycle && request.current();

    setLoading(true);
    setError("");
    setValidation("");
    setSaveStatus("");
    try {
      const persistenceScope = await readCloudSweetScope(consent.userId, undefined, current);
      if (!current()) return;
      const result = await requestSummary(request);
      if (!current()) return;
      if (isAiUrgentResponse(result)) {
        setAiResult(null);
        setUrgentReply(result.reply);
        return;
      }
      setUrgentReply("");
      setAiResult(result);
      setSavableResult(result);
      resultLifecycle.current.set(result, lifecycle);
      aiPersistence.current = { result, scope: persistenceScope };
    } catch (requestError) {
      if (!current()) return;
      if (requestError instanceof SweetPersistenceError) setSaveStatus(recordSaveErrorMessage(requestError));
      else setError(requestError instanceof Error ? requestError.message : t("checkIn.messages.responseUnavailable"));
    } finally {
      finishSummaryRequest(request);
    }
  }

  async function generateAndSave() {
    if (currentSaveLifecycle.current !== saveLifecycle) return;
    if (loading || saving || activeSave.current) return;
    if (showUrgentIfNeeded()) return;
    if (conflictRequired.current) { setSaveStatus(t("checkIn.messages.persistenceConflict")); return; }
    if (!allRequiredDone) {
      setValidation(t("checkIn.messages.completeRequired"));
      return;
    }
    if (!consent.studentReady) { setValidation(t("inlineConsent.consentNeeded")); return; }
    if (!sensitiveConsentAccepted) { setValidation(t("aiTransparency.confirm")); return; }
    const lifecycle = startSaveLifecycle();
    setSavableResult(null);
    const request = beginSummaryRequest();
    const current = () => currentSaveLifecycle.current === lifecycle && request.current();

    setLoading(true);
    setError("");
    setValidation("");
    setSaveStatus("");
    let persistenceScope: SweetScope | undefined;
    try {
      persistenceScope = await readCloudSweetScope(consent.userId, undefined, current);
      if (!current()) return;
      const result = await requestSummary(request);
      if (!current()) return;
      if (isAiUrgentResponse(result)) {
        setAiResult(null);
        setUrgentReply(result.reply);
        return;
      }
      setUrgentReply("");
      setAiResult(result);
      setSavableResult(result);
      resultLifecycle.current.set(result, lifecycle);
      aiPersistence.current = { result, scope: persistenceScope };
      await saveCurrentRecord(result, request.revision, persistenceScope, false, lifecycle);
    } catch (requestError) {
      if (!current()) return;
      if (requestError instanceof SweetPersistenceError) {
        setSaveStatus(recordSaveErrorMessage(requestError));
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("checkIn.messages.summaryUnavailableSaveAllowed"),
      );
      if (persistenceScope) await saveCurrentRecord(null, request.revision, persistenceScope, false, lifecycle);
    } finally {
      finishSummaryRequest(request);
    }
  }

  function showUrgentIfNeeded() {
    if (!detectCrisisInValues(getRecordPayload(), locale).isUrgent) return false;
    setAiResult(null); setUrgentReply(getCrisisResponse(locale));
    return true;
  }

  return (
    <>
      <PageHero
        label={t("checkIn.hero.label")}
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
        <div className="container mb-6">
          <Link href="/garden" className="button-secondary">{t("gardenWelcome.back")}</Link>
          <details className="mt-4 rounded-2xl border border-sage/20 p-4">
            <summary className="cursor-pointer font-semibold text-sage-dark">{t("gardenWelcome.guide")}</summary>
            <GardenGuide />
          </details>
        </div>
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
                                aria-pressed={selected}
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
                              aria-pressed={selected}
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
                <InlineStudentConsent controller={consent} className="mt-7" />
              ) : null}
              {currentStep === steps.length - 1 ? (
                <AiTransparencyNotice
                  id="check-in-ai-notice"
                  className="mt-7"
                  checked={sensitiveConsentAccepted}
                  onChange={(checked) => { cancelSummary(); setSensitiveConsentAccepted(checked); }}
                />
              ) : null}

              <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
                {currentStep === steps.length - 1 ? <button type="button" className="button-secondary w-full sm:w-auto"
                  disabled={loading || saving || rawCompleted || !allRequiredDone} onClick={() => void saveCurrentRecord(null)}>
                  {t(saving ? "checkIn.actions.saving" : "checkIn.actions.saveFirst")}
                </button> : null}
                <button type="button" className="button-secondary w-full sm:w-auto" disabled={currentStep === 0} onClick={() => goToStep(currentStep - 1)}>
                  {t("checkIn.actions.previous")}
                </button>
                {currentStep < steps.length - 1 ? (
                  <button type="button" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto" disabled={!canGoNext} onClick={goNext}>
                    {t("checkIn.actions.next")}
                  </button>
                ) : (
                  <button type="button" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto" disabled={!allRequiredDone || loading || saving} onClick={generateAndSave}>
                    {loading || saving ? t("checkIn.actions.generatingAndSaving") : t("checkIn.actions.generateAndSave")}
                  </button>
                )}
              </div>
            </article>

            {saveStatus ? <p className="mt-5 rounded-2xl bg-white/80 p-4 text-sm font-bold text-sage-dark">{saveStatus}</p> : null}
            {conflicted ? <section role="region" aria-labelledby="sweet-conflict-title" className="mt-5 rounded-2xl border border-sage/25 bg-white/85 p-5">
              <h2 id="sweet-conflict-title" className="font-bold">{t("checkIn.conflict.title")}</h2>
              <p className="mt-2 text-sm leading-7">{t("checkIn.conflict.explanation")}</p>
              <button type="button" className="button-secondary mt-4" disabled={reviewing || saving || !consent.canProceed} onClick={() => void reviewLatest()}>
                {t(reviewing ? "checkIn.conflict.viewing" : "checkIn.conflict.view")}
              </button>
              {preview ? <>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0 rounded-2xl bg-mist/65 p-4">
                    <h3 className="font-bold">{t("checkIn.conflict.latest")}</h3>
                    {preview.scope.record ? <>
                      <p className="text-sm">{t("checkIn.conflict.savedAt", { time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(preview.scope.record.created_at)) })}</p>
                      {renderRecords(preview.scope.record.records)}
                      {renderSummary(savedSummary(preview.scope.record))}
                    </> : <p className="mt-3 text-sm">{t("checkIn.conflict.noRecord")}</p>}
                  </div>
                  <div className="min-w-0 rounded-2xl border border-ink/10 p-4">
                    <h3 className="font-bold">{t("checkIn.conflict.draft")}</h3>
                    {renderRecords(getRecordPayload())}
                    {renderSummary(aiResult)}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {aiResult ? <button type="button" className="button-primary max-w-full whitespace-normal" disabled={saving || !preview.current() || !consent.canProceed} onClick={() => confirmReviewed(aiResult)}>{t("checkIn.conflict.confirmSummary")}</button> : null}
                  <button type="button" className="button-secondary max-w-full whitespace-normal" disabled={saving || !preview.current() || !consent.canProceed} onClick={() => confirmReviewed(null)}>{t("checkIn.conflict.confirmRaw")}</button>
                  <button type="button" className="button-secondary max-w-full whitespace-normal" disabled={saving} onClick={() => { ++previewSequence.current; setPreview(null); }}>{t("checkIn.conflict.cancel")}</button>
                </div>
              </> : null}
            </section> : null}
            {error ? (
              <div className="mt-6 rounded-2xl bg-white/80 p-5">
                <p className="text-sm font-bold text-sage-dark">{error}</p>
                <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap">
                  <button type="button" className="button-primary w-full sm:w-auto" disabled={loading} onClick={generateSummary}>
                    {loading ? t("checkIn.actions.retrying") : t("checkIn.actions.regenerate")}
                  </button>
                  <button type="button" className="button-secondary w-full sm:w-auto" disabled={loading || saving || (aiResult ? aiResult !== savableResult : rawCompleted)} onClick={() => saveCurrentRecord()}>
                    {saving ? t("checkIn.actions.saving") : t("checkIn.actions.saveFirst")}
                  </button>
                </div>
              </div>
            ) : null}

            {urgentReply ? <AiUrgentNotice message={urgentReply} className="mt-8" /> : null}

            {aiResult ? (
              <section ref={resultRef} className="mt-8 scroll-mt-24 rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:scroll-mt-28 sm:p-8">
                <AiGeneratedLabel className="mb-3" />
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
                  <button type="button" className="button-primary w-full sm:w-auto" disabled={loading || saving || (aiResult ? aiResult !== savableResult : rawCompleted)} onClick={() => saveCurrentRecord()}>
                    {saving ? t("checkIn.actions.saving") : savedContentKey === getContentKey(aiResult) ? t("checkIn.actions.savedToAccount") : t("checkIn.actions.saveToAccount")}
                  </button>
                  <Link href="/mood-journal" className="button-secondary w-full sm:w-auto">{t("checkIn.actions.openMoodJournal")}</Link>
                  <Link href="/worry-time" className="button-secondary w-full sm:w-auto">{t("checkIn.actions.openWorryTime")}</Link>
                  <Link href="/referral" className="button-secondary w-full sm:w-auto">{t("checkIn.actions.viewReferral")}</Link>
                  <button type="button" className="button-secondary w-full sm:w-auto" onClick={reset}>{t("checkIn.actions.reset")}</button>
                </div>
              </section>
            ) : null}
            <MicroPilotFeedback feature="sweet" trigger={savedRecordKey} crisis={Boolean(urgentReply)} />
          </div>
        </div>
      </section>
    </>
  );
}
