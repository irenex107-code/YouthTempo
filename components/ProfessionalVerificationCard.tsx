import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { professionalVerificationStatuses } from "@/lib/professionalVerification";
import { useTranslation } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { useSessionActor } from "@/lib/useSessionActor";

type Verification = {
  status: string;
  institutionName: string | null;
  positionTitle: string | null;
  credentialType: string | null;
  credentialNumber: string | null;
  credentialIssuer: string | null;
  credentialExpiresOn: string | null;
  evidenceReference: string | null;
  applicantStatement: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  legacyConfirmed: boolean;
};

type FormState = {
  institutionName: string;
  positionTitle: string;
  credentialType: string;
  credentialNumber: string;
  credentialIssuer: string;
  credentialExpiresOn: string;
  evidenceReference: string;
  applicantStatement: string;
};

const emptyForm: FormState = {
  institutionName: "",
  positionTitle: "",
  credentialType: "",
  credentialNumber: "",
  credentialIssuer: "",
  credentialExpiresOn: "",
  evidenceReference: "",
  applicantStatement: "",
};

function formFromVerification(verification: Verification | null): FormState {
  if (!verification) return emptyForm;
  return {
    institutionName: verification.institutionName || "",
    positionTitle: verification.positionTitle || "",
    credentialType: verification.credentialType || "",
    credentialNumber: verification.credentialNumber || "",
    credentialIssuer: verification.credentialIssuer || "",
    credentialExpiresOn: verification.credentialExpiresOn || "",
    evidenceReference: verification.evidenceReference || "",
    applicantStatement: verification.applicantStatement || "",
  };
}

function isVerification(value: unknown): value is Verification {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Verification>;
  return typeof item.status === "string" && typeof item.legacyConfirmed === "boolean"
    && ["institutionName", "positionTitle", "credentialType", "credentialNumber", "credentialIssuer",
      "credentialExpiresOn", "evidenceReference", "applicantStatement", "submittedAt", "reviewedAt", "reviewNote"]
      .every((key) => item[key as keyof Verification] === null || typeof item[key as keyof Verification] === "string");
}

function formatDate(value: string | null, locale: Locale) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

export function ProfessionalVerificationCard({ actorId }: { actorId: string }) {
  const { locale, t } = useTranslation();
  const actor = useSessionActor();
  const loadSeq = useRef(0);
  const inFlight = useRef(false);
  const [loadedOwner, setLoadedOwner] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(false);
  const [error, setError] = useState<"load" | "submit" | null>(null);

  const load = useCallback(async () => {
    if (actor.phase !== "ready" || actor.actorId !== actorId) return false;
    const current = actor.trackRequest();
    const sequence = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const payload = await peerSpaceRequest<{ verification: unknown }>("/api/professional-verification", locale, "GET", undefined, actorId);
      if (!current() || sequence !== loadSeq.current) return false;
      if (payload.verification !== null && !isVerification(payload.verification)) throw new Error("invalid_verification");
      const nextVerification = payload.verification;
      setVerification(nextVerification);
      setForm(formFromVerification(nextVerification));
      setLoadedOwner(actorId);
      return true;
    } catch {
      if (current() && sequence === loadSeq.current) { setLoadedOwner(""); setVerification(null); setError("load"); }
      return false;
    } finally {
      if (current() && sequence === loadSeq.current) setLoading(false);
    }
  }, [actor.actorId, actor.phase, actor.trackRequest, actorId, locale]);

  useEffect(() => {
    ++loadSeq.current; inFlight.current = false;
    setVerification(null); setForm(emptyForm); setLoadedOwner(""); setSaving(false); setNotice(false); setError(null);
    setLoading(actor.phase === "loading" || (actor.phase === "ready" && actor.actorId === actorId));
    if (actor.phase === "ready" && actor.actorId === actorId) void load();
    return () => { ++loadSeq.current; };
    // Keep a same-account draft when only the display language changes.
  }, [actor.actorId, actor.phase, actorId]);

  const loaded = actor.phase === "ready" && actor.actorId === actorId && loadedOwner === actorId;
  const visibleVerification = loaded ? verification : null;
  const knownStatus = !visibleVerification || professionalVerificationStatuses.some((status) => status === visibleVerification.status);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function retry() {
    const current = actor.trackRequest();
    await actor.refreshIdentity();
    if (current()) await load();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || loading || !knownStatus || visibleVerification?.status === "active" || inFlight.current) return;
    const current = actor.trackRequest();
    const owner = actorId;
    ++loadSeq.current; inFlight.current = true;
    setSaving(true);
    setError(null);
    setNotice(false);
    try {
      await peerSpaceRequest("/api/professional-verification", locale, "POST", { ...form, credentialExpiresOn: form.credentialExpiresOn || null }, owner);
      if (!current()) return;
      if (await load()) setNotice(true);
    } catch {
      if (!current()) return;
      setLoadedOwner(""); setVerification(null); setError("submit");
    } finally {
      if (current()) { inFlight.current = false; setSaving(false); }
    }
  }

  const active = visibleVerification?.status === "active";
  const isLegacy = Boolean(visibleVerification?.legacyConfirmed);
  const statusLabel = visibleVerification ? knownStatus ? t(`account.professional.status.${visibleVerification.status}` as TranslationKey)
    : t("roleFollowup.professional.unknownStatus") : "";

  return (
    <section className="section section-muted pt-8 sm:pt-10" aria-labelledby="professional-verification-title">
      <div className="container max-w-4xl">
        <div className="card">
          <p className="eyebrow">{t("account.professional.label")}</p>
          <h2 id="professional-verification-title" className="mt-2 text-[1.5rem] font-bold text-ink">
            {t("account.professional.title")}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
            {t("account.professional.description")}
          </p>
          <p className="mt-3 text-sm leading-7 text-muted">{t("roleFollowup.professional.communityPurpose")}</p>
          <Link href="/support/apply" className="mt-2 inline-block text-sm font-bold text-sage-dark underline">{t("supportWorkbench.application")}</Link>

          {loading ? <p className="mt-6 rounded-2xl bg-cream px-4 py-4 text-sm font-bold text-muted">{t("account.professional.loading")}</p> : null}
          {notice ? <p className="mt-5 rounded-2xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark" aria-live="polite">{t("account.professional.noticeSubmitted")}</p> : null}
          {error ? <p className="mt-5 rounded-2xl border border-[#b8644d]/25 bg-[#f9eee9] px-4 py-3 text-sm font-bold text-[#8a4634]" role="alert">{t(error === "load" ? "account.professional.errors.loadFailed" : "account.professional.errors.submitFailed")}</p> : null}
          {actor.phase === "signed_out" || actor.phase === "error" || error || !knownStatus ? <div className="mt-4 flex flex-wrap items-center gap-3">
            {actor.phase === "error" ? <p role="alert" className="w-full text-sm">{t("roleFollowup.professional.sessionFailed")}</p> : null}
            {actor.phase !== "signed_out" ? <button type="button" disabled={loading || saving} className="button-secondary"
              onClick={() => void retry()}>{t("roleFollowup.professional.retry")}</button> : null}
            <Link href="/account" className="button-secondary">{t("roleFollowup.professional.signInVerification")}</Link>
          </div> : null}

          {!loading && visibleVerification ? (
            <div className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-bold text-ink">{statusLabel}</p>
                {visibleVerification.submittedAt ? <p className="text-xs text-muted">{t("account.professional.submittedAt", { date: formatDate(visibleVerification.submittedAt, locale) })}</p> : null}
              </div>
              {visibleVerification.reviewNote ? <p className="mt-3 text-sm leading-7 text-muted">{t("account.professional.reviewNote", { note: visibleVerification.reviewNote })}</p> : null}
              {active ? (
                <div className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
                  <p>{t("account.professional.institution", { value: visibleVerification.institutionName || (isLegacy ? t("account.professional.legacyConfirmed") : t("account.professional.noInstitution")) })}</p>
                  <p>{t("account.professional.position", { value: visibleVerification.positionTitle || (isLegacy ? t("account.professional.legacyConfirmed") : "—") })}</p>
                  <p>{t("account.professional.credential", { value: visibleVerification.credentialType || (isLegacy ? t("account.professional.legacyConfirmed") : "—") })}</p>
                  <p>{t("account.professional.expires", { value: visibleVerification.credentialExpiresOn ? formatDate(visibleVerification.credentialExpiresOn, locale) : t("account.professional.noExpiry") })}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && loaded && knownStatus && !active ? (
            <form className="mt-7" onSubmit={submit}>
              <fieldset disabled={saving} className="grid min-w-0 gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.institution")}
                  <input className="field-control" value={form.institutionName} onChange={(event) => update("institutionName", event.target.value)} maxLength={120} placeholder={t("account.professional.fields.institutionPlaceholder")} />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.position")}
                  <input className="field-control" value={form.positionTitle} onChange={(event) => update("positionTitle", event.target.value)} maxLength={80} placeholder={t("account.professional.fields.positionPlaceholder")} required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.credentialType")}
                  <input className="field-control" value={form.credentialType} onChange={(event) => update("credentialType", event.target.value)} maxLength={80} placeholder={t("account.professional.fields.credentialPlaceholder")} required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.credentialNumber")}
                  <input className="field-control" value={form.credentialNumber} onChange={(event) => update("credentialNumber", event.target.value)} maxLength={120} autoComplete="off" required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.issuer")}
                  <input className="field-control" value={form.credentialIssuer} onChange={(event) => update("credentialIssuer", event.target.value)} maxLength={120} required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  {t("account.professional.fields.expiry")}
                  <input className="field-control" type="date" value={form.credentialExpiresOn} onChange={(event) => update("credentialExpiresOn", event.target.value)} />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-bold text-ink">
                {t("account.professional.fields.evidence")}
                <textarea className="field-control min-h-28" value={form.evidenceReference} onChange={(event) => update("evidenceReference", event.target.value)} maxLength={500} placeholder={t("account.professional.fields.evidencePlaceholder")} required />
              </label>
              <label className="grid gap-2 text-sm font-bold text-ink">
                {t("account.professional.fields.additional")}
                <textarea className="field-control min-h-24" value={form.applicantStatement} onChange={(event) => update("applicantStatement", event.target.value)} maxLength={1000} />
              </label>
              <p className="text-xs leading-6 text-muted">{t("account.professional.disclaimer")}</p>
              <button className="button-primary w-full sm:w-fit" type="submit" disabled={saving}>
                {saving ? t("account.actions.submitting") : visibleVerification ? t("account.professional.resubmit") : t("account.professional.submit")}
              </button>
              </fieldset>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
