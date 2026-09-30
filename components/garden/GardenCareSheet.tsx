import { GardenSheet } from "@/components/garden/GardenSheet";
import type { GardenCareAction } from "@/lib/gardenCatalog";
import { gardenCareActions } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

type GardenCareSheetProps = {
  open: boolean;
  available: boolean;
  onChoose: (action: GardenCareAction) => void;
  onClose: () => void;
};

export function GardenCareSheet({ open, available, onChoose, onClose }: GardenCareSheetProps) {
  const { t } = useTranslation();
  return (
    <GardenSheet open={open} title={t("garden.care.title")} description={t("garden.care.description")} closeLabel={t("garden.actions.close")} onClose={onClose}>
      <p className="rounded-2xl bg-mist/70 px-4 py-3 text-sm leading-7 text-sage-dark">
        {t(available ? "garden.care.available" : "garden.care.unavailable")}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {gardenCareActions.map((action) => (
          <button key={action} type="button" className="garden-care-choice" disabled={!available} onClick={() => onChoose(action)}>
            <span className="font-bold text-ink">{t(`garden.care.options.${action}.title`)}</span>
            <span className="mt-1 text-sm leading-6 text-muted">{t(`garden.care.options.${action}.description`)}</span>
          </button>
        ))}
      </div>
    </GardenSheet>
  );
}
