import { useState } from "react";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

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
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [context, setContext] = useState("");
  const [body, setBody] = useState("");
  const [understanding, setUnderstanding] = useState("");
  const [support, setSupport] = useState("");
  const [starterIndex, setStarterIndex] = useState(0);
  const [showAllStarters, setShowAllStarters] = useState(false);
  const [aiResult, setAiResult] = useState<MoodAiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");

  function toggleWord(word: string) {
    setSelectedWords((current) =>
      current.includes(word) ? current.filter((item) => item !== word) : [...current, word],
    );
  }

  const starterOptions = buildStarterOptions(`${context} ${body} ${understanding} ${support}`);
  const starter = starterOptions[starterIndex % starterOptions.length];

  function generateStarter() {
    setStarterIndex((current) => current + 1);
  }

  async function generateAiResponse() {
    if (!selectedWords.length && !context && !body && !understanding && !support) {
      setValidation(t("moodJournal.messages.completeRequired"));
      return;
    }

    setLoading(true);
    setError("");
    setValidation("");
    try {
      const response = await fetch("/api/ai/mood-journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale,
          selectedWords,
          context,
          bodyFeeling: body,
          recurringThought: understanding,
          desiredSupport: support,
          communicationStarter: starter.value,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("moodJournal.messages.connectionFailed"));
      setAiResult(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("moodJournal.messages.responseUnavailable"));
    } finally {
      setLoading(false);
    }
  }

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
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
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
              label="Guided Reflection"
              title={t("moodJournal.reflection.title")}
              description={t("moodJournal.reflection.description")}
            />
            <div className="grid gap-5">
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">{t("moodJournal.reflection.context")}</span>
                <textarea className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={context} onChange={(e) => setContext(e.target.value)} />
                <VoiceInputButton value={context} onChange={setContext} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">{t("moodJournal.reflection.body")}</span>
                <textarea className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={body} onChange={(e) => setBody(e.target.value)} />
                <VoiceInputButton value={body} onChange={setBody} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">{t("moodJournal.reflection.understanding")}</span>
                <textarea className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={understanding} onChange={(e) => setUnderstanding(e.target.value)} />
                <VoiceInputButton value={understanding} onChange={setUnderstanding} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">{t("moodJournal.reflection.support")}</span>
                <textarea className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={support} onChange={(e) => setSupport(e.target.value)} />
                <VoiceInputButton value={support} onChange={setSupport} />
              </label>
              <button type="button" className="button-primary w-fit" onClick={generateAiResponse} disabled={loading}>
                {loading ? t("moodJournal.actions.organizing") : t("moodJournal.actions.organize")}
              </button>
              {validation ? <p className="text-sm font-bold text-sage-dark">{validation}</p> : null}
              {error ? <p className="text-sm font-bold text-sage-dark">{error}</p> : null}
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

        {aiResult ? (
          <div className="container mt-8">
            <div className="rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:p-8">
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
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
