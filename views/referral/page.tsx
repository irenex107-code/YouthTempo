import Link from "next/link";
import { useState } from "react";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const flowStepKeys: TranslationKey[] = [
  "referral.flow.select",
  "referral.flow.generate",
  "referral.flow.view",
];

type ReferralAiResult = {
  recommendedSupport: string;
  reason: string;
  nextStep: string;
  whenToSeekMoreSupport: string;
  supportReminder: string;
};

type Question = {
  id: string;
  title: string;
  type: "single" | "multi";
  instruction?: string;
  maxSelections?: number;
  options: string[];
};

type Answers = Record<string, string[]>;

const questionnaire: Question[] = [
  {
    id: "currentState",
    title: "你现在最接近哪种状态？",
    type: "multi",
    instruction: "可多选，选择最接近你的 1–3 项",
    maxSelections: 3,
    options: [
      "情绪压力比较大",
      "最近睡眠不太稳定",
      "学习或任务很难开始",
      "和家人沟通有点困难",
      "吃饭或身体状态受到影响",
      "不知道怎么表达自己",
      "只是想先整理一下",
      "不太确定",
    ],
  },
  {
    id: "duration",
    title: "这些状态大概持续多久了？",
    type: "single",
    options: ["只是今天", "几天以内", "一两周", "更久一些", "不太确定"],
  },
  {
    id: "impact",
    title: "是否影响到睡眠、学习或日常生活？",
    type: "single",
    options: ["基本没有", "有一点影响", "已经明显影响", "不太确定"],
  },
  {
    id: "affectedAreas",
    title: "主要影响到哪些方面？",
    type: "multi",
    instruction: "可多选",
    options: ["睡眠", "学习或任务", "吃饭", "身体状态", "家庭沟通", "情绪表达", "日常生活", "基本没有", "不太确定"],
  },
  {
    id: "trustedAdult",
    title: "你现在愿意和可信任的大人说吗？",
    type: "single",
    options: ["愿意", "可能愿意，但不知道怎么开口", "暂时不想", "不太确定"],
  },
  {
    id: "supportType",
    title: "你更希望先获得哪类支持？",
    type: "multi",
    instruction: "可多选",
    options: ["自己先整理一下", "有人听我说", "学校支持", "专业资源", "不太确定"],
  },
  {
    id: "currentNeed",
    title: "你现在最需要的是哪一种？",
    type: "single",
    options: ["被理解", "一个具体小步骤", "帮我判断下一步", "帮我和别人表达", "不太确定"],
  },
];

type RecommendationLink = {
  labelKey: TranslationKey;
  href: string;
  primary?: boolean;
};

type QuestionCopyKeys = {
  title: TranslationKey;
  instruction?: TranslationKey;
  options: readonly TranslationKey[];
};

const questionCopyKeys: Record<string, QuestionCopyKeys> = {
  currentState: {
    title: "referral.questions.currentState.title",
    instruction: "referral.questions.currentState.instruction",
    options: ["referral.questions.currentState.options.emotionalPressure", "referral.questions.currentState.options.sleep", "referral.questions.currentState.options.tasks", "referral.questions.currentState.options.family", "referral.questions.currentState.options.eatingOrPhysical", "referral.questions.currentState.options.expression", "referral.questions.currentState.options.organize", "referral.questions.currentState.options.unsure"],
  },
  duration: {
    title: "referral.questions.duration.title",
    options: ["referral.questions.duration.options.today", "referral.questions.duration.options.days", "referral.questions.duration.options.weeks", "referral.questions.duration.options.longer", "referral.questions.duration.options.unsure"],
  },
  impact: {
    title: "referral.questions.impact.title",
    options: ["referral.questions.impact.options.none", "referral.questions.impact.options.some", "referral.questions.impact.options.significant", "referral.questions.impact.options.unsure"],
  },
  affectedAreas: {
    title: "referral.questions.affectedAreas.title",
    instruction: "referral.questions.multiInstruction",
    options: ["referral.questions.affectedAreas.options.sleep", "referral.questions.affectedAreas.options.tasks", "referral.questions.affectedAreas.options.eating", "referral.questions.affectedAreas.options.physical", "referral.questions.affectedAreas.options.family", "referral.questions.affectedAreas.options.expression", "referral.questions.affectedAreas.options.dailyLife", "referral.questions.affectedAreas.options.none", "referral.questions.affectedAreas.options.unsure"],
  },
  trustedAdult: {
    title: "referral.questions.trustedAdult.title",
    options: ["referral.questions.trustedAdult.options.willing", "referral.questions.trustedAdult.options.unsureHow", "referral.questions.trustedAdult.options.notNow", "referral.questions.trustedAdult.options.unsure"],
  },
  supportType: {
    title: "referral.questions.supportType.title",
    instruction: "referral.questions.multiInstruction",
    options: ["referral.questions.supportType.options.self", "referral.questions.supportType.options.listener", "referral.questions.supportType.options.school", "referral.questions.supportType.options.professional", "referral.questions.supportType.options.unsure"],
  },
  currentNeed: {
    title: "referral.questions.currentNeed.title",
    options: ["referral.questions.currentNeed.options.understood", "referral.questions.currentNeed.options.smallStep", "referral.questions.currentNeed.options.direction", "referral.questions.currentNeed.options.expression", "referral.questions.currentNeed.options.unsure"],
  },
};

function getSelections(answers: Answers, key: string) {
  return answers[key] || [];
}

function hasAny(answers: Answers, key: string, options: string[]) {
  return getSelections(answers, key).some((value) => options.includes(value));
}

function addLink(links: RecommendationLink[], link: RecommendationLink) {
  if (!links.some((item) => item.href === link.href)) {
    links.push(link);
  }
}

function getRecommendedPath(answers: Answers) {
  const needsMoreSupport =
    hasAny(answers, "impact", ["已经明显影响"]) ||
    hasAny(answers, "duration", ["一两周", "更久一些"]) ||
    hasAny(answers, "supportType", ["学校支持", "专业资源"]);

  const links: RecommendationLink[] = [];
  let titleKey: TranslationKey = needsMoreSupport ? "referral.paths.moreSupport" : "referral.paths.lowPressure";

  if (
    hasAny(answers, "currentState", ["情绪压力比较大", "不知道怎么表达自己"]) ||
    hasAny(answers, "affectedAreas", ["情绪表达"]) ||
    hasAny(answers, "currentNeed", ["帮我和别人表达"])
  ) {
    titleKey = "referral.paths.moodFirst";
    addLink(links, { labelKey: "referral.links.moodJournal", href: "/mood-journal", primary: true });
  }

  if (hasAny(answers, "currentState", ["最近睡眠不太稳定"]) || hasAny(answers, "affectedAreas", ["睡眠"])) {
    titleKey = links.length ? titleKey : "referral.paths.worryFirst";
    addLink(links, { labelKey: "referral.links.worryTime", href: "/worry-time", primary: links.length === 0 });
    addLink(links, { labelKey: "referral.links.checkIn", href: "/check-in" });
  }

  if (
    hasAny(answers, "currentState", ["学习或任务很难开始"]) ||
    hasAny(answers, "affectedAreas", ["学习或任务"])
  ) {
    titleKey = links.length ? titleKey : "referral.paths.rhythmAndExpression";
    addLink(links, { labelKey: "referral.links.checkIn", href: "/check-in", primary: links.length === 0 });
    addLink(links, { labelKey: "referral.links.moodJournal", href: "/mood-journal" });
  }

  if (
    hasAny(answers, "currentState", ["和家人沟通有点困难"]) ||
    hasAny(answers, "affectedAreas", ["家庭沟通"])
  ) {
    titleKey = "referral.paths.expressionAndTell";
    addLink(links, { labelKey: "referral.links.moodJournal", href: "/mood-journal", primary: links.length === 0 });
    addLink(links, { labelKey: "referral.links.messages", href: "/messages" });
  }

  if (
    hasAny(answers, "currentState", ["吃饭或身体状态受到影响"]) ||
    hasAny(answers, "affectedAreas", ["吃饭", "身体状态"])
  ) {
    titleKey = needsMoreSupport ? "referral.paths.rhythmAndTell" : "referral.paths.checkInFirst";
    addLink(links, { labelKey: "referral.links.checkIn", href: "/check-in", primary: links.length === 0 });
    addLink(links, needsMoreSupport ? { labelKey: "referral.links.messages", href: "/messages" } : { labelKey: "referral.links.moodJournal", href: "/mood-journal" });
  }

  if (hasAny(answers, "currentState", ["只是想先整理一下"]) || hasAny(answers, "supportType", ["自己先整理一下"])) {
    titleKey = links.length ? titleKey : "referral.paths.selfOrganize";
    addLink(links, { labelKey: "referral.links.checkIn", href: "/check-in", primary: links.length === 0 });
    addLink(links, { labelKey: "referral.links.moodJournal", href: "/mood-journal" });
  }

  if (hasAny(answers, "currentState", ["不太确定"])) {
    titleKey = links.length ? titleKey : "referral.paths.lowBarrier";
    addLink(links, { labelKey: "referral.links.checkIn", href: "/check-in", primary: links.length === 0 });
  }

  if (hasAny(answers, "supportType", ["有人听我说"]) || hasAny(answers, "trustedAdult", ["愿意", "可能愿意，但不知道怎么开口"])) {
    titleKey = links.length ? titleKey : "referral.paths.tellAdult";
    addLink(links, { labelKey: "referral.links.moodJournal", href: "/mood-journal", primary: links.length === 0 });
  }

  if (needsMoreSupport) {
    if (links.some((item) => item.href === "/messages")) {
      return { titleKey, links: links.slice(0, 2) };
    }
    if (links.length >= 2) {
      links[1] = { labelKey: "referral.links.tellAdult", href: "/messages" };
    } else {
      addLink(links, { labelKey: "referral.links.tellAdult", href: "/messages", primary: links.length === 0 });
    }
  }

  if (!links.length || hasAny(answers, "affectedAreas", ["基本没有", "不太确定"])) {
    addLink(links, { labelKey: "referral.links.checkIn", href: "/check-in", primary: links.length === 0 });
  }

  return { titleKey, links: links.slice(0, 2) };
}

type Translate = ReturnType<typeof useTranslation>["t"];

function buildAnsweredSummary(answers: Answers, t: Translate) {
  const selected = questionnaire
    .filter((item) => getSelections(answers, item.id).length)
    .map((item) => {
      const copy = questionCopyKeys[item.id];
      const labels = getSelections(answers, item.id).map((value) => {
        const optionIndex = item.options.indexOf(value);
        return optionIndex >= 0 ? t(copy.options[optionIndex]) : value;
      });
      return t("referral.result.answerSummary", { question: t(copy.title).replace("？", ""), answers: labels.join("、") });
    });

  return selected.length ? selected.join("；") : t("referral.result.noSelection");
}

export default function ReferralPage() {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Answers>({});
  const [note, setNote] = useState("");
  const [aiResult, setAiResult] = useState<ReferralAiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");

  const selectedCount = Object.keys(answers).length;
  const complete = questionnaire.every((item) => getSelections(answers, item.id).length > 0);
  const recommendedPath = getRecommendedPath(answers);
  const resultLinks = recommendedPath.links as RecommendationLink[];

  function handleOptionClick(item: Question, option: string) {
    const currentSelections = getSelections(answers, item.id);
    let nextSelections: string[];

    if (item.type === "single") {
      nextSelections = [option];
    } else if (currentSelections.includes(option)) {
      nextSelections = currentSelections.filter((value) => value !== option);
    } else {
      const optionIsGeneral = option === "不太确定" || option === "基本没有";
      const withoutGeneral = currentSelections.filter((value) => value !== "不太确定" && value !== "基本没有");

      if (optionIsGeneral) {
        nextSelections = [option];
      } else if (item.maxSelections && withoutGeneral.length >= item.maxSelections) {
        setValidation(t("referral.messages.maxSelections", { count: item.maxSelections }));
        return;
      } else {
        nextSelections = [...withoutGeneral, option];
      }
    }

    setAnswers((current) => {
      const updated = { ...current };
      if (nextSelections.length) {
        updated[item.id] = nextSelections;
      } else {
        delete updated[item.id];
      }
      return updated;
    });
    setAiResult(null);
    setValidation("");
    setError("");
  }

  function getStatusLabel(item: Question) {
    const count = getSelections(answers, item.id).length;
    if (item.type === "multi") {
      return count ? t("referral.status.selectedCount", { count }) : t("referral.status.multi");
    }
    return count ? t("referral.status.selected") : t("referral.status.single");
  }

  async function generateRecommendation() {
    if (!getSelections(answers, "currentState").length) {
      setValidation(t("referral.messages.selectCurrentState"));
      return;
    }

    if (!complete) {
      setValidation(t("referral.messages.completeQuestions"));
      return;
    }

    const payload = questionnaire.reduce<Record<string, string>>((current, item) => {
      current[item.id] = getSelections(answers, item.id).join("、") || "不太确定";
      return current;
    }, {});

    setLoading(true);
    setError("");
    setValidation("");
    try {
      const response = await fetch("/api/ai/referral", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          note: [
            `当前状态：${getSelections(answers, "currentState").join("、")}`,
            `主要影响：${getSelections(answers, "affectedAreas").join("、") || "不太确定"}`,
            note ? `补充：${note}` : "",
          ].filter(Boolean).join("\n"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI request failed");
      setAiResult(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("referral.messages.responseUnavailable"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHero
        title={t("referral.hero.title")}
        subtitle={t("referral.hero.description")}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-progress-path.webp"
            alt={t("referral.hero.imageAlt")}
            priority
          />
        }
      />
      <section className="section section-muted">
        <div className="container">
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {flowStepKeys.map((titleKey, index) => {
              const active =
                (!loading && !aiResult && index === 0) ||
                (loading && index === 1) ||
                (Boolean(aiResult) && index === 2);
              const completed = Boolean(aiResult) && index < 2;
              return (
                <div
                  key={titleKey}
                  className={`rounded-2xl border p-4 transition ${
                    active || completed
                      ? "border-sage/45 bg-white text-ink shadow-soft"
                      : "border-ink/10 bg-white/45 text-muted"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-xs font-bold ${active || completed ? "text-sage-dark" : "text-muted"}`}>
                      {t("referral.flow.step", { number: index + 1 })}
                    </p>
                    {completed ? (
                      <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-bold text-sage-dark">{t("referral.flow.completed")}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-bold">{t(titleKey)}</p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {questionnaire.map((item) => (
              <article key={item.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold leading-snug text-ink">{t(questionCopyKeys[item.id].title)}</h3>
                    {item.instruction ? (
                      <p className="mt-2 text-xs font-bold text-sage">{questionCopyKeys[item.id].instruction ? t(questionCopyKeys[item.id].instruction!) : item.instruction}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-mist px-2.5 py-1 text-xs font-bold text-sage-dark">
                    {getStatusLabel(item)}
                  </span>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {item.options.map((option, optionIndex) => {
                    const selected = getSelections(answers, item.id).includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleOptionClick(item, option)}
                        className={`min-h-11 rounded-full border px-4 py-2 text-sm font-bold transition ${
                          selected
                            ? "border-sage bg-mist text-sage-dark shadow-sm ring-2 ring-sage/15"
                            : "border-ink/10 bg-white/80 text-muted hover:border-sage/50 hover:text-sage-dark"
                        }`}
                      >
                        {selected ? "✓ " : ""}{t(questionCopyKeys[item.id].options[optionIndex])}
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>

          <div className="mt-6 rounded-3xl border border-sage/20 bg-white/85 p-6 shadow-soft">
            <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr] lg:items-end">
              <div>
                <h2 className="text-xl font-bold text-ink">{t("referral.generate.title")}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {t("referral.generate.progress", { selected: selectedCount, total: questionnaire.length })}
                </p>
                <p className="mt-3 text-sm font-bold leading-6 text-sage-dark">
                  {t("referral.generate.description")}
                </p>
              </div>
              <div>
                <label className="grid gap-2">
                  <span className="text-sm font-bold text-ink">{t("referral.generate.noteLabel")}</span>
                  <textarea
                    className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none transition focus:border-sage"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t("referral.generate.notePlaceholder")}
                  />
                </label>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <button
                type="button"
                className="button-primary px-7"
                onClick={generateRecommendation}
                disabled={loading}
              >
                {loading ? t("referral.actions.generating") : t("referral.actions.generate")}
              </button>
              {validation ? <p className="text-sm font-bold text-sage-dark">{validation}</p> : null}
              {error ? <p className="text-sm font-bold text-sage-dark">{error}</p> : null}
            </div>
          </div>

          {aiResult ? (
            <div className="mt-8 rounded-3xl border border-sage/25 bg-white/90 p-6 shadow-soft sm:p-8">
              <p className="text-sm font-bold text-sage">{t("referral.result.label")}</p>
              <h2 className="mt-2 text-[1.7rem] font-bold leading-[1.25] text-ink">{t("referral.result.title")}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{buildAnsweredSummary(answers, t)}</p>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div className="rounded-2xl bg-cream p-5">
                  <h3 className="text-lg font-bold text-ink">{t("referral.result.path")}</h3>
                  <p className="mt-2 text-xl font-extrabold text-sage-dark">{t(recommendedPath.titleKey)}</p>
                  <p className="mt-3 text-[0.95rem] leading-7 text-muted">{aiResult.recommendedSupport}</p>
                </div>
                <div className="rounded-2xl bg-cream p-5">
                  <h3 className="text-lg font-bold text-ink">{t("referral.result.reason")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.reason}</p>
                </div>
                <div className="rounded-2xl bg-cream p-5">
                  <h3 className="text-lg font-bold text-ink">{t("referral.result.howToStart")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">
                    {aiResult.nextStep ||
                      t("referral.result.fallbackStarter")}
                  </p>
                </div>
                <div className="rounded-2xl bg-cream p-5">
                  <h3 className="text-lg font-bold text-ink">{t("referral.result.links")}</h3>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {resultLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={item.primary ? "button-primary px-4 py-2 text-xs" : "button-secondary px-4 py-2 text-xs"}
                      >
                        {t(item.labelKey)}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-5 rounded-2xl bg-mist p-4 text-sm font-bold leading-7 text-sage-dark">
                {aiResult.supportReminder}
              </p>
              <p className="mt-3 text-xs leading-6 text-muted">{aiResult.whenToSeekMoreSupport}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section">
        <div className="container rounded-2xl border border-sage/25 bg-mint/60 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <h2 className="text-xl font-bold text-ink">{t("referral.direct.title")}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{t("referral.direct.description")}</p>
          </div>
          <Link href="/messages" className="button-primary mt-4 w-full sm:mt-0 sm:w-auto">{t("referral.direct.action")}</Link>
        </div>
      </section>
    </>
  );
}
