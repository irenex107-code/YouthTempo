import { FormEvent, useEffect, useState } from "react";
import {
  professionalVerificationStatusLabels,
  type ProfessionalVerificationStatus,
} from "@/lib/professionalVerification";
import { getSupabase } from "@/lib/supabaseClient";

type Verification = {
  status: ProfessionalVerificationStatus;
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

async function accessToken() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("账号服务暂时不可用，请稍后再试。");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("请先登录，再提交专业身份资料。");
  return data.session.access_token;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

export function ProfessionalVerificationCard() {
  const [verification, setVerification] = useState<Verification | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/professional-verification", {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "专业身份资料暂时没有加载出来。");
      const nextVerification = payload.verification as Verification | null;
      setVerification(nextVerification);
      setForm(formFromVerification(nextVerification));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "专业身份资料暂时没有加载出来。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/professional-verification", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...form, credentialExpiresOn: form.credentialExpiresOn || null }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "资料暂时无法提交。");
      setNotice("资料已经交给平台确认。审核期间，你仍可以正常使用其他功能。");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "资料暂时无法提交。");
    } finally {
      setSaving(false);
    }
  }

  const active = verification?.status === "active";
  const isLegacy = Boolean(verification?.legacyConfirmed);

  return (
    <section className="section section-muted pt-8 sm:pt-10" aria-labelledby="professional-verification-title">
      <div className="container max-w-4xl">
        <div className="card">
          <p className="eyebrow">专业支持者</p>
          <h2 id="professional-verification-title" className="mt-2 text-[1.5rem] font-bold text-ink">
            让大家知道你的专业身份已经过确认
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
            提交所在机构和可核验的资质信息。只有平台管理员能查看这些资料；通过后，社区会显示“专业身份已确认”。
          </p>

          {loading ? <p className="mt-6 rounded-2xl bg-cream px-4 py-4 text-sm font-bold text-muted">正在加载确认状态…</p> : null}
          {notice ? <p className="mt-5 rounded-2xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark" aria-live="polite">{notice}</p> : null}
          {error ? <p className="mt-5 rounded-2xl border border-[#b8644d]/25 bg-[#f9eee9] px-4 py-3 text-sm font-bold text-[#8a4634]" role="alert">{error}</p> : null}

          {!loading && verification ? (
            <div className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-bold text-ink">{professionalVerificationStatusLabels[verification.status]}</p>
                {verification.submittedAt ? <p className="text-xs text-muted">提交于 {formatDate(verification.submittedAt)}</p> : null}
              </div>
              {verification.reviewNote ? <p className="mt-3 text-sm leading-7 text-muted">平台说明：{verification.reviewNote}</p> : null}
              {active ? (
                <div className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
                  <p>机构：{verification.institutionName || (isLegacy ? "此前已由平台确认" : "—")}</p>
                  <p>专业方向：{verification.positionTitle || (isLegacy ? "此前已由平台确认" : "—")}</p>
                  <p>资质：{verification.credentialType || (isLegacy ? "此前已由平台确认" : "—")}</p>
                  <p>有效期：{verification.credentialExpiresOn ? formatDate(verification.credentialExpiresOn) : "未注明到期日"}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && !active ? (
            <form className="mt-7 grid gap-4" onSubmit={submit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-bold text-ink">
                  所在机构
                  <input className="field-control" value={form.institutionName} onChange={(event) => update("institutionName", event.target.value)} maxLength={120} placeholder="例如：某某心理服务中心" required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  职务或专业方向
                  <input className="field-control" value={form.positionTitle} onChange={(event) => update("positionTitle", event.target.value)} maxLength={80} placeholder="例如：心理咨询师" required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  资质类型
                  <input className="field-control" value={form.credentialType} onChange={(event) => update("credentialType", event.target.value)} maxLength={80} placeholder="例如：职业资格或执业登记" required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  资质编号
                  <input className="field-control" value={form.credentialNumber} onChange={(event) => update("credentialNumber", event.target.value)} maxLength={120} autoComplete="off" required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  发证或登记机构
                  <input className="field-control" value={form.credentialIssuer} onChange={(event) => update("credentialIssuer", event.target.value)} maxLength={120} required />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  到期日期（没有可留空）
                  <input className="field-control" type="date" value={form.credentialExpiresOn} onChange={(event) => update("credentialExpiresOn", event.target.value)} />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-bold text-ink">
                核验材料说明
                <textarea className="field-control min-h-28" value={form.evidenceReference} onChange={(event) => update("evidenceReference", event.target.value)} maxLength={500} placeholder="填写平台约定的材料编号、机构公开人员页或可联系核验的方式。不要填写与审核无关的个人信息。" required />
              </label>
              <label className="grid gap-2 text-sm font-bold text-ink">
                还有什么想补充的（可不填）
                <textarea className="field-control min-h-24" value={form.applicantStatement} onChange={(event) => update("applicantStatement", event.target.value)} maxLength={1000} />
              </label>
              <p className="text-xs leading-6 text-muted">提交不代表自动通过。平台会核对机构和资质；资料不完整时，会说明需要补充什么。</p>
              <button className="button-primary w-full sm:w-fit" type="submit" disabled={saving}>
                {saving ? "正在提交…" : verification ? "更新并重新提交" : "提交确认资料"}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
