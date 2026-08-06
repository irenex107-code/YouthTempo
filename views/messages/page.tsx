import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import {
  AccountStatus,
  StudentMessage,
  getAccountStatus,
  getCurrentUser,
  listStudentMessages,
  localizedCloudErrorMessage,
  sendStudentMessage,
} from "@/lib/cloudRecords";

type RecipientType = "teacher" | "guardian" | "self";

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function MessagesPage() {
  const { locale, t } = useTranslation();
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
  const showVisitorCopy = !loading && !user;

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
        setError(localizedCloudErrorMessage(loadError, locale, t("messages.errors.loadFailed")));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    setNotice("");
    setError("");
  }, [locale]);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || sending) return;
    const candidates = recipientType === "teacher" ? assignedTeachers : recipientType === "guardian" ? linkedGuardians : [];
    const recipientUserId = recipientType === "self" ? user.id : recipientId || candidates[0]?.id || "";
    if (recipientType !== "self" && !recipientUserId) {
      setNotice(recipientType === "teacher" ? t("messages.notices.noTeacher") : t("messages.notices.noGuardian"));
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
        locale,
      });
      setBody("");
      setAnonymous(false);
      setNotice(
        result.safetyNotice
          ? t("messages.notices.safetySent")
          : recipientType === "self"
            ? t("messages.notices.savedForSelf")
            : t("messages.notices.sent"),
      );
      await refreshMessages();
    } catch (sendError) {
      setNotice(localizedCloudErrorMessage(sendError, locale, t("messages.errors.sendFailed")));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHero
        title={showVisitorCopy ? t("messages.visitor.hero.title") : t("messages.member.hero.title")}
        subtitle={showVisitorCopy ? t("messages.visitor.hero.description") : isStudent ? t("messages.member.hero.studentDescription") : t("messages.member.hero.supporterDescription")}
        action={<Link href="/account" className="button-secondary">{showVisitorCopy ? t("messages.visitor.hero.action") : t("messages.member.hero.action")}</Link>}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-mailbox.webp"
            alt={showVisitorCopy ? t("messages.visitor.hero.imageAlt") : t("messages.member.hero.imageAlt")}
            priority
          />
        }
      />

      {loading ? (
        <section className="section section-muted">
          <div className="container"><p className="card text-sm font-bold text-sage-dark">{t("messages.visitor.loading")}</p></div>
        </section>
      ) : !user ? (
        <section className="section section-muted">
          <div className="container max-w-2xl">
            <div className="card text-center">
              <h2 className="text-2xl font-bold text-ink">{t("messages.visitor.title")}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{t("messages.visitor.description")}</p>
              <Link href="/account" className="button-primary mt-6">{t("messages.visitor.action")}</Link>
            </div>
          </div>
        </section>
      ) : isStudent ? (
        <>
          <section className="section section-muted pt-8 sm:pt-12">
            <div className="container grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <h2 className="text-[1.75rem] font-bold text-ink">{t("messages.compose.title")}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">
                  {t("messages.compose.description")}
                </p>
              </div>
              <form className="card" onSubmit={handleSend}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    {t("messages.compose.recipientType")}
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
                      <option value="self">{t("messages.compose.recipientOptions.self")}</option>
                      <option value="teacher">{t("messages.compose.recipientOptions.teacher")}</option>
                      <option value="guardian">{t("messages.compose.recipientOptions.guardian")}</option>
                    </select>
                  </label>
                  {recipientType !== "self" ? (
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      {t("messages.compose.recipient")}
                      <select
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={recipientId}
                        onChange={(event) => setRecipientId(event.target.value)}
                      >
                        <option value="">{t("messages.compose.selectRecipient")}</option>
                        {(recipientType === "teacher" ? assignedTeachers : linkedGuardians).map((person) => (
                          <option key={person.id} value={person.id}>{person.display_name}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <label className="mt-4 grid gap-2 text-sm font-bold text-ink">
                  {t("messages.compose.message")}
                  <textarea
                    className="min-h-40 rounded-2xl border border-ink/15 bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-sage"
                    value={body}
                    maxLength={1000}
                    placeholder={t("messages.compose.placeholder")}
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
                    <span>{t("messages.compose.anonymousDescription")}</span>
                  </label>
                ) : null}
                <button type="submit" className="button-primary mt-5 w-full sm:w-auto" disabled={sending || !body.trim()}>
                  {sending ? t("messages.compose.sending") : recipientType === "self" ? t("messages.compose.saveForSelf") : t("messages.compose.send")}
                </button>
                {notice ? <p className="mt-4 rounded-xl bg-mint px-4 py-3 text-sm font-bold leading-6 text-sage-dark">{notice}</p> : null}
              </form>
            </div>
          </section>
          <MessageList title={t("messages.lists.sentTitle")} messages={messages} sent />
        </>
      ) : (
        <MessageList title={isSchoolLead ? t("messages.lists.safetyTitle") : t("messages.lists.receivedTitle")} messages={messages} />
      )}

      {error ? (
        <section className="section pt-0"><div className="container"><p className="card text-sm font-bold text-sage-dark">{error}</p></div></section>
      ) : null}
    </>
  );
}

function MessageList({ title, messages, sent = false }: { title: string; messages: StudentMessage[]; sent?: boolean }) {
  const { locale, t } = useTranslation();
  return (
    <section className="section">
      <div className="container">
        <SectionHeader title={title} description={messages.length ? undefined : sent ? t("messages.lists.sentEmpty") : t("messages.lists.receivedEmpty")} />
        <div className="grid gap-4">
          {messages.map((message) => (
            <article key={message.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-ink">{sent ? message.recipient_name : message.sender_name}</h3>
                  {sent && message.anonymous_to_recipient ? <span className="text-xs font-bold text-muted">{t("messages.lists.anonymousToTeacher")}</span> : null}
                  {!sent && message.moderation_status === "safety_review" ? (
                    <span className="rounded-full bg-[#f7e8dc] px-3 py-1 text-xs font-bold text-[#824b2d]">{t("messages.lists.reviewSoon")}</span>
                  ) : null}
                </div>
                <span className="text-xs font-bold text-muted">{formatDate(message.created_at, locale)}</span>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink">{message.body}</p>
              {!sent && message.anonymous_to_recipient && !message.canRevealSender ? (
                <p className="mt-3 text-xs leading-6 text-muted">{t("messages.lists.senderAnonymous")}</p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
