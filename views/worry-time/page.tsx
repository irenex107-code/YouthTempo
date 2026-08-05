import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type AiWorryResult = {
  controllableParts: string;
  canWaitUntilTomorrow: string;
  tomorrowSmallAction: string;
  bedtimeSentence: string;
  supportReminder: string;
};

const controlOptions = [
  { value: "我可以做一点点", labelKey: "worryTime.controls.actionable" as TranslationKey },
  { value: "我暂时控制不了", labelKey: "worryTime.controls.uncontrollable" as TranslationKey },
  { value: "我还不确定", labelKey: "worryTime.controls.unsure" as TranslationKey },
];

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

export default function WorryTimePage() {
  const { t } = useTranslation();
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
      setValidation(t("worryTime.messages.addWorry"));
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
      if (!response.ok) throw new Error(data.error || t("worryTime.messages.connectionFailed"));
      setAiResult(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("worryTime.messages.responseUnavailable"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHero
        label={t("worryTime.hero.label")}
        title={t("worryTime.hero.title")}
        subtitle={t("worryTime.hero.description")}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-worry-time.webp"
            alt={t("worryTime.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section section-muted">
        <div className="container">
          <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
            <article className="card">
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("worryTime.timer.title")}</h2>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                {t("worryTime.timer.description")}
              </p>
              <div className="mt-6 rounded-3xl bg-cream p-6 text-center">
                <p className="text-5xl font-bold leading-none text-ink">{formatTime(secondsLeft)}</p>
                <p className="mt-3 text-sm font-bold text-sage-dark">{t("worryTime.timer.label")}</p>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" className="button-primary px-5 py-2 text-xs" onClick={() => setTimerRunning(true)}>
                  {t("worryTime.actions.start")}
                </button>
                <button type="button" className="button-secondary px-5 py-2 text-xs" onClick={() => setTimerRunning(false)}>
                  {t("worryTime.actions.pause")}
                </button>
                <button type="button" className="button-secondary px-5 py-2 text-xs" onClick={resetTimer}>
                  {t("worryTime.actions.resetTimer")}
                </button>
              </div>
              {secondsLeft === 0 ? (
                <div className="mt-5 rounded-2xl border border-sage/25 bg-mist p-4 text-sm font-bold leading-7 text-sage-dark">
                  {t("worryTime.timer.finished")}
                </div>
              ) : null}
            </article>

            <article className="card">
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("worryTime.worries.title")}</h2>
              <div className="mt-6 grid gap-5">
                {worries.map((worry, index) => (
                  <label key={index} className="grid gap-2">
                    <span className="text-sm font-bold text-ink">{t("worryTime.worries.item", { number: index + 1 })}</span>
                    <textarea
                      className="min-h-20 rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage"
                      value={worry}
                      onChange={(e) => updateWorry(index, e.target.value)}
                    />
                    <VoiceInputButton value={worry} onChange={(value) => updateWorry(index, value)} />
                  </label>
                ))}
              </div>
            </article>
          </div>

          <article className="card mt-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-ink">{t("worryTime.sorting.title")}</h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-muted">
                {t("worryTime.sorting.description")}
              </p>
            </div>
            <div className="mt-5 grid gap-3">
              {worries.map((_, index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-ink/10 bg-white/75 p-3 sm:grid sm:grid-cols-[88px_1fr] sm:items-center sm:gap-3"
                >
                  <p className="mb-3 text-sm font-bold text-ink sm:mb-0">{t("worryTime.worries.item", { number: index + 1 })}</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {controlOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => updateControl(index, item.value)}
                        className={`min-h-11 rounded-full border px-4 py-2 text-center text-xs font-bold transition focus:outline-none focus:ring-4 focus:ring-sage/15 ${
                          controls[index] === item.value
                            ? "border-sage bg-mist text-sage-dark"
                            : "border-ink/10 bg-white text-ink/70 hover:border-sage/50"
                        }`}
                      >
                        {t(item.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.55fr]">
            <article className="card">
              <h2 className="text-xl font-bold text-ink">{t("worryTime.action.title")}</h2>
              <textarea
                className="mt-5 min-h-28 w-full rounded-2xl border border-ink/10 bg-white/80 p-4 leading-7 outline-none focus:border-sage"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setDone(false);
                }}
                placeholder={t("worryTime.action.placeholder")}
              />
              <div className="mt-3">
                <VoiceInputButton
                  value={action}
                  onChange={(value) => {
                    setAction(value);
                    setDone(false);
                  }}
                />
              </div>
            </article>
            <article className="card flex flex-col justify-center">
              <button type="button" className="button-primary w-full" onClick={generateAiResponse} disabled={loading}>
                {loading ? t("worryTime.actions.organizing") : t("worryTime.actions.organize")}
              </button>
              <button type="button" className="button-secondary mt-3 w-full" onClick={() => setDone(true)}>
                {t("worryTime.actions.complete")}
              </button>
              <button type="button" className="mt-3 min-h-11 w-full text-sm font-bold text-muted transition hover:text-sage-dark" onClick={reset}>
                {t("worryTime.actions.reset")}
              </button>
              {validation ? <p className="mt-4 text-sm font-bold text-sage-dark">{validation}</p> : null}
              {error ? <p className="mt-4 text-sm font-bold text-sage-dark">{error}</p> : null}
            </article>
          </div>

          {aiResult ? (
            <div className="mt-8 rounded-3xl border border-sage/25 bg-white/85 p-6 shadow-soft sm:p-8">
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("worryTime.result.title")}</h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("worryTime.result.controllable")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.controllableParts}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("worryTime.result.tomorrow")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.canWaitUntilTomorrow}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("worryTime.result.smallAction")}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-muted">{aiResult.tomorrowSmallAction}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("worryTime.result.bedtimeSentence")}</h3>
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
              <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">{t("worryTime.done.title")}</h2>
              <p className="mt-4 text-base leading-8 text-muted">
                {t("worryTime.done.description")}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/check-in" className="button-primary">
                  {t("worryTime.actions.backToSweet")}
                </Link>
                <Link href="/mood-journal" className="button-secondary">
                  {t("worryTime.actions.openMoodJournal")}
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
