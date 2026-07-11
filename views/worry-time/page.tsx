import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";

type AiWorryResult = {
  controllableParts: string;
  canWaitUntilTomorrow: string;
  tomorrowSmallAction: string;
  bedtimeSentence: string;
  supportReminder: string;
};

const controlOptions = ["我可以做一点点", "我暂时控制不了", "我还不确定"];

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

export default function WorryTimePage() {
  const [secondsLeft, setSecondsLeft] = useState(15 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [worries, setWorries] = useState(["", "", ""]);
  const [controls, setControls] = useState(["", "", ""]);
  const [action, setAction] = useState("");
  const [done, setDone] = useState(false);
  const [aiResult, setAiResult] = useState<AiWorryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!timerRunning || secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft((current) => Math.max(current - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning, secondsLeft]);

  useEffect(() => {
    if (secondsLeft === 0) setTimerRunning(false);
  }, [secondsLeft]);

  function updateWorry(index: number, value: string) {
    setWorries((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
    setDone(false);
    setValidation("");
    setAiResult(null);
  }

  function updateControl(index: number, value: string) {
    setControls((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
    setDone(false);
    setValidation("");
    setAiResult(null);
  }

  function resetTimer() {
    setSecondsLeft(15 * 60);
    setTimerRunning(false);
  }

  function reset() {
    setSecondsLeft(15 * 60);
    setTimerRunning(false);
    setWorries(["", "", ""]);
    setControls(["", "", ""]);
    setAction("");
    setDone(false);
    setAiResult(null);
    setValidation("");
    setError("");
  }

  async function generateAiResponse() {
    const filledWorries = worries.filter((item) => item.trim().length > 0);
    if (filledWorries.length === 0) {
      setValidation("可以先写下至少一个担心，再生成整理。");
      return;
    }
    setLoading(true);
    setValidation("");
    setError("");
    try {
      const response = await fetch("/api/ai/worry-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worries, controls, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI request failed");
      setAiResult(data);
    } catch {
      setError("暂时无法生成 AI 整理，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHero
        label="Worry Time"
        title="睡前整理"
        subtitle="睡前整理是 Sleep 睡眠维度下的延伸工具，适合在睡前反复想很多、难以放下担心时使用。用 15 分钟把今天的担心先放到纸面上。"
      />

      <section className="section section-muted">
        <div className="container">
          <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
            <article className="card">
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">15 分钟整理</h2>
              <p className="mt-2 text-sm font-bold text-sage">15-minute bedtime organization</p>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                给睡前担心一个清晰边界：先整理 15 分钟，剩下的留给明天慢慢处理。
              </p>
              <div className="mt-6 rounded-3xl bg-cream p-6 text-center">
                <p className="text-5xl font-bold leading-none text-ink">{formatTime(secondsLeft)}</p>
                <p className="mt-3 text-sm font-bold text-sage-dark">睡前整理计时器</p>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" className="button-primary px-5 py-2 text-xs" onClick={() => setTimerRunning(true)}>
                  开始
                </button>
                <button type="button" className="button-secondary px-5 py-2 text-xs" onClick={() => setTimerRunning(false)}>
                  暂停
                </button>
                <button type="button" className="button-secondary px-5 py-2 text-xs" onClick={resetTimer}>
                  重置
                </button>
              </div>
              {secondsLeft === 0 ? (
                <div className="mt-5 rounded-2xl border border-sage/25 bg-mist p-4 text-sm font-bold leading-7 text-sage-dark">
                  15 分钟到了。今天的担心已经被看见，剩下的可以留给明天慢慢处理。
                </div>
              ) : null}
            </article>

            <article className="card">
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">写下今天最担心的三件事</h2>
              <p className="mt-2 text-sm font-bold text-sage">Three worries</p>
              <div className="mt-6 grid gap-5">
                {worries.map((worry, index) => (
                  <label key={index} className="grid gap-2">
                    <span className="text-sm font-bold text-ink">担心 {index + 1}</span>
                    <textarea
                      className="min-h-20 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage"
                      value={worry}
                      onChange={(e) => updateWorry(index, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </article>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {worries.map((_, index) => (
              <article key={index} className="card">
                <h3 className="text-xl font-bold text-ink">担心 {index + 1}：区分可控与不可控</h3>
                <p className="mt-2 text-sm font-bold text-sage">Control check</p>
                <div className="mt-5 grid gap-3">
                  {controlOptions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => updateControl(index, item)}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-sage/15 ${
                        controls[index] === item
                          ? "border-sage bg-mist text-sage-dark"
                          : "border-ink/10 bg-white/80 text-ink/75 hover:border-sage/50"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.55fr]">
            <article className="card">
              <h2 className="text-xl font-bold text-ink">明天可以做的一个小行动</h2>
              <p className="mt-2 text-sm font-bold text-sage">One small action</p>
              <textarea
                className="mt-5 min-h-28 w-full rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setDone(false);
                }}
                placeholder="明天我可以先做的一件小事是……"
              />
            </article>
            <article className="card flex flex-col justify-center">
              <button type="button" className="button-primary w-full" onClick={generateAiResponse} disabled={loading}>
                {loading ? "正在生成……" : "生成 AI 睡前整理"}
              </button>
              <button type="button" className="button-secondary mt-3 w-full" onClick={() => setDone(true)}>
                完成整理
              </button>
              <button type="button" className="mt-3 w-full text-sm font-bold text-muted transition hover:text-sage-dark" onClick={reset}>
                重新填写
              </button>
              {validation ? <p className="mt-4 text-sm font-bold text-sage-dark">{validation}</p> : null}
              {error ? <p className="mt-4 text-sm font-bold text-sage-dark">{error}</p> : null}
            </article>
          </div>

          {aiResult ? (
            <div className="mt-8 rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:p-8">
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">AI 睡前整理</h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div>
                  <h3 className="text-lg font-bold text-ink">可以先做一点点的部分</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.controllableParts}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">可以暂时放到明天的部分</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.canWaitUntilTomorrow}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">明天最小行动</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.tomorrowSmallAction}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">睡前可以对自己说的一句话</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.bedtimeSentence}</p>
                </div>
              </div>
              <p className="mt-6 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">
                {aiResult.supportReminder}
              </p>
            </div>
          ) : null}

          {done ? (
            <div className="mt-8 rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:p-8">
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">今天先到这里</h2>
              <p className="mt-4 text-base leading-8 text-muted">
                你已经把担心放到了纸面上，也给明天留了一个小行动。现在可以允许自己慢慢收尾。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/check-in" className="button-primary">
                  回到 SWEET 节律
                </Link>
                <Link href="/mood-journal" className="button-secondary">
                  进入情绪表达
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
