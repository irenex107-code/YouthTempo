import { useEffect, useState } from "react";
import { pilotFeedbackRoleLabels, type PilotFeedbackRole } from "@/lib/pilotFeedback";

type FeedbackItem = {
  id: string;
  role: PilotFeedbackRole;
  overall_experience: number;
  clarity: number;
  safety: number;
  most_helpful: string;
  hard_to_use: string;
  suggestion: string;
  may_contact: boolean;
  contact_email: string | null;
  updated_at: string;
};

type FeedbackPayload = {
  counts: { total: number; student: number; guardian: number; teacher: number };
  averages: { overallExperience: number | null; clarity: number | null; safety: number | null };
  feedback: FeedbackItem[];
};

const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function PilotFeedbackOverview({ accessToken }: { accessToken: string }) {
  const [payload, setPayload] = useState<FeedbackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadFeedback() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/pilot-feedback", { headers: { authorization: `Bearer ${accessToken}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "试点反馈暂时无法读取。");
      setPayload(body as FeedbackPayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "试点反馈暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadFeedback(); }, [accessToken]);

  return (
    <section id="pilot-feedback" className="section section-muted scroll-mt-24">
      <div className="container">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">试点反馈</p>
            <h2 className="mt-3 text-[1.6rem] font-bold text-ink">学生、家长和老师怎么说</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">默认不显示账号和学校信息；只有对方主动同意联系时才会显示登录邮箱。自由填写的文字仍可能带有个人线索，请只用于改进试点。</p>
          </div>
          <button type="button" className="button-secondary" onClick={() => void loadFeedback()} disabled={loading}>{loading ? "正在刷新……" : "刷新反馈"}</button>
        </div>
        {error ? <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}
        {payload ? (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card"><p className="text-xs font-bold text-sage">已收到</p><p className="mt-2 text-3xl font-bold text-ink">{payload.counts.total}</p><p className="mt-2 text-xs text-muted">学生 {payload.counts.student} · 家长 {payload.counts.guardian} · 老师 {payload.counts.teacher}</p></div>
              <div className="card"><p className="text-xs font-bold text-sage">整体顺不顺</p><p className="mt-2 text-3xl font-bold text-ink">{payload.averages.overallExperience ?? "—"}<span className="text-sm text-muted"> / 5</span></p></div>
              <div className="card"><p className="text-xs font-bold text-sage">清不清楚</p><p className="mt-2 text-3xl font-bold text-ink">{payload.averages.clarity ?? "—"}<span className="text-sm text-muted"> / 5</span></p></div>
              <div className="card"><p className="text-xs font-bold text-sage">安不安心</p><p className="mt-2 text-3xl font-bold text-ink">{payload.averages.safety ?? "—"}<span className="text-sm text-muted"> / 5</span></p></div>
            </div>
            {!payload.feedback.length ? <div className="card mt-6"><p className="font-bold text-ink">还没有收到反馈</p><p className="mt-2 text-sm text-muted">三方提交后会显示在这里。</p></div> : null}
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {payload.feedback.map((item) => (
                <article key={item.id} className="card">
                  <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-bold text-ink">{pilotFeedbackRoleLabels[item.role]}反馈</p><p className="text-xs text-muted">{formatDate(item.updated_at)}</p></div>
                  <p className="mt-3 text-sm font-bold text-sage-dark">整体 {item.overall_experience} · 清晰 {item.clarity} · 安心 {item.safety}</p>
                  <div className="mt-4 grid gap-3 text-sm leading-7">
                    {item.most_helpful ? <p><strong>有帮助：</strong>{item.most_helpful}</p> : null}
                    {item.hard_to_use ? <p><strong>卡住：</strong>{item.hard_to_use}</p> : null}
                    {item.suggestion ? <p><strong>希望改：</strong>{item.suggestion}</p> : null}
                  </div>
                  {item.may_contact ? <p className="mt-4 break-all text-xs font-bold text-sage-dark">对方同意进一步了解：{item.contact_email || "登录邮箱暂不可用"}</p> : null}
                </article>
              ))}
            </div>
          </>
        ) : loading ? <div className="card mt-6 text-sm font-bold text-muted">正在读取反馈……</div> : null}
      </div>
    </section>
  );
}
