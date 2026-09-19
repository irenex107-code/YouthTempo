import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";

type Feature = "quick_check_in" | "sweet" | "peer_space" | "support" | "mood_journal" | "worry_time";
type Answer = boolean | null;
const questions = ["helpful", "wouldReturn", "wantsHumanSupport"] as const;

export function MicroPilotFeedback({ feature, trigger, crisis = false }: {
  feature: Feature;
  trigger: number | string;
  crisis?: boolean;
}) {
  const { locale, t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [answers, setAnswers] = useState<Record<(typeof questions)[number], Answer>>({
    helpful: null, wouldReturn: null, wantsHumanSupport: null,
  });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!trigger || crisis) return;
    let active = true;
    peerSpaceRequest<{ eligible: boolean }>(
      `/api/pilot-experience?feature=${encodeURIComponent(feature)}`, locale,
    ).then((result) => { if (active) setVisible(result.eligible); })
      .catch(() => { if (active) setVisible(false); });
    return () => { active = false; };
  }, [feature, trigger, crisis, locale]);

  async function finish(outcome: "dismissed" | "submitted") {
    setBusy(true);
    setNotice("");
    try {
      const response = await peerSpaceRequest<{ urgent: boolean }>("/api/pilot-experience", locale, "POST", {
        feature, outcome,
        ...(outcome === "submitted" ? { ...answers, comment } : {}),
      });
      setVisible(false);
      if (outcome === "submitted") setNotice(response.urgent ? t("microFeedback.urgent") : t("microFeedback.thanks"));
    } catch {
      setNotice(t("microFeedback.errors.unavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      {visible && !crisis ? (
        <section className="mt-5 rounded-2xl border border-sage/25 bg-paper p-5 shadow-sm" aria-label={t("microFeedback.title")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-ink">{t("microFeedback.title")}</h2>
              <p className="mt-1 text-sm text-muted">{t("microFeedback.description")}</p>
            </div>
            <button type="button" className="text-sm font-bold text-sage-dark underline" disabled={busy} onClick={() => finish("dismissed")}>
              {t("microFeedback.skip")}
            </button>
          </div>
          <div className="mt-4 grid gap-4">
            {questions.map((question) => (
              <fieldset key={question} className="min-w-0">
                <legend className="text-sm font-bold text-ink">{t(`microFeedback.questions.${question}`)}</legend>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  {([true, false] as const).map((value) => (
                    <label key={String(value)} className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name={question} checked={answers[question] === value}
                        onChange={() => setAnswers((current) => ({ ...current, [question]: value }))} />
                      {t(value ? "microFeedback.yes" : "microFeedback.no")}
                    </label>
                  ))}
                  <button type="button" className="text-xs text-muted underline" onClick={() => setAnswers((current) => ({ ...current, [question]: null }))}>
                    {t("microFeedback.clear")}
                  </button>
                </div>
              </fieldset>
            ))}
            <label className="text-sm font-bold text-ink">{t("microFeedback.comment")}
              <textarea className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3 text-sm font-normal" rows={2}
                maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} />
            </label>
            <button type="button" className="button-secondary w-fit" disabled={busy} onClick={() => finish("submitted")}>
              {t("microFeedback.submit")}
            </button>
          </div>
        </section>
      ) : null}
      {notice ? <p className="mt-3 text-sm leading-6 text-sage-dark" role="status">{notice}{" "}
        {notice === t("microFeedback.urgent") || (notice === t("microFeedback.thanks") && answers.wantsHumanSupport)
          ? <Link href="/referral" className="underline">{t("microFeedback.support")}</Link> : null}
      </p> : null}
    </div>
  );
}
