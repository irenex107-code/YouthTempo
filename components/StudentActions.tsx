import Link from "next/link";
import { useTranslation } from "@/lib/i18n/client";

export function StudentActions({ adult = false, recordHref = "/garden", recordDisabled = false, onRecord }: {
  adult?: boolean;
  recordHref?: string;
  recordDisabled?: boolean;
  onRecord?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("studentActions.label")} className="my-4 flex flex-wrap gap-3">
      {onRecord
        ? <button type="button" onClick={onRecord} disabled={recordDisabled} className="button-primary">{t("studentActions.record")}</button>
        : <Link href={recordHref} className="button-primary">{t("studentActions.record")}</Link>}
      <Link href={adult ? "/mood-journal?audience=adult" : "/mood-journal"} className="button-secondary">{t("studentActions.reflect")}</Link>
      <Link href={adult ? "/for-young-adults#direct-support" : "/referral#direct-support"} className="button-secondary">
        {t("studentActions.talk")}
      </Link>
    </nav>
  );
}
