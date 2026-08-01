import { useEffect, useState } from "react";

type ModerationItem = {
  id: string;
  content_type: "post" | "comment";
  title: string;
  body: string;
  author_name: string;
  author_role_label: string;
  moderation_status: "published" | "safety_review" | "removed";
  moderation_reason: string | null;
  created_at: string;
  reports: Array<{ id: string; reason: string; status: string; created_at: string }>;
};

type ModerationPayload = {
  counts: { total: number; safetyReview: number; reports: number };
  items: ModerationItem[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CommunityModerationQueue({ accessToken }: { accessToken: string }) {
  const [payload, setPayload] = useState<ModerationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadQueue() {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/community-moderation", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "社区审核队列加载失败。");
      setPayload(body as ModerationPayload);
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "社区审核队列加载失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQueue();
    // accessToken changes only when the signed-in account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  return (
    <section id="community-moderation" className="section scroll-mt-24">
      <div className="container">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">社区安全</p>
            <h2 className="mt-3 text-[1.6rem] font-bold text-ink">需要平台查看的内容</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
              汇总用户举报和系统识别为需要安全确认的帖子与回复。
            </p>
          </div>
          <button type="button" className="button-secondary" onClick={() => void loadQueue()} disabled={loading}>
            {loading ? "正在刷新…" : "刷新列表"}
          </button>
        </div>

        {payload ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="card py-5"><p className="text-xs font-bold text-sage">待查看内容</p><p className="mt-2 text-3xl font-bold text-ink">{payload.counts.total}</p></div>
            <div className="card py-5"><p className="text-xs font-bold text-sage">安全待确认</p><p className="mt-2 text-3xl font-bold text-ink">{payload.counts.safetyReview}</p></div>
            <div className="card py-5"><p className="text-xs font-bold text-sage">未结举报</p><p className="mt-2 text-3xl font-bold text-ink">{payload.counts.reports}</p></div>
          </div>
        ) : null}

        {error ? <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}
        {loading && !payload ? <div className="card mt-6 text-sm font-bold text-muted">正在读取社区审核队列……</div> : null}
        {!loading && payload?.items.length === 0 ? (
          <div className="card mt-6"><p className="text-lg font-bold text-ink">当前没有待查看内容</p><p className="mt-2 text-sm leading-6 text-muted">新的举报或安全待确认内容会显示在这里。</p></div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {payload?.items.map((item) => (
            <article key={item.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-sage-dark">{item.content_type === "post" ? "帖子" : "回复"} · {item.author_role_label}</p>
                  <h3 className="mt-2 text-lg font-bold text-ink">{item.title}</h3>
                  <p className="mt-1 text-xs text-muted">{item.author_name} · {formatDate(item.created_at)}</p>
                </div>
                <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${item.moderation_status === "safety_review" ? "bg-amber-100 text-amber-800" : item.moderation_status === "removed" ? "bg-ink/10 text-muted" : "bg-mint text-sage-dark"}`}>
                  {item.moderation_status === "safety_review" ? "安全待确认" : item.moderation_status === "removed" ? "已移除" : "已发布"}
                </span>
              </div>
              <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-cream px-4 py-4 text-sm leading-7 text-ink">{item.body}</p>
              {item.moderation_reason ? <p className="mt-3 text-sm font-bold text-amber-800">系统提示：{item.moderation_reason}</p> : null}
              {item.reports.length ? (
                <div className="mt-4 rounded-2xl border border-ink/10 px-4 py-4">
                  <p className="text-xs font-bold text-sage-dark">用户举报（{item.reports.length}）</p>
                  <ul className="mt-2 grid gap-2 text-sm leading-6 text-muted">
                    {item.reports.map((report) => <li key={report.id}>“{report.reason}” · {formatDate(report.created_at)}</li>)}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
