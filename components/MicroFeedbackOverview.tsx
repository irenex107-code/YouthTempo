import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";

type Summary = {
  sampleLimited: boolean;
  people: number;
  submissions: number;
  byFeature: Record<string, number>;
  byAge: Record<string, number>;
  ratios: { helpful: number | null; wouldReturn: number | null; wantsHumanSupport: number | null };
  pendingSafety: number;
  comments: Array<{ id: string; feature: string; ageBand: string; comment: string; safetyReview: boolean; createdAt: string }>;
};

export function MicroFeedbackOverview({ accessToken }: { accessToken: string }) {
  const { locale, t } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/admin/pilot-experience", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || t("microFeedback.errors.unavailable"));
        return payload as Summary;
      })
      .then((payload) => { if (active) setSummary(payload); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : t("microFeedback.errors.unavailable")); });
    return () => { active = false; };
  }, [accessToken, t]);
  const percent = (value: number | null) => value === null
    ? t("microFeedbackAdmin.noAnswers")
    : new Intl.NumberFormat(locale === "en" ? "en" : "zh-CN", { style: "percent", maximumFractionDigits: 0 }).format(value);
  return (
    <section className="section section-muted" aria-labelledby="micro-feedback-admin-title">
      <div className="container">
        <h2 id="micro-feedback-admin-title" className="text-2xl font-bold text-ink">{t("microFeedbackAdmin.title")}</h2>
        <p className="mt-2 text-sm text-muted">{t("microFeedbackAdmin.description")}</p>
        {error ? <p role="alert" className="mt-4 text-sm">{error}</p> : null}
        {summary ? (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ["people", summary.people],
                ["submissions", summary.submissions],
                ["helpful", percent(summary.ratios.helpful)],
                ["wouldReturn", percent(summary.ratios.wouldReturn)],
                ["wantsHumanSupport", percent(summary.ratios.wantsHumanSupport)],
                ["pendingSafety", summary.pendingSafety],
              ] as const).map(([key, value]) => (
                <div key={key} className="card"><h3 className="text-sm font-bold">{t(`microFeedbackAdmin.stats.${key}`)}</h3><p className="mt-2 text-2xl font-black">{value}</p></div>
              ))}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="card"><h3 className="font-bold">{t("microFeedbackAdmin.byFeature")}</h3>
                <ul className="mt-3 space-y-2 text-sm">{Object.entries(summary.byFeature).map(([feature, count]) => <li key={feature}>{feature}: {count}</li>)}</ul>
              </div>
              <div className="card"><h3 className="font-bold">{t("microFeedbackAdmin.byAge")}</h3>
                <ul className="mt-3 space-y-2 text-sm">{Object.entries(summary.byAge).map(([age, count]) => <li key={age}>{age}: {count}</li>)}</ul>
              </div>
            </div>
            {summary.sampleLimited ? <p className="mt-3 text-xs text-muted">{t("microFeedbackAdmin.sampleLimited")}</p> : null}
            <details className="card mt-5"><summary className="cursor-pointer font-bold">{t("microFeedbackAdmin.comments")}</summary>
              <ul className="mt-4 grid gap-3">{summary.comments.map((item) => (
                <li key={item.id} className="rounded-xl bg-mist p-3 text-sm">
                  <span className="font-bold">{item.feature} · {item.ageBand} {item.safetyReview ? `· ${t("microFeedbackAdmin.safety")}` : ""}</span>
                  <p className="mt-2 break-words whitespace-pre-wrap">{item.comment}</p>
                  <time dateTime={item.createdAt} className="mt-2 block text-xs text-muted">
                    {new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "medium" }).format(new Date(item.createdAt))}
                  </time>
                </li>
              ))}</ul>
            </details>
          </>
        ) : !error ? <p role="status" className="mt-5 text-sm">{t("peerSpace.loading")}</p> : null}
      </div>
    </section>
  );
}
