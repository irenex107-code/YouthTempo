import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { useTranslation } from "@/lib/i18n/client";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import type { PeerSpaceEvidenceSource, PeerSpaceInvitationKind } from "@/lib/peerSpaceInvitations";

type Invitation = {
  id: string;
  email: string;
  cohort_id: string;
  school_id: string | null;
  eligibility_kind: PeerSpaceInvitationKind;
  evidence_source: PeerSpaceEvidenceSource;
  evidence_reference: string;
  status: "pending" | "claimed" | "revoked";
  membership_status: string | null;
  invited_at: string;
};
type Cohort = { id: string; internal_name: string; status: string };
type School = { id: string; name: string };
type Overview = {
  invitations: Invitation[];
  cohorts: Cohort[];
  schools: School[];
  spaceStatus: string;
};

const inputClass = "w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage";

function invitationStatus(invitation: Invitation) {
  if (invitation.status === "revoked") return "已撤销";
  if (invitation.membership_status === "active") return "已激活";
  if (invitation.status === "claimed") return "已认领，待确认规则";
  return "待邮箱登录认领";
}

export default function PeerSpaceInvitationsPage() {
  const { locale } = useTranslation();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cohortName, setCohortName] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [email, setEmail] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [eligibilityKind, setEligibilityKind] = useState<PeerSpaceInvitationKind>("adult_pilot");
  const [evidenceSource, setEvidenceSource] = useState<PeerSpaceEvidenceSource>("trusted_roster");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const refresh = useCallback(async () => {
    const next = await peerSpaceRequest<Overview>("/api/admin/peer-space/invitations", locale);
    setOverview(next);
    setCohortId((current) => current && next.cohorts.some((cohort) => cohort.id === current)
      ? current : next.cohorts.find((cohort) => cohort.status === "active")?.id || "");
  }, [locale]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh().catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "邀请管理暂时不可用。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  async function createCohort(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await peerSpaceRequest("/api/admin/peer-space/invitations", locale, "POST", {
        action: "create_cohort", name: cohortName,
      });
      setCohortName("");
      setNotice("试点批次已创建。");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建批次失败。");
    } finally { setBusy(false); }
  }

  function resetInvitationForm() {
    setEditingId(null);
    setEmail("");
    setSchoolId("");
    setEligibilityKind("adult_pilot");
    setEvidenceSource("trusted_roster");
    setEvidenceReference("");
  }

  async function saveInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await peerSpaceRequest("/api/admin/peer-space/invitations", locale, editingId ? "PATCH" : "POST", {
        action: editingId ? "correct" : "invite",
        ...(editingId ? { invitationId: editingId } : { cohortId }),
        email, schoolId, eligibilityKind, evidenceSource, evidenceReference,
      });
      setNotice(editingId ? "邀请已更正。" : "邮箱邀请已登记，学生用同一邮箱登录后可认领。");
      resetInvitationForm();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存邀请失败。");
    } finally { setBusy(false); }
  }

  async function revokeInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revokingId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await peerSpaceRequest("/api/admin/peer-space/invitations", locale, "PATCH", {
        action: "revoke", invitationId: revokingId, reason: revokeReason,
      });
      setNotice("邀请与对应的解忧室成员资格已撤销。");
      setRevokingId(null); setRevokeReason("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销邀请失败。");
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHero label="平台管理" title="成年人解忧室邀请" subtitle="按登录邮箱预邀。学校可选，资格依据与聊天权限分开管理。" />
      <main className="container space-y-6 py-8">
        <Link href="/admin" className="text-sm font-bold text-sage-dark underline">返回管理台</Link>
        {loading ? <p role="status">正在加载邀请…</p> : null}
        {error ? <p role="alert" className="rounded-xl bg-[#f9eee9] px-4 py-3 text-sm text-[#8a4634]">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-mint px-4 py-3 text-sm text-sage-dark">{notice}</p> : null}
        {overview ? (
          <>
            <section className="card">
              <h2 className="text-xl font-bold text-ink">试点批次</h2>
              <p className="mt-2 text-sm leading-6 text-muted">批次只管理邀请。创建批次不会开放聊天室；当前空间状态：{overview.spaceStatus}。</p>
              <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={createCohort}>
                <label className="flex-1 text-sm font-bold text-ink">批次名称
                  <input className={`${inputClass} mt-2`} value={cohortName} onChange={(event) => setCohortName(event.target.value)} required minLength={3} maxLength={120} placeholder="例如：2026 秋季成年试点" />
                </label>
                <button className="button-secondary self-end" disabled={busy}>创建批次</button>
              </form>
            </section>

            <section className="card">
              <h2 className="text-xl font-bold text-ink">{editingId ? "更正待认领邀请" : "邀请成年人"}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">只录入学生登录邮箱和可复核的资格来源；无需预创建账号，也不会自动建立学校成员关系。</p>
              <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveInvitation}>
                {!editingId ? <label className="text-sm font-bold text-ink">试点批次
                  <select className={`${inputClass} mt-2`} value={cohortId} onChange={(event) => setCohortId(event.target.value)} required>
                    <option value="">请选择批次</option>
                    {overview.cohorts.filter((cohort) => cohort.status === "active").map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.internal_name}</option>)}
                  </select>
                </label> : null}
                <label className="text-sm font-bold text-ink">登录邮箱
                  <input className={`${inputClass} mt-2`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="off" />
                </label>
                <label className="text-sm font-bold text-ink">资格类型
                  <select className={`${inputClass} mt-2`} value={eligibilityKind} onChange={(event) => setEligibilityKind(event.target.value as PeerSpaceInvitationKind)}>
                    <option value="adult_pilot">受邀成年试点成员</option>
                    <option value="verified_university_student">已核验大学生</option>
                  </select>
                </label>
                <label className="text-sm font-bold text-ink">学校（可选）
                  <select className={`${inputClass} mt-2`} value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
                    <option value="">不归属学校</option>
                    {overview.schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-bold text-ink">核验来源
                  <select className={`${inputClass} mt-2`} value={evidenceSource} onChange={(event) => setEvidenceSource(event.target.value as PeerSpaceEvidenceSource)}>
                    <option value="trusted_roster">可信名单</option>
                    <option value="direct_review">平台人工核对</option>
                  </select>
                </label>
                <label className="text-sm font-bold text-ink sm:col-span-2">来源说明或内部引用（8–160 字）
                  <input className={`${inputClass} mt-2`} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} required minLength={8} maxLength={160} placeholder="例如：合作方 2026 秋季成年名单，批次 A；请勿填写证件号码" />
                </label>
                <div className="flex flex-wrap gap-3 sm:col-span-2">
                  <button className="button-primary" disabled={busy || (!editingId && !cohortId)}>{busy ? "正在保存…" : editingId ? "保存更正" : "登记邀请"}</button>
                  {editingId ? <button type="button" className="button-secondary" onClick={resetInvitationForm}>取消更正</button> : null}
                </div>
              </form>
            </section>

            <section className="card">
              <h2 className="text-xl font-bold text-ink">邀请记录</h2>
              <p className="mt-2 text-sm text-muted">显示最近 100 条。认领和撤销由服务端核对，工作台只显示已获资格的入口。</p>
              <div className="mt-5 space-y-3">
                {overview.invitations.length ? overview.invitations.map((invitation) => (
                  <div key={invitation.id} className="rounded-2xl border border-ink/10 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all font-bold text-ink">{invitation.email}</p>
                        <p className="mt-1 text-sm text-muted">
                          {invitationStatus(invitation)} · {invitation.eligibility_kind === "verified_university_student" ? "已核验大学生" : "受邀成年试点成员"}
                          {invitation.school_id ? ` · ${overview.schools.find((school) => school.id === invitation.school_id)?.name || "学校记录"}` : " · 无学校归属"}
                        </p>
                        <p className="mt-1 text-xs text-muted">{overview.cohorts.find((cohort) => cohort.id === invitation.cohort_id)?.internal_name || "历史批次"} · {invitation.evidence_source === "trusted_roster" ? "可信名单" : "平台核对"} · {invitation.evidence_reference}</p>
                      </div>
                      {invitation.status !== "revoked" ? <div className="flex gap-2">
                        {invitation.status === "pending" ? <button type="button" className="button-secondary text-sm" disabled={busy} onClick={() => {
                          setEditingId(invitation.id); setEmail(invitation.email); setSchoolId(invitation.school_id || "");
                          setEligibilityKind(invitation.eligibility_kind); setEvidenceSource(invitation.evidence_source);
                          setEvidenceReference(invitation.evidence_reference);
                        }}>更正</button> : null}
                        <button type="button" className="button-secondary text-sm" disabled={busy} onClick={() => {
                          setRevokingId(invitation.id); setRevokeReason("");
                        }}>撤销</button>
                      </div> : null}
                    </div>
                    {revokingId === invitation.id ? <form className="mt-4 flex flex-col gap-3 border-t border-ink/10 pt-4 sm:flex-row" onSubmit={revokeInvitation}>
                      <label className="flex-1 text-sm font-bold text-ink">撤销原因
                        <input className={`${inputClass} mt-2`} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} minLength={3} maxLength={160} required placeholder="简述撤销原因，不填写敏感资料" />
                      </label>
                      <button className="button-secondary self-end" disabled={busy}>确认撤销</button>
                      <button type="button" className="self-end text-sm text-muted underline" onClick={() => setRevokingId(null)}>取消</button>
                    </form> : null}
                  </div>
                )) : <p className="text-sm text-muted">尚无邮箱邀请。</p>}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
