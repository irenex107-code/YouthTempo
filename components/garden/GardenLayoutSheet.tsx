import { GardenSheet } from "@/components/garden/GardenSheet";
import { gardenItems, gardenLayoutSlots, type GardenItemKey, type GardenLayoutSlot } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

type GardenLayoutSheetProps = {
  open: boolean;
  unlockedPositions: GardenLayoutSlot[];
  unlockedItems: GardenItemKey[];
  selectedItems: Partial<Record<GardenLayoutSlot, GardenItemKey>>;
  onChoose: (slot: GardenLayoutSlot, item: GardenItemKey) => void;
  onClose: () => void;
};

export function GardenLayoutSheet({ open, unlockedPositions, unlockedItems, selectedItems, onChoose, onClose }: GardenLayoutSheetProps) {
  const { t } = useTranslation();
  return (
    <GardenSheet open={open} title={t("garden.layout.title")} description={t("garden.layout.description")} closeLabel={t("garden.actions.close")} onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        {gardenLayoutSlots.map((slot) => {
          const unlocked = unlockedPositions.includes(slot.key);
          return (
            <section key={slot.key} className="rounded-2xl border border-sage/20 bg-white/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold text-ink">{t(`garden.layout.slots.${slot.key}`)}</h3>
                <span className="text-xs font-semibold text-muted">{t(unlocked ? "garden.layout.unlocked" : "garden.layout.locked", { count: slot.unlockDay })}</span>
              </div>
              {unlocked ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {gardenItems.filter((item) => item.slot === slot.key && unlockedItems.includes(item.key)).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`garden-item-chip ${selectedItems[slot.key] === item.key ? "garden-item-chip-selected" : ""}`}
                      onClick={() => onChoose(slot.key, item.key)}
                    >{t(`garden.layout.items.${item.key}`)}</button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-6 text-muted">{t("garden.layout.previewNotice")}</p>
    </GardenSheet>
  );
}
