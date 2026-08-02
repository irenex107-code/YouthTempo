import { useEffect, useState } from "react";

type ModerationItem = {
  id: string;
  content_id: string;
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

type ModerationHistoryItem = {
  id: string;
  content_type: "post" | "comment";
  content_id: string;
  action: "publish" | "remove";
  previous_status: "published" | "safety_review" | "removed";
  new_status: "published" | "removed";
  current_status: "published" | "safety_review" | "removed";
  title: string;
  body: string;
  note: string;
  actor_name: string;
  is_latest_for_target: boolean;
  created_at: string;
};

type ModerationPayload = {
  counts: { total: number; safetyReview: number; reports: number };
  items: ModerationItem[];
  history: ModerationHistoryItem[];
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
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");

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

  async function moderate(
    contentType: "post" | "comment",
    contentId: string,
    action: "publish" | "remove",
    note: string,
    savingKey: string,
  ) {
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setError("请先填写简短的处理说明。");
      return;
    }
    setSavingId(savingKey);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/community-moderation", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ contentType, contentId, action, note: trimmedNote }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "社区内容处理失败。");
      setNotice(body.notice || "处理结果已保存。");
      setNotes((current) => ({ ...current, [savingKey]: "" }));
      await loadQueue();
    } catch (moderationError) {
      setError(moderationError instanceof Error ? moderationError.message : "社区内容处理失败。");
    } finally {
      setSavingId("");
    }
  }

  async function restoreFromHistory(item: ModerationHistoryItem) {
    const note = window.prompt("请说明恢复显示的原因（会写入审核记录）：", "复核后确认可以恢复显示");
    if (note === null) return;
    await moderate(item.content_type, item.content_id, "publish", note, `history:${item.id}`);
  }

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

        {notice ? <p className="mt-6 rounded-2xl border border-sage/30 bg-mint px-4 py-3 text-sm font-bold text-sage-dark" role="status">{notice}</p> : null}
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
              <div className="mt-5 grid gap-3 rounded-2xl border border-sage/25 bg-mint/35 p-4">
                <label className="grid gap-2 text-sm font-bold text-ink">
                  处理说明
                  <textarea
                    className="min-h-24 resize-y rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm font-normal leading-6 outline-none focus:border-sage"
                    value={notes[item.id] || ""}
                    maxLength={500}
                    onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="例如：结合上下文复核后可正常发布；或说明移除所依据的社区规则。"
                  />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="button-primary disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={Boolean(savingId) || !(notes[item.id] || "").trim()}
                    onClick={() => void moderate(item.content_type, item.content_id, "publish", notes[item.id] || "", item.id)}
                  >
                    {savingId === item.id ? "保存中…" : item.moderation_status === "published" ? "保留显示" : "通过并发布"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary border-red-200 text-red-700 hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={Boolean(savingId) || !(notes[item.id] || "").trim()}
                    onClick={() => void moderate(item.content_type, item.content_id, "remove", notes[item.id] || "", item.id)}
                  >
                    {savingId === item.id ? "保存中…" : "移除内容"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {payload?.history.length ? (
          <div className="mt-12">
            <p className="eyebrow">处理记录</p>
            <h3 className="mt-3 text-[1.35rem] font-bold text-ink">最近审核历史</h3>
            <p className="mt-2 text-sm leading-7 text-muted">保留处理人、处理说明和内容状态；误移除的内容可以从这里恢复。</p>
            <div className="mt-5 grid gap-3">
              {payload.history.map((item) => (
                <article key={item.id} className="rounded-2xl border border-ink/10 bg-white px-5 py-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-sage-dark">{item.content_type === "post" ? "帖子" : "回复"} · {item.action === "remove" ? "已移除" : "已恢复/保留"}</p>
                      <h4 className="mt-1 truncate font-bold text-ink">{item.title}</h4>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{item.body}</p>
                      <p className="mt-3 text-sm font-bold text-ink">处理说明：{item.note}</p>
                      <p className="mt-1 text-xs text-muted">{item.actor_name} · {formatDate(item.created_at)}</p>
                    </div>
                    {item.current_status === "removed" && item.is_latest_for_target ? (
                      <button
                        type="button"
                        className="button-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={Boolean(savingId)}
                        onClick={() => void restoreFromHistory(item)}
                      >
                        {savingId === `history:${item.id}` ? "恢复中…" : "恢复显示"}
                      </button>
                    ) : item.current_status === "published" ? (
                      <span className="rounded-full bg-mint px-3 py-1.5 text-xs font-bold text-sage-dark">当前可见</span>
                    ) : <span className="rounded-full bg-ink/10 px-3 py-1.5 text-xs font-bold text-muted">当前已移除</span>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
