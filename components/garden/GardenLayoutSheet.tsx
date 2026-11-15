import { GardenSheet } from "@/components/garden/GardenSheet";
import { useEffect, useRef } from "react";
import { gardenItems, gardenLayoutSlots, type GardenItemKey, type GardenLayoutSlot } from "@/lib/gardenCatalog";
import { useTranslation } from "@/lib/i18n/client";

type GardenLayoutSheetProps = {
  open: boolean;
  unlockedPositions: GardenLayoutSlot[];
  unlockedItems: GardenItemKey[];
  selectedItems: Partial<Record<GardenLayoutSlot, GardenItemKey>>;
  saving: boolean;
  onChoose: (slot: GardenLayoutSlot, item: GardenItemKey) => void;
  onClose: () => void;
  focusSlot?: GardenLayoutSlot | null;
  error?: string;
};

export function GardenLayoutSheet({ open, unlockedPositions, unlockedItems, selectedItems, saving, onChoose, onClose, focusSlot, error }: GardenLayoutSheetProps) {
  const { t } = useTranslation();
  const targetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open && focusSlot) targetRef.current?.focus();
  }, [open, focusSlot]);
  return (
    <GardenSheet open={open} title={t("garden.layout.title")} description={t("garden.layout.description")} closeLabel={t("garden.actions.close")} onClose={onClose}>
      {error ? <p role="alert" className="mb-4 rounded-xl bg-mist px-4 py-3 text-sm font-semibold text-sage-dark">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {gardenLayoutSlots.map((slot) => {
          const unlocked = unlockedPositions.includes(slot.key);
          return (
            <section key={slot.key} ref={slot.key === focusSlot ? targetRef : undefined}
              tabIndex={slot.key === focusSlot ? -1 : undefined} data-layout-slot={slot.key}
              aria-labelledby={`garden-layout-${slot.key}`}
              className="scroll-mt-4 rounded-2xl border border-sage/20 bg-white/80 p-4 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-sage">
              <div className="flex items-center justify-between gap-3">
                <h3 id={`garden-layout-${slot.key}`} className="font-bold text-ink">{t(`garden.layout.slots.${slot.key}`)}</h3>
                <span className="text-xs font-semibold text-muted">{t(unlocked ? "garden.layout.unlocked" : "garden.layout.locked", { count: slot.unlockDay })}</span>
              </div>
              {unlocked ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {gardenItems.filter((item) => item.slot === slot.key && unlockedItems.includes(item.key)).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`garden-item-chip ${selectedItems[slot.key] === item.key ? "garden-item-chip-selected" : ""}`}
                      disabled={saving}
                      onClick={() => onChoose(slot.key, item.key)}
                    >{t(`garden.layout.items.${item.key}`)}</button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-6 text-muted">{t(saving ? "garden.layout.saving" : "garden.layout.savedNotice")}</p>
    </GardenSheet>
  );
}
