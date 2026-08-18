import Link from "next/link";
import { AI_NOTICE_VERSION } from "@/lib/aiNotice";
import { useTranslation } from "@/lib/i18n/client";

type AiTransparencyNoticeProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export function AiTransparencyNotice({ id, checked, onChange, className = "" }: AiTransparencyNoticeProps) {
  const { t } = useTranslation();

  return (
    <section className={`rounded-2xl border border-sage/25 bg-mist/60 p-5 ${className}`.trim()} aria-labelledby={`${id}-title`}>
      <p className="text-xs font-extrabold tracking-[0.1em] text-sage-dark">{t("aiTransparency.label")}</p>
      <h3 id={`${id}-title`} className="mt-2 text-lg font-bold text-ink">{t("aiTransparency.title")}</h3>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
        <li>{t("aiTransparency.notHuman")}</li>
        <li>{t("aiTransparency.limits")}</li>
        <li>{t("aiTransparency.dataUse")}</li>
      </ul>
      <label className="mt-4 flex items-start gap-3 text-sm font-bold leading-6 text-ink">
        <input type="checkbox" className="mt-1" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span>{t("aiTransparency.confirm")}</span>
      </label>
      <p className="mt-3 text-xs leading-5 text-muted">
        {t("aiTransparency.version", { version: AI_NOTICE_VERSION })}{" "}
        <Link href="/privacy-safety#student-consent" className="font-bold text-sage-dark underline underline-offset-4">
          {t("aiTransparency.details")}
        </Link>
      </p>
    </section>
  );
}

export function AiGeneratedLabel({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return <p className={`text-xs font-extrabold tracking-[0.08em] text-sage-dark ${className}`.trim()}>{t("aiTransparency.generatedLabel")}</p>;
}
