import { GardenSheet } from "@/components/garden/GardenSheet";
import { gardenKeepsakeTypes } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

type GardenKeepsakeDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function GardenKeepsakeDrawer({ open, onClose }: GardenKeepsakeDrawerProps) {
  const { t } = useTranslation();
  return (
    <GardenSheet open={open} title={t("garden.keepsakes.title")} description={t("garden.keepsakes.description")} closeLabel={t("garden.actions.close")} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-3">
        {gardenKeepsakeTypes.map((type) => (
          <div key={type} className="rounded-2xl border border-sage/20 bg-white/80 p-4">
            <p className="font-bold text-ink">{t(`garden.keepsakes.types.${type}`)}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm leading-7 text-muted">{t("garden.keepsakes.previewNotice")}</p>
    </GardenSheet>
  );
}
