import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { InlineStudentConsent } from "@/components/InlineStudentConsent";
import { useInlineStudentConsent } from "@/lib/useInlineStudentConsent";
import { useSessionActor } from "@/lib/useSessionActor";
import type { User } from "@supabase/supabase-js";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import {
  CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED,
  isAdultWithoutGuardianFlow,
} from "@/lib/guardianAccessPolicy";
import {
  AccountStatus,
  StudentMessage,
  StudentMessageReadError,
  StudentMessageSendRejectedError,
  StudentMessageSendUnknownError,
  getAccountStatus,
  getCurrentUser,
  listStudentMessages,
  localizedCloudErrorMessage,
  sendStudentMessage,
} from "@/lib/cloudRecords";

type RecipientType = "teacher" | "guardian" | "self" | "pilot_duty";
type MessageSendRecovery = { checked: boolean; current: () => boolean };

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
  const consent = useInlineStudentConsent();
  const actor = useSessionActor();
  const readEpoch = useRef(0);
  const metadataEpoch = useRef(0);
  const submissionEpoch = useRef(0);
  const [receipt, setReceipt] = useState<{ key: TranslationKey; current: () => boolean } | null>(null);
  const sendRecoveryRef = useRef<MessageSendRecovery | null>(null);
  const [sendRecovery, setSendRecovery] = useState<MessageSendRecovery | null>(null);
  const [messagesCurrent, setMessagesCurrent] = useState<() => boolean>(() => () => false);
  const draftOwner = useRef("");
  const draftEdit = useRef<{ revision: number; current: () => boolean }>({ revision: 0, current: () => false });
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
  const [pilotDutyAvailable, setPilotDutyAvailable] = useState(false);
  const [pilotDutyEmailConfigured, setPilotDutyEmailConfigured] = useState(false);

  useEffect(() => {
    if (actor.phase !== "ready" || (draftOwner.current && draftOwner.current !== actor.actorId)) {
      retireSubmission();
      setMessages([]); setAccountStatus(null); setError("");
    }
    draftOwner.current = actor.actorId;
  }, [actor.actorId, actor.phase, consent.userId]);

  const viewerUser = actor.phase === "ready" && user?.id === actor.actorId ? user : null;
  const shownMessages = viewerUser && messagesCurrent() ? messages : [];
  const displayRole = viewerUser ? accountStatus?.displayRole || "" : "";
  const isStudent = displayRole === "学生";
  const isSchoolLead = displayRole === "学校负责人";
  const assignedTeachers = accountStatus?.assignedTeachers || [];
  const linkedGuardians = accountStatus?.linkedGuardians || [];
  const showGuardianRecipient =
    CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED
    && !isAdultWithoutGuardianFlow(accountStatus?.studentAgeBand);
  const studentHeroDescription = accountStatus?.studentAgeBand === "18_plus"
    ? t("messages.member.hero.adultStudentDescription")
    : accountStatus?.studentAgeBand === "14_17"
      ? t("messages.member.hero.minorStudentDescription")
      : t("messages.member.hero.studentDescription");
  const showVisitorCopy = !loading && !viewerUser;

  function markDraftEdited() {
    draftEdit.current = { revision: draftEdit.current.revision + 1, current: actor.trackRequest() };
  }

  function editBody(value: string) {
    markDraftEdited();
    setBody(value);
  }

  function retireSubmission() {
    ++submissionEpoch.current;
    sendRecoveryRef.current = null; setSendRecovery(null);
    setReceipt(null); setBody(""); setAnonymous(false); setRecipientId(""); setRecipientType("self");
    setNotice(""); setSending(false);
  }

  function retireMessages() {
    ++readEpoch.current;
    setMessages([]); setMessagesCurrent(() => () => false);
    setPilotDutyAvailable(false); setPilotDutyEmailConfigured(false); setLoading(false);
  }

  async function revalidateMessages(includeOriginalAccountStatus = false): Promise<boolean> {
    const revision = ++readEpoch.current;
    const owner = actor.actorId;
    const currentActor = actor.trackRequest();
    const metadataRevision = metadataEpoch.current;
    const current = () => revision === readEpoch.current && currentActor();
    setMessages([]); setMessagesCurrent(() => () => false); setError(""); setLoading(true);
    setPilotDutyAvailable(false); setPilotDutyEmailConfigured(false);
    if (!owner || actor.phase !== "ready") { setUser(null); setAccountStatus(null); setLoading(false); return false; }
    let identityConfirmed = false;
    try {
      const currentUser = await getCurrentUser(); // auth.getUser, not account/status.
      if (!currentActor()) return false;
      if (currentUser?.id !== owner) {
        if (current()) { setUser(null); throw new Error(t("messages.errors.loadFailed")); }
        return false;
      }
      identityConfirmed = true;
      // Preserve the pre-existing initial page load only. It may sync school invites.
      // Stable-identity focus/visibility/manual reads never enter this branch.
      // Establishing identity again still uses the original metadata initialization.
      if (includeOriginalAccountStatus) {
        if (!currentActor() || metadataRevision !== metadataEpoch.current) return false;
        const status = await getAccountStatus(owner);
        // Metadata is separate from private-message reads: focus may retire the latter.
        if (currentActor() && metadataRevision === metadataEpoch.current) setAccountStatus(status);
      }
      if (!current()) return false;
      setUser(currentUser);
      const payload = await listStudentMessages(owner, current);
      if (!current()) return false;
      setMessages(payload.messages); setMessagesCurrent(() => current);
      setPilotDutyAvailable(payload.pilotDutyAvailable);
      setPilotDutyEmailConfigured(payload.pilotDutyEmailConfigured);
      return true;
    } catch (loadError) {
      if (!current()) return false;
      // A list/token failure is separate from submission, but identity must remain verifiable.
      if (identityConfirmed) {
        try {
          const confirmedUser = await getCurrentUser();
          if (!current()) return false;
          identityConfirmed = confirmedUser?.id === owner;
          if (identityConfirmed) await actor.getToken(owner);
        } catch { identityConfirmed = false; }
      }
      if (!current()) return false;
      if (!identityConfirmed) retireSubmission();
      ++readEpoch.current; // No later callback may reapply private content from this attempt.
      setMessages([]); setMessagesCurrent(() => () => false);
      setUser(null); setLoading(false);
      const loadKey = loadError instanceof StudentMessageReadError && loadError.status === 401
        ? "messages.errors.loadIdentityRequired"
        : loadError instanceof StudentMessageReadError && loadError.status === 403
          ? "messages.errors.loadAccessDenied" : "messages.errors.loadFailed";
      setError(localizedCloudErrorMessage(loadError, locale, t(loadKey)));
      return false;
    } finally { if (current()) setLoading(false); }
  }

  async function refreshMessages() { return revalidateMessages(false); }

  useEffect(() => {
    const retireLifetimes = () => { ++readEpoch.current; ++metadataEpoch.current; };
    ++metadataEpoch.current;
    retireMessages(); setUser(null); setAccountStatus(null);
    if (actor.phase === "ready") void revalidateMessages(true);
    return retireLifetimes;
  // Preserve original metadata-load triggers; actor guards also retire logout and ABA.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.actorId, actor.phase, consent.userId, consent.studentReady]);

  useEffect(() => {
    const focus = () => { if (document.visibilityState === "visible") void revalidateMessages(false); };
    const visibility = () => {
      if (document.visibilityState === "visible") void revalidateMessages(false);
      else retireMessages();
    };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  // Read-only revalidation uses actor + read lifetime; teacher own-consent errors cannot strand it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.actorId, actor.phase, consent.userId, consent.studentReady, locale]);

  useEffect(() => {
    setNotice("");
    setError("");
  }, [locale]);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || sending || sendRecoveryRef.current?.current()) return;
    if (actor.phase !== "ready" || !actor.isSameActor(user.id)) return;
    if (!consent.studentReady || user.id !== consent.userId) { setNotice(t("inlineConsent.consentNeeded")); return; }
    const candidates = recipientType === "teacher" ? assignedTeachers : recipientType === "guardian" ? linkedGuardians : [];
    const recipientUserId = recipientType === "self" ? user.id : recipientId || candidates[0]?.id || "";
    if (["teacher", "guardian"].includes(recipientType) && !recipientUserId) {
      setNotice(recipientType === "teacher" ? t("messages.notices.noTeacher") : t("messages.notices.noGuardian"));
      return;
    }

    const consentCurrent = consent.trackRequest();
    const actorCurrent = actor.trackRequest();
    const revision = ++submissionEpoch.current;
    const draftRevision = draftEdit.current.revision;
    const receiptCurrent = () => revision === submissionEpoch.current && actorCurrent();
    const current = () => receiptCurrent() && consentCurrent();
    setSending(true);
    setNotice("");
    setReceipt(null);
    sendRecoveryRef.current = null; setSendRecovery(null);
    try {
      const result = await sendStudentMessage({
        recipientType,
        recipientUserId,
        anonymous: recipientType === "teacher" && anonymous,
        body,
        locale,
      }, consent.userId);
      if (!current()) return;
      setBody("");
      setAnonymous(false);
      setReceipt({ current: receiptCurrent, key: result.safetyNotice
          ? result.dutyEscalated
            ? result.dutyAlertStatus === "sent"
              ? "messages.notices.safetyDutyAlerted"
              : "messages.notices.safetyDutyQueued"
            : "messages.notices.safetyPrivate"
          : recipientType === "pilot_duty"
            ? result.dutyAlertStatus === "sent"
              ? "messages.notices.dutyAlerted"
              : "messages.notices.dutyQueued"
          : recipientType === "self"
            ? "messages.notices.savedForSelf"
            : "messages.notices.sent",
      });
      await refreshMessages();
    } catch (sendError) {
      if (!current()) return;
      if (sendError instanceof StudentMessageSendUnknownError) {
        const recovery: MessageSendRecovery = { checked: false, current };
        sendRecoveryRef.current = recovery; setSendRecovery(recovery); setNotice("");
      } else if (sendError instanceof StudentMessageSendRejectedError) {
        const errorKey = sendError.rejection === "identity"
          ? "messages.errors.sendIdentityRequired"
          : sendError.rejection === "access"
            ? "messages.errors.sendAccessDenied"
            : sendError.rejection === "input"
              ? "messages.errors.sendInputRejected"
              : sendError.rejection === "safety"
                ? "messages.errors.sendSafetyRejected"
                : "messages.errors.sendRateLimited";
        setNotice(t(errorKey));
      } else {
        setNotice(localizedCloudErrorMessage(sendError, locale, t("messages.errors.sendFailed")));
      }
    } finally {
      if (receiptCurrent()) setSending(false);
      // A batched A→B→A can retire the actor without an intermediate render.
      else if (revision === submissionEpoch.current && actor.isSameActor(user.id)) {
        setSending(false);
        if (draftEdit.current.revision <= draftRevision || !draftEdit.current.current()) retireSubmission();
      }
    }
  }

  async function checkSendOutcome() {
    const recovery = sendRecoveryRef.current;
    if (!recovery?.current() || recovery.checked) return;
    if (await revalidateMessages(false)) {
      const latest = sendRecoveryRef.current;
      if (latest === recovery && latest.current()) {
        const checked = { ...latest, checked: true };
        sendRecoveryRef.current = checked; setSendRecovery(checked);
      }
    }
  }

  return (
    <>
      <PageHero
        title={showVisitorCopy ? t("messages.visitor.hero.title") : t("messages.member.hero.title")}
        subtitle={showVisitorCopy ? t("messages.visitor.hero.description") : isStudent ? studentHeroDescription : t("messages.member.hero.supporterDescription")}
        action={<Link href={showVisitorCopy ? "/account?next=/messages" : "/account"} className="button-secondary">{showVisitorCopy ? t("messages.visitor.hero.action") : t("messages.member.hero.action")}</Link>}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-mailbox.webp"
            alt={showVisitorCopy ? t("messages.visitor.hero.imageAlt") : t("messages.member.hero.imageAlt")}
            priority
          />
        }
      />

      <div className="container pt-6"><InlineStudentConsent controller={consent} /></div>
      <div className="container pt-4">
        <button type="button" className="button-secondary" aria-busy={loading} onClick={() => {
          if (actor.phase === "ready") void revalidateMessages(false);
          else void actor.refreshIdentity();
        }}>{t("messages.actions.revalidate")}</button>
      </div>

      {actor.phase === "ready" && receipt?.current() ? (
        <div className="container pt-4"><p role="status" className="rounded-xl bg-mint px-4 py-3 text-sm font-bold leading-6 text-sage-dark">{t(receipt.key)}</p></div>
      ) : null}

      {sendRecovery?.current() ? (
        <div className="container pt-4">
          <div className="card text-sm leading-6" data-testid="message-send-recovery" role="alert">
            <p>{t("messages.errors.sendUnconfirmed")}</p>
            {sendRecovery.checked ? (
              <>
                <p className="mt-2">{t("messages.errors.sendRecoveryChecked")}</p>
                <button type="button" className="button-secondary mt-3" onClick={() => {
                  const currentRecovery = sendRecoveryRef.current;
                  if (currentRecovery?.current() && currentRecovery.checked) {
                    sendRecoveryRef.current = null; setSendRecovery(null);
                    setNotice(t("messages.errors.sendRecoveryReady"));
                  }
                }}>{t("messages.actions.acknowledgeSendRecovery")}</button>
              </>
            ) : (
              <button type="button" className="button-secondary mt-3" disabled={loading}
                onClick={() => { void checkSendOutcome(); }}>{t("messages.actions.checkSendOutcome")}</button>
            )}
          </div>
        </div>
      ) : null}

      {loading ? (
        <section className="section section-muted">
          <div className="container"><p className="card text-sm font-bold text-sage-dark">{t("messages.visitor.loading")}</p></div>
        </section>
      ) : !viewerUser ? (
        <section className="section section-muted">
          <div className="container max-w-2xl">
            <div className="card text-center">
              <h2 className="text-2xl font-bold text-ink">{t("messages.visitor.title")}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{t("messages.visitor.description")}</p>
              <Link href="/account?next=/messages" className="button-primary mt-6">{t("messages.visitor.action")}</Link>
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
                        markDraftEdited();
                        const nextType = event.target.value as RecipientType;
                        setRecipientType(nextType);
                        setRecipientId("");
                        if (nextType !== "teacher") setAnonymous(false);
                      }}
                    >
                      <option value="self">{t("messages.compose.recipientOptions.self")}</option>
                      {pilotDutyAvailable ? <option value="pilot_duty">{t("messages.compose.recipientOptions.pilotDuty")}</option> : null}
                      <option value="teacher">{t("messages.compose.recipientOptions.teacher")}</option>
                      {showGuardianRecipient ? <option value="guardian">{t("messages.compose.recipientOptions.guardian")}</option> : null}
                    </select>
                  </label>
                  {["teacher", "guardian"].includes(recipientType) ? (
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      {t("messages.compose.recipient")}
                      <select
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={recipientId}
                        onChange={(event) => { markDraftEdited(); setRecipientId(event.target.value); }}
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
                    onChange={(event) => editBody(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <VoiceInputButton value={body} onChange={editBody} />
                    <span className="text-xs font-normal text-muted">{body.length}/1000</span>
                  </div>
                </label>
                {recipientType === "teacher" ? (
                  <label className="mt-3 flex items-start gap-3 rounded-2xl bg-cream px-4 py-3 text-sm leading-6 text-muted">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-sage" checked={anonymous} onChange={(event) => { markDraftEdited(); setAnonymous(event.target.checked); }} />
                    <span>{t("messages.compose.anonymousDescription")}</span>
                  </label>
                ) : null}
                {recipientType === "pilot_duty" ? (
                  <p className="mt-3 rounded-2xl border border-sage/20 bg-mint px-4 py-3 text-sm leading-6 text-sage-dark">
                    {pilotDutyEmailConfigured
                      ? t("messages.compose.dutyDisclosureEmail")
                      : t("messages.compose.dutyDisclosureQueue")}
                  </p>
                ) : pilotDutyAvailable ? (
                  <p className="mt-3 text-xs leading-6 text-muted">{t("messages.compose.safetyDisclosure")}</p>
                ) : null}
                <button type="submit" className="button-primary mt-5 w-full sm:w-auto" disabled={sending || Boolean(sendRecovery?.current()) || !body.trim()}>
                  {sending ? t("messages.compose.sending") : recipientType === "self" ? t("messages.compose.saveForSelf") : recipientType === "pilot_duty" ? t("messages.compose.sendToDuty") : t("messages.compose.send")}
                </button>
                {notice ? <p className="mt-4 rounded-xl bg-mint px-4 py-3 text-sm font-bold leading-6 text-sage-dark">{notice}</p> : null}
              </form>
            </div>
          </section>
          <MessageList title={t("messages.lists.sentTitle")} messages={shownMessages} sent />
        </>
      ) : (
        <MessageList title={isSchoolLead ? t("messages.lists.safetyTitle") : t("messages.lists.receivedTitle")} messages={shownMessages} />
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
