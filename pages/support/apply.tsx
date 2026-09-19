import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { getSupabase } from "@/lib/supabaseClient";

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

export default function SupportStaffApplyPage() {
  const { locale, t } = useTranslation();
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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const result = await peerSpaceRequest<{ application: Application | null }>("/api/support/staff", locale);
    setApplication(result.application);
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
  }, [locale]);
  useEffect(() => {
    let active = true;
    refresh().catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, t]);

  function toggle(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await peerSpaceRequest("/api/support/staff", locale, "POST", application?.category === "school_duty_teacher"
        ? { action: "confirm_invitation", boundariesConfirmed, crisisRulesConfirmed, privacyRulesConfirmed }
        : {
          category, legalName, credentialType, credentialNumber, serviceScope,
          availability, institutionName, serviceLanguages, ageScopes,
          boundariesConfirmed, crisisRulesConfirmed, privacyRulesConfirmed,
        });
      await refresh();
      setNotice(t("supportStaff.saved"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable"));
    } finally { setBusy(false); }
  }

  async function uploadEvidence() {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size > 5 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
        throw new Error(t("supportFlow.errors.evidence"));
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error(t("supportFlow.errors.unavailable"));
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token) throw new Error(t("supportFlow.errors.signIn"));
      const response = await fetch("/api/support/staff-evidence", {
        method: "POST",
        headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": file.type },
        body: file,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || t("supportFlow.errors.evidence"));
      setFile(null);
      await refresh();
      setNotice(t("supportStaff.uploaded"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("supportFlow.errors.unavailable"));
    } finally { setBusy(false); }
  }

  const editable = !application || ["pending", "rejected"].includes(application.status);
  return (
    <>
      <PageHero label={t("supportStaff.label")} title={t("supportStaff.title")}
        subtitle={t("supportStaff.description")}
        action={<Link href="/support/workbench" className="button-secondary">{t("supportStaff.workbench")}</Link>} />
      <main className="section section-muted">
        <div className="container max-w-3xl space-y-5">
          {loading ? <p role="status">{t("peerSpace.loading")}</p> : null}
          {error ? <p role="alert" className="rounded-xl bg-white p-4 text-sm">{error}</p> : null}
          {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm">{notice}</p> : null}
          {application ? <div className="card">
            <h2 className="font-bold">{t("supportStaff.statusTitle")}: {t(`supportStaff.status.${application.status as "pending" | "trial" | "approved" | "paused" | "removed" | "rejected"}`)}</h2>
            {application.review_note ? <p className="mt-2 text-sm text-muted">{application.review_note}</p> : null}
            <p className="mt-2 text-sm">{application.evidence_path ? t("supportStaff.evidenceUploaded") : t("supportStaff.evidenceMissing")}</p>
          </div> : null}
          {editable && !loading ? (
            <form onSubmit={submit} className="card grid gap-4">
              <h2 className="text-xl font-bold">{application?.category === "school_duty_teacher" ? t("supportStaff.schoolInvite") : t("supportStaff.formTitle")}</h2>
              {application?.category !== "school_duty_teacher" ? (
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
                        <input type="checkbox" checked={serviceLanguages.includes(value)} onChange={() => toggle(serviceLanguages, value, setServiceLanguages)} />{value}
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
            </form>
          ) : null}
          {application && editable && application.category !== "school_duty_teacher" ? (
            <section className="card">
              <h2 className="font-bold">{t("supportStaff.evidenceTitle")}</h2>
              <p className="mt-2 text-sm text-muted">{t("supportStaff.evidenceHelp")}</p>
              <label className="mt-4 block text-sm font-bold">{t("supportStaff.file")}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="mt-2 block w-full" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </label>
              <button type="button" className="button-secondary mt-4" disabled={busy || !file} onClick={uploadEvidence}>{t("supportStaff.upload")}</button>
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}
