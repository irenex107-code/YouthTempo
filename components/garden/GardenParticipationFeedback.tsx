import type { TempoGardenData } from "@/lib/cloudRecords";
import type { GardenLayoutSlot } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

export type GardenParticipationFeedbackData = Pick<TempoGardenData, "total" | "stage"> & {
  newParticipationDay: boolean;
  unlockedPositions: GardenLayoutSlot[];
};

type GardenParticipationFeedbackProps = {
  feedback: GardenParticipationFeedbackData;
  onOpenLayout: (slot: GardenLayoutSlot) => void;
  onDismissUnlocks: () => void;
};

export function GardenParticipationFeedback({ feedback, onOpenLayout, onDismissUnlocks }: GardenParticipationFeedbackProps) {
  const { locale, t } = useTranslation();
  const earlyMilestone = feedback.newParticipationDay
    ? feedback.total === 1 && feedback.stage === "sprout" ? "sprout"
      : feedback.total === 3 && feedback.stage === "leaves" && feedback.unlockedPositions.includes("flower_border") ? "leaves"
        : feedback.total === 7 && feedback.stage === "bloom" && feedback.unlockedPositions.includes("hill_path") ? "bloom"
          : null
    : null;
  return (
    <section className="my-4 rounded-2xl border border-sage/20 bg-mist/70 p-4" aria-label={t("garden.growth.savedTitle")}>
      <div role="status">
        <p className="font-bold text-sage-dark">{t(feedback.total === 1 ? "garden.growth.totalOne" : "garden.growth.totalOther", {
          count: new Intl.NumberFormat(locale).format(feedback.total),
        })}</p>
        <p className="mt-2 text-sm leading-7 text-muted">{earlyMilestone
          ? t(`garden.growth.milestones.${earlyMilestone}`)
          : t("garden.growth.plant", { stage: t(`garden.stage.${feedback.stage}`) })}</p>
        {!feedback.newParticipationDay ? <p className="mt-1 text-sm leading-7 text-muted">{t("garden.growth.sameDay")}</p> : null}
      </div>
      {feedback.unlockedPositions.length ? (
        <div className="mt-3 grid gap-3">
          {feedback.unlockedPositions.map((slot) => (
            <div key={slot} className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">{(earlyMilestone === "leaves" && slot === "flower_border") || (earlyMilestone === "bloom" && slot === "hill_path")
                ? t(`garden.layout.slots.${slot}`)
                : t("garden.growth.positionOpened", { position: t(`garden.layout.slots.${slot}`) })}</p>
              <button type="button" className="button-secondary" onClick={() => onOpenLayout(slot)}
                aria-label={t("garden.growth.arrangePosition", { position: t(`garden.layout.slots.${slot}`) })}>
                {t("garden.growth.arrange")}
              </button>
            </div>
          ))}
          <button type="button" className="w-fit text-sm font-semibold text-sage-dark underline underline-offset-4" onClick={onDismissUnlocks}>
            {t("garden.growth.keepAsIs")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
