import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendEmailOtp, verifyEmailOtp } from "@/lib/cloudRecords";
import { emailOtpLength, otpRequestErrorMessage, otpVerificationErrorMessage } from "@/lib/emailOtp";
import { useTranslation } from "@/lib/i18n/client";
import type { StudentAgeBand } from "@/lib/studentConsent";
import type { InlineStudentConsentController } from "@/lib/useInlineStudentConsent";

/** Lives beside the action, keeping its draft in the mounted page. */
export function InlineStudentConsent({ controller: c, studentOnly = false, className = "" }: {
  controller: InlineStudentConsentController;
  studentOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const [ageBand, setAgeBand] = useState<StudentAgeBand | "">("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [name, setName] = useState("");
  const inFlight = useRef(false);
  const actor = useRef(c.userId);
  const authGeneration = useRef(0);
  useEffect(() => () => { ++authGeneration.current; }, []);
  useEffect(() => {
    if (actor.current !== c.userId) {
      actor.current = c.userId;
      ++authGeneration.current;
      inFlight.current = false;
      setEmail(""); setOtpSent(false); setCooldown(0); setAuthBusy(false);
      setChecked(false);
      setAgeBand("");
      setName("");
      setOtp("");
      setAuthError("");
    }
  }, [c.userId]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || cooldown || !email.trim()) return;
    inFlight.current = true;
    setAuthBusy(true);
    setAuthError("");
    setCooldown(60);
    const revision = authGeneration.current;
    try {
      await sendEmailOtp(email.trim());
      if (revision !== authGeneration.current) return;
      setOtpSent(true);
    } catch (error) {
      if (revision !== authGeneration.current) return;
      setAuthError(otpRequestErrorMessage(error, {
        unauthorized: t("account.errors.otpUnauthorized"), rateLimited: t("account.errors.otpRateLimited"),
        network: t("account.errors.otpSendNetwork"), fallback: t("account.errors.otpSendFailed"),
        service: t("account.errors.otpServiceUnavailable"),
      }));
    } finally {
      if (revision === authGeneration.current) { inFlight.current = false; setAuthBusy(false); }
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!new RegExp(`^\\d{${emailOtpLength}}$`).test(otp.trim())) {
      setAuthError(t("account.errors.otpIncomplete", { count: emailOtpLength }));
      return;
    }
    inFlight.current = true;
    setAuthBusy(true);
    setAuthError("");
    const revision = authGeneration.current;
    try {
      await verifyEmailOtp(email.trim(), otp.trim());
      if (revision !== authGeneration.current) return;
      setOtp("");
      setEmail("");
      await c.refresh();
    } catch (error) {
      if (revision !== authGeneration.current) return;
      setAuthError(otpVerificationErrorMessage(error, {
        invalid: t("account.errors.otpInvalid"), rateLimited: t("account.errors.otpVerifyRateLimited"),
        network: t("account.errors.otpVerifyNetwork"), fallback: t("account.errors.otpVerifyFailed"),
        service: t("account.errors.otpServiceUnavailable"),
      }));
    } finally {
      if (revision === authGeneration.current) { inFlight.current = false; setAuthBusy(false); }
    }
  }

  if (c.phase === "other" && !studentOnly) return null;
  return (
    <section data-testid="inline-student-consent" aria-label={t("inlineConsent.title")}
      className={`rounded-2xl border border-sage/25 bg-mist/60 p-5 ${className}`.trim()}>
      {c.phase === "ready" ? <p role="status" className="text-sm font-bold text-sage-dark">{t("inlineConsent.ready")}</p>
        : <h2 className="text-lg font-bold text-ink">{t("inlineConsent.title")}</h2>}
      {c.phase === "ready" ? <p className="mt-2 text-sm leading-6 text-muted">{t("inlineConsent.continueHint")}</p> : null}
      {c.phase === "loading" ? <p role="status" className="mt-3 text-sm">{t("inlineConsent.loading")}</p> : null}
      {c.phase === "other" ? <p className="mt-3 text-sm leading-6">{t("inlineConsent.notStudent")}</p> : null}
      {c.phase === "error" || c.phase === "unknown" ? <>
        <p role="alert" className="mt-3 text-sm leading-6">{t(c.phase === "unknown" ? "inlineConsent.submitUnknown" : "inlineConsent.loadFailed")}</p>
        <button type="button" disabled={c.busy} className="button-secondary mt-4" onClick={() => void c.refresh(undefined, c.phase === "unknown")}>
          {t(c.phase === "unknown" ? "inlineConsent.checkStatus" : "inlineConsent.retry")}
        </button>
      </> : null}
      {c.phase === "signed_out" ? <>
        <p className="mt-3 text-sm leading-6 text-muted">{t("inlineConsent.signInNote")}</p>
        <form className="mt-4 grid gap-3 sm:max-w-md" onSubmit={sendCode}>
          <label className="grid gap-2 text-sm font-bold">{t("account.visitor.email")}
            <input type="email" required autoComplete="email" disabled={authBusy || otpSent} value={email}
              onChange={(event) => setEmail(event.target.value)} className="rounded-xl border border-ink/15 bg-white px-4 py-3" />
          </label>
          <button type="submit" className="button-secondary" disabled={authBusy || cooldown > 0}>
            {cooldown > 0 ? t("account.visitor.resendCountdown", { seconds: cooldown }) : t("account.visitor.sendOtp")}
          </button>
          {!otpSent ? <button type="button" className="text-left text-sm font-bold text-sage-dark" disabled={authBusy || !email.trim()}
            onClick={(event) => {
              if (!event.currentTarget.form?.reportValidity()) return;
              setEmail(email.trim());
              setOtp("");
              setOtpSent(true);
              setCooldown((current) => Math.max(current, 60));
              setAuthError("");
            }}>{t("account.visitor.alreadyReceivedOtp")}</button> : null}
          {otpSent ? <button type="button" className="text-left text-sm font-bold text-sage-dark" disabled={authBusy}
            onClick={() => { setOtpSent(false); setOtp(""); setAuthError(""); }}>{t("account.visitor.changeEmail")}</button> : null}
        </form>
        {otpSent ? <form className="mt-4 grid gap-3 sm:max-w-md" onSubmit={verifyCode}>
          <label className="grid gap-2 text-sm font-bold">{t("account.visitor.otp")}
            <input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={emailOtpLength} value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} className="rounded-xl border border-ink/15 bg-white px-4 py-3" />
          </label>
          <button type="submit" className="button-primary" disabled={authBusy || otp.length !== emailOtpLength}>
            {t(authBusy ? "inlineConsent.signingIn" : "account.visitor.signIn")}
          </button>
        </form> : null}
        {authError ? <p role="alert" className="mt-3 text-sm">{authError}</p> : null}
      </> : null}
      {c.phase === "needs_profile" ? <form className="mt-4 grid gap-3 sm:max-w-md" onSubmit={(event) => { event.preventDefault(); void c.completeProfile(name); }}>
        <p className="text-sm leading-6 text-muted">{t("inlineConsent.profileRequired")}</p>
        <label className="grid gap-2 text-sm font-bold">{t("account.profile.name")}
          <input required maxLength={80} autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value)}
            className="rounded-xl border border-ink/15 bg-white px-4 py-3" />
        </label>
        <button type="submit" disabled={c.busy || !name.trim()} className="button-primary">{t("account.actions.saveProfile")}</button>
        {c.errorKind === "profile" ? <p role="alert" className="text-sm">{t("account.errors.profileSaveFailed")}</p> : null}
      </form> : null}
      {c.phase === "pending_guardian" ? <p className="mt-3 text-sm leading-6">{t("account.consent.pendingTitle")} {t("account.consent.noGuardian")}</p> : null}
      {c.phase === "ineligible" ? <p role="status" className="mt-3 text-sm leading-6">{t("account.consent.ineligible")}</p> : null}
      {c.phase === "needs_consent" ? <>
        <p className="mt-3 text-sm leading-7 text-muted">{t("inlineConsent.description")}</p>
        <details className="mt-3 text-sm leading-7">
          <summary className="cursor-pointer font-bold text-sage-dark">{t("inlineConsent.detailsTitle")}</summary>
          <p className="mt-2">{t("account.consent.description")}</p>
          <p className="mt-2">{t("inlineConsent.schoolReports")}</p>
          <p className="mt-2">{t("inlineConsent.aiSeparate")}</p>
          <Link href="/privacy-safety#student-consent" target="_blank" rel="noopener noreferrer" className="font-bold text-sage-dark underline">
            {t("account.consent.privacyLink")}
          </Link>
        </details>
        <label className="mt-4 grid max-w-md gap-2 text-sm font-bold">{t("account.consent.ageRange")}
          <select value={ageBand} disabled={c.busy} onChange={(event) => { setAgeBand(event.target.value as StudentAgeBand | ""); setChecked(false); }}
            className="rounded-xl border border-ink/15 bg-white px-4 py-3">
            <option value="">{t("inlineConsent.chooseAge")}</option>
            <option value="14_17">{t("account.consent.age14to17")}</option>
            <option value="18_plus">{t("account.consent.age18Plus")}</option>
            <option value="under_14">{t("account.consent.ageUnder14")}</option>
          </select>
        </label>
        <label className="mt-4 flex items-start gap-3 text-sm leading-6">
          <input type="checkbox" checked={checked} disabled={c.busy} onChange={(event) => setChecked(event.target.checked)} className="mt-1" />
          {t("account.consent.acknowledgement")}
        </label>
        <button type="button" className="button-primary mt-4" disabled={c.busy || !checked || !ageBand}
          onClick={() => { if (checked && ageBand) { setChecked(false); void c.assent(ageBand); } }}>
          {t(c.busy ? "account.actions.submitting" : "account.consent.completeStudent")}
        </button>
      </> : null}
      {c.phase !== "ready" && c.phase !== "other" ? <p className="mt-3 text-xs leading-6 text-muted">{t("inlineConsent.draftNotice")}</p> : null}
    </section>
  );
}
