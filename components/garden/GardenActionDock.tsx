import { useTranslation } from "@/lib/i18n/client";

type GardenActionDockProps = {
  onRecord: () => void;
  onCare: () => void;
  onLayout: () => void;
};

function GardenActionIcon({ kind }: { kind: "record" | "care" | "layout" }) {
  if (kind === "record") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2Z" /><path d="M8 9h8M8 13h6" /></svg>;
  if (kind === "care") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-3.5 2-6 5-10Z" /><path d="M10 16c.7.7 1.4 1 2.4 1" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 4v6M17 4v6M5 13h6v6H5zM14 13h5v6h-5z" /></svg>;
}

export function GardenActionDock({ onRecord, onCare, onLayout }: GardenActionDockProps) {
  const { t } = useTranslation();
  return (
    <nav className="garden-action-dock" aria-label={t("garden.actions.ariaLabel")}>
      {(["record", "care", "layout"] as const).map((action) => (
        <button key={action} type="button" className="garden-action-button" onClick={{ record: onRecord, care: onCare, layout: onLayout }[action]}>
          <GardenActionIcon kind={action} />
          <span>{t(`garden.actions.${action}`)}</span>
        </button>
      ))}
    </nav>
  );
}
