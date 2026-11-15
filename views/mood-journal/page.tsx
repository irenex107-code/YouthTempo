import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { InlineStudentConsent } from "@/components/InlineStudentConsent";
import { InlineConsentDialog } from "@/components/InlineConsentDialog";
import { useInlineStudentConsent } from "@/lib/useInlineStudentConsent";
import { detectCrisisInValues, getCrisisResponse } from "@/lib/safety/crisisDetection";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { AiUrgentNotice } from "@/components/AiUrgentNotice";
import { AiGeneratedLabel, AiTransparencyNotice } from "@/components/AiTransparencyNotice";
import { AI_NOTICE_VERSION } from "@/lib/aiNotice";
import { aiRequestHeaders } from "@/lib/aiClient";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { isAiUrgentResponse } from "@/lib/safety/aiUrgentResponse";

const emotionGroups = [
  { key: "pressure", labelKey: "moodJournal.emotions.groups.pressure.title" as TranslationKey, words: [
    { value: "紧张", labelKey: "moodJournal.emotions.groups.pressure.words.tense" as TranslationKey },
    { value: "焦虑", labelKey: "moodJournal.emotions.groups.pressure.words.anxious" as TranslationKey },
    { value: "压迫", labelKey: "moodJournal.emotions.groups.pressure.words.pressured" as TranslationKey },
    { value: "不安", labelKey: "moodJournal.emotions.groups.pressure.words.uneasy" as TranslationKey },
  ] },
  { key: "low", labelKey: "moodJournal.emotions.groups.low.title" as TranslationKey, words: [
    { value: "难过", labelKey: "moodJournal.emotions.groups.low.words.sad" as TranslationKey },
    { value: "空", labelKey: "moodJournal.emotions.groups.low.words.empty" as TranslationKey },
    { value: "委屈", labelKey: "moodJournal.emotions.groups.low.words.hurt" as TranslationKey },
    { value: "没动力", labelKey: "moodJournal.emotions.groups.low.words.unmotivated" as TranslationKey },
  ] },
  { key: "irritable", labelKey: "moodJournal.emotions.groups.irritable.title" as TranslationKey, words: [
    { value: "烦躁", labelKey: "moodJournal.emotions.groups.irritable.words.irritable" as TranslationKey },
    { value: "生气", labelKey: "moodJournal.emotions.groups.irritable.words.angry" as TranslationKey },
    { value: "想躲开", labelKey: "moodJournal.emotions.groups.irritable.words.avoid" as TranslationKey },
    { value: "不想说话", labelKey: "moodJournal.emotions.groups.irritable.words.quiet" as TranslationKey },
  ] },
  { key: "unclear", labelKey: "moodJournal.emotions.groups.unclear.title" as TranslationKey, words: [
    { value: "说不清", labelKey: "moodJournal.emotions.groups.unclear.words.unclear" as TranslationKey },
    { value: "很乱", labelKey: "moodJournal.emotions.groups.unclear.words.messy" as TranslationKey },
    { value: "麻木", labelKey: "moodJournal.emotions.groups.unclear.words.numb" as TranslationKey },
    { value: "累", labelKey: "moodJournal.emotions.groups.unclear.words.tired" as TranslationKey },
  ] },
];

const starters = [
  { value: "我现在有点乱，能先听我慢慢说吗？", key: "moodJournal.starters.default.confused" as TranslationKey },
  { value: "你先听我说完，可以吗？", key: "moodJournal.starters.default.listen" as TranslationKey },
  { value: "我最近真的有点累，能先陪我一下吗？", key: "moodJournal.starters.default.tired" as TranslationKey },
  { value: "我不是不想做，是现在有点不知道怎么开始。", key: "moodJournal.starters.default.stuck" as TranslationKey },
];

function buildStarterOptions(reflectionText: string) {
  if (/拖|开始|任务|作业|学习|催|压力|做不好/.test(reflectionText)) {
    return [
      { value: "我不是不想做，是现在有点不知道怎么开始。能陪我先拆小一点吗？", key: "moodJournal.starters.context.task" as TranslationKey },
      ...starters,
    ];
  }
  if (/不想说|说不清|乱|麻木|累/.test(reflectionText)) {
    return [
      { value: "我现在有点乱，还没想好怎么说。你能先听听吗？", key: "moodJournal.starters.context.unclear" as TranslationKey },
      ...starters,
    ];
  }
  if (/评价|吵|冲突|生气|烦/.test(reflectionText)) {
    return [
      { value: "你先听我说完，可以吗？我现在还不太需要建议。", key: "moodJournal.starters.context.conflict" as TranslationKey },
      ...starters,
    ];
  }
  return starters;
}

type MoodAiResult = {
  emotionReflection: string;
  possibleNeed: string;
  communicationSuggestion: string;
  smallStep: string;
  supportReminder: string;
};

export default function MoodJournalPage() {
  const { locale, t } = useTranslation();
  const consent = useInlineStudentConsent();
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  const reflectionInputRef = useRef<HTMLTextAreaElement>(null);
  const draftOwner = useRef("");
  const draftRequest = useRef({ mounted: false, revision: 0, sequence: 0, controller: null as AbortController | null });
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [context, setContext] = useState("");
  const [body, setBody] = useState("");
  const [understanding, setUnderstanding] = useState("");
  const [support, setSupport] = useState("");
  const [starterIndex, setStarterIndex] = useState(0);
  const [showAllStarters, setShowAllStarters] = useState(false);
  const [aiResult, setAiResult] = useState<MoodAiResult | null>(null);
  const [urgentReply, setUrgentReply] = useState("");
  const [aiNoticeAccepted, setAiNoticeAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");

  useEffect(() => {
    const scope = draftRequest.current;
    scope.mounted = true;
    return () => {
      scope.mounted = false;
      ++scope.sequence;
      scope.controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (consent.studentReady) { setConsentDialogOpen(false); setValidation(""); }
  }, [consent.studentReady]);

  useEffect(() => {
    if (draftOwner.current && draftOwner.current !== consent.userId) {
      cancelAiRequest();
      setSelectedWords([]); setContext(""); setBody(""); setUnderstanding(""); setSupport("");
      setAiResult(null); setUrgentReply(""); setAiNoticeAccepted(false); setError(""); setValidation("");
      setLoading(false);
    }
    draftOwner.current = consent.userId;
  }, [consent.userId]);

  function cancelAiRequest() {
    const scope = draftRequest.current;
    ++scope.revision;
    ++scope.sequence;
    scope.controller?.abort();
    scope.controller = null;
    setLoading(false);
    setAiResult(null);
    setError("");
    setValidation("");
  }

  function updateReflection(setValue: (value: string) => void, value: string) {
    cancelAiRequest();
    setValue(value);
  }

  function toggleWord(word: string) {
    cancelAiRequest();
    setSelectedWords((current) =>
      current.includes(word) ? current.filter((item) => item !== word) : [...current, word],
    );
  }

  const starterOptions = buildStarterOptions(`${context} ${body} ${understanding} ${support}`);
  const starter = starterOptions[starterIndex % starterOptions.length];

  function generateStarter() {
    cancelAiRequest();
    setStarterIndex((current) => current + 1);
  }

  function continueEditing() {
    reflectionInputRef.current?.focus();
    reflectionInputRef.current?.scrollIntoView({ block: "center" });
  }

  async function generateAiResponse() {
    if (loading) return;
    if (!selectedWords.length && !context && !body && !understanding && !support) {
      setValidation(t("moodJournal.messages.completeRequired"));
      return;
    }

    if (detectCrisisInValues({ selectedWords, context, body, understanding, support }, locale).isUrgent) {
      setAiResult(null); setUrgentReply(getCrisisResponse(locale));
      return;
    }
    if (!consent.studentReady) {
      setValidation(t("inlineConsent.consentNeeded"));
      setConsentDialogOpen(true);
      return;
    }
    if (!aiNoticeAccepted) { setValidation(t("aiTransparency.confirm")); return; }
    const scope = draftRequest.current;
    const revision = scope.revision;
    const sequence = ++scope.sequence;
    const controller = new AbortController();
    scope.controller?.abort();
    scope.controller = controller;
    const sameActor = consent.trackRequest();
    const current = () => scope.mounted && scope.revision === revision && scope.sequence === sequence && sameActor();

    setLoading(true);
    setError("");
    setValidation("");
    try {
      const headers = await aiRequestHeaders(consent.userId);
      if (!current()) return;
      const response = await fetch("/api/ai/mood-journal", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          locale,
          selectedWords,
          context,
          bodyFeeling: body,
          recurringThought: understanding,
          desiredSupport: support,
          communicationStarter: t(starter.key),
          aiNoticeAccepted,
          aiNoticeVersion: AI_NOTICE_VERSION,
        }),
      });
      const data = await response.json();
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        setConsentDialogOpen(true);
        void consent.refresh();
      }
      if (!response.ok) throw new Error(data.error || t("moodJournal.messages.connectionFailed"));
      if (isAiUrgentResponse(data)) {
        setAiResult(null);
        setUrgentReply(data.reply);
        return;
      }
      setUrgentReply("");
      setAiResult(data);
    } catch (requestError) {
      if (!current()) return;
      setError(requestError instanceof Error ? requestError.message : t("moodJournal.messages.responseUnavailable"));
    } finally {
      if (scope.controller === controller) scope.controller = null;
      if (current()) setLoading(false);
    }
  }

  const reflectionFeedbackIds = [
    validation ? "mood-journal-validation" : "",
    error ? "mood-journal-error" : "",
  ].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <PageHero
        label={t("moodJournal.hero.label")}
        title={t("moodJournal.hero.title")}
        subtitle={t("moodJournal.hero.description")}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-mood-puzzle.webp"
            alt={t("moodJournal.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            label={t("moodJournal.emotions.label")}
            title={t("moodJournal.emotions.title")}
            description={t("moodJournal.emotions.description")}
          />
          <div
            className="grid gap-6 md:grid-cols-2 lg:grid-cols-4"
            role="group"
            aria-label={t("moodJournal.emotions.title")}
            aria-describedby={reflectionFeedbackIds}
          >
            {emotionGroups.map((group) => (
              <article key={group.key} className="card">
                <h3 className="text-xl font-bold text-ink">{t(group.labelKey)}</h3>
                <div className="mt-5 flex flex-wrap gap-2">
                  {group.words.map((word) => (
                    <button
                      key={word.value}
                      type="button"
                      onClick={() => toggleWord(word.value)}
                      className={`min-h-11 rounded-full border px-4 py-2 text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-sage/15 ${
                        selectedWords.includes(word.value)
                          ? "border-sage bg-mist text-sage-dark"
                          : "border-ink/10 bg-white/80 text-ink/70 hover:border-sage/50"
                      }`}
                    >
                      {t(word.labelKey)}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="card">
            <SectionHeader
              label={t("moodJournal.reflection.label")}
              title={t("moodJournal.reflection.title")}
              description={t("moodJournal.reflection.description")}
            />
            <div className="grid gap-5" role="group" aria-label={t("moodJournal.reflection.title")} aria-describedby={reflectionFeedbackIds}>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">{t("moodJournal.reflection.context")}</span>
                <textarea ref={reflectionInputRef} id="mood-journal-context" aria-invalid={Boolean(validation)} aria-describedby={reflectionFeedbackIds} className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={context} onChange={(e) => updateReflection(setContext, e.target.value)} />
                <VoiceInputButton value={context} onChange={(value) => updateReflection(setContext, value)} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">{t("moodJournal.reflection.body")}</span>
                <textarea id="mood-journal-body" aria-invalid={Boolean(validation)} aria-describedby={reflectionFeedbackIds} className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={body} onChange={(e) => updateReflection(setBody, e.target.value)} />
                <VoiceInputButton value={body} onChange={(value) => updateReflection(setBody, value)} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">{t("moodJournal.reflection.understanding")}</span>
                <textarea id="mood-journal-understanding" aria-invalid={Boolean(validation)} aria-describedby={reflectionFeedbackIds} className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={understanding} onChange={(e) => updateReflection(setUnderstanding, e.target.value)} />
                <VoiceInputButton value={understanding} onChange={(value) => updateReflection(setUnderstanding, value)} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">{t("moodJournal.reflection.support")}</span>
                <textarea id="mood-journal-support" aria-invalid={Boolean(validation)} aria-describedby={reflectionFeedbackIds} className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={support} onChange={(e) => updateReflection(setSupport, e.target.value)} />
                <VoiceInputButton value={support} onChange={(value) => updateReflection(setSupport, value)} />
              </label>
              <InlineConsentDialog open={consentDialogOpen} onClose={() => setConsentDialogOpen(false)}>
                <InlineStudentConsent controller={consent} studentOnly />
              </InlineConsentDialog>
              <AiTransparencyNotice
                id="mood-journal-ai-notice"
                checked={aiNoticeAccepted}
                onChange={(checked) => { cancelAiRequest(); setAiNoticeAccepted(checked); }}
              />
              <button type="button" className="button-primary w-fit max-w-full whitespace-normal" onClick={generateAiResponse} disabled={loading} aria-describedby={reflectionFeedbackIds}>
                {loading ? t("moodJournal.actions.organizing") : t("moodJournal.actions.organize")}
              </button>
              {validation ? <p id="mood-journal-validation" role="alert" aria-atomic="true" className="text-sm font-bold text-sage-dark">{validation}</p> : null}
              {error ? <p id="mood-journal-error" role="alert" aria-atomic="true" className="text-sm font-bold text-sage-dark">{error}</p> : null}
            </div>
          </div>

          <div className="card">
            <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("moodJournal.starters.title")}</h2>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              {t("moodJournal.starters.description")}
            </p>
            <div className="mt-6 rounded-2xl bg-cream p-5 text-lg font-bold leading-8 text-ink">
              “{t(starter.key)}”
            </div>
            <button type="button" className="button-secondary mt-5" onClick={generateStarter}>
              {t("moodJournal.actions.changeStarter")}
            </button>
            <button
              type="button"
              className="button-secondary mt-3 w-full sm:w-auto"
              onClick={() => setShowAllStarters((current) => !current)}
            >
              {showAllStarters ? t("moodJournal.actions.hideStarters") : t("moodJournal.actions.showStarters")}
            </button>
            {showAllStarters ? (
              <div className="mt-5 grid gap-3">
                {starterOptions.filter((item) => item.value !== starter.value).map((item) => (
                  <p key={item.value} className="rounded-2xl border border-ink/10 bg-white/70 p-4 text-sm font-bold leading-7 text-muted">
                    “{t(item.key)}”
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {urgentReply ? (
          <div className="container mt-8">
            <AiUrgentNotice message={urgentReply} />
          </div>
        ) : null}

        {aiResult ? (
          <div className="container mt-8">
            <div className="rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:p-8">
              <AiGeneratedLabel className="mb-3" />
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("moodJournal.result.title")}</h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("moodJournal.result.emotions")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.emotionReflection}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("moodJournal.result.support")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.possibleNeed}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("moodJournal.result.expression")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.communicationSuggestion}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("moodJournal.result.smallStep")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.smallStep}</p>
                </div>
              </div>
              <p className="mt-6 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">
                {aiResult.supportReminder}
              </p>
              <p className="mt-4 text-xs leading-6 text-muted">
                {t("moodJournal.result.disclaimer")}
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/garden" className="button-primary w-full sm:w-auto">
                  {t("moodJournal.actions.backToGarden")}
                </Link>
                <button type="button" className="button-secondary w-full sm:w-auto" onClick={continueEditing}>
                  {t("moodJournal.actions.continueEditing")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
