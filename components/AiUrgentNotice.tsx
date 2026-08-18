import { useTranslation } from "@/lib/i18n/client";

export function AiUrgentNotice({ message, className = "" }: { message: string; className?: string }) {
  const { t } = useTranslation();

  return (
    <section
      role="alert"
      aria-live="assertive"
      className={`rounded-3xl border border-[#d59b78] bg-[#fff6ef] p-6 shadow-soft sm:p-8 ${className}`.trim()}
    >
      <p className="text-sm font-bold text-[#9a5532]">{t("aiSafety.urgent.label")}</p>
      <h2 className="mt-2 text-[1.7rem] font-bold leading-[1.25] text-ink">{t("aiSafety.urgent.title")}</h2>
      <p className="mt-4 text-base font-bold leading-8 text-ink">{message}</p>
      <p className="mt-4 text-sm leading-7 text-muted">{t("aiSafety.urgent.description")}</p>
    </section>
  );
}
