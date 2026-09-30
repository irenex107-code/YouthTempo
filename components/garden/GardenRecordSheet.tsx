import type { FormEvent } from "react";
import Link from "next/link";
import { GardenSheet } from "@/components/garden/GardenSheet";
import { useTranslation } from "@/lib/i18n/client";

export type GardenFeeling = "steady" | "mixed" | "heavy" | "unsure";

type GardenRecordSheetProps = {
  open: boolean;
  feeling: GardenFeeling | "";
  saving: boolean;
  onFeelingChange: (feeling: GardenFeeling) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};

const feelings: GardenFeeling[] = ["steady", "mixed", "heavy", "unsure"];

export function GardenRecordSheet(props: GardenRecordSheetProps) {
  const { t } = useTranslation();
  return (
    <GardenSheet open={props.open} title={t("garden.quick.title")} description={t("garden.quick.description")} closeLabel={t("garden.actions.close")} onClose={props.onClose}>
      <form onSubmit={props.onSubmit} className="grid gap-4">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">{t("garden.quick.title")}</legend>
          {feelings.map((option) => (
            <label key={option} className="garden-choice">
              <input type="radio" name="feeling" value={option} checked={props.feeling === option} onChange={() => props.onFeelingChange(option)} required />
              <span>{t(`garden.quick.${option}`)}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="button-primary" disabled={props.saving || !props.feeling}>
            {props.saving ? t("garden.quick.saving") : t("garden.quick.submit")}
          </button>
          <Link href="/check-in" className="button-secondary">{t("garden.actions.fullSweet")}</Link>
        </div>
      </form>
    </GardenSheet>
  );
}
