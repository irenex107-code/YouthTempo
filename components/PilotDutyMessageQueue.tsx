import { useEffect, useState } from "react";

type DutyStatus = "new" | "in_progress" | "resolved";

type DutyAction = {
  id: string;
  previous_status: DutyStatus;
  new_status: DutyStatus;
  note: string;
  actor_name: string;
  created_at: string;
};

type DutyMessage = {
  id: string;
  sender_name: string;
  sender_email: string | null;
  recipient_type: "teacher" | "guardian" | "self" | "pilot_duty";
  body: string;
  moderation_status: "sent" | "safety_review";
  moderation_reason: string | null;
  duty_status: DutyStatus;
  alert_delivery_status: "not_requested" | "pending" | "sent" | "failed" | "not_configured";
  alert_last_attempt_at: string | null;
  created_at: string;
  actions: DutyAction[];
};

type DutyPayload = {
  enabled: boolean;
  emailConfigured: boolean;
  counts: {
    total: number;
    new: number;
    inProgress: number;
    safetyReview: number;
    alertProblems: number;
  };
  messages: DutyMessage[];
};

const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(value));

const statusLabels: Record<DutyStatus, string> = {
  new: "待查看",
  in_progress: "处理中",
  resolved: "已完成",
};

const alertLabels: Record<DutyMessage["alert_delivery_status"], string> = {
  not_requested: "未请求邮件",
  pending: "邮件发送中",
  sent: "邮件已发送",
  failed: "邮件发送失败",
  not_configured: "邮件尚未配置",
};

export function PilotDutyMessageQueue({ accessToken }: { accessToken: string }) {
  const [payload, setPayload] = useState<DutyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");

  async function loadQueue() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/message-duty", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "值班留言暂时无法读取。");
      setPayload(body as DutyPayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "值班留言暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadQueue(); }, [accessToken]);

  async function updateStatus(messageId: string, status: DutyStatus) {
    const note = notes[messageId]?.trim() || "";
    if (!note) {
      setError("请先填写简短的处理记录，再更改状态。");
      return;
    }
    setSavingId(messageId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/message-duty", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ messageId, status, note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "值班状态暂时无法保存。");
      setNotes((current) => ({ ...current, [messageId]: "" }));
      setNotice(body.notice || "值班状态已保存。");
      await loadQueue();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "值班状态暂时无法保存。");
    } finally {
      setSavingId("");
    }
  }

  async function retryAlert(messageId: string) {
    setSavingId(messageId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/message-duty", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ messageId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.notice || body.error || "提醒邮件未确认发送成功。");
      setNotice(body.notice);
      await loadQueue();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "提醒邮件未确认发送成功。");
      await loadQueue();
    } finally {
      setSavingId("");
    }
  }

  return (
    <section id="message-duty" className="section section-muted scroll-mt-24">
      <div className="container">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">试点值班</p>
            <h2 className="mt-3 text-[1.6rem] font-bold text-ink">学生联系与安全复核队列</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
              只收录学生主动发给值班负责人的留言，以及无学校承接的高风险留言。邮件不包含学生身份或正文；请登录这里查看并留下处理记录。
            </p>
          </div>
          <button type="button" className="button-secondary" onClick={() => void loadQueue()} disabled={loading}>
            {loading ? "正在刷新……" : "刷新队列"}
          </button>
        </div>

        {payload ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="card"><p className="text-xs font-bold text-sage">待查看</p><p className="mt-2 text-3xl font-bold text-ink">{payload.counts.new}</p></div>
            <div className="card"><p className="text-xs font-bold text-sage">处理中</p><p className="mt-2 text-3xl font-bold text-ink">{payload.counts.inProgress}</p></div>
            <div className="card"><p className="text-xs font-bold text-sage">安全优先</p><p className="mt-2 text-3xl font-bold text-ink">{payload.counts.safetyReview}</p></div>
            <div className="card"><p className="text-xs font-bold text-sage">邮件异常</p><p className="mt-2 text-3xl font-bold text-ink">{payload.counts.alertProblems}</p></div>
            <div className="card"><p className="text-xs font-bold text-sage">提醒配置</p><p className="mt-2 text-sm font-bold text-ink">{payload.enabled && payload.emailConfigured ? "已启用" : "尚未启用"}</p></div>
          </div>
        ) : null}

        {notice ? <p className="mt-6 rounded-2xl border border-sage/20 bg-mint px-4 py-3 text-sm font-bold text-sage-dark">{notice}</p> : null}
        {error ? <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}
        {loading && !payload ? <div className="card mt-6 text-sm font-bold text-muted">正在读取值班队列……</div> : null}
        {payload && !payload.messages.length ? <div className="card mt-6"><p className="font-bold text-ink">目前没有值班留言</p><p className="mt-2 text-sm text-muted">学生主动联系或无学校承接的安全留言会显示在这里。</p></div> : null}

        <div className="mt-6 grid gap-4">
          {payload?.messages.map((message) => (
            <article key={message.id} className={`card ${message.moderation_status === "safety_review" ? "border-amber-300" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${message.moderation_status === "safety_review" ? "bg-amber-100 text-amber-800" : "bg-mint text-sage-dark"}`}>
                      {message.moderation_status === "safety_review" ? "安全优先" : "主动联系"}
                    </span>
                    <span className="rounded-full bg-ink/5 px-3 py-1 text-xs font-bold text-muted">{statusLabels[message.duty_status]}</span>
                    <span className="text-xs font-bold text-muted">{alertLabels[message.alert_delivery_status]}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-ink">{message.sender_name}</h3>
                  {message.sender_email ? <p className="mt-1 break-all text-xs text-muted">{message.sender_email}</p> : null}
                  <p className="mt-2 text-xs text-muted">{formatDate(message.created_at)} · 事件 {message.id}</p>
                </div>
                {message.alert_delivery_status !== "sent" ? (
                  <button type="button" className="button-secondary" onClick={() => void retryAlert(message.id)} disabled={savingId === message.id || !payload.emailConfigured}>
                    重新发送邮件提醒
                  </button>
                ) : null}
              </div>

              <details className="mt-5 rounded-2xl border border-ink/10 bg-white px-4 py-4">
                <summary className="cursor-pointer font-bold text-ink">查看学生留言正文</summary>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink">{message.body}</p>
                {message.moderation_reason ? <p className="mt-3 text-xs font-bold text-amber-800">系统提示：{message.moderation_reason}</p> : null}
              </details>

              <label className="mt-5 grid gap-2 text-sm font-bold text-ink">
                本次处理记录
                <textarea
                  className="min-h-24 rounded-2xl border border-ink/15 bg-white px-4 py-3 text-sm font-normal leading-7 outline-none focus:border-sage"
                  value={notes[message.id] || ""}
                  maxLength={500}
                  placeholder="例如：已查看，正在联系学生确认当前是否安全。请勿复制留言正文。"
                  onChange={(event) => setNotes((current) => ({ ...current, [message.id]: event.target.value }))}
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className="button-secondary" onClick={() => void updateStatus(message.id, "in_progress")} disabled={savingId === message.id}>标记处理中</button>
                <button type="button" className="button-primary" onClick={() => void updateStatus(message.id, "resolved")} disabled={savingId === message.id}>标记已完成</button>
              </div>

              {message.actions.length ? (
                <details className="mt-5 text-sm text-muted">
                  <summary className="cursor-pointer font-bold">处理历史（{message.actions.length}）</summary>
                  <div className="mt-3 grid gap-3">
                    {message.actions.map((action) => (
                      <div key={action.id} className="rounded-xl bg-cream px-4 py-3">
                        <p className="font-bold text-ink">{statusLabels[action.previous_status]} → {statusLabels[action.new_status]}</p>
                        <p className="mt-1 whitespace-pre-wrap leading-6">{action.note}</p>
                        <p className="mt-1 text-xs">{action.actor_name} · {formatDate(action.created_at)}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
