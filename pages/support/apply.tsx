import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { useSessionActor } from "@/lib/useSessionActor";
import { InlineStudentConsent } from "@/components/InlineStudentConsent";
import { useInlineStudentConsent } from "@/lib/useInlineStudentConsent";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type Category = "counselor" | "social_worker" | "listening_volunteer";
type Application = {
  category: Category | "school_duty_teacher";
  status: string;
  legal_name: string;
  credential_type: string | null;
  credential_number: string | null;
  evidence_path: string | null;
  service_languages: string[];
  age_scopes: string[];
  service_scope: string;
  availability: string;
  institution_name: string | null;
  boundaries_confirmed: boolean;
  crisis_rules_confirmed: boolean;
  privacy_rules_confirmed: boolean;
  review_note: string | null;
};
const applicationStatuses = new Set(["pending", "trial", "approved", "paused", "removed", "rejected"]);

function isApplication(value: unknown): value is Application {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Application>;
  return ["counselor", "social_worker", "listening_volunteer", "school_duty_teacher"].includes(item.category || "")
    && typeof item.status === "string" && typeof item.legal_name === "string"
    && typeof item.service_scope === "string" && typeof item.availability === "string"
    && Array.isArray(item.service_languages) && item.service_languages.every((entry) => typeof entry === "string")
    && Array.isArray(item.age_scopes) && item.age_scopes.every((entry) => typeof entry === "string")
    && typeof item.boundaries_confirmed === "boolean" && typeof item.crisis_rules_confirmed === "boolean"
    && typeof item.privacy_rules_confirmed === "boolean";
}

export default function SupportStaffApplyPage() {
  const { locale, t } = useTranslation();
  const actor = useSessionActor();
  const consent = useInlineStudentConsent();
  const loadSeq = useRef(0);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [loadedOwner, setLoadedOwner] = useState("");
  const [application, setApplication] = useState<Application | null>(null);
  const [category, setCategory] = useState<Category>("counselor");
  const [legalName, setLegalName] = useState("");
  const [credentialType, setCredentialType] = useState("");
  const [credentialNumber, setCredentialNumber] = useState("");
  const [serviceScope, setServiceScope] = useState("");
  const [availability, setAvailability] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [serviceLanguages, setServiceLanguages] = useState<string[]>(["zh-CN"]);
  const [ageScopes, setAgeScopes] = useState<string[]>(["18_plus"]);
  const [boundariesConfirmed, setBoundariesConfirmed] = useState(false);
  const [crisisRulesConfirmed, setCrisisRulesConfirmed] = useState(false);
  const [privacyRulesConfirmed, setPrivacyRulesConfirmed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"" | "load" | "submit" | "evidence">("");
  const [notice, setNotice] = useState<"" | "saved" | "uploaded">("");

  const visibleApplication = actor.phase === "ready" && loadedOwner === actor.actorId ? application : null;
  const loaded = actor.phase === "ready" && loadedOwner === actor.actorId;
  const canApply = loaded && !loading && consent.userId === actor.actorId && (consent.phase === "other"
    || (consent.studentReady && consent.summary?.consent?.ageBand === "18_plus"));

  function clearForm() {
    setApplication(null); setCategory("counselor"); setLegalName(""); setCredentialType(""); setCredentialNumber("");
    setServiceScope(""); setAvailability(""); setInstitutionName(""); setServiceLanguages(["zh-CN"]); setAgeScopes(["18_plus"]);
    setBoundariesConfirmed(false); setCrisisRulesConfirmed(false); setPrivacyRulesConfirmed(false); setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  const refresh = useCallback(async () => {
    if (actor.phase !== "ready") return false;
    const current = actor.trackRequest();
    const sequence = ++loadSeq.current;
    setLoading(true); setError("");
    try {
    const result = await peerSpaceRequest<{ application: unknown }>("/api/support/staff", locale, "GET", undefined, actor.actorId);
    if (!current() || sequence !== loadSeq.current) return false;
    if (result.application !== null && !isApplication(result.application)) throw new Error("invalid_application");
    setApplication(result.application);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    if (result.application) {
      const item = result.application;
      if (item.category !== "school_duty_teacher") setCategory(item.category);
      setLegalName(item.legal_name);
      setCredentialType(item.credential_type || "");
      setCredentialNumber(item.credential_number || "");
      setServiceScope(item.service_scope);
      setAvailability(item.availability);
      setInstitutionName(item.institution_name || "");
      setServiceLanguages(item.service_languages);
      setAgeScopes(item.age_scopes);
      setBoundariesConfirmed(item.boundaries_confirmed);
      setCrisisRulesConfirmed(item.crisis_rules_confirmed);
      setPrivacyRulesConfirmed(item.privacy_rules_confirmed);
    }
    setLoadedOwner(actor.actorId);
    return true;
    } catch {
      if (current() && sequence === loadSeq.current) {
        setLoadedOwner(""); setApplication(null); setError("load");
      }
      return false;
    } finally { if (current() && sequence === loadSeq.current) setLoading(false); }
  }, [locale, actor.actorId, actor.phase, actor.trackRequest]);
  useEffect(() => {
    ++loadSeq.current; inFlight.current = false; setBusy(false); setLoadedOwner(""); setNotice(""); setError(""); clearForm();
    setLoading(actor.phase === "loading" || actor.phase === "ready");
    if (actor.phase === "ready") void refresh();
    return () => { ++loadSeq.current; };
    // User-generated application fields should not be overwritten on a locale switch.
  }, [actor.actorId, actor.phase]);
  useEffect(() => {
    if (consent.studentReady && consent.userId === actor.actorId && !inFlight.current) void refresh();
  }, [consent.studentReady, consent.userId]);

  function toggle(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function retry() {
    const current = actor.trackRequest();
    await Promise.all([actor.refreshIdentity(), consent.refresh()]);
    if (current()) await refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canApply || inFlight.current) return;
    const current = actor.trackRequest();
    const owner = actor.actorId;
    ++loadSeq.current; inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await peerSpaceRequest("/api/support/staff", locale, "POST", visibleApplication?.category === "school_duty_teacher"
        ? { action: "confirm_invitation", boundariesConfirmed, crisisRulesConfirmed, privacyRulesConfirmed }
        : {
          category, legalName, credentialType, credentialNumber, serviceScope,
          availability, institutionName, serviceLanguages, ageScopes,
          boundariesConfirmed, crisisRulesConfirmed, privacyRulesConfirmed,
        }, owner);
      if (!current()) return;
      if (await refresh()) setNotice("saved");
    } catch {
      if (!current()) return;
      setError("submit");
      setLoadedOwner("");
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }

  async function uploadEvidence() {
    if (!file || !canApply || inFlight.current) return;
    const selectedFile = file;
    if (selectedFile.size > 5 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(selectedFile.type)) {
      setError("evidence"); setNotice(""); setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    const current = actor.trackRequest();
    const owner = actor.actorId;
    ++loadSeq.current; inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await actor.getToken(owner);
      if (!current()) return;
      const response = await fetch(`/api/support/staff-evidence?locale=${encodeURIComponent(locale)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": selectedFile.type },
        body: selectedFile,
      });
      const payload = await response.json();
      if (!current()) return;
      if (!response.ok) throw new Error(payload.error || t("supportFlow.errors.evidence"));
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      if (await refresh()) setNotice("uploaded");
    } catch {
      if (!current()) return;
      setError("evidence"); setLoadedOwner(""); setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }

  const editable = canApply && (!visibleApplication || visibleApplication.status === "pending"
    || (visibleApplication.status === "rejected" && visibleApplication.category !== "school_duty_teacher"));
  return (
    <>
      <PageHero label={t("supportStaff.label")} title={t("supportStaff.title")}
        subtitle={t("supportStaff.description")}
        action={<Link href="/support/workbench" className="button-secondary">{t("supportStaff.workbench")}</Link>} />
      <section className="section section-muted">
        <div className="container max-w-3xl space-y-5">
          <div className="card text-sm leading-7 text-muted">
            <p>{t("roleFollowup.professional.servicePurpose")}</p>
            {consent.phase === "other" && visibleApplication?.category !== "school_duty_teacher" ? <Link href="/account" className="mt-2 inline-block font-bold text-sage-dark underline">{t("common.navbar.actions.myAccount")}</Link> : null}
          </div>
          {loading ? <p role="status">{t("peerSpace.loading")}</p> : null}
          {error ? <p role="alert" className="rounded-xl bg-white p-4 text-sm">{t(error === "load" ? "roleFollowup.professional.loadFailed"
            : error === "evidence" ? "supportFlow.errors.evidence" : "supportFlow.errors.unavailable")}</p> : null}
          {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm">{t(notice === "saved" ? "supportStaff.saved" : "supportStaff.uploaded")}</p> : null}
          {actor.phase === "signed_out" || actor.phase === "error" || consent.phase === "signed_out" || error ? <div className="card flex flex-wrap items-center gap-3">
            {actor.phase === "error" ? <p role="alert" className="w-full text-sm">{t("roleFollowup.professional.sessionFailed")}</p> : null}
            {actor.phase !== "signed_out" ? <button type="button" className="button-secondary" disabled={loading || busy}
              onClick={() => void retry()}>{t("roleFollowup.professional.retry")}</button> : null}
            <Link href={{ pathname: "/account", query: { next: "/support/apply" } }} className="button-secondary">{t("roleFollowup.professional.signInApplication")}</Link>
          </div> : null}
          {actor.phase === "ready" && consent.userId === actor.actorId && consent.phase !== "other" && consent.phase !== "signed_out" ? <>
            {consent.summary?.role === "student" ? <p className="card text-sm leading-7">{t("roleFollowup.professional.studentEligibility")}</p> : null}
            <InlineStudentConsent controller={consent} />
          </> : null}
          {visibleApplication ? <div className="card">
            <h2 className="font-bold">{t("supportStaff.statusTitle")}: {applicationStatuses.has(visibleApplication.status)
              ? t(`supportStaff.status.${visibleApplication.status}` as TranslationKey) : t("roleFollowup.professional.unknownStatus")}</h2>
            {visibleApplication.review_note ? <p className="mt-2 text-sm text-muted">{visibleApplication.review_note}</p> : null}
            <p className="mt-2 text-sm">{visibleApplication.category === "school_duty_teacher" ? t("roleFollowup.professional.schoolInvitationEvidence")
              : visibleApplication.evidence_path ? t("supportStaff.evidenceUploaded") : t("supportStaff.evidenceMissing")}</p>
            {!applicationStatuses.has(visibleApplication.status) ? <button type="button" className="button-secondary mt-3" disabled={loading || busy}
              onClick={() => void retry()}>{t("roleFollowup.professional.retry")}</button> : null}
          </div> : null}
          {editable && !loading ? (
            <form onSubmit={submit} className="card">
              <fieldset disabled={busy} className="grid min-w-0 gap-4">
              <h2 className="text-xl font-bold">{visibleApplication?.category === "school_duty_teacher" ? t("supportStaff.schoolInvite") : t("supportStaff.formTitle")}</h2>
              {visibleApplication?.category !== "school_duty_teacher" ? (
                <>
                  <label className="text-sm font-bold">{t("supportStaff.category")}
                    <select className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3" value={category} onChange={(event) => setCategory(event.target.value as Category)}>
                      {(["counselor", "social_worker", "listening_volunteer"] as const).map((value) =>
                        <option key={value} value={value}>{t(`supportStaff.categories.${value}`)}</option>)}
                    </select>
                  </label>
                  {([
                    ["legalName", legalName, setLegalName, 120, true],
                    ["credentialType", credentialType, setCredentialType, 120, category !== "listening_volunteer"],
                    ["credentialNumber", credentialNumber, setCredentialNumber, 120, category === "counselor"],
                    ["serviceScope", serviceScope, setServiceScope, 500, true],
                    ["availability", availability, setAvailability, 500, true],
                    ["institutionName", institutionName, setInstitutionName, 160, false],
                  ] as const).map(([key, value, setter, limit, required]) => (
                    <label key={key} className="text-sm font-bold">{t(`supportStaff.fields.${key}`)}
                      <input required={required} maxLength={limit} className="mt-2 block w-full rounded-xl border border-sage/30 bg-white p-3 font-normal"
                        value={value} onChange={(event) => setter(event.target.value)} />
                    </label>
                  ))}
                  <fieldset><legend className="text-sm font-bold">{t("supportStaff.languages")}</legend>
                    <div className="mt-2 flex gap-4">
                      {["zh-CN", "en"].map((value) => <label key={value} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={serviceLanguages.includes(value)} onChange={() => toggle(serviceLanguages, value, setServiceLanguages)} />{t(value === "en" ? "common.languageSwitcher.english" : "common.languageSwitcher.chinese")}
                      </label>)}
                    </div>
                  </fieldset>
                  <fieldset><legend className="text-sm font-bold">{t("supportStaff.ageScopes")}</legend>
                    <div className="mt-2 flex gap-4">
                      {["14_17", "18_plus"].map((value) => <label key={value} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={ageScopes.includes(value)} onChange={() => toggle(ageScopes, value, setAgeScopes)} />{value === "14_17" ? "14–17" : "18+"}
                      </label>)}
                    </div>
                  </fieldset>
                </>
              ) : null}
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={boundariesConfirmed} onChange={(event) => setBoundariesConfirmed(event.target.checked)} />{t("supportStaff.confirm.boundaries")}</label>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={crisisRulesConfirmed} onChange={(event) => setCrisisRulesConfirmed(event.target.checked)} />{t("supportStaff.confirm.crisis")}</label>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={privacyRulesConfirmed} onChange={(event) => setPrivacyRulesConfirmed(event.target.checked)} />{t("supportStaff.confirm.privacy")}</label>
              <button type="submit" className="button-primary w-fit" disabled={busy}>{t("supportStaff.submit")}</button>
              </fieldset>
            </form>
          ) : null}
          {visibleApplication && editable && visibleApplication.category !== "school_duty_teacher" ? (
            <section className="card">
              <h2 className="font-bold">{t("supportStaff.evidenceTitle")}</h2>
              <p className="mt-2 text-sm text-muted">{t("supportStaff.evidenceHelp")}</p>
              <label className="mt-4 block text-sm font-bold">{t("supportStaff.file")}
                <input key={actor.actorId} ref={fileInput} type="file" disabled={busy} accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="mt-2 block w-full" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </label>
              <button type="button" className="button-secondary mt-4" disabled={busy || !file} onClick={uploadEvidence}>{t("supportStaff.upload")}</button>
            </section>
          ) : null}
        </div>
      </section>
    </>
  );
}
