import type { ChangeEvent } from "react";
import type { TempoGardenData } from "@/lib/cloudRecords";
import { gardenLayoutSlots } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

type GardenFactsPanelProps = {
  data: TempoGardenData;
  readOnly?: boolean;
  controlsBlocked?: boolean;
  savingPreference: boolean;
  onReminderChange: (mode: TempoGardenData["reminderMode"]) => void;
  onOpenKeepsakes: () => void;
  onOpenLayout: () => void;
};

const reminderModes: TempoGardenData["reminderMode"][] = ["off", "daily", "weekly"];

export function GardenFactsPanel({ data, readOnly = false, controlsBlocked = false, savingPreference, onReminderChange, onOpenKeepsakes, onOpenLayout }: GardenFactsPanelProps) {
  const { locale, t } = useTranslation();
  const nextPosition = gardenLayoutSlots.find((slot) => !data.unlockedPositions.includes(slot.key));
  const availablePositions = new Intl.ListFormat(locale, { style: "long", type: "conjunction" })
    .format(data.unlockedPositions.map((slot) => t(`garden.layout.slots.${slot}`)));
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
      <div className="grid gap-3 text-sm leading-7 text-muted">
        {availablePositions ? <p>{t("garden.growth.availablePositions", { positions: availablePositions })}</p> : null}
        {!readOnly ? <p>{nextPosition ? t("garden.growth.nextPosition", {
          count: nextPosition.unlockDay,
          position: t(`garden.layout.slots.${nextPosition.key}`),
        }) : t("garden.growth.allPositionsOpen")}</p> : null}
        {!readOnly ? <button type="button" className="button-secondary w-fit" disabled={controlsBlocked} onClick={onOpenLayout}>{t("garden.growth.viewPositions")}</button> : null}
      </div>
      <details className="rounded-2xl border border-sage/20 p-4" data-garden-options>
        <summary className="cursor-pointer text-sm font-semibold text-sage-dark">{t("garden.options.title")}</summary>
        {!readOnly ? <p className="mt-3 text-sm leading-7 text-muted">{t("garden.reminders.description")}</p> : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="text-sm font-semibold text-ink">
            {t("garden.reminders.title")}
            <select className="mt-2 block w-full rounded-xl border border-sage/30 bg-white px-4 py-3 font-normal" value={data.reminderMode} disabled={readOnly || savingPreference} onChange={changeReminder}>
              {reminderModes.map((mode) => <option key={mode} value={mode}>{t(`garden.reminders.${mode}`)}</option>)}
            </select>
          </label>
          <button type="button" className="button-secondary" disabled={controlsBlocked} onClick={onOpenKeepsakes}>{t("garden.keepsakes.open")}</button>
        </div>
      </details>
    </section>
  );
}
