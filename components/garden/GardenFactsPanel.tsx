import type { ChangeEvent } from "react";
import type { TempoGardenData } from "@/lib/cloudRecords";
import { useTranslation } from "@/lib/i18n/client";

type GardenFactsPanelProps = {
  data: TempoGardenData;
  savingPreference: boolean;
  onReminderChange: (mode: TempoGardenData["reminderMode"]) => void;
  onOpenKeepsakes: () => void;
};

const reminderModes: TempoGardenData["reminderMode"][] = ["off", "daily", "weekly"];

export function GardenFactsPanel({ data, savingPreference, onReminderChange, onOpenKeepsakes }: GardenFactsPanelProps) {
  const { t } = useTranslation();
  function changeReminder(event: ChangeEvent<HTMLSelectElement>) {
    onReminderChange(event.target.value as TempoGardenData["reminderMode"]);
  }
  return (
    <section className="garden-facts" aria-labelledby="garden-facts-title">
      <div>
        <p className="eyebrow">{t("garden.facts.eyebrow")}</p>
        <h2 id="garden-facts-title" className="mt-1 text-xl font-bold text-ink">{t(`garden.stage.${data.stage}`)}</h2>
      </div>
      <dl className="garden-fact-grid">
        <div><dt>{t("garden.stats.weekLabel")}</dt><dd>{data.thisWeek}</dd></div>
        <div><dt>{t("garden.stats.monthLabel")}</dt><dd>{data.thisMonth}</dd></div>
        <div><dt>{t("garden.stats.totalLabel")}</dt><dd>{data.total}</dd></div>
      </dl>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="text-sm font-semibold text-ink">
          {t("garden.reminders.title")}
          <select className="mt-2 block w-full rounded-xl border border-sage/30 bg-white px-4 py-3 font-normal" value={data.reminderMode} disabled={savingPreference} onChange={changeReminder}>
            {reminderModes.map((mode) => <option key={mode} value={mode}>{t(`garden.reminders.${mode}`)}</option>)}
          </select>
        </label>
        <button type="button" className="button-secondary" onClick={onOpenKeepsakes}>{t("garden.keepsakes.open")}</button>
      </div>
    </section>
  );
}
