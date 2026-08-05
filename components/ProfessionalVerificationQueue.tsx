import { useEffect, useMemo, useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import {
  professionalVerificationStatusLabels,
  type ProfessionalVerificationReviewAction,
  type ProfessionalVerificationStatus,
} from "@/lib/professionalVerification";

type Verification = {
  user_id: string;
  status: ProfessionalVerificationStatus;
  institution_name: string | null;
  position_title: string | null;
  credential_type: string | null;
  credential_number: string | null;
  credential_issuer: string | null;
  credential_expires_on: string | null;
  evidence_reference: string | null;
  applicant_statement: string | null;
  verification_basis: "document_review" | "legacy_platform_confirmation";
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  profile: { email: string | null; display_name: string | null } | null;
  events: Array<{
    id: string;
    action: string;
    new_status: ProfessionalVerificationStatus;
    note: string | null;
    created_at: string;
  }>;
};

function formatDate(value: string | null) {
  if (!value) return "未提交";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function ProfessionalVerificationQueue({ accessToken }: { accessToken: string }) {
  const [items, setItems] = useState<Verification[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/professional-verifications", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "专业身份申请暂时没有加载出来。");
      setItems(payload.verifications || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "专业身份申请暂时没有加载出来。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [accessToken]);

  const orderedItems = useMemo(() => [...items].sort((left, right) => {
    const priority: Record<ProfessionalVerificationStatus, number> = { pending: 0, needs_more_info: 1, active: 2, rejected: 3, revoked: 4 };
    return priority[left.status] - priority[right.status];
  }), [items]);

  async function review(userId: string, action: ProfessionalVerificationReviewAction) {
    const note = notes[userId]?.trim() || "";
    if (action !== "approve" && note.length < 5) {
      setError("需要补充、拒绝或撤销时，请先写至少 5 个字的处理说明。");
      return;
    }
    setSavingId(userId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/professional-verifications", {
        method: "PATCH",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ userId, action, note }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "这次处理没有保存成功。");
      const label = action === "approve" ? "已通过" : action === "request_changes" ? "已请对方补充资料" : action === "reject" ? "已记录暂未通过" : "已撤销专业身份确认";
      setNotice(label);
      setNotes((current) => ({ ...current, [userId]: "" }));
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "这次处理没有保存成功。");
    } finally {
      setSavingId("");
    }
  }

  const pendingCount = items.filter((item) => item.status === "pending").length;

  return (
    <section id="professional-verifications" className="section section-muted scroll-mt-24">
      <div className="container">
        <SectionHeader
          title="专业支持者身份确认"
          description="逐项核对机构和资质。只有明确通过的账号，才会在社区显示专业身份标记。"
        />
        <div className="mb-5 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-white px-3 py-2 text-sage-dark">待确认 {pendingCount}</span>
          <span className="rounded-full bg-white px-3 py-2 text-muted">全部记录 {items.length}</span>
        </div>
        {notice ? <p className="mb-5 rounded-2xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark" aria-live="polite">{notice}</p> : null}
        {error ? <p className="mb-5 rounded-2xl border border-[#b8644d]/25 bg-[#f9eee9] px-4 py-3 text-sm font-bold text-[#8a4634]" role="alert">{error}</p> : null}
        {loading ? <p className="card text-sm font-bold text-muted">正在加载申请…</p> : null}
        {!loading && orderedItems.length === 0 ? <p className="card text-sm text-muted">暂时没有专业身份申请。</p> : null}
        <div className="grid gap-5">
          {orderedItems.map((item) => {
            const canApprove = item.verification_basis === "document_review" && Boolean(item.institution_name && item.position_title && item.credential_type && item.credential_number && item.credential_issuer && item.evidence_reference);
            return (
              <article key={item.user_id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow">{professionalVerificationStatusLabels[item.status]}</p>
                    <h3 className="mt-2 text-xl font-bold text-ink">{item.profile?.display_name || item.profile?.email || "未命名账号"}</h3>
                    {item.profile?.display_name && item.profile.email ? <p className="mt-1 break-all text-xs text-muted">{item.profile.email}</p> : null}
                  </div>
                  <p className="text-xs text-muted">{formatDate(item.submitted_at)}</p>
                </div>
                {item.verification_basis === "legacy_platform_confirmation" ? (
                  <p className="mt-5 rounded-2xl bg-cream px-4 py-3 text-sm leading-6 text-muted">这是迁移前已由平台确认的记录。若需重新核验，可撤销后请对方补交资料。</p>
                ) : (
                  <div className="mt-5 grid gap-3 rounded-2xl bg-white/80 p-4 text-sm leading-6 sm:grid-cols-2">
                    <p><span className="font-bold text-ink">机构：</span>{item.institution_name || "未填写"}</p>
                    <p><span className="font-bold text-ink">职务/方向：</span>{item.position_title || "未填写"}</p>
                    <p><span className="font-bold text-ink">资质：</span>{item.credential_type || "未填写"}</p>
                    <p><span className="font-bold text-ink">编号：</span>{item.credential_number || "未填写"}</p>
                    <p><span className="font-bold text-ink">发证机构：</span>{item.credential_issuer || "未填写"}</p>
                    <p><span className="font-bold text-ink">到期：</span>{item.credential_expires_on || "未注明"}</p>
                    <p className="sm:col-span-2"><span className="font-bold text-ink">核验材料说明：</span>{item.evidence_reference || "未填写"}</p>
                    {item.applicant_statement ? <p className="sm:col-span-2"><span className="font-bold text-ink">补充说明：</span>{item.applicant_statement}</p> : null}
                  </div>
                )}
                {item.review_note ? <p className="mt-4 text-sm leading-6 text-muted">上次处理说明：{item.review_note}</p> : null}
                <label className="mt-5 grid gap-2 text-sm font-bold text-ink">
                  处理说明
                  <textarea className="field-control min-h-24" value={notes[item.user_id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.user_id]: event.target.value }))} maxLength={1000} placeholder="通过时可简要记录核验方式；需要补充、拒绝或撤销时必须说明原因。" />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  {item.status !== "active" && item.verification_basis !== "legacy_platform_confirmation" ? <button type="button" className="button-primary" disabled={savingId === item.user_id || !canApprove} onClick={() => review(item.user_id, "approve")}>确认通过</button> : null}
                  {item.status !== "active" && item.verification_basis !== "legacy_platform_confirmation" ? <button type="button" className="button-secondary" disabled={savingId === item.user_id} onClick={() => review(item.user_id, "request_changes")}>请补充资料</button> : null}
                  {item.status !== "active" && item.verification_basis !== "legacy_platform_confirmation" ? <button type="button" className="button-secondary" disabled={savingId === item.user_id} onClick={() => review(item.user_id, "reject")}>暂不通过</button> : null}
                  {item.status === "active" ? <button type="button" className="button-secondary" disabled={savingId === item.user_id} onClick={() => review(item.user_id, "revoke")}>撤销确认</button> : null}
                </div>
                {item.events.length > 0 ? (
                  <details className="mt-5 border-t border-ink/10 pt-4">
                    <summary className="cursor-pointer text-sm font-bold text-sage-dark">查看处理记录（{item.events.length}）</summary>
                    <div className="mt-3 grid gap-2 text-xs leading-5 text-muted">
                      {item.events.map((event) => <p key={event.id}>{formatDate(event.created_at)} · {professionalVerificationStatusLabels[event.new_status]}{event.note ? ` · ${event.note}` : ""}</p>)}
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
