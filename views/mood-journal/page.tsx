import { useState } from "react";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const emotionGroups = [
  ["压力类", ["紧张", "焦虑", "压迫", "不安"]],
  ["低落类", ["难过", "空", "委屈", "没动力"]],
  ["烦躁类", ["烦躁", "生气", "想躲开", "不想说话"]],
  ["模糊类", ["说不清", "很乱", "麻木", "累"]],
];

const starters = [
  "我现在不是不想说，只是还没整理清楚。",
  "我希望你先听我说完，不要马上评价。",
  "我最近有点累，可能需要一点时间慢慢调整。",
  "我不是故意拖延，我只是现在开始起来有点困难。",
];

function buildStarterOptions(reflectionText: string) {
  if (/拖|开始|任务|作业|学习|催|压力|做不好/.test(reflectionText)) {
    return [
      "我不是故意拖延，我是现在开始起来有点困难。可以先给我一点时间整理吗？",
      ...starters,
    ];
  }
  if (/不想说|说不清|乱|麻木|累/.test(reflectionText)) {
    return [
      "我现在不是不想说，只是还没整理清楚。可以先听我慢慢说吗？",
      ...starters,
    ];
  }
  if (/评价|吵|冲突|生气|烦/.test(reflectionText)) {
    return [
      "我希望你先听我说完，不要马上评价，这样我会比较容易继续说。",
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
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [context, setContext] = useState("");
  const [body, setBody] = useState("");
  const [understanding, setUnderstanding] = useState("");
  const [support, setSupport] = useState("");
  const [saved, setSaved] = useState(false);
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
    setSaved(false);
  }

  const starterOptions = buildStarterOptions(`${context} ${body} ${understanding} ${support}`);
  const starter = starterOptions[starterIndex % starterOptions.length];

  function generateStarter() {
    setStarterIndex((current) => current + 1);
  }

  async function generateAiResponse() {
    if (!selectedWords.length && !context && !body && !understanding && !support) {
      setValidation("请先完成必要问题，再生成回应。");
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
          selectedWords,
          context,
          bodyFeeling: body,
          recurringThought: understanding,
          desiredSupport: support,
          communicationStarter: starter,
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
        label="Emotion Expression"
        title="情绪表达"
        subtitle="当你发现状态有些波动时，可以用情绪词、引导式整理和 AI 回应，把说不清的感受慢慢表达出来。"
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            label="Emotion Word Cards"
            title="情绪词卡"
            description="如果一开始说不清楚，可以先从几个接近的词开始。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {emotionGroups.map(([group, words]) => (
              <article key={group as string} className="card">
                <h3 className="text-xl font-bold text-ink">{group}</h3>
                <div className="mt-5 flex flex-wrap gap-2">
                  {(words as string[]).map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => toggleWord(word)}
                      className={`rounded-full border px-4 py-2 text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-sage/15 ${
                        selectedWords.includes(word)
                          ? "border-sage bg-mist text-sage-dark"
                          : "border-ink/10 bg-white/80 text-ink/70 hover:border-sage/50"
                      }`}
                    >
                      {word}
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
              title="引导式整理"
              description="这些问题只是帮助你整理今天的状态，不是测试，也不是正式评估。"
            />
            <div className="grid gap-5">
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">这件事发生在什么情境里？</span>
                <textarea className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={context} onChange={(e) => { setContext(e.target.value); setSaved(false); }} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">当时你身体有什么感觉？</span>
                <textarea className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={body} onChange={(e) => { setBody(e.target.value); setSaved(false); }} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">你最想被别人理解的一点是什么？</span>
                <textarea className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={understanding} onChange={(e) => { setUnderstanding(e.target.value); setSaved(false); }} />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-ink">现在你希望自己先得到什么支持？</span>
                <textarea className="min-h-24 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage" value={support} onChange={(e) => { setSupport(e.target.value); setSaved(false); }} />
              </label>
              <button type="button" className="button-primary w-fit" onClick={() => setSaved(true)}>
                保存这次记录
              </button>
              <button type="button" className="button-secondary w-fit" onClick={generateAiResponse} disabled={loading}>
                {loading ? "生成中，请稍等……" : "生成 AI 情绪回应"}
              </button>
              {validation ? <p className="text-sm font-bold text-sage-dark">{validation}</p> : null}
              {error ? <p className="text-sm font-bold text-sage-dark">{error}</p> : null}
              {saved ? (
                <div className="rounded-2xl border border-sage/25 bg-mist p-5 text-[0.95rem] font-bold leading-7 text-sage-dark">
                  这次整理已经暂时保留在页面上。你不需要马上解释清楚，先看见它就已经是一步。
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">低冲突表达句式</h2>
            <p className="mt-2 text-sm font-bold text-sage">Communication Starter</p>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              可以结合刚才写下的情绪词和整理内容，选择一句更柔和的方式，向家长、老师或可信任的人开口。
            </p>
            <div className="mt-6 rounded-2xl bg-cream p-5 text-lg font-bold leading-8 text-ink">
              “{starter}”
            </div>
            <button type="button" className="button-secondary mt-5" onClick={generateStarter}>
              换一条表达句式
            </button>
            <button
              type="button"
              className="mt-4 block text-sm font-bold text-sage-dark"
              onClick={() => setShowAllStarters((current) => !current)}
            >
              {showAllStarters ? "收起句式" : "查看更多句式"}
            </button>
            {showAllStarters ? (
              <div className="mt-5 grid gap-3">
                {starterOptions.filter((item) => item !== starter).map((item) => (
                  <p key={item} className="rounded-2xl border border-ink/10 bg-white/70 p-4 text-sm font-bold leading-7 text-muted">
                    “{item}”
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {aiResult ? (
          <div className="container mt-8">
            <div className="rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:p-8">
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">AI 情绪回应</h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div>
                  <h3 className="text-lg font-bold text-ink">你今天可能正在经历的情绪</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.emotionReflection}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">这件事里你可能最需要的支持</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.possibleNeed}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">可以试着这样表达</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.communicationSuggestion}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">今天可以先做的一件小事</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.smallStep}</p>
                </div>
              </div>
              <p className="mt-6 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">
                {aiResult.supportReminder}
              </p>
              <p className="mt-4 text-xs leading-6 text-muted">
                这里的回应不能替代专业支持，但可以帮助你先整理当前状态和下一步选择。
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
