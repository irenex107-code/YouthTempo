import Head from "next/head";
import { useState } from "react";
import { useTranslation } from "@/lib/i18n/client";
import { reportDimensions, type ReportDimension, type ReportSummary } from "@/lib/reports/types";
import {
  buildPreviewReport, previewPermissionWindow, previewRecipientAvailable, reportPreviewScenarios,
  type ReportPreviewScenario, type ReportPreviewViewer,
} from "@/lib/reports/previewSamples";

type Recipient = "guardian" | "teacher";
type PreviewControl = { dimensions: ReportDimension[]; confirmed: boolean; enabled: boolean };
const recipients = ["guardian", "teacher"] as const;
const viewers = ["self", ...recipients] as const;

function emptyControls(): Record<Recipient, PreviewControl> {
  return {
    guardian: { dimensions: [], confirmed: false, enabled: false },
    teacher: { dimensions: [], confirmed: false, enabled: false },
  };
}

function formatShanghaiInstant(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Shanghai", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export default function ReportsPreviewPage() {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState<ReportPreviewScenario>("ready");
  const [viewer, setViewer] = useState<ReportPreviewViewer>("self");
  const [controls, setControls] = useState(emptyControls);
  const [readFailed, setReadFailed] = useState(false);
  const summary = buildPreviewReport(scenario, viewer, viewer === "self" ? reportDimensions : controls[viewer].dimensions);

  function reset(nextScenario: ReportPreviewScenario = "ready") {
    setScenario(nextScenario);
    setViewer("self");
    setControls(emptyControls());
    setReadFailed(nextScenario === "readFailure");
  }

  function updateControl(recipient: Recipient, update: (current: PreviewControl) => PreviewControl) {
    setControls((current) => ({ ...current, [recipient]: update(current[recipient]) }));
  }

  const blockedState = viewer !== "self" && !previewRecipientAvailable(scenario, viewer)
    ? scenario === "expired" ? "expired" : "unverified"
    : viewer !== "self" && !controls[viewer].enabled ? "notEnabled" : null;

  return (
    <>
      <Head>
        <title>{t("reportsPreview.metadata.title")}</title>
        <meta name="description" content={t("reportsPreview.metadata.description")} />
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container max-w-5xl">
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-7 text-amber-900">
            {t("reportsPreview.notice")}
          </p>
          <h1 className="mt-6 text-3xl font-black tracking-[-0.035em] text-ink sm:text-4xl">{t("reportsPreview.title")}</h1>
          <p className="mt-3 rounded-2xl bg-mist px-4 py-3 text-sm leading-7 text-ink" data-report-historical-preview>
            <strong>{t("reportsV2.historicalPreview.label")}</strong> {t("reportsV2.historicalPreview.description")}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">{t("reportsPreview.description")}</p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-bold text-ink" htmlFor="report-preview-scenario">
              {t("reportsPreview.scenarioLabel")}
              <select id="report-preview-scenario" className="mt-2 block w-full rounded-xl border border-sage/30 bg-white px-4 py-3 font-normal"
                value={scenario} onChange={(event) => reset(event.target.value as ReportPreviewScenario)}>
                {reportPreviewScenarios.map((value) => <option key={value} value={value}>{t(`reportsPreview.scenarios.${value}`)}</option>)}
              </select>
            </label>
            <button type="button" className="button-secondary" onClick={() => reset()}>{t("reportsPreview.reset")}</button>
          </div>

          <section className="mt-8" aria-labelledby="report-preview-settings">
            <h2 id="report-preview-settings" className="text-xl font-bold text-ink">{t("reportsPreview.sharing.title")}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{t("reportsPreview.sharing.scope")}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {recipients.map((recipient) => (
                <RecipientSettings key={recipient} recipient={recipient} scenario={scenario} control={controls[recipient]}
                  onChange={(update) => updateControl(recipient, update)}
                  onRevoke={() => setControls((current) => ({ ...current, [recipient]: emptyControls()[recipient] }))} />
              ))}
            </div>
          </section>

          <section className="card mt-6 min-w-0" aria-labelledby="report-preview-result">
            <h2 id="report-preview-result" className="text-xl font-bold text-ink">{t("reportsPreview.report.title")}</h2>
            <div role="group" aria-label={t("reportsPreview.viewerLabel")} className="mt-4 flex flex-wrap gap-2">
              {viewers.map((value) => (
                <button key={value} type="button" className={viewer === value ? "button-primary" : "button-secondary"}
                  aria-pressed={viewer === value} onClick={() => setViewer(value)}>{t(`reportsPreview.viewers.${value}`)}</button>
              ))}
            </div>
            <p className="mt-4 text-sm leading-7 text-muted">{t(viewer === "self" ? "reportsPreview.report.selfScope" : "reportsPreview.report.recipientScope")}</p>
            {readFailed ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p role="alert" className="text-sm leading-7 text-ink">{t("reportsPreview.states.readFailure")}</p>
                <button type="button" className="button-secondary mt-3" onClick={() => setReadFailed(false)}>{t("reportsPreview.retry")}</button>
              </div>
            ) : blockedState ? (
              <p role="status" className="mt-4 rounded-2xl bg-mist p-4 text-sm leading-7 text-ink">{t(`reportsPreview.states.${blockedState}`)}</p>
            ) : <ReportResult summary={summary} />}
          </section>
          <p className="mt-5 text-sm leading-7 text-muted">{t("reportsPreview.footer")}</p>
        </div>
      </section>
    </>
  );
}

function RecipientSettings({ recipient, scenario, control, onChange, onRevoke }: {
  recipient: Recipient;
  scenario: ReportPreviewScenario;
  control: PreviewControl;
  onChange: (update: (current: PreviewControl) => PreviewControl) => void;
  onRevoke: () => void;
}) {
  const { locale, t } = useTranslation();
  const available = previewRecipientAvailable(scenario, recipient);
  const permissionWindow = previewPermissionWindow(scenario, recipient);
  return (
    <section className="card min-w-0" aria-labelledby={`report-settings-${recipient}`}>
      <h3 id={`report-settings-${recipient}`} className="text-lg font-bold text-ink">{t(`reportsPreview.viewers.${recipient}`)}</h3>
      <p className="mt-2 text-sm leading-7 text-muted">{t(`reportsPreview.sharing.${recipient}Scope`)}</p>
      <p className="mt-2 text-sm leading-7 text-muted">{t("reportsPreview.sharing.schedule")}</p>
      <p className="mt-2 text-sm leading-7 text-muted">{t("reportsPreview.sharing.window", {
        start: formatShanghaiInstant(permissionWindow.effectiveAt, locale), end: formatShanghaiInstant(permissionWindow.expiresAt, locale),
      })}</p>
      {!available ? <p role="status" className="mt-3 text-sm leading-7 text-ink">{t(scenario === "expired" ? "reportsPreview.states.expired" : "reportsPreview.states.unverified")}</p> : null}
      {control.enabled ? (
        <div className="mt-4">
          <p role="status" className="text-sm leading-7 text-sage-dark">{t("reportsPreview.sharing.enabled")}</p>
          <p className="mt-2 text-sm leading-7 text-muted">{control.dimensions.map((dimension) => t(`reportsPreview.dimensions.${dimension}`)).join(" / ")}</p>
          <button type="button" className="button-secondary mt-4" onClick={onRevoke}>{t("reportsPreview.sharing.revoke")}</button>
        </div>
      ) : (
        <>
          <fieldset className="mt-4" disabled={!available}>
            <legend className="text-sm font-bold text-ink">{t("reportsPreview.sharing.choose")}</legend>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
              {reportDimensions.map((dimension) => (
                <label key={dimension} className="flex items-center gap-2 text-sm leading-6 text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-sage-dark" checked={control.dimensions.includes(dimension)}
                    onChange={(event) => onChange((current) => ({
                      ...current, confirmed: false,
                      dimensions: event.target.checked ? [...current.dimensions, dimension] : current.dimensions.filter((value) => value !== dimension),
                    }))} />
                  {t(`reportsPreview.dimensions.${dimension}`)}
                </label>
              ))}
            </div>
            <label className="mt-5 flex items-start gap-3 text-sm leading-7 text-ink">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-sage-dark" checked={control.confirmed}
                onChange={(event) => onChange((current) => ({ ...current, confirmed: event.target.checked }))} />
              {t("reportsPreview.sharing.confirm")}
            </label>
          </fieldset>
          <button type="button" className="button-primary mt-4" disabled={!available || !control.confirmed || control.dimensions.length === 0}
            onClick={() => onChange((current) => ({ ...current, enabled: true }))}>{t("reportsPreview.sharing.enable")}</button>
        </>
      )}
    </section>
  );
}

function ReportResult({ summary }: { summary: ReportSummary }) {
  const { locale, t } = useTranslation();
  if (summary.status !== "ready") {
    return <p role="status" className="mt-4 rounded-2xl bg-mist p-4 text-sm leading-7 text-ink">{t(`reportsPreview.states.${summary.status}`)}</p>;
  }
  return (
    <div className="mt-5 space-y-3" data-report-summary="ready">
      {summary.period ? <p className="text-sm leading-7 text-ink">{t("reportsPreview.report.period", {
        start: formatShanghaiInstant(summary.period.start, locale), end: formatShanghaiInstant(summary.period.end, locale),
      })}</p> : null}
      {summary.dimensions.map((dimension) => (
        <article key={dimension.id} className="rounded-2xl border border-sage/20 bg-mist/50 p-4" data-report-dimension={dimension.id}>
          <h3 className="font-bold text-ink">{t(`reportsPreview.dimensions.${dimension.id}`)}</h3>
          <p className="mt-2 text-sm leading-7 text-muted">{dimension.state === "category" && dimension.category
            ? t(`reportsPreview.categories.${dimension.category}`)
            : t(dimension.state === "mixed" ? "reportsPreview.report.mixed" : "reportsPreview.report.insufficient")}</p>
          {dimension.comparison !== "unavailable" ? <p className="mt-1 text-sm leading-7 text-muted">{t(`reportsPreview.report.comparison.${dimension.comparison}`)}</p> : null}
        </article>
      ))}
      <p className="text-sm leading-7 text-muted">{t("reportsPreview.report.noConclusion")}</p>
    </div>
  );
}
