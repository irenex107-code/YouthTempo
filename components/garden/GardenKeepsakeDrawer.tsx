import { GardenSheet } from "@/components/garden/GardenSheet";
import { gardenKeepsakeTypes, type GardenKeepsakeType } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

type GardenKeepsakeDrawerProps = {
  open: boolean;
  keepsakes: Array<{ id: string; date: string; type: GardenKeepsakeType }>;
  canCreateToday: boolean;
  saving: boolean;
  onCreate: (type: GardenKeepsakeType) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function GardenKeepsakeDrawer({
  open,
  keepsakes,
  canCreateToday,
  saving,
  onCreate,
  onDelete,
  onClose,
}: GardenKeepsakeDrawerProps) {
  const { locale, t } = useTranslation();
  return (
    <GardenSheet open={open} title={t("garden.keepsakes.title")} description={t("garden.keepsakes.description")} closeLabel={t("garden.actions.close")} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-3">
        {gardenKeepsakeTypes.map((type) => (
          <button
            key={type}
            type="button"
            className="rounded-2xl border border-sage/20 bg-white/80 p-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canCreateToday || saving}
            onClick={() => onCreate(type)}
          >
            <span className="font-bold text-ink">{t(`garden.keepsakes.types.${type}`)}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm leading-7 text-muted">
        {t(canCreateToday ? "garden.keepsakes.available" : "garden.keepsakes.unavailable")}
      </p>
      {saving ? <p role="status" className="mt-3 text-sm text-muted">{t("garden.keepsakes.saving")}</p> : null}
      {keepsakes.length ? (
        <ul className="mt-5 grid gap-3">
          {keepsakes.map((keepsake) => (
            <li key={keepsake.id} className="flex items-center justify-between gap-4 rounded-2xl border border-sage/20 bg-white/80 px-4 py-3">
              <div>
                <p className="font-bold text-ink">{t(`garden.keepsakes.types.${keepsake.type}`)}</p>
                <p className="mt-1 text-sm text-muted">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Shanghai" })
                    .format(new Date(`${keepsake.date}T00:00:00+08:00`))}
                </p>
              </div>
              <button type="button" className="text-sm font-semibold text-sage-dark underline underline-offset-4" disabled={saving} onClick={() => onDelete(keepsake.id)}>
                {t("garden.keepsakes.remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-5 text-sm text-muted">{t("garden.keepsakes.empty")}</p>}
    </GardenSheet>
  );
}
