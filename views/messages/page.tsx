import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import {
  AccountStatus,
  StudentMessage,
  getAccountStatus,
  getCurrentUser,
  listStudentMessages,
  sendStudentMessage,
} from "@/lib/cloudRecords";

type RecipientType = "teacher" | "guardian" | "self";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function MessagesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [messages, setMessages] = useState<StudentMessage[]>([]);
  const [recipientType, setRecipientType] = useState<RecipientType>("self");
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const displayRole = accountStatus?.displayRole || "";
  const isStudent = displayRole === "学生";
  const isSchoolLead = displayRole === "学校负责人";
  const assignedTeachers = accountStatus?.assignedTeachers || [];
  const linkedGuardians = accountStatus?.linkedGuardians || [];

  async function refreshMessages() {
    setMessages(await listStudentMessages());
  }

  useEffect(() => {
    async function load() {
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
        if (!currentUser) return;
        const [status, nextMessages] = await Promise.all([
          getAccountStatus(),
          listStudentMessages(),
        ]);
        setAccountStatus(status);
        setMessages(nextMessages);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "暂时无法加载想说的话。");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || sending) return;
    const candidates = recipientType === "teacher" ? assignedTeachers : recipientType === "guardian" ? linkedGuardians : [];
    const recipientUserId = recipientType === "self" ? user.id : recipientId || candidates[0]?.id || "";
    if (recipientType !== "self" && !recipientUserId) {
      setNotice(recipientType === "teacher" ? "学校还没有为你安排负责老师。" : "学校还没有确认关联家长。");
      return;
    }

    setSending(true);
    setNotice("");
    try {
      const result = await sendStudentMessage({
        recipientType,
        recipientUserId,
        anonymous: recipientType === "teacher" && anonymous,
        body,
      });
      setBody("");
      setAnonymous(false);
      setNotice(
        result.safetyNotice
          ? "这段话已经送出。请尽快联系身边可信任的大人；如果正处于危险中，请立即联系当地紧急服务。"
          : recipientType === "self"
            ? "已经替你保存下来。"
            : "已经送出。",
      );
      await refreshMessages();
    } catch (sendError) {
      setNotice(sendError instanceof Error ? sendError.message : "暂时无法发送，请稍后再试。");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHero
        title="悄悄话信箱"
        subtitle={isStudent ? "有些话不容易当面说，可以先写给老师、家长或自己。" : "在这里查看学生认真写下、希望你知道的话。"}
        action={<Link href="/account" className="button-secondary">返回工作台</Link>}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-mailbox.png"
            alt="装着一封信的绿色悄悄话信箱插画"
            priority
          />
        }
      />

      {loading ? (
        <section className="section section-muted">
          <div className="container"><p className="card text-sm font-bold text-sage-dark">正在加载…</p></div>
        </section>
      ) : !user ? (
        <section className="section section-muted">
          <div className="container max-w-2xl">
            <div className="card text-center">
              <h2 className="text-2xl font-bold text-ink">登录后使用这个功能</h2>
              <p className="mt-3 text-sm leading-7 text-muted">这样才能确认你可以写给谁，或查看哪些话。</p>
              <Link href="/account" className="button-primary mt-6">前往登录</Link>
            </div>
          </div>
        </section>
      ) : isStudent ? (
        <>
          <section className="section section-muted pt-8 sm:pt-12">
            <div className="container grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <h2 className="text-[1.75rem] font-bold text-ink">先写下来，再决定给谁看</h2>
                <p className="mt-3 text-sm leading-7 text-muted">
                  写给老师时可以匿名。若内容涉及明确的安全危险，获授权的学校负责人可以确认来源并及时提供帮助。
                </p>
              </div>
              <form className="card" onSubmit={handleSend}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    写给谁
                    <select
                      className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                      value={recipientType}
                      onChange={(event) => {
                        const nextType = event.target.value as RecipientType;
                        setRecipientType(nextType);
                        setRecipientId("");
                        if (nextType !== "teacher") setAnonymous(false);
                      }}
                    >
                      <option value="self">写给自己</option>
                      <option value="teacher">写给老师</option>
                      <option value="guardian">写给家长</option>
                    </select>
                  </label>
                  {recipientType !== "self" ? (
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      收件人
                      <select
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={recipientId}
                        onChange={(event) => setRecipientId(event.target.value)}
                      >
                        <option value="">请选择</option>
                        {(recipientType === "teacher" ? assignedTeachers : linkedGuardians).map((person) => (
                          <option key={person.id} value={person.id}>{person.display_name}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <label className="mt-4 grid gap-2 text-sm font-bold text-ink">
                  想说的话
                  <textarea
                    className="min-h-40 rounded-2xl border border-ink/15 bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-sage"
                    value={body}
                    maxLength={1000}
                    placeholder="不用组织得很完整，先写下最想让对方知道的事情。"
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <VoiceInputButton value={body} onChange={setBody} />
                    <span className="text-xs font-normal text-muted">{body.length}/1000</span>
                  </div>
                </label>
                {recipientType === "teacher" ? (
                  <label className="mt-3 flex items-start gap-3 rounded-2xl bg-cream px-4 py-3 text-sm leading-6 text-muted">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-sage" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
                    <span>对老师匿名。只有出现明确安全危险时，获授权的学校负责人才能确认来源。</span>
                  </label>
                ) : null}
                <button type="submit" className="button-primary mt-5 w-full sm:w-auto" disabled={sending || !body.trim()}>
                  {sending ? "正在送出…" : recipientType === "self" ? "保存给自己" : "送出这段话"}
                </button>
                {notice ? <p className="mt-4 rounded-xl bg-mint px-4 py-3 text-sm font-bold leading-6 text-sage-dark">{notice}</p> : null}
              </form>
            </div>
          </section>
          <MessageList title="我写过的话" messages={messages} sent />
        </>
      ) : (
        <MessageList title={isSchoolLead ? "需要安全跟进的话" : "收到的话"} messages={messages} />
      )}

      {error ? (
        <section className="section pt-0"><div className="container"><p className="card text-sm font-bold text-sage-dark">{error}</p></div></section>
      ) : null}
    </>
  );
}

function MessageList({ title, messages, sent = false }: { title: string; messages: StudentMessage[]; sent?: boolean }) {
  return (
    <section className="section">
      <div className="container">
        <SectionHeader title={title} description={messages.length ? undefined : sent ? "你写下并保存或送出的话，会显示在这里。" : "目前还没有收到新的内容。"} />
        <div className="grid gap-4">
          {messages.map((message) => (
            <article key={message.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-ink">{sent ? message.recipient_name : message.sender_name}</h3>
                  {sent && message.anonymous_to_recipient ? <span className="text-xs font-bold text-muted">对老师匿名</span> : null}
                  {!sent && message.moderation_status === "safety_review" ? (
                    <span className="rounded-full bg-[#f7e8dc] px-3 py-1 text-xs font-bold text-[#824b2d]">请尽快了解</span>
                  ) : null}
                </div>
                <span className="text-xs font-bold text-muted">{formatDate(message.created_at)}</span>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink">{message.body}</p>
              {!sent && message.anonymous_to_recipient && !message.canRevealSender ? (
                <p className="mt-3 text-xs leading-6 text-muted">这名学生选择了对老师匿名。</p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
