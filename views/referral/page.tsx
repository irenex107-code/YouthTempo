import Link from "next/link";
import { useState } from "react";
import { InfoCard, StepCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const support = [
  ["可信任的大人", "可以从一句很轻的话开始，让身边可靠的人先知道你最近有点卡住。"],
  ["学校支持", "如果学习、出勤或校园生活受到影响，可以考虑联系班主任、导师或学校心理老师。"],
  ["家校资源", "当亲子沟通比较难时，可以先用低冲突材料帮助家长和学校理解你的状态。"],
  ["专业资源", "如果状态持续影响生活，可以考虑连接专业咨询、线上支持资源或当地支持服务。"],
];

const layers = [
  [
    "日常压力",
    "最近有压力，但仍能基本学习和生活。",
    "AI 引导整理、SWEET 节律记录、情绪表达和睡前整理。",
  ],
  [
    "持续低落或焦虑",
    "情绪压力持续多天，睡眠、学习或日常生活受到影响。",
    "建议连接可信任的大人、学校心理老师、专业资源或线上支持资源。",
  ],
  [
    "家庭沟通困难",
    "亲子沟通困难、冲突频繁，用户不知道如何表达。",
    "提供低冲突表达句式、家长教育内容和家校资源建议。",
  ],
  [
    "需要及时连接支持",
    "用户状态明显影响安全感、基本生活或持续无法应对。",
    "建议尽快联系监护人、学校负责人、专业人员或当地支持服务。",
  ],
];

const referralSteps = [
  ["SWEET 节律记录", "记录睡眠、醒来、饮食、运动和任务投入，先看见今天的状态。"],
  ["AI 引导整理", "把模糊的压力和状态变化整理成更清楚的表达。"],
  ["支持需求理解", "判断现在更需要自助整理、有人倾听、学校支持还是专业资源。"],
  ["建议下一步", "给出一个低压力、可执行的下一步，而不是一次性要求用户解决所有问题。"],
  ["连接可信支持", "在需要时，引导用户联系可信任的大人、学校资源、家校资源或专业支持。"],
];

const network = [
  ["家庭", "提供日常理解、陪伴和低冲突沟通。"],
  ["学校", "更早发现学习、情绪和适应变化，提供校内支持。"],
  ["专业咨询", "在持续压力、低落或适应困难时提供进一步支持。"],
  ["当地支持服务", "在需要及时帮助时，连接更可靠、更具体的线下或线上资源。"],
];

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
    title = "先做情绪表达";
    addLink(links, { label: "情绪表达", href: "/mood-journal", primary: true });
  }

  if (hasAny(answers, "currentState", ["最近睡眠不太稳定"]) || hasAny(answers, "affectedAreas", ["睡眠"])) {
    title = links.length ? title : "先做睡前整理";
    addLink(links, { label: "睡前整理", href: "/worry-time", primary: links.length === 0 });
    addLink(links, { label: "SWEET 节律记录", href: "/check-in" });
  }

  if (
    hasAny(answers, "currentState", ["学习或任务很难开始"]) ||
    hasAny(answers, "affectedAreas", ["学习或任务"])
  ) {
    title = links.length ? title : "从节律和表达开始";
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
    addLink(links, { label: "情绪表达", href: "/mood-journal" });
  }

  if (
    hasAny(answers, "currentState", ["和家人沟通有点困难"]) ||
    hasAny(answers, "affectedAreas", ["家庭沟通"])
  ) {
    title = "先整理表达，再连接家校资源";
    addLink(links, { label: "情绪表达", href: "/mood-journal", primary: links.length === 0 });
    addLink(links, { label: "家校资源", href: "/resources" });
  }

  if (
    hasAny(answers, "currentState", ["吃饭或身体状态受到影响"]) ||
    hasAny(answers, "affectedAreas", ["吃饭", "身体状态"])
  ) {
    title = needsMoreSupport ? "记录节律，并查看家校资源" : "先做 SWEET 节律记录";
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
    addLink(links, needsMoreSupport ? { label: "家校资源", href: "/resources" } : { label: "情绪表达", href: "/mood-journal" });
  }

  if (hasAny(answers, "currentState", ["只是想先整理一下"]) || hasAny(answers, "supportType", ["自己先整理一下"])) {
    title = links.length ? title : "先自己整理一下";
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
    addLink(links, { label: "情绪表达", href: "/mood-journal" });
  }

  if (hasAny(answers, "currentState", ["不太确定"])) {
    title = links.length ? title : "从低门槛记录开始";
    addLink(links, { label: "SWEET 节律记录", href: "/check-in", primary: links.length === 0 });
  }

  if (hasAny(answers, "supportType", ["有人听我说"]) || hasAny(answers, "trustedAdult", ["愿意", "可能愿意，但不知道怎么开口"])) {
    title = links.length ? title : "尝试和可信任的大人说";
    addLink(links, { label: "情绪表达", href: "/mood-journal", primary: links.length === 0 });
  }

  if (needsMoreSupport) {
    if (links.some((item) => item.href === "/resources")) {
      return { title, links: links.slice(0, 2) };
    }
    if (links.length >= 2) {
      links[1] = { label: "家校资源", href: "/resources" };
    } else {
      addLink(links, { label: "家校资源", href: "/resources", primary: links.length === 0 });
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
        label="Support Pathway Recommendation"
        title="支持路径推荐"
        subtitle="选择当前状态，点击生成支持路径建议，再查看一份温和的下一步建议。"
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
                        className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
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
        <div className="container">
          <SectionHeader
            label="Layered Support Pathway"
            title="分层支持路径"
            description="平台不让 AI 单独处理复杂情况，而是根据支持需求，给出更合适的下一步连接。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {layers.map(([title, signs, response]) => (
              <article key={title} className="card">
                <h3 className="text-lg font-bold leading-snug text-ink sm:text-xl">{title}</h3>
                <p className="mt-4 text-xs font-bold text-sage">用户状态</p>
                <p className="mt-2 text-[0.95rem] leading-7 text-muted">{signs}</p>
                <p className="mt-4 text-xs font-bold text-sage">平台回应</p>
                <p className="mt-2 text-[0.95rem] leading-7 text-muted">{response}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="转介路径"
            description="当平台观察到用户可能需要更多帮助时，会优先把支持连接到真实的人和可靠资源。"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {referralSteps.map(([title, text], index) => (
              <StepCard key={title} number={index + 1} title={title}>
                {text}
              </StepCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            label="Family-School-Professional Support Network"
            title="家校与专业支持网络"
            description="YouthTempo 把支持理解为一个协作网络，而不是让年轻人独自面对压力。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {network.map(([title, role]) => (
              <InfoCard key={title} title={title}>
                {role}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="可以连接的支持"
            description="不同情境下，用户可以选择更熟悉、更可获得或更专业的支持来源。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {support.map(([title, text]) => (
              <InfoCard key={title} title={title}>
                {text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
