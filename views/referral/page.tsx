import Link from "next/link";
import { useState } from "react";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";

const flowSteps = ["选择当前状态", "生成支持路径建议", "查看下一步入口"];

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
  label: string;
  href: string;
  primary?: boolean;
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
  let title = needsMoreSupport ? "整理当前状态，并连接更多支持" : "从一个低压力入口开始";

  if (
    hasAny(answers, "currentState", ["情绪压力比较大", "不知道怎么表达自己"]) ||
    hasAny(answers, "affectedAreas", ["情绪表达"]) ||
    hasAny(answers, "currentNeed", ["帮我和别人表达"])
  ) {
    title = "先拼一拼现在的心情";
    addLink(links, { label: "心情拼图", href: "/mood-journal", primary: true });
  }

  if (hasAny(answers, "currentState", ["最近睡眠不太稳定"]) || hasAny(answers, "affectedAreas", ["睡眠"])) {
    title = links.length ? title : "今晚先放下一点";
    addLink(links, { label: "今晚先放下", href: "/worry-time", primary: links.length === 0 });
    addLink(links, { label: "SWEET 节律记录", href: "/check-in" });
  }

  if (
    hasAny(answers, "currentState", ["学习或任务很难开始"]) ||
    hasAny(answers, "affectedAreas", ["学习或任务"])
  ) {
    title = links.length ? title : "从节律和表达开始";
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
    addLink(links, { label: "心情拼图", href: "/mood-journal" });
  }

  if (
    hasAny(answers, "currentState", ["和家人沟通有点困难"]) ||
    hasAny(answers, "affectedAreas", ["家庭沟通"])
  ) {
    title = "先整理表达，再让一个可信任的人知道";
    addLink(links, { label: "心情拼图", href: "/mood-journal", primary: links.length === 0 });
    addLink(links, { label: "悄悄话信箱", href: "/messages" });
  }

  if (
    hasAny(answers, "currentState", ["吃饭或身体状态受到影响"]) ||
    hasAny(answers, "affectedAreas", ["吃饭", "身体状态"])
  ) {
    title = needsMoreSupport ? "记录节律，并让可信任的人知道" : "先做 SWEET 节律记录";
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
    addLink(links, needsMoreSupport ? { label: "悄悄话信箱", href: "/messages" } : { label: "心情拼图", href: "/mood-journal" });
  }

  if (hasAny(answers, "currentState", ["只是想先整理一下"]) || hasAny(answers, "supportType", ["自己先整理一下"])) {
    title = links.length ? title : "先自己整理一下";
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
    addLink(links, { label: "心情拼图", href: "/mood-journal" });
  }

  if (hasAny(answers, "currentState", ["不太确定"])) {
    title = links.length ? title : "从低门槛记录开始";
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
  }

  if (hasAny(answers, "supportType", ["有人听我说"]) || hasAny(answers, "trustedAdult", ["愿意", "可能愿意，但不知道怎么开口"])) {
    title = links.length ? title : "尝试和可信任的大人说";
    addLink(links, { label: "心情拼图", href: "/mood-journal", primary: links.length === 0 });
  }

  if (needsMoreSupport) {
    if (links.some((item) => item.href === "/messages")) {
      return { title, links: links.slice(0, 2) };
    }
    if (links.length >= 2) {
      links[1] = { label: "告诉老师或家长", href: "/messages" };
    } else {
      addLink(links, { label: "告诉老师或家长", href: "/messages", primary: links.length === 0 });
    }
  }

  if (!links.length || hasAny(answers, "affectedAreas", ["基本没有", "不太确定"])) {
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
  }

  return { title, links: links.slice(0, 2) };
}

function buildAnsweredSummary(answers: Answers) {
  const selected = questionnaire
    .filter((item) => getSelections(answers, item.id).length)
    .map((item) => `${item.title.replace("？", "")}：${getSelections(answers, item.id).join("、")}`);

  return selected.length ? selected.join("；") : "你还没有选择当前状态。";
}

export default function ReferralPage() {
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
        setValidation(`这题最多选择 ${item.maxSelections} 项。`);
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
      return count ? `已选择 ${count} 项` : "可多选";
    }
    return count ? "已选择" : "单选";
  }

  async function generateRecommendation() {
    if (!getSelections(answers, "currentState").length) {
      setValidation("可以先选择一个最接近你现在状态的选项。");
      return;
    }

    if (!complete) {
      setValidation("可以先选择几个最接近你现在状态的选项。");
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
    } catch {
      setError("暂时无法生成回应，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHero
        title="下一步找谁"
        subtitle="当自己整理还不够时，用几道题判断现在适合继续自助、告诉可信任的人，还是尽快连接更多支持。"
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-progress-path.webp"
            alt="穿过自然山丘、逐步靠近支持的路径插画"
            priority
          />
        }
      />
      <section className="section section-muted">
        <div className="container">
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {flowSteps.map((title, index) => {
              const active =
                (!loading && !aiResult && index === 0) ||
                (loading && index === 1) ||
                (Boolean(aiResult) && index === 2);
              const completed = Boolean(aiResult) && index < 2;
              return (
                <div
                  key={title}
                  className={`rounded-2xl border p-4 transition ${
                    active || completed
                      ? "border-sage/45 bg-white text-ink shadow-soft"
                      : "border-ink/10 bg-white/45 text-muted"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-xs font-bold ${active || completed ? "text-sage-dark" : "text-muted"}`}>
                      第 {index + 1} 步
                    </p>
                    {completed ? (
                      <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-bold text-sage-dark">已完成</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-bold">{title}</p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {questionnaire.map((item) => (
              <article key={item.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold leading-snug text-ink">{item.title}</h3>
                    {item.instruction ? (
                      <p className="mt-2 text-xs font-bold text-sage">{item.instruction}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-mist px-2.5 py-1 text-xs font-bold text-sage-dark">
                    {getStatusLabel(item)}
                  </span>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {item.options.map((option) => {
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
                        {selected ? "✓ " : ""}{option}
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
                <h2 className="text-xl font-bold text-ink">生成支持路径建议</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  已选择 {selectedCount} / {questionnaire.length} 项。选择越接近当前状态，建议会越具体。
                </p>
                <p className="mt-3 text-sm font-bold leading-6 text-sage-dark">
                  这不是评判，只是帮助你整理下一步可以从哪里开始。
                </p>
              </div>
              <div>
                <label className="grid gap-2">
                  <span className="text-sm font-bold text-ink">还有什么想补充的吗？</span>
                  <textarea
                    className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none transition focus:border-sage"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="可以写一句，也可以先留空。"
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
                {loading ? "正在生成支持路径建议……" : "生成支持路径建议"}
              </button>
              {validation ? <p className="text-sm font-bold text-sage-dark">{validation}</p> : null}
              {error ? <p className="text-sm font-bold text-sage-dark">{error}</p> : null}
            </div>
          </div>

          {aiResult ? (
            <div className="mt-8 rounded-3xl border border-sage/25 bg-white/90 p-6 shadow-soft sm:p-8">
              <p className="text-sm font-bold text-sage">支持建议</p>
              <h2 className="mt-2 text-[1.7rem] font-bold leading-[1.25] text-ink">你的下一步支持路径</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{buildAnsweredSummary(answers)}</p>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div className="rounded-2xl bg-cream p-5">
                  <h3 className="text-lg font-bold text-ink">建议路径</h3>
                  <p className="mt-2 text-xl font-extrabold text-sage-dark">{recommendedPath.title}</p>
                  <p className="mt-3 text-[0.95rem] leading-7 text-muted">{aiResult.recommendedSupport}</p>
                </div>
                <div className="rounded-2xl bg-cream p-5">
                  <h3 className="text-lg font-bold text-ink">为什么这样建议</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.reason}</p>
                </div>
                <div className="rounded-2xl bg-cream p-5">
                  <h3 className="text-lg font-bold text-ink">可以怎么开始</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">
                    {aiResult.nextStep ||
                      "“我最近有点卡住，不一定需要马上解决，但我想先让你知道。”"}
                  </p>
                </div>
                <div className="rounded-2xl bg-cream p-5">
                  <h3 className="text-lg font-bold text-ink">推荐入口</h3>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {resultLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={item.primary ? "button-primary px-4 py-2 text-xs" : "button-secondary px-4 py-2 text-xs"}
                      >
                        {item.label}
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
            <h2 className="text-xl font-bold text-ink">你也可以直接让一个人知道</h2>
            <p className="mt-2 text-sm leading-7 text-muted">不必先完成所有问题。可以把现在最想说的一句话写给老师或家长。</p>
          </div>
          <Link href="/messages" className="button-primary mt-4 w-full sm:mt-0 sm:w-auto">打开悄悄话信箱</Link>
        </div>
      </section>
    </>
  );
}
