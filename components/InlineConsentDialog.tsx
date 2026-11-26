import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "@/lib/i18n/client";

/** Keeps the same consent form mounted when an action brings it into view. */
export function InlineConsentDialog({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ) || []).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div ref={dialogRef} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined}
      aria-label={open ? t("inlineConsent.title") : undefined} onKeyDown={trapFocus}
      className={open ? "fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-6 backdrop-blur-sm" : undefined}
      onMouseDown={(event) => { if (open && event.target === event.currentTarget) onClose(); }}>
      <div className={open ? "max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl sm:p-6" : undefined}>
        {open ? <div className="mb-3 flex justify-end">
          <button ref={closeRef} type="button" className="button-secondary px-4 py-2 text-sm" onClick={onClose}>
            {t("inlineConsent.closeDialog")}
          </button>
        </div> : null}
        {children}
      </div>
    </div>
  );
}
