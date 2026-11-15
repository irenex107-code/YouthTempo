import { useRouter } from "next/router";
import Link from "next/link";
import { FormEvent, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { SectionHeader } from "@/components/SectionHeader";
import { ProfessionalVerificationCard } from "@/components/ProfessionalVerificationCard";
import { AgePathWorkspace } from "@/components/AgePathWorkspace";
import { AiGeneratedLabel } from "@/components/AiTransparencyNotice";
import { YOUNG_ADULT_REFERRAL_HREF } from "@/lib/referralDisplayContext";
import {
  AccountStatus,
  AccountWriteError,
  AccountDeletionError,
  AccountDeletionReceipt,
  AccountDeletionState,
  CloudProfile,
  CloudSweetRecord,
  StudentConsentResponse,
  WechatBindSession,
  WechatIdentity,
  checkWechatBindSession,
  checkAccountDeletionStatus,
  createAccountDeletionReceipt,
  listAccountDeletionReceipts,
  accountDeletionReceiptChanged,
  createWechatBindSession,
  deleteAccountPermanently,
  deleteCloudSweetRecord,
  downloadAccountDataExport,
  OwnAccountContent,
  OwnContentKind,
  OwnContentRequestError,
  readOwnAccountContent,
  deleteOwnAccountContent,
  getAccountStatus,
  getCurrentUser,
  getProfile,
  getStudentConsentStatus,
  isAccountConsentSnapshot,
  handleAuthRedirect,
  listCloudSweetRecords,
  readCloudSweetScope,
  listWechatIdentities,
  saveProfile,
  sendEmailOtp,
  signOut,
  submitGuardianConsent,
  submitStudentAssent,
  verifyEmailOtp,
  withdrawStudentConsent,
  localizedCloudErrorMessage,
} from "@/lib/cloudRecords";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { defaultAccountDestination, navigationTargetForRole } from "@/lib/navigation";
import { useSessionActor } from "@/lib/useSessionActor";
import { SessionSignOutError } from "@/lib/sessionSignOut";
import { SweetPersistenceError, sweetStoredDay } from "@/lib/sweetPersistenceProtocol";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { reportClientOperationFailure } from "@/lib/clientMonitoring";
import { CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED } from "@/lib/guardianAccessPolicy";
import { useTranslation } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import type { TranslationKey, TranslationValues } from "@/lib/i18n/dictionaries";
import {
  emailOtpLength,
  otpRequestErrorMessage,
  otpVerificationErrorMessage,
} from "@/lib/emailOtp";
import { localizedStoredCheckInValue, storedCheckInLabel } from "@/lib/checkInHistoryCopy";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type DeletionContinuation = { operationId: string; subjectUserId: string; revision: number; current: () => boolean };
type DeletionContinuationView = Pick<DeletionContinuation, "operationId" | "subjectUserId" | "revision"> & { actorRevision: number };
type AccountWriteKind = "profile" | "sweet" | "assent" | "guardian" | "withdraw";
type AccountWriteAttempt = {
  id: number;
  kind: AccountWriteKind; slot: string; owner: string; target: string; day?: string;
  actorRevision: number; generation: number;
  phase: "pending" | "unknown"; checking: boolean; checked: boolean; checkFailed: boolean;
  trigger: HTMLElement | null;
  current: () => boolean;
};
type AccountWriteView = Omit<AccountWriteAttempt, "current" | "trigger">;

function accountConsentFingerprint(status: StudentConsentResponse) {
  const summary = (item: StudentConsentResponse["consent"]) => item && [item.studentUserId, item.status,
    item.ageBand, item.consentBasis, item.policyVersion, item.studentAssentedAt, item.guardianUserId,
    item.guardianConsentedAt, item.withdrawnAt];
  return JSON.stringify([status.role, status.policyVersion, summary(status.consent),
    [...status.children].sort((a, b) => a.studentUserId.localeCompare(b.studentUserId)).map(summary)]);
}

function storedRecordLabel(locale: Locale, key: string, fallback: string) {
  return storedCheckInLabel(locale, key, fallback);
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function recordCountLabel(count: number, locale: Locale, t: Translate) {
  return t(locale === "en" && count === 1 ? "account.summary.recordCountOne" : "account.summary.recordCount", { count });
}

function recordedDaysLabel(count: number, locale: Locale, t: Translate) {
  return t(locale === "en" && count === 1 ? "account.summary.daysRecordedOne" : "account.summary.daysRecorded", { count });
}

function countRecentRecordDays(records: CloudSweetRecord[], userId?: string) {
  if (!userId) return 0;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const days = new Set(
    records
      .filter((record) => record.user_id === userId && new Date(record.created_at) >= start)
      .map((record) => {
        const date = new Date(record.created_at);
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      }),
  );
  return days.size;
}

function formatRecordValue(value: string | string[], locale: Locale, t: Translate, stepId: string, fieldId: string) {
  if (Array.isArray(value)) return value.length ? value.map((item) => localizedStoredCheckInValue(item, locale, stepId, fieldId)).join(locale === "en" ? ", " : "、") : t("account.records.notProvided");
  const text = String(value || "").trim();
  return text ? localizedStoredCheckInValue(text, locale, stepId, fieldId) : t("account.records.notProvided");
}

function profileRoleLabel(value?: string | null) {
  if (value === "家长") return "家长";
  if (value === "专业支持者") return "专业支持者";
  if (value === "学校支持人员") return "支持老师";
  return "学生";
}

export function roleDisplayLabel(role: string, t: Translate) {
  if (role === "学校学生") return t("account.roles.schoolStudent");
  if (role === "学校家长") return t("account.roles.schoolGuardian");
  if (role === "平台管理员") return t("account.roles.platformAdmin");
  if (role === "学校负责人") return t("account.roles.schoolLead");
  if (role === "支持老师") return t("account.roles.supportTeacher");
  if (role === "家长") return t("account.roles.guardian");
  if (role === "专业支持者") return t("account.roles.professionalSupporter");
  return t("account.roles.student");
}

function recordsTitle(_role: string, t: Translate) {
  return t("account.records.titles.own");
}

function recordsDescription(role: string, hasSchool: boolean, t: Translate) {
  if (role === "平台管理员") return t("account.hero.descriptions.platformAdmin");
  if (role === "学校负责人") return t("adminPrivateRecords.schoolAccountDescription");
  if (role === "支持老师") return t("adminPrivateRecords.teacherAccountDescription");
  if (role === "家长") return t("account.hero.descriptions.guardian");
  return hasSchool ? t("account.hero.descriptions.schoolStudent") : t("account.hero.descriptions.personal");
}

function emptyRecordsDescription(_role: string, t: Translate) {
  return t("adminPrivateRecords.ownRecordsDescription");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timeoutId: number | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function deletionReceiptState(current: AccountDeletionState | undefined, next: AccountDeletionState) {
  if (current === "completed") return current;
  if (current === "deleted_cleanup_pending" && next !== "completed") return current;
  return next;
}

function OwnContentManagement({ owner, actor, active, signingOut, locale, t }: {
  owner: string; actor: ReturnType<typeof useSessionActor>; active: boolean; signingOut: boolean; locale: Locale; t: Translate;
}) {
  const epoch = useRef(0);
  const busy = useRef(false);
  const writing = useRef(false);
  const mounted = useRef(false);
  const [working, setWorking] = useState(false);
  const [view, setView] = useState<{ owner: string; current: () => boolean; data: OwnAccountContent } | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [receipt, setReceipt] = useState<{
    kind: OwnContentKind; id: string; current: () => boolean;
    // kind/id preserve which existing DELETE supplied this result; GET never overwrites it.
    deleteOutcome: "notSent" | "denied" | "unknown" | "acknowledged" | "confirmed";
    latestRead: "notChecked" | "verified" | "unconfirmed" | "readFailed";
  } | null>(null);
  const [pending, setPending] = useState<{ kind: OwnContentKind; id: string; current: () => boolean } | null>(null);
  const [shown, setShown] = useState(20);
  const eligible = active && !signingOut && actor.phase === "ready" && actor.isSameActor(owner);
  const live = useRef({ owner, eligible });
  useLayoutEffect(() => { live.current = { owner, eligible }; }, [owner, eligible]);

  useEffect(() => {
    mounted.current = true;
    const retire = () => {
      ++epoch.current; setView(null); setPending(null); setReadFailed(false); setShown(20);
      // A retired write can still have committed. It is never re-issued here.
      if (writing.current) setReceipt((r) => r && r.deleteOutcome !== "confirmed" ? { ...r, deleteOutcome: "unknown" } : r);
    };
    retire();
    window.addEventListener("focus", retire);
    document.addEventListener("visibilitychange", retire);
    const retireRequests = () => { ++epoch.current; };
    return () => {
      mounted.current = false; retireRequests();
      window.removeEventListener("focus", retire);
      document.removeEventListener("visibilitychange", retire);
    };
  }, [owner, actor.actorId, actor.phase, active, signingOut]);

  const rows = view && view.owner === owner && view.current() && eligible ? view.data : null;
  const visibleReceipt = receipt?.current() && eligible ? receipt : null;
  const confirmedRemoved = (data: OwnAccountContent, kind: OwnContentKind, id: string) => {
    if (kind === "peerSpaceControls") return !data.peerSpaceControls.some((r) => r.id === id);
    const row = data[kind].find((r) => r.id === id);
    // Missing soft-deleted content is not treated as proof that its body was erased.
    return Boolean(row && (kind === "peerSpaceMessages"
      ? row.moderation_status === "deleted" || ("deleted_at" in row && Boolean(row.deleted_at))
      : row.moderation_status === "removed"));
  };

  async function read() {
    if (!eligible || busy.current) return;
    const validActor = actor.trackRequest();
    const revision = ++epoch.current;
    const current = () => mounted.current && validActor() && actor.isSameActor(owner) && live.current.owner === owner && live.current.eligible && revision === epoch.current;
    busy.current = true; setWorking(true); setView(null); setPending(null); setReadFailed(false);
    try {
      const data = await readOwnAccountContent(owner, current);
      if (!current()) return;
      setView({ owner, current, data }); setShown(20);
      setReceipt((r) => {
        if (!r?.current()) return null;
        return { ...r, latestRead: confirmedRemoved(data, r.kind, r.id) ? "verified" : "unconfirmed" };
      });
    } catch {
      if (current()) {
        setReadFailed(true);
        setReceipt((r) => r?.current() ? { ...r, latestRead: "readFailed" } : null);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setWorking(false);
    }
  }

  async function remove() {
    if (!pending || !rows || busy.current || !eligible || !view?.current() || !pending.current()) return;
    const { kind, id } = pending;
    setPending(null);
    const validActor = actor.trackRequest();
    const revision = ++epoch.current;
    const current = () => mounted.current && validActor() && actor.isSameActor(owner) && live.current.owner === owner && live.current.eligible && revision === epoch.current;
    busy.current = true; writing.current = true; setWorking(true); setView(null); setReadFailed(false);
    setReceipt({ kind, id, current: validActor, deleteOutcome: "unknown", latestRead: "notChecked" });
    try {
      const outcome = await deleteOwnAccountContent(kind, id, owner, locale, current);
      if (current()) setReceipt({ kind, id, current: validActor, deleteOutcome: outcome, latestRead: "notChecked" });
    } catch (error) {
      if (current()) setReceipt({ kind, id, current: validActor,
        deleteOutcome: error instanceof OwnContentRequestError ? error.outcome : "unknown", latestRead: "notChecked" });
    } finally {
      busy.current = false; writing.current = false;
      if (mounted.current) setWorking(false);
    }
    // Every outcome requires a new, user-triggered GET before another DELETE.
  }

  if (!active) return null;
  const groups = rows ? [
    { kind: "communityPosts" as const, items: rows.communityPosts.map((r) => ({ ...r, text: `${r.title}\n${r.body}`, removed: r.moderation_status === "removed" })) },
    { kind: "communityComments" as const, items: rows.communityComments.map((r) => ({ ...r, text: r.body, removed: r.moderation_status === "removed" })) },
    { kind: "peerSpaceMessages" as const, items: rows.peerSpaceMessages.map((r) => ({ ...r, text: r.body, removed: r.moderation_status === "deleted" || Boolean(r.deleted_at) })) },
    { kind: "peerSpaceControls" as const, items: rows.peerSpaceControls.map((r) => ({ ...r,
      text: `${t(r.control_type === "block" ? "account.ownContent.block" : "account.ownContent.mute")} · ${r.room_id}`, removed: false })) },
  ] : [];
  return <section className="mt-6 max-w-2xl rounded-2xl border border-sage/20 bg-mint/35 p-5" aria-label={t("account.ownContent.title")}>
    <h3 className="font-bold text-ink">{t("account.ownContent.title")}</h3>
    <p className="mt-2 text-sm leading-7 text-muted">{t("account.ownContent.description")}</p>
    <p className="mt-2 text-sm leading-7 text-muted">{t("account.ownContent.retained")}</p>
    <button type="button" className="button-secondary mt-4 w-full whitespace-normal sm:w-auto" onClick={read} disabled={!eligible || working}>
      {t(working ? "account.actions.processing" : "account.ownContent.read")}
    </button>
    {readFailed ? <p role="alert" className="mt-3 text-sm">{t("account.ownContent.readFailed")}</p> : null}
    {visibleReceipt ? <div className="mt-3 break-words text-sm">
      <p role="status">{t("account.ownContent.operationResult")} · {t(`account.ownContent.${visibleReceipt.kind}`)} · {visibleReceipt.id}: {t(`account.ownContent.${visibleReceipt.deleteOutcome}`)}</p>
      <p role="status" className="mt-2">{t("account.ownContent.latestCheck")}: {t(`account.ownContent.${visibleReceipt.latestRead}`)}</p>
      {visibleReceipt.deleteOutcome === "confirmed" && visibleReceipt.latestRead === "unconfirmed"
        ? <p role="status" className="mt-2">{t("account.ownContent.snapshotDiff")}</p> : null}
    </div> : null}
    {pending && rows && pending.current() ? <div role="group" aria-label={t("account.ownContent.confirmAction")} className="mt-4 rounded-xl border border-sage/30 bg-white p-4">
      <p className="break-words text-sm">{t(pending.kind === "peerSpaceControls" ? "account.ownContent.confirmControl" : "account.ownContent.confirmContent")} · {pending.id}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className="button-secondary" disabled={working || !eligible} onClick={remove}>{t("account.ownContent.confirmAction")}</button>
        <button type="button" className="button-secondary" onClick={() => setPending(null)}>{t("account.ownContent.cancel")}</button>
      </div>
    </div> : null}
    {groups.map(({ kind, items }) => <div key={kind} className="mt-5">
      <h4 className="font-bold">{t(`account.ownContent.${kind}`)} ({items.length})</h4>
      {kind === "peerSpaceControls" ? <p className="mt-2 text-sm text-muted">{t("account.ownContent.controlsDescription")}</p> : null}
      {!items.length ? <p className="mt-2 text-sm text-muted">{t("account.ownContent.empty")}</p> : null}
      <ul className="mt-3 grid min-w-0 gap-3">{items.slice(0, shown).map((item) => <li key={item.id} className="min-w-0 rounded-xl bg-white p-4">
        <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{item.text}</p>
        <p className="mt-2 break-words text-xs text-muted">{formatDate(item.created_at, locale)} · {item.id}</p>
        {item.removed ? <p className="mt-2 text-sm">{t("account.ownContent.removed")}</p> :
          <button type="button" className="button-secondary mt-3" disabled={working || !eligible || Boolean(pending)} onClick={() => { if (view?.current()) setPending({ kind, id: item.id, current: view.current }); }}>
            {t(kind === "peerSpaceControls" ? "account.ownContent.removeControl" : "account.ownContent.removeContent")}
          </button>}
      </li>)}</ul>
      {items.length > shown ? <button type="button" className="button-secondary mt-3" onClick={() => setShown((n) => n + 20)}>{t("account.ownContent.more")}</button> : null}
    </div>)}
  </section>;
}

export default function AccountPage() {
  const router = useRouter();
  const actor = useSessionActor();
  const [continueAfterAuth, setContinueAfterAuth] = useState(false);
  const [supportApproved, setSupportApproved] = useState(false);
  const [supportCheckedFor, setSupportCheckedFor] = useState<string | null>(null);
  const { locale, t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [accountActorRevision, setAccountActorRevision] = useState(-1);
  const [records, setRecordsState] = useState<CloudSweetRecord[]>([]);
  const [wechatIdentities, setWechatIdentities] = useState<WechatIdentity[]>([]);
  const [wechatBindSession, setWechatBindSession] = useState<WechatBindSession | null>(null);
  const [wechatStatus, setWechatStatus] = useState("");
  const [wechatLoading, setWechatLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpEntryOpen, setOtpEntryOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRequestInFlight = useRef(false);
  const signOutInFlight = useRef(false);
  const accountUserId = useRef<string | null>(null);
  const accountRead = useRef(0);
  const exportEpoch = useRef(0);
  const exportInFlight = useRef(false);
  const authRevision = useRef(0);
  const latestActorId = useRef(actor.actorId);
  useLayoutEffect(() => { latestActorId.current = actor.actorId; }, [actor.actorId]);
  const navigationAttempt = useRef<string | null>(null);
  const [name, setName] = useState("");
  const [accountTab, setAccountTab] = useState<"profile" | "wechat" | "data">("profile");
  const [accountActionLoading, setAccountActionLoading] = useState(false);
  const [deletionEmail, setDeletionEmail] = useState("");
  const [deletionAcknowledged, setDeletionAcknowledged] = useState(false);
  const [deletionReceipts, setDeletionReceipts] = useState<AccountDeletionReceipt[]>([]);
  const [deletionReceiptStates, setDeletionReceiptStates] = useState<Record<string, AccountDeletionState>>({});
  const [receiptChecking, setReceiptChecking] = useState<Record<string, boolean>>({});
  const [receiptErrors, setReceiptErrors] = useState<Record<string, boolean>>({});
  const receiptViewMounted = useRef(false);
  const receiptChecksInFlight = useRef(new Set<string>());
  const deletionInFlight = useRef(false);
  const deletionContinuation = useRef<DeletionContinuation | null>(null);
  const continuationSequence = useRef(0);
  const [continuationRevision, setContinuationRevision] = useState(0);
  const [deletionContinuationView, setDeletionContinuationView] = useState<DeletionContinuationView | null>(null);
  const accountSettings = useRef<HTMLDetailsElement>(null);
  const deletionEmailInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [identityChecking, setIdentityChecking] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [consentStatus, setConsentStatus] = useState<StudentConsentResponse | null>(null);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentLoadFailed, setConsentLoadFailed] = useState(false);
  const [ageBand, setAgeBand] = useState<"under_14" | "14_17" | "18_plus">("14_17");
  const [consentRead, setConsentRead] = useState(false);
  const consentGeneration = useRef(0);
  const consentFingerprint = useRef("");
  const writeAttemptsRef = useRef(new Map<string, AccountWriteAttempt>());
  const [writeAttempts, setWriteAttempts] = useState<AccountWriteView[]>([]);
  const writeSequence = useRef(0);
  const [writeGeneration, setWriteGeneration] = useState(0);
  const consentAttemptRef = useRef<AccountWriteAttempt | null>(null);
  const recordTargets = useRef(new Map<string, string>());
  const recordGenerations = useRef(new Map<string, number>());
  const [recordVersionView, setRecordVersionView] = useState<Record<string, number>>({});
  const nameEdits = useRef(0);
  const writeNotice = useRef("");
  const writeError = useRef("");
  const writeNoticeOwner = useRef<AccountWriteAttempt | null>(null);
  const writeErrorOwner = useRef<AccountWriteAttempt | null>(null);
  const writeViewConsent = writeGeneration;

  const isIdentityLoading = Boolean(user && (identityChecking || actor.phase !== "ready" || user.id !== actor.actorId || accountActorRevision !== actor.revision));
  const displayRole = isIdentityLoading ? "正在确认" : accountStatus?.displayRole || profileRoleLabel(profile?.role);
  const adminAccess = accountStatus?.adminAccess || null;
  const hasSchool = Boolean(accountStatus?.hasSchool || profile?.school_id);
  const isManagedSchoolRole = !isIdentityLoading && (displayRole === "学校负责人" || displayRole === "支持老师" || displayRole === "平台管理员");
  const isSchoolAssignedStudent = !isIdentityLoading && displayRole === "学生" && hasSchool;
  const isSchoolAssignedParent = !isIdentityLoading && displayRole === "家长" && hasSchool;
  const isProfessional = !isIdentityLoading && displayRole === "专业支持者";
  const isExternallyManagedRole = isManagedSchoolRole || isSchoolAssignedStudent || isSchoolAssignedParent || isProfessional;
  const needsPersonalProfile = Boolean(
    user && !isIdentityLoading && !isExternallyManagedRole && (!profile || !profile.display_name?.trim()),
  );
  const confirmedRoleLabel = isSchoolAssignedStudent
    ? "学校学生"
    : isSchoolAssignedParent
      ? "学校家长"
      : displayRole;
  const accountName = profile?.display_name?.trim() || user?.email || t("account.hero.accountFallback");
  const isInitialAccountLoad = (loading && !user) || actor.phase === "loading"
    || (actor.phase === "ready" && Boolean(user && (user.id !== actor.actorId || accountActorRevision !== actor.revision)));
  const isPlatformAdmin = displayRole === "平台管理员";
  const studentAgeBand = consentStatus?.role === "student"
    ? consentStatus.consent?.ageBand || null
    : accountStatus?.studentAgeBand || null;
  const showStudentAgeGuidance = displayRole === "学生" && ["14_17", "18_plus"].includes(studentAgeBand || "");
  const isAdultStudent = studentAgeBand === "18_plus";
  const visibleAccountRecords = displayRole === "家长" && !CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED
    ? []
    : isPlatformAdmin && user
      ? records.filter((record) => record.user_id === user.id)
      : records;
  const recentRecordDays = countRecentRecordDays(visibleAccountRecords, user?.id);
  const isSchoolLead = displayRole === "学校负责人";
  const isSupportTeacher = displayRole === "支持老师";
  const isParent = displayRole === "家长";
  const canShowSupportApplication = isProfessional || (displayRole === "学生" && studentAgeBand === "18_plus"
    && consentStatus?.role === "student" && consentStatus.consent?.status === "active");
  const linkedChildren = accountStatus?.linkedChildren || [];
  const assignedStudents = accountStatus?.assignedStudents || [];
  const relatedPeople = isParent ? linkedChildren : isSupportTeacher ? assignedStudents : [];
  const linkedChildById = new Map(linkedChildren.map((child) => [child.id, child]));
  // Presentation only. The event handler still checks the live continuation ref.
  const deletionReceiptBlocksSubmit = deletionReceipts.some(receipt => receipt.subjectUserId === user?.id && (
    !deletionContinuationView || deletionContinuationView.operationId !== receipt.operationId
    || deletionContinuationView.subjectUserId !== receipt.subjectUserId
    || deletionContinuationView.revision !== continuationRevision
    || deletionContinuationView.actorRevision !== actor.revision
    || actor.phase !== "ready" || actor.actorId !== receipt.subjectUserId
  ));
  const latestWriteAccess = useRef({ profile: false, assent: false, withdraw: false });
  useLayoutEffect(() => { latestWriteAccess.current = {
    profile: Boolean(user && !isIdentityLoading && !isExternallyManagedRole),
    assent: displayRole === "学生" && !needsPersonalProfile && consentStatus?.role === "student"
      && Boolean(consentStatus.consent && !["active", "pending_guardian"].includes(consentStatus.consent.status)),
    withdraw: !needsPersonalProfile && consentStatus?.role === "student"
      && Boolean(consentStatus.consent && ["active", "pending_guardian"].includes(consentStatus.consent.status)),
  }; }, [user, isIdentityLoading, isExternallyManagedRole, displayRole, needsPersonalProfile, consentStatus]);
  const accountError = (error: unknown, fallbackKey: TranslationKey) => {
    if (fallbackKey === "account.errors.recordDeleteFailed" && error instanceof SweetPersistenceError) {
      if (error.code === "denied") return t("account.errors.recordDeleteDenied");
      if (error.code === "conflict" || error.code === "scope_expired") return t("account.errors.recordDeleteChanged");
      if (error.code === "invalid_request" || error.code === "write_rejected") return t("account.errors.recordDeleteRejected");
      if (error.code === "not_found") return t("account.errors.recordDeleteMissing");
    }
    return localizedCloudErrorMessage(error, locale, t(fallbackKey));
  };

  function publishWrites() {
    setWriteAttempts([...writeAttemptsRef.current.values()].map(attempt => ({
      id: attempt.id, kind: attempt.kind, slot: attempt.slot, owner: attempt.owner, target: attempt.target,
      day: attempt.day, actorRevision: attempt.actorRevision, generation: attempt.generation,
      phase: attempt.phase, checking: attempt.checking, checked: attempt.checked, checkFailed: attempt.checkFailed,
    })));
  }
  function showWriteNotice(key: TranslationKey, attempt: AccountWriteAttempt) { writeNoticeOwner.current = attempt; writeNotice.current = t(key); setNotice(writeNotice.current); }
  function showWriteError(key: TranslationKey, attempt: AccountWriteAttempt) { writeErrorOwner.current = attempt; writeError.current = t(key); setError(writeError.current); }
  function retireAccountWrites() {
    writeAttemptsRef.current.clear();
    consentAttemptRef.current = null;
    setConsentLoading(false);
    const oldNotice = writeNotice.current, oldError = writeError.current;
    setNotice(value => value === oldNotice ? "" : value); setError(value => value === oldError ? "" : value);
    writeNotice.current = ""; writeError.current = "";
    writeNoticeOwner.current = null; writeErrorOwner.current = null;
    setWriteGeneration(consentGeneration.current);
    publishWrites();
  }
  function setRecords(next: CloudSweetRecord[]) {
    let targetChanged = false;
    for (const record of next) {
      const day = sweetStoredDay(record.created_at);
      if (!day) continue;
      const previous = recordTargets.current.get(day);
      if (previous && previous !== record.id) {
        targetChanged = true;
        recordGenerations.current.set(day, (recordGenerations.current.get(day) || 0) + 1);
        writeAttemptsRef.current.delete(`sweet:${day}`);
        if (writeNoticeOwner.current?.kind === "sweet" && writeNoticeOwner.current.day === day) {
          const value = writeNotice.current; setNotice(current => current === value ? "" : current);
          writeNotice.current = ""; writeNoticeOwner.current = null;
        }
        if (writeErrorOwner.current?.kind === "sweet" && writeErrorOwner.current.day === day) {
          const value = writeError.current; setError(current => current === value ? "" : current);
          writeError.current = ""; writeErrorOwner.current = null;
        }
        publishWrites();
      }
      recordTargets.current.set(day, record.id);
    }
    if (targetChanged) setRecordVersionView(Object.fromEntries(recordGenerations.current));
    // Absence from one list does not settle a pending deletion.
    setRecordsState(next);
  }
  function writeSlot(kind: AccountWriteKind, target: string, day?: string) {
    return kind === "profile" ? `profile:${target}` : kind === "sweet" ? `sweet:${day || target}` : `consent:${target}`;
  }
  function writeLockedNow(kind: AccountWriteKind, target: string, day?: string) {
    const previous = writeAttemptsRef.current.get(writeSlot(kind, target, day));
    return Boolean(previous?.current() && !(kind === "withdraw" && previous.kind !== "withdraw" && previous.phase === "unknown"));
  }
  const visibleWriteAttempts = writeAttempts.filter(attempt => attempt.owner === actor.actorId
    && attempt.actorRevision === actor.revision && attempt.generation === writeGeneration);
  function writeLocked(kind: AccountWriteKind, target: string, day?: string) {
    const previous = visibleWriteAttempts.find(attempt => attempt.slot === writeSlot(kind, target, day));
    return Boolean(previous && !(kind === "withdraw" && previous.kind !== "withdraw" && previous.phase === "unknown"));
  }
  function beginAccountWrite(kind: AccountWriteKind, target: string, day?: string) {
    const scope = accountRequest();
    if (!scope.owner || !scope.current() || !actor.isCurrentRevision(actor.revision) || writeViewConsent !== consentGeneration.current
      || signingOut || signOutInFlight.current) return null;
    if (kind === "profile" && !latestWriteAccess.current.profile) return null;
    if (kind === "assent" && !latestWriteAccess.current.assent) return null;
    if (kind === "withdraw" && target === scope.owner && !latestWriteAccess.current.withdraw) return null;
    if ((kind === "guardian" || (kind === "withdraw" && target !== scope.owner)) && !CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED) return null;
    if (kind === "sweet" && day && (recordTargets.current.get(day) !== target
      || (recordVersionView[day] || 0) !== (recordGenerations.current.get(day) || 0))) return null;
    if (writeLockedNow(kind, target, day)) return null;
    const slot = writeSlot(kind, target, day);
    const generation = consentGeneration.current;
    const recordGeneration = day ? recordGenerations.current.get(day) || 0 : 0;
    const attempt: AccountWriteAttempt = {
      id: ++writeSequence.current,
      kind, slot, owner: scope.owner, target, day, phase: "pending", checking: false, checked: false, checkFailed: false,
      actorRevision: actor.revision, generation,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      current: () => scope.current() && generation === consentGeneration.current
        && writeAttemptsRef.current.get(slot) === attempt
        && (!day || recordGeneration === (recordGenerations.current.get(day) || 0)),
    };
    writeAttemptsRef.current.set(slot, attempt); // Synchronous barrier, including queued React callbacks.
    if (!["profile", "sweet"].includes(kind)) { consentAttemptRef.current = attempt; setConsentLoading(true); }
    publishWrites();
    return attempt;
  }
  function finishAccountWrite(attempt: AccountWriteAttempt) {
    if (writeAttemptsRef.current.get(attempt.slot) === attempt) {
      writeAttemptsRef.current.delete(attempt.slot);
      publishWrites();
    }
    if (consentAttemptRef.current === attempt) { consentAttemptRef.current = null; setConsentLoading(false); }
  }
  function accountWriteFailed(attempt: AccountWriteAttempt, failure: unknown, fallback: TranslationKey) {
    if (!attempt.current()) return;
    if (failure instanceof AccountWriteError && failure.outcome === "unknown") {
      attempt.phase = "unknown";
      attempt.checked = false;
      showWriteError(fallback, attempt);
      publishWrites();
    } else {
      finishAccountWrite(attempt);
      const reason = failure instanceof AccountWriteError ? failure.reason : "identity";
      const key: TranslationKey = attempt.kind === "sweet" && reason !== "identity" && reason !== "service"
        ? reason === "permission" ? "account.errors.recordDeleteDenied"
          : reason === "scope" ? "account.errors.recordDeleteChanged"
            : reason === "not_found" ? "account.errors.recordDeleteMissing" : "account.errors.recordDeleteRejected"
        : reason === "identity" ? "account.writeRecovery.errors.identity"
          : reason === "permission" ? "account.writeRecovery.errors.permission"
            : reason === "input" ? "account.writeRecovery.errors.input"
              : reason === "not_found" ? "account.writeRecovery.errors.notFound"
                : reason === "scope" ? "account.writeRecovery.errors.scope"
                  : failure instanceof AccountWriteError && failure.outcome === "rejected"
                    ? "account.writeRecovery.errors.serviceRejected" : "account.writeRecovery.errors.notDispatched";
      showWriteError(key, attempt);
    }
  }

  async function checkAccountWrite(view: AccountWriteView) {
    const attempt = writeAttemptsRef.current.get(view.slot);
    if (!attempt || attempt.id !== view.id || !attempt.current() || attempt.phase !== "unknown" || attempt.checking) return;
    attempt.checking = true; attempt.checked = false; attempt.checkFailed = false; publishWrites();
    try {
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      const currentUser = await getCurrentUser();
      if (!attempt.current()) return;
      if (currentUser?.id !== attempt.owner) throw new Error("account_read_unverified");
      const [status, consent, content] = await Promise.all([
        getAccountStatus(attempt.owner),
        withTimeout(getStudentConsentStatus(attempt.owner), 8_000, "account_read_unverified"),
        attempt.kind === "profile" ? getProfile(currentUser)
          : attempt.kind === "sweet" ? Promise.all([listCloudSweetRecords(attempt.owner), readCloudSweetScope(attempt.owner, attempt.day, attempt.current)])
            : Promise.resolve(null),
      ]);
      if (!attempt.current()) return;
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      if (!status || status.profile?.id !== attempt.owner || !isAccountConsentSnapshot(consent, attempt.owner)) throw new Error("account_read_unverified");
      if (attempt.kind === "profile" && (!content || Array.isArray(content) || content.id !== attempt.owner)) throw new Error("account_read_unverified");
      setAccountStatus(status);
      if (attempt.kind === "profile") setProfile(content as CloudProfile); // Never replace the current input.
      if (attempt.kind === "sweet") setRecords((content as [CloudSweetRecord[], unknown])[0]);
      applyConsentStatus(consent, true);
      if (!attempt.current()) return; // A changed consent or target retires this generation, never proves its result.
      attempt.checked = true;
    } catch {
      if (attempt.current()) attempt.checkFailed = true;
    } finally {
      if (attempt.current()) { attempt.checking = false; publishWrites(); }
    }
  }
  function releaseAccountWrite(view: AccountWriteView) {
    const attempt = writeAttemptsRef.current.get(view.slot);
    if (!attempt || attempt.id !== view.id || !attempt.current() || attempt.phase !== "unknown" || !attempt.checked || attempt.checking) return;
    finishAccountWrite(attempt);
    if (attempt.kind === "assent") setConsentRead(false); // New submit must pass the existing acknowledgement again.
    if (writeErrorOwner.current === attempt) {
      const value = writeError.current; setError(current => current === value ? "" : current);
      writeError.current = ""; writeErrorOwner.current = null;
    }
    showWriteNotice("account.writeRecovery.released", attempt); // No write or old command is dispatched.
    const currentActor = actor.trackRequest(), generation = consentGeneration.current;
    window.requestAnimationFrame(() => {
      if (!currentActor() || generation !== consentGeneration.current) return;
      if (attempt.trigger?.isConnected) attempt.trigger.focus();
      else accountSettings.current?.querySelector("summary")?.focus();
    });
  }

  async function completeAccountConsentWrite(attempt: AccountWriteAttempt, status: StudentConsentResponse, notice: TranslationKey) {
    if (!attempt.current()) return;
    let recheckFailed = false;
    try { await confirmActor(attempt.owner); } catch { recheckFailed = true; }
    if (!attempt.current()) return;
    finishAccountWrite(attempt);
    applyConsentStatus(status);
    showWriteNotice(recheckFailed ? "account.writeRecovery.confirmedStateUnverified" : notice, attempt);
  }

  function revokeDeletionContinuation(operationId?: string) {
    if (operationId && deletionContinuation.current?.operationId !== operationId) return;
    deletionContinuation.current = null;
    setDeletionContinuationView(null);
    setContinuationRevision(++continuationSequence.current);
  }

  function canContinueDeletion(receipt: AccountDeletionReceipt) {
    const grant = deletionContinuation.current;
    return Boolean(grant && grant.operationId === receipt.operationId && grant.subjectUserId === receipt.subjectUserId
      && grant.revision === continuationRevision && grant.current());
  }

  function clearAccountView(preserveSignedOutNotice = false) {
    setAccountActorRevision(-1);
    ++consentGeneration.current;
    consentFingerprint.current = "";
    retireAccountWrites();
    recordTargets.current.clear(); recordGenerations.current.clear(); ++nameEdits.current;
    setRecordVersionView({});
    ++exportEpoch.current;
    exportInFlight.current = false;
    accountUserId.current = null;
    navigationAttempt.current = null;
    setUser(null); setProfile(null); setAccountStatus(null); setRecords([]);
    setWechatIdentities([]); setWechatBindSession(null); setWechatStatus(""); setWechatLoading(false);
    setName(""); setEmail(""); setOtp(""); setOtpEntryOpen(false); setAuthLoading(false);
    setConsentStatus(null); setConsentLoadFailed(false); setConsentLoading(false);
    setDeletionEmail(""); setDeletionAcknowledged(false); setAccountActionLoading(false);
    revokeDeletionContinuation();
    setSupportApproved(false); setSupportCheckedFor(null); setAccountTab("profile");
    setSigningOut(false);
    setNotice((current) => preserveSignedOutNotice && [t("account.notices.signedOut"),
      t("account.notices.accountDeleted"), t("account.notices.accountDeletedCleanupPending")].includes(current) ? current : "");
    setError("");
    resetConsentForm();
  }

  function accountRequest() {
    const owner = user?.id || "";
    const current = actor.trackRequest();
    return { owner, current: () => current() && actor.isSameActor(owner) };
  }

  async function confirmActor(owner: string) {
    try { await actor.getToken(owner); }
    catch (error) { void actor.refreshIdentity(); throw error; }
  }

  async function sessionIsSignedOut() {
    const supabase = getSupabase();
    if (!supabase) return false;
    const result = await withTimeout(supabase.auth.getSession(), 4_000, t("account.errors.serviceTimeout"));
    return !result.error && !result.data.session;
  }

  function resetConsentForm(nextAgeBand: typeof ageBand = "14_17") {
    setConsentRead(false);
    setAgeBand(nextAgeBand);
  }

  function applyConsentStatus(nextStatus: StudentConsentResponse, preserveForm = false) {
    if (!isAccountConsentSnapshot(nextStatus, accountUserId.current || actor.actorId)) {
      setConsentLoadFailed(true);
      return;
    }
    const fingerprint = accountConsentFingerprint(nextStatus);
    const changed = fingerprint !== consentFingerprint.current;
    if (changed) {
      consentFingerprint.current = fingerprint;
      ++consentGeneration.current;
      retireAccountWrites();
    }
    setConsentStatus(nextStatus);
    setConsentLoadFailed(false);
    if (!preserveForm) resetConsentForm(nextStatus.consent?.ageBand || "14_17");
    else if (changed) setConsentRead(false);
    if (nextStatus.role === "student") {
      // The returned age is a server-confirmed fact, not the form selection.
      setAccountStatus((current) => current ? {
        ...current,
        studentAgeBand: nextStatus.consent?.ageBand || null,
      } : current);
    }
  }

  async function refreshAccount(owner = actor.actorId) {
    const revision = ++accountRead.current;
    const identityRevision = actor.revision;
    const consentReadGeneration = consentGeneration.current;
    const currentActor = actor.trackRequest();
    const current = () => currentActor() && actor.isSameActor(owner) && revision === accountRead.current;
    if (!current()) return;
    setLoading(true);
    setIdentityChecking(true);
    setError("");
    setConsentLoadFailed(false);
    setNotice((currentNotice) => currentNotice || "");
    try {
      let currentUser: User | null = null;
      try {
        currentUser = await withTimeout(getCurrentUser(), 4_000, t("account.errors.serviceTimeout"));
        if (!current()) return;
        if (currentUser?.id !== owner) { clearAccountView(); void actor.refreshIdentity(); return; }
      } catch (authError) {
        if (!current()) return;
        reportClientOperationFailure("auth", "auth_session", authError);
        setUser(null);
        setProfile(null);
        setAccountStatus(null);
        setRecords([]);
        setWechatIdentities([]);
        setConsentStatus(null);
        accountUserId.current = null;
        resetConsentForm();
        setNotice(t("account.notices.sessionSlow"));
        return;
      }
      if ((currentUser?.id || null) !== accountUserId.current) {
        accountUserId.current = currentUser?.id || null;
        resetConsentForm();
      }
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setAccountStatus(null);
        setRecords([]);
        setWechatIdentities([]);
        setConsentStatus(null);
        return;
      }

      // Never render identity details from the previously signed-in account.
      setProfile(null);
      setAccountStatus(null);
      setRecords([]);
      setWechatIdentities([]);
      setConsentStatus(null);
      setAccountTab("profile");

      let nextAccountStatus: AccountStatus | null = null;
      let nextProfile: CloudProfile | null = null;
      let nonFatalNotice = "";
      let nextConsentLoadFailed = false;

      try {
        nextAccountStatus = await getAccountStatus(owner);
        nextProfile = nextAccountStatus.profile;
      } catch (statusError) {
        reportClientOperationFailure("auth", "account_status", statusError);
        nonFatalNotice = t("account.notices.identitySyncing");
      }
      if (!current()) return;

      if (!nextProfile) {
        try {
          nextProfile = await getProfile(currentUser);
        } catch (profileError) {
          reportClientOperationFailure("auth", "account_profile", profileError);
          nonFatalNotice = nonFatalNotice || t("account.notices.profileIncomplete");
        }
      }
      if (!current()) return;

      const [nextRecords, nextWechatIdentities, nextConsentStatus] = await Promise.all([
        listCloudSweetRecords(owner).catch((recordsError) => {
          reportClientOperationFailure("save", "account_records", recordsError);
          nonFatalNotice = nonFatalNotice || t("account.notices.recordsUnavailable");
          return [] as CloudSweetRecord[];
        }),
        listWechatIdentities(owner).catch((wechatError) => {
          reportClientOperationFailure("auth", "wechat_identities", wechatError);
          return [] as WechatIdentity[];
        }),
        withTimeout(getStudentConsentStatus(owner), 8_000, t("account.errors.serviceTimeout")).catch((consentError) => {
          reportClientOperationFailure("auth", "student_consent", consentError);
          nextConsentLoadFailed = true;
          return null;
        }),
      ]);

      if (!current()) return;
      await confirmActor(owner);
      if (!current()) return;

      setAccountStatus(nextAccountStatus);
      setAccountActorRevision(identityRevision);
      setProfile(nextProfile);
      setName(nextProfile?.display_name || "");
      setRecords(nextRecords);
      setWechatIdentities(nextWechatIdentities);
      if (consentReadGeneration === consentGeneration.current) {
        if (nextConsentStatus) applyConsentStatus(nextConsentStatus);
        setConsentLoadFailed(nextConsentLoadFailed);
      }
      if (nextAccountStatus?.inviteSyncError) {
        setNotice(t("account.notices.inviteSyncDelayed"));
      } else if (nonFatalNotice) {
        setNotice(nonFatalNotice);
      }
    } catch (loadError) {
      if (!current()) return;
      setError(accountError(loadError, "account.errors.loadFailed"));
    } finally {
      if (current()) { setLoading(false); setIdentityChecking(false); }
    }
  }

  async function handleRetryConsentStatus() {
    if (consentLoading || signingOut) return;
    const scope = accountRequest();
    const generation = consentGeneration.current;
    if (!scope.current()) return;
    setConsentLoading(true);
    try {
      const status = await withTimeout(getStudentConsentStatus(scope.owner), 8_000, t("account.errors.serviceTimeout"));
      await confirmActor(scope.owner);
      if (scope.current() && generation === consentGeneration.current) applyConsentStatus(status);
    } catch (consentError) {
      if (!scope.current() || generation !== consentGeneration.current) return;
      reportClientOperationFailure("auth", "student_consent", consentError);
      setConsentStatus(null);
      setConsentLoadFailed(true);
    } finally {
      if (scope.current() && generation === consentGeneration.current) setConsentLoading(false);
    }
  }

  useEffect(() => {
    async function loadAccount() {
      try {
        const handledRedirect = await withTimeout(handleAuthRedirect(), 8_000, t("account.errors.serviceTimeout"));
        if (handledRedirect) setNotice(t("account.notices.signedInAccount"));
      } catch (redirectError) {
        reportClientOperationFailure("auth", "auth_redirect", redirectError);
        setError(accountError(redirectError, "account.errors.redirectFailed"));
      } finally {
        await actor.refreshIdentity();
      }
    }

    loadAccount();
  }, []);

  useEffect(() => {
    ++accountRead.current;
    ++authRevision.current;
    if (accountUserId.current && accountUserId.current !== actor.actorId) setContinueAfterAuth(false);
    clearAccountView(actor.phase === "signed_out");
    setLoading(actor.phase === "loading" || actor.phase === "ready");
    setIdentityChecking(actor.phase === "loading" || actor.phase === "ready");
    if (actor.phase === "ready") void refreshAccount(actor.actorId);
    else if (actor.phase === "error") setNotice(t("account.notices.sessionSlow"));
  }, [actor.actorId, actor.phase, actor.revision]);

  const onWriteConsentUpdated = useEffectEvent(() => {
      const owner = actor.actorId;
      const currentActor = actor.trackRequest();
      ++consentGeneration.current;
      consentFingerprint.current = "";
      retireAccountWrites();
      setConsentRead(false); setConsentStatus(null); setConsentLoadFailed(true);
      const generation = consentGeneration.current;
      const current = () => currentActor() && actor.isSameActor(owner) && generation === consentGeneration.current;
      if (!current()) return;
      void withTimeout(getStudentConsentStatus(owner), 8_000, "account_read_unverified")
        .then(async status => {
          if (!current()) return;
          await actor.getToken(owner);
          if (current()) applyConsentStatus(status, true);
        }).catch(() => { if (current()) setConsentLoadFailed(true); });
  });
  useEffect(() => {
    const updated = () => onWriteConsentUpdated();
    window.addEventListener("youthtempo:consent-updated", updated);
    return () => window.removeEventListener("youthtempo:consent-updated", updated);
  }, []);

  useEffect(() => {
    if (!wechatBindSession) return;
    const scope = accountRequest();

    const interval = window.setInterval(async () => {
      try {
        const result = await checkWechatBindSession(wechatBindSession.scene, scope.owner);
        if (!scope.current()) return;
        if (result.bound) {
          window.clearInterval(interval);
          setWechatStatus(t("account.notices.wechatBound"));
          setWechatBindSession(null);
          await refreshAccount(scope.owner);
        } else if (result.status === "expired") {
          window.clearInterval(interval);
          setWechatStatus(t("account.errors.wechatQrExpired"));
          setWechatBindSession(null);
        }
      } catch (bindError) {
        if (!scope.current()) return;
        window.clearInterval(interval);
        setWechatStatus(accountError(bindError, "account.errors.wechatStatusFailed"));
        setWechatBindSession(null);
      }
    }, 2200);

    return () => window.clearInterval(interval);
  }, [wechatBindSession]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    setNotice("");
    setError("");
    setWechatStatus("");
  }, [locale]);

  useEffect(() => {
    receiptViewMounted.current = true;
    const reload = () => setDeletionReceipts(listAccountDeletionReceipts());
    reload();
    window.addEventListener(accountDeletionReceiptChanged, reload);
    const timer = window.setInterval(reload, 60_000);
    return () => {
      receiptViewMounted.current = false;
      window.removeEventListener(accountDeletionReceiptChanged, reload);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const grant = deletionContinuation.current;
    if (grant && grant.revision === continuationRevision && grant.current()) {
      deletionEmailInput.current?.focus();
    }
  }, [continuationRevision]);

  useEffect(() => {
    setSupportApproved(false);
    setSupportCheckedFor(null);
    if (!user || !canShowSupportApplication) return;
    let active = true;
    withTimeout(peerSpaceRequest<{ application: { status: string } | null }>("/api/support/staff", locale, "GET", undefined, user.id), 8_000, "")
      .then((result) => { if (active) setSupportApproved(result.application?.status === "approved"); })
      .catch(() => { if (active) setSupportApproved(false); })
      .finally(() => { if (active) setSupportCheckedFor(user.id); });
    return () => { active = false; };
  }, [user?.id, canShowSupportApplication, locale]);

  useEffect(() => {
    if (!router.isReady || loading || identityChecking || needsPersonalProfile || !user || !accountStatus?.displayRole) return;
    const requested = navigationTargetForRole(router.query.next, { role: accountStatus.displayRole, ageBand: studentAgeBand });
    if (!requested && (!continueAfterAuth || (isProfessional && supportCheckedFor !== user.id))) return;
    const destination = requested || (isProfessional && supportApproved ? "/support/workbench" : defaultAccountDestination(accountStatus.displayRole));
    if (!destination) return;
    const attempt = `${user.id}:${router.asPath}:${destination}`;
    if (navigationAttempt.current === attempt) return;
    navigationAttempt.current = attempt;
    setContinueAfterAuth(false);
    void router.replace(destination).then((completed) => {
      if (!completed && navigationAttempt.current === attempt) navigationAttempt.current = null;
    }).catch(() => {
      if (navigationAttempt.current !== attempt) return;
      navigationAttempt.current = null;
      setError(t("account.errors.redirectFailed"));
    });
  }, [router, loading, identityChecking, needsPersonalProfile, user, accountStatus, studentAgeBand, continueAfterAuth, isProfessional, supportApproved, supportCheckedFor, t]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otpRequestInFlight.current || resendCooldown > 0) return;
    otpRequestInFlight.current = true;
    setNotice("");
    setError("");
    setAuthLoading(true);
    setResendCooldown(60);
    const revision = authRevision.current;
    try {
      await sendEmailOtp(email.trim());
      if (revision !== authRevision.current) return;
      setOtpEntryOpen(true);
      setNotice(t("account.notices.otpSent"));
    } catch (loginError) {
      if (revision !== authRevision.current) return;
      reportClientOperationFailure("auth", "auth_otp_send", loginError);
      setError(otpRequestErrorMessage(loginError, {
        unauthorized: t("account.errors.otpUnauthorized"),
        rateLimited: t("account.errors.otpRateLimited"),
        network: t("account.errors.otpSendNetwork"),
        service: t("account.errors.otpServiceUnavailable"),
        fallback: t("account.errors.otpSendFailed"),
      }));
    } finally {
      otpRequestInFlight.current = false;
      if (revision === authRevision.current) setAuthLoading(false);
    }
  }

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otpRequestInFlight.current) return;
    setNotice("");
    setError("");
    if (otp.trim().length !== emailOtpLength) {
      setError(t("account.errors.otpIncomplete", { count: emailOtpLength }));
      return;
    }
    const revision = authRevision.current;
    otpRequestInFlight.current = true;
    setAuthLoading(true);
    try {
      const signedInUser = await verifyEmailOtp(email.trim(), otp);
      await actor.refreshIdentity();
      if (!signedInUser || !actor.isSameActor(signedInUser.id)) return;
      setContinueAfterAuth(true);
      setOtp("");
      setOtpEntryOpen(false);
      setNotice(t("account.notices.signedIn"));
      await refreshAccount(signedInUser.id);
    } catch (loginError) {
      if (revision !== authRevision.current) return;
      reportClientOperationFailure("auth", "auth_otp_verify", loginError);
      setError(otpVerificationErrorMessage(loginError, {
        invalid: t("account.errors.otpInvalid"),
        rateLimited: t("account.errors.otpVerifyRateLimited"),
        network: t("account.errors.otpVerifyNetwork"),
        service: t("account.errors.otpServiceUnavailable"),
        fallback: t("account.errors.otpVerifyFailed"),
      }));
    } finally {
      otpRequestInFlight.current = false;
      if (revision === authRevision.current) setAuthLoading(false);
    }
  }

  async function resendOtp() {
    if (otpRequestInFlight.current || resendCooldown > 0) return;
    otpRequestInFlight.current = true;
    setNotice("");
    setError("");
    setAuthLoading(true);
    setResendCooldown(60);
    const revision = authRevision.current;
    try {
      await sendEmailOtp(email.trim());
      if (revision !== authRevision.current) return;
      setOtp("");
      setNotice(t("account.notices.otpResent"));
    } catch (loginError) {
      if (revision !== authRevision.current) return;
      reportClientOperationFailure("auth", "auth_otp_send", loginError);
      setError(otpRequestErrorMessage(loginError, {
        unauthorized: t("account.errors.otpUnauthorized"),
        rateLimited: t("account.errors.otpRateLimited"),
        network: t("account.errors.otpSendNetwork"),
        service: t("account.errors.otpServiceUnavailable"),
        fallback: t("account.errors.otpSendFailed"),
      }));
    } finally {
      otpRequestInFlight.current = false;
      if (revision === authRevision.current) setAuthLoading(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || isExternallyManagedRole) return;
    if (!name.trim()) {
      setError(t("account.errors.nameRequired"));
      return;
    }
    const attempt = beginAccountWrite("profile", user.id);
    if (!attempt) return;
    const submittedRevision = nameEdits.current;
    let confirmed = false;
    const savedNotice = (): TranslationKey => nameEdits.current === submittedRevision ? "account.notices.profileSaved" : "account.writeRecovery.profileSavedDraftKept";
    setNotice(""); setError("");
    try {
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      const saved = await saveProfile(user, name.trim(), { current: attempt.current });
      if (!attempt.current()) return;
      confirmed = true;
      setProfile(saved); showWriteNotice(savedNotice(), attempt);
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      const status = await getAccountStatus(attempt.owner);
      if (!attempt.current()) return;
      if (status.profile?.id !== attempt.owner) throw new Error("profile_read_unverified");
      setAccountStatus(status);
      showWriteNotice(savedNotice(), attempt); // A later edit is never called saved or overwritten by this read.
    } catch (profileError) {
      if (!attempt.current()) return;
      if (confirmed) { showWriteNotice(savedNotice(), attempt); showWriteError("account.writeRecovery.profileRefreshFailed", attempt); }
      else accountWriteFailed(attempt, profileError, "account.errors.profileSaveFailed");
    } finally {
      if (attempt.phase === "pending") finishAccountWrite(attempt);
    }
  }

  async function handleDeleteRecord(recordId: string) {
    const record = records.find(item => item.id === recordId);
    if (!record) return;
    const attempt = beginAccountWrite("sweet", recordId, sweetStoredDay(record.created_at) || undefined);
    if (!attempt) return;
    setNotice("");
    setError("");
    let deletionConfirmed = false;
    try {
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      await deleteCloudSweetRecord(recordId, attempt.owner, attempt.current, { current: attempt.current });
      if (!attempt.current()) return;
      deletionConfirmed = true;
      showWriteNotice("account.notices.recordDeleted", attempt);
      const nextRecords = await listCloudSweetRecords(attempt.owner);
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      setRecords(nextRecords);
      if (attempt.current()) showWriteNotice("account.notices.recordDeleted", attempt);
    } catch (deleteError) {
      if (!attempt.current()) return;
      if (deletionConfirmed) {
        showWriteNotice("account.notices.recordDeleted", attempt);
        showWriteError("account.errors.recordDeletedRefreshFailed", attempt);
      } else {
        accountWriteFailed(attempt, deleteError, "account.errors.recordDeleteFailed");
      }
    } finally {
      if (attempt.phase === "pending") finishAccountWrite(attempt);
    }
  }

  async function handleSignOut() {
    if (signOutInFlight.current || loading || consentLoading) return;
    const scope = accountRequest();
    if (!scope.current()) return;
    signOutInFlight.current = true;
    setSigningOut(true);
    setError("");
    setNotice("");
    try {
      await confirmActor(scope.owner);
      if (!scope.current()) return;
      await signOut(scope.owner);
      if (!await sessionIsSignedOut()) return;
      accountUserId.current = null;
      navigationAttempt.current = null;
      setUser(null);
      setProfile(null);
      setRecords([]);
      setName("");
      setEmail("");
      setOtp("");
      setOtpEntryOpen(false);
      setContinueAfterAuth(false);
      setWechatIdentities([]);
      setWechatBindSession(null);
      setWechatStatus("");
      setAccountStatus(null);
      setConsentStatus(null);
      setConsentLoadFailed(false);
      setDeletionEmail("");
      setDeletionAcknowledged(false);
      resetConsentForm();
      setAccountTab("profile");
      setNotice(t("account.notices.signedOut"));
    } catch (error) {
      if (error instanceof SessionSignOutError && error.code === "session_changed") {
        await actor.refreshIdentity();
        return;
      }
      if (!scope.current()) return;
      setError(t("account.errors.signOutFailed"));
    } finally {
      signOutInFlight.current = false;
      if (!latestActorId.current || scope.current()) setSigningOut(false);
    }
  }

  useEffect(() => {
    // Retire a pending download when this view is re-entered or hidden. No automatic export or role write.
    const retireLifetime = () => { ++exportEpoch.current; exportInFlight.current = false; };
    const retireExport = () => {
      const wasExporting = exportInFlight.current;
      retireLifetime();
      if (wasExporting) setAccountActionLoading(false);
    };
    window.addEventListener("focus", retireExport);
    document.addEventListener("visibilitychange", retireExport);
    return () => {
      retireLifetime();
      window.removeEventListener("focus", retireExport);
      document.removeEventListener("visibilitychange", retireExport);
    };
  }, []);

  async function handleDataExport() {
    const accountScope = accountRequest();
    if (!accountScope.current() || accountActionLoading || exportInFlight.current) return;
    const revision = ++exportEpoch.current;
    const scope = { owner: accountScope.owner, current: () => accountScope.current() && revision === exportEpoch.current };
    exportInFlight.current = true;
    setAccountActionLoading(true);
    setError("");
    setNotice("");
    try {
      await confirmActor(scope.owner);
      if (!scope.current()) return;
      await downloadAccountDataExport(scope.owner, scope.current);
      if (!scope.current()) return;
      setNotice(t("account.notices.exportStarted"));
    } catch (exportError) {
      if (!scope.current()) return;
      setError(accountError(exportError, "account.errors.exportFailed"));
    } finally {
      if (revision === exportEpoch.current) exportInFlight.current = false;
      if (scope.current()) setAccountActionLoading(false);
    }
  }

  async function handleAccountDeletion() {
    if (deletionInFlight.current || accountActionLoading) return;
    if (!user?.email || !deletionAcknowledged || deletionEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      setError(t("account.errors.deletionConfirmationRequired"));
      return;
    }
    const scope = accountRequest();
    if (!scope.current()) return;
    let receipt = listAccountDeletionReceipts().find((value) => value.subjectUserId === scope.owner);
    const grant = deletionContinuation.current;
    if (!receipt && (grant?.subjectUserId === scope.owner || deletionReceipts.some((value) => value.subjectUserId === scope.owner))) {
      revokeDeletionContinuation();
      setError(t("account.deletionReceipt.unknown"));
      return;
    }
    if (receipt && (!canContinueDeletion(receipt)
      || ["completed", "deleted_cleanup_pending"].includes(deletionReceiptStates[receipt.operationId]))) {
      setError(t("account.deletionReceipt.unknown"));
      return;
    }
    deletionInFlight.current = true;
    setAccountActionLoading(true);
    setError("");
    setNotice("");
    try {
      await confirmActor(scope.owner);
      if (!scope.current()) return;
      // A status lookup or identity change while authentication was pending
      // revokes this one-use confirmation before any destructive request.
      if (receipt && (deletionContinuation.current !== grant || !grant?.current())) return;
      try { receipt = receipt || createAccountDeletionReceipt(scope.owner); }
      catch { setError(t("account.deletionReceipt.storageUnavailable")); return; }
      revokeDeletionContinuation(receipt.operationId);
      setDeletionReceiptStates((states) => ({ ...states, [receipt!.operationId]: "unknown" }));
      const result = await deleteAccountPermanently(deletionEmail, scope.owner, receipt);
      if (receiptViewMounted.current) {
        setDeletionReceiptStates((states) => ({ ...states, [receipt!.operationId]: deletionReceiptState(states[receipt!.operationId], result.cleanupPending ? "deleted_cleanup_pending" : "completed") }));
      }
      if (!scope.current()) return;
      await signOut(scope.owner).catch(() => undefined);
      if (!await sessionIsSignedOut()) return;
      setUser(null);
      setProfile(null);
      setAccountStatus(null);
      setRecords([]);
      setConsentStatus(null);
      setConsentLoadFailed(false);
      accountUserId.current = null;
      resetConsentForm();
      setDeletionEmail("");
      setDeletionAcknowledged(false);
      setNotice(result.cleanupPending
        ? t("account.notices.accountDeletedCleanupPending")
        : t("account.notices.accountDeleted"));
    } catch (deleteError) {
      if (!scope.current()) return;
      if (receipt && deleteError instanceof AccountDeletionError && deleteError.deletionState === "not_deleted") {
        setDeletionReceiptStates((states) => ({ ...states, [receipt!.operationId]: "not_deleted" }));
        setDeletionEmail("");
        setDeletionAcknowledged(false);
      }
      setError(deleteError instanceof AccountDeletionError
        ? t(deleteError.deletionState === "not_deleted" ? "account.deletionReceipt.notDeleted" : "account.deletionReceipt.unknown")
        : accountError(deleteError, "account.errors.accountDeleteFailed"));
    } finally {
      if (receipt) revokeDeletionContinuation(receipt.operationId);
      deletionInFlight.current = false;
      if (!latestActorId.current || scope.current()) setAccountActionLoading(false);
    }
  }

  function handleContinueDeletion(receipt: AccountDeletionReceipt) {
    const scope = accountRequest();
    if (!scope.current() || scope.owner !== receipt.subjectUserId || deletionInFlight.current || accountActionLoading
      || receiptChecksInFlight.current.has(receipt.operationId)
      || ["completed", "deleted_cleanup_pending"].includes(deletionReceiptStates[receipt.operationId])) return;
    // Continuing is a local preparation step, never a DELETE or a cancellation.
    // Prior email/acknowledgement cannot authorize a new request attempt.
    setDeletionEmail("");
    setDeletionAcknowledged(false);
    setError("");
    const revision = ++continuationSequence.current;
    deletionContinuation.current = { operationId: receipt.operationId, subjectUserId: scope.owner, revision, current: scope.current };
    setDeletionContinuationView({ operationId: receipt.operationId, subjectUserId: scope.owner, revision, actorRevision: actor.revision });
    setContinuationRevision(revision);
    setAccountTab("data");
    if (accountSettings.current) accountSettings.current.open = true;
  }

  async function handleCheckDeletion(receipt: AccountDeletionReceipt) {
    if (receiptChecksInFlight.current.has(receipt.operationId)) return;
    receiptChecksInFlight.current.add(receipt.operationId);
    revokeDeletionContinuation(receipt.operationId);
    const owner = actor.actorId;
    const sameActor = actor.trackRequest();
    setReceiptChecking((states) => ({ ...states, [receipt.operationId]: true }));
    setReceiptErrors((states) => ({ ...states, [receipt.operationId]: false }));
    try {
      const state = await checkAccountDeletionStatus(receipt);
      if (!receiptViewMounted.current) return;
      // This result describes the earlier operation only. It never signs out
      // or restores consent; B's form is isolated from A's reconfirmation.
      setDeletionReceiptStates((states) => ({ ...states, [receipt.operationId]: deletionReceiptState(states[receipt.operationId], state) }));
      if (state === "not_deleted" && owner === receipt.subjectUserId && sameActor()) {
        setDeletionEmail("");
        setDeletionAcknowledged(false);
      }
    } catch {
      if (receiptViewMounted.current) {
        setReceiptErrors((states) => ({ ...states, [receipt.operationId]: true }));
        setDeletionReceiptStates((states) => ({ ...states, [receipt.operationId]: deletionReceiptState(states[receipt.operationId], "unknown") }));
      }
    } finally {
      receiptChecksInFlight.current.delete(receipt.operationId);
      if (receiptViewMounted.current) setReceiptChecking((states) => ({ ...states, [receipt.operationId]: false }));
    }
  }

  async function handleStudentAssent() {
    if (consentLoading || !consentRead || signingOut) return;
    const attempt = beginAccountWrite("assent", user?.id || "");
    if (!attempt) return;
    setError(""); setNotice("");
    try {
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      const status = await submitStudentAssent(ageBand, attempt.owner, { current: attempt.current });
      const confirmedAgeBand = status.consent?.ageBand;
      await completeAccountConsentWrite(attempt, status, confirmedAgeBand === "under_14" ? "account.notices.under14Ineligible"
        : confirmedAgeBand === "18_plus" ? "account.notices.adultConsentComplete" : "account.notices.studentAssentRecorded");
    } catch (failure) {
      accountWriteFailed(attempt, failure, "account.errors.studentAssentFailed");
    } finally {
      if (attempt.phase === "pending") finishAccountWrite(attempt);
      if (consentAttemptRef.current === attempt) { consentAttemptRef.current = null; setConsentLoading(false); }
    }
  }

  async function handleGuardianConsent(studentUserId: string) {
    if (consentLoading || signingOut || !CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED) return;
    const attempt = beginAccountWrite("guardian", studentUserId);
    if (!attempt) return;
    setError(""); setNotice("");
    try {
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      const status = await submitGuardianConsent(studentUserId, attempt.owner, { current: attempt.current });
      await completeAccountConsentWrite(attempt, status, "account.notices.guardianConsentComplete");
    } catch (failure) {
      accountWriteFailed(attempt, failure, "account.errors.guardianConsentFailed");
    } finally {
      if (attempt.phase === "pending") finishAccountWrite(attempt);
      if (consentAttemptRef.current === attempt) { consentAttemptRef.current = null; setConsentLoading(false); }
    }
  }

  async function handleWithdrawConsent(studentUserId?: string) {
    if (consentLoading || signingOut) return;
    const attempt = beginAccountWrite("withdraw", studentUserId || user?.id || "");
    if (!attempt) return;
    setError(""); setNotice("");
    try {
      await confirmActor(attempt.owner);
      if (!attempt.current()) return;
      const status = await withdrawStudentConsent(studentUserId, attempt.owner, { current: attempt.current });
      await completeAccountConsentWrite(attempt, status, "account.notices.consentWithdrawn");
    } catch (failure) {
      accountWriteFailed(attempt, failure, "account.errors.consentWithdrawFailed");
    } finally {
      if (attempt.phase === "pending") finishAccountWrite(attempt);
      if (consentAttemptRef.current === attempt) { consentAttemptRef.current = null; setConsentLoading(false); }
    }
  }

  async function handleCreateWechatBindSession() {
    const scope = accountRequest();
    if (!scope.current()) return;
    setWechatLoading(true);
    setWechatStatus("");
    setError("");
    try {
      const bindSession = await createWechatBindSession(scope.owner);
      await confirmActor(scope.owner);
      if (!scope.current()) return;
      setWechatBindSession(bindSession);
      setWechatStatus(t("account.notices.scanWechatQr"));
    } catch (bindError) {
      if (!scope.current()) return;
      setWechatStatus(accountError(bindError, "account.errors.wechatQrFailed"));
    } finally {
      if (scope.current()) setWechatLoading(false);
    }
  }

  return (
    <>
      {deletionReceipts.length ? (
        <section className="section section-muted" aria-label={t("account.deletionReceipt.title")}>
          <div className="container grid max-w-3xl gap-4">
            {deletionReceipts.map((receipt) => {
              const state = deletionReceiptStates[receipt.operationId];
              return (
                <article key={receipt.operationId} className="rounded-2xl border border-sage/25 bg-white/90 p-5" data-deletion-receipt>
                  <h2 className="text-lg font-bold text-ink">{t("account.deletionReceipt.title")}</h2>
                  <p className="mt-2 text-sm leading-7 text-muted">{t("account.deletionReceipt.description")}</p>
                  {actor.actorId && actor.actorId !== receipt.subjectUserId ? <p className="mt-2 text-sm leading-7 text-muted">{t("account.deletionReceipt.differentAccount")}</p> : null}
                  <p className="mt-3 text-sm font-bold text-sage-dark" role="status">
                    {t(receiptErrors[receipt.operationId] ? "account.deletionReceipt.unavailable"
                      : state === "completed" ? "account.deletionReceipt.completed"
                        : state === "deleted_cleanup_pending" ? "account.deletionReceipt.cleanupPending"
                          : state === "not_deleted" ? "account.deletionReceipt.notDeleted"
                            : state === "unknown" ? "account.deletionReceipt.unknown" : "account.deletionReceipt.pending")}
                  </p>
                  <button type="button" className="button-secondary mt-4" disabled={Boolean(receiptChecking[receipt.operationId])} onClick={() => handleCheckDeletion(receipt)}>
                    {t(receiptChecking[receipt.operationId] ? "account.deletionReceipt.checking" : "account.deletionReceipt.check")}
                  </button>
                  {actor.phase === "ready" && actor.actorId === receipt.subjectUserId && user?.id === receipt.subjectUserId
                    && state !== "completed" && state !== "deleted_cleanup_pending" ? (
                      <button type="button" className="button-secondary ml-0 mt-3 max-w-full whitespace-normal sm:ml-3 sm:mt-4"
                        disabled={accountActionLoading || Boolean(receiptChecking[receipt.operationId])}
                        onClick={() => handleContinueDeletion(receipt)}>
                        {t("account.deletionReceipt.continue")}
                      </button>
                    ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {isInitialAccountLoad ? (
        <section className="section section-muted">
          <div className="container max-w-3xl">
            <div className="rounded-2xl border border-ink/10 bg-white/75 px-5 py-8 text-center shadow-soft sm:px-8">
              <p className="text-sm font-bold text-sage">{t("account.visitor.loading")}</p>
            </div>
          </div>
        </section>
      ) : !user || actor.phase === "signed_out" || actor.phase === "error" ? (
        <section className="section section-muted">
          <div className="container grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div className="max-w-xl">
              <p className="eyebrow">{t("account.visitor.label")}</p>
              <h1 className="mt-3 text-[2rem] font-bold leading-tight text-ink sm:text-[2.7rem]">
                {t("account.visitor.title")}
              </h1>
              <p className="mt-4 max-w-lg text-[0.95rem] leading-7 text-muted sm:text-base sm:leading-8">
                {t("account.visitor.description")}
              </p>
              <div className="mt-7 grid gap-3 text-sm leading-6 text-muted sm:grid-cols-2">
                <p className="border-l-2 border-sage/45 pl-4">{t("account.visitor.noPassword")}</p>
                <p className="border-l-2 border-sage/45 pl-4">{t("account.visitor.firstUse")}</p>
              </div>
            </div>

            <div className="w-full rounded-2xl border border-ink/10 bg-white/90 p-5 shadow-soft sm:p-7 lg:max-w-lg lg:justify-self-end">
              <p className="eyebrow">{otpEntryOpen ? t("account.visitor.otpEntry") : t("account.visitor.emailLogin")}</p>
              <h2 className="mt-2 text-[1.45rem] font-bold leading-tight text-ink sm:text-[1.7rem]">
                {otpEntryOpen ? t("account.visitor.enterOtp", { count: emailOtpLength }) : t("account.visitor.welcome")}
              </h2>

              {!isSupabaseConfigured() ? (
                <div className="mt-6 rounded-2xl bg-cream px-4 py-4">
                  <p className="font-bold text-ink">{t("account.visitor.unavailableTitle")}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{t("account.visitor.unavailableText")}</p>
                </div>
              ) : (
                <form className="mt-6 grid gap-4" onSubmit={otpEntryOpen ? handleOtpSubmit : handleLogin}>
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    {t("account.visitor.email")}
                    <input
                      className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/10 disabled:bg-cream disabled:text-ink/60"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                      type="email"
                      autoComplete="email"
                      disabled={otpEntryOpen || authLoading}
                    />
                  </label>
                  {otpEntryOpen ? (
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      {t("account.visitor.otp")}
                      <input
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-center text-lg font-bold tracking-[0.22em] outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/10"
                        value={otp}
                        onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, emailOtpLength))}
                        autoFocus
                        placeholder="12345678"
                        maxLength={emailOtpLength}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                      />
                    </label>
                  ) : null}
                  <button
                    type="submit"
                    className="button-primary mt-1 w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45"
                    disabled={authLoading || !email.trim() || (!otpEntryOpen && resendCooldown > 0) || (otpEntryOpen && otp.trim().length === 0)}
                  >
                    {authLoading ? t("account.visitor.wait") : otpEntryOpen ? t("account.visitor.signIn") : resendCooldown > 0 ? t("account.visitor.resendCountdown", { seconds: resendCooldown }) : t("account.visitor.sendOtp")}
                  </button>
                  {!otpEntryOpen ? (
                    <button
                      type="button"
                      className="text-sm font-bold text-sage-dark hover:text-sage disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={authLoading || !email.trim()}
                      onClick={(event) => {
                        if (!event.currentTarget.form?.reportValidity()) return;
                        setEmail(email.trim());
                        setOtp("");
                        setOtpEntryOpen(true);
                        setResendCooldown((current) => Math.max(current, 60));
                        setNotice("");
                        setError("");
                      }}
                    >
                      {t("account.visitor.alreadyReceivedOtp")}
                    </button>
                  ) : null}
                  {otpEntryOpen ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <button
                        type="button"
                        className="font-bold text-sage-dark hover:text-sage disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={resendOtp}
                        disabled={authLoading || resendCooldown > 0}
                      >
                        {resendCooldown > 0 ? t("account.visitor.resendCountdown", { seconds: resendCooldown }) : t("account.visitor.resend")}
                      </button>
                      <button
                        type="button"
                        className="font-bold text-muted hover:text-ink"
                        onClick={() => {
                          setOtp("");
                          setOtpEntryOpen(false);
                          setNotice("");
                          setError("");
                        }}
                        disabled={authLoading}
                      >
                        {t("account.visitor.changeEmail")}
                      </button>
                    </div>
                  ) : null}
                </form>
              )}
              {notice ? <p className="mt-4 rounded-xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark">{notice}</p> : null}
              {error ? <p className="mt-4 rounded-xl border border-sage/30 bg-white px-4 py-3 text-sm font-bold text-sage-dark">{error}</p> : null}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="section section-muted pb-10 pt-10 sm:pb-12 sm:pt-12 lg:pb-14 lg:pt-14">
            <div className="container">
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <div className="min-w-0">
                  <p className="eyebrow">{needsPersonalProfile ? t("account.hero.firstSignIn") : t("account.hero.label")}</p>
                  <h1 className="mt-2 overflow-hidden text-ellipsis text-[2rem] font-bold leading-tight text-ink sm:text-[2.5rem]">
                    {needsPersonalProfile ? t("account.hero.completeProfile") : t("account.hero.greeting", { name: accountName })}
                  </h1>
                  <p className="mt-3 max-w-2xl text-[0.95rem] leading-7 text-muted">
                    {needsPersonalProfile
                      ? t("account.hero.completeProfileDescription")
                      : isParent
                        ? CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED
                          ? linkedChildren.length
                            ? t("account.hero.linkedChildren", { names: linkedChildren.map((child) => child.display_name).join(locale === "en" ? ", " : "、") })
                            : t("account.hero.noLinkedChildren")
                          : t("account.hero.descriptions.guardian")
                        : displayRole === "学生" && studentAgeBand === "18_plus"
                          ? t("account.ageGuidance.adult.heroDescription")
                          : displayRole === "学生" && studentAgeBand === "14_17"
                            ? t("account.ageGuidance.minor.heroDescription")
                            : recordsDescription(displayRole, hasSchool, t)}
                  </p>
                </div>
                {!needsPersonalProfile ? (
                  <div className="grid shrink-0 gap-3 sm:flex">
                    {isPlatformAdmin ? <Link href="/admin" className="button-primary w-full sm:w-auto">{t("account.actions.platformAdmin")}</Link> : null}
                    {isPlatformAdmin ? <Link href="/admin/role-preview" className="button-secondary w-full sm:w-auto">{t("adminRolePreview.action")}</Link> : null}
                    {isSchoolLead ? <Link href="/admin" className="button-primary w-full sm:w-auto">{t("account.actions.schoolAdmin")}</Link> : null}
                    {isSchoolLead ? <Link href="#records" className="button-secondary w-full sm:w-auto">{t("adminPrivateRecords.ownRecords")}</Link> : null}
                    {isSupportTeacher ? <Link href="#students" className="button-primary w-full sm:w-auto">{t("account.actions.assignedStudents")}</Link> : null}
                    {isSupportTeacher && adminAccess ? <Link href="/admin" className="button-secondary w-full sm:w-auto">{t("account.actions.followUpWorkspace")}</Link> : null}
                    {isParent ? <Link href={CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? "#records" : "/for-parents"} className="button-primary w-full sm:w-auto">{t(CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? "account.actions.childRecords" : "account.actions.parentResources")}</Link> : null}
                    {isParent ? <Link href="/referral" className="button-secondary w-full sm:w-auto">{t("account.actions.moreSupport")}</Link> : null}
                    {displayRole === "学生" ? <Link href="/garden" className="button-primary w-full sm:w-auto">{t("account.actions.recordToday")}</Link> : null}
                    <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut} disabled={signingOut || loading || consentLoading}>
                      {t(signingOut ? "account.actions.signingOut" : "account.actions.signOut")}
                    </button>
                  </div>
                ) : null}
              </div>

              {!needsPersonalProfile && error ? <p role="alert" className="mt-5 rounded-xl border border-sage/30 bg-white px-4 py-3 text-sm font-bold text-sage-dark">{error}</p> : null}

              {needsPersonalProfile ? (
                <form className="mt-8 max-w-2xl rounded-2xl border border-ink/10 bg-white/90 p-5 shadow-soft sm:p-7" onSubmit={handleProfileSubmit}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      {t("account.profile.name")}
                      <input
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={name}
                        onChange={(event) => { ++nameEdits.current; setName(event.target.value); }}
                        placeholder={t("account.profile.namePlaceholder")}
                        maxLength={50}
                        autoFocus
                      />
                    </label>
                    <div className="grid gap-2 text-sm font-bold text-ink">
                      <p>{t("account.profile.accountType")}</p>
                      <p className="rounded-xl border border-ink/15 bg-cream px-4 py-3 text-sm">
                        {roleDisplayLabel(displayRole, t)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:flex">
                    <button type="submit" className="button-primary w-full sm:w-auto" disabled={!name.trim() || writeLocked("profile", user.id)}>
                      {t("account.actions.saveContinue")}
                    </button>
                    <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut} disabled={signingOut || loading || consentLoading}>
                      {t(signingOut ? "account.actions.signingOut" : "account.actions.signOut")}
                    </button>
                  </div>
                  {error ? <p className="mt-4 text-sm font-bold text-sage-dark">{error}</p> : null}
                </form>
              ) : (
                <div className="mt-8 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-ink/10 bg-white/80 px-5 py-5">
                    <p className="text-xs font-bold text-sage">{t("account.summary.currentRole")}</p>
                    <p className="mt-2 text-xl font-bold text-ink">{isIdentityLoading ? t("account.summary.confirming") : roleDisplayLabel(confirmedRoleLabel, t)}</p>
                    <p className="mt-2 overflow-hidden text-ellipsis text-sm text-muted">{user.email}</p>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-white/80 px-5 py-5">
                    <p className="text-xs font-bold text-sage">{t("account.summary.visibleRecords")}</p>
                    <p className="mt-2 text-xl font-bold text-ink">{recordCountLabel(visibleAccountRecords.length, locale, t)}</p>
                    <p className="mt-2 text-sm text-muted">{t("account.summary.savedToAccount")}</p>
                  </div>
                  {!isIdentityLoading && displayRole === "学生" ? (
                    <div className="rounded-2xl border border-sage/30 bg-mist/70 px-5 py-5">
                      <p className="text-xs font-bold text-sage">{t("account.summary.lastSevenDays")}</p>
                      <p className="mt-2 text-xl font-bold text-ink">{recordedDaysLabel(recentRecordDays, locale, t)}</p>
                      <p className="mt-2 text-sm text-muted">{t("account.summary.notEveryDay")}</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-ink/10 bg-white/80 px-5 py-5">
                      <p className="text-xs font-bold text-sage">{t("account.summary.schoolSpace")}</p>
                      <p className="mt-2 text-xl font-bold text-ink">{isIdentityLoading ? t("account.summary.confirming") : hasSchool ? t("account.summary.joined") : t("account.summary.notJoined")}</p>
                      <p className="mt-2 text-sm text-muted">{t("account.summary.configuredBySchool")}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {user && visibleWriteAttempts.some(attempt => attempt.phase === "unknown") ? (
            <section className="px-4 pb-2 pt-6 sm:px-8 lg:px-12" aria-label={t("account.writeRecovery.title")}>
              <div className="container grid gap-4">
                {visibleWriteAttempts.filter(attempt => attempt.phase === "unknown").map(attempt => (
                  <article key={attempt.slot} data-account-write-recovery={attempt.kind} className="rounded-2xl border border-sage/30 bg-white p-5 shadow-soft">
                    <h2 className="text-lg font-bold">{t(`account.writeRecovery.operations.${attempt.kind}`)}</h2>
                    {attempt.day ? <p className="mt-2 text-sm">{t("account.writeRecovery.targetDay", { date: attempt.day })}</p> : null}
                    <p role="alert" className="mt-3 text-sm leading-7">{t("account.writeRecovery.unknown")}</p>
                    {attempt.checkFailed ? <p role="alert" className="mt-3 text-sm font-bold">{t("account.writeRecovery.checkFailed")}</p> : null}
                    {attempt.checked ? <p role="status" className="mt-3 text-sm leading-7">{t("account.writeRecovery.checked")}</p> : null}
                    <div className="mt-4 flex flex-col gap-3 sm:items-start">
                      <button type="button" className="button-secondary w-full whitespace-normal break-words sm:w-auto" disabled={attempt.checking}
                        onClick={() => void checkAccountWrite(attempt)}>{t(attempt.checking ? "account.writeRecovery.checking" : "account.writeRecovery.check")}</button>
                      {attempt.checked ? <button type="button" className="button-primary w-full whitespace-normal break-words sm:w-auto" disabled={attempt.checking}
                        onClick={() => releaseAccountWrite(attempt)}>{t("account.writeRecovery.release")}</button> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {!needsPersonalProfile && consentLoadFailed && (displayRole === "学生" || (isParent && CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED)) ? (
            <section className="px-4 pb-2 pt-6 sm:px-8 lg:px-12">
              <div className="container">
                <div className="rounded-2xl border border-sage/25 bg-mist/55 p-5 shadow-soft sm:p-7">
                  <p role="alert" className="text-sm leading-7 text-ink">{t("account.consent.loadFailed")}</p>
                  <button type="button" className="button-secondary mt-4" disabled={consentLoading || signingOut} onClick={handleRetryConsentStatus}>
                    {t(consentLoading ? "account.consent.loading" : "account.consent.retry")}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {!needsPersonalProfile && consentStatus && (consentStatus.role === "student" || (consentStatus.role === "guardian" && CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED)) ? (
            <section className="px-4 pb-2 pt-6 sm:px-8 lg:px-12">
              <div className="container">
                <div className="rounded-2xl border border-sage/25 bg-mist/55 p-5 shadow-soft sm:p-7">
                  <p className="eyebrow">{t("account.consent.label")}</p>
                  <h2 className="mt-2 text-2xl font-bold text-ink">{t("account.consent.title")}</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
                    {t("account.consent.description")}
                    {locale === "en" ? " " : null}
                    <Link href="/privacy-safety#student-consent" className={`${locale === "en" ? "" : "ml-1 "}font-bold text-sage-dark underline underline-offset-4`}>{t("account.consent.privacyLink")}</Link>{t("account.consent.sentenceEnd")}
                  </p>

                  {consentStatus.role === "student" && consentStatus.consent ? (
                    <div className="mt-6 rounded-2xl bg-white/85 p-5">
                      {consentStatus.consent.status === "active" ? (
                        <>
                          <p className="font-bold text-sage-dark">{t("account.consent.activeTitle")}</p>
                          <p className="mt-2 text-sm leading-6 text-muted">
                            {consentStatus.consent.ageBand === "18_plus"
                              ? t("account.consent.adultActive")
                              : consentStatus.consent.consentBasis === "student_self_pilot"
                                ? t("account.consent.minorSelfActive")
                              : t("account.consent.minorActive")}
                            {t("account.consent.policyVersion", { version: consentStatus.policyVersion })}
                          </p>
                          <button type="button" className="button-secondary mt-4" disabled={consentLoading || signingOut || writeLocked("withdraw", user.id)} onClick={() => handleWithdrawConsent()}>{t("account.consent.withdraw")}</button>
                        </>
                      ) : consentStatus.consent.status === "pending_guardian" ? (
                        <>
                          <p className="font-bold text-ink">{t("account.consent.pendingTitle")}</p>
                          <p className="mt-2 text-sm leading-6 text-muted">{consentStatus.consent.hasLinkedGuardian ? t("account.consent.askGuardian") : t("account.consent.noGuardian")}</p>
                          <button type="button" className="button-secondary mt-4" disabled={consentLoading || signingOut || writeLocked("withdraw", user.id)} onClick={() => handleWithdrawConsent()}>{t("account.consent.withdrawStudent")}</button>
                        </>
                      ) : (
                        <>
                          {consentStatus.consent.status === "ineligible" ? <p className="mb-4 rounded-xl bg-cream px-4 py-3 text-sm font-bold text-sage-dark">{t("account.consent.ineligible")}</p> : null}
                          <label className="grid max-w-md gap-2 text-sm font-bold text-ink">
                            {t("account.consent.ageRange")}
                            <select className="rounded-xl border border-ink/15 bg-white px-4 py-3" value={ageBand} disabled={consentLoading || signingOut} onChange={(event) => {
                              setAgeBand(event.target.value as typeof ageBand);
                              setConsentRead(false);
                            }}>
                              <option value="14_17">{t("account.consent.age14to17")}</option>
                              <option value="18_plus">{t("account.consent.age18Plus")}</option>
                              <option value="under_14">{t("account.consent.ageUnder14")}</option>
                            </select>
                          </label>
                          <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-muted">
                            <input type="checkbox" className="mt-1" checked={consentRead} disabled={consentLoading || signingOut} onChange={(event) => setConsentRead(event.target.checked)} />
                            <span>{t("account.consent.acknowledgement")}</span>
                          </label>
                          <button type="button" className="button-primary mt-4 w-full whitespace-normal sm:w-auto disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45" disabled={consentLoading || signingOut || !consentRead || writeLocked("assent", user.id)} onClick={handleStudentAssent}>{consentLoading ? t("account.actions.submitting") : t("account.consent.completeStudent")}</button>
                        </>
                      )}
                    </div>
                  ) : null}

                  {consentStatus.role === "guardian" ? (
                    <div className="mt-6 grid gap-4">
                      {consentStatus.children.length ? consentStatus.children.map((child) => (
                        <div key={child.studentUserId} className="rounded-2xl bg-white/85 p-5">
                          <p className="font-bold text-ink">{child.studentName}</p>
                          {child.status === "active" && child.consentBasis === "student_self_pilot" ? (
                            <p className="mt-2 text-sm text-muted">{t("account.consent.selfPilotChildActive")}</p>
                          ) : child.status === "active" ? (
                            <><p className="mt-2 text-sm text-muted">{t("account.consent.bothComplete")}</p><button type="button" className="button-secondary mt-4" disabled={consentLoading || writeLocked("withdraw", child.studentUserId)} onClick={() => handleWithdrawConsent(child.studentUserId)}>{t("account.consent.withdrawGuardian")}</button></>
                          ) : child.status === "pending_guardian" ? (
                            <><p className="mt-2 text-sm leading-6 text-muted">{t("account.consent.guardianPrompt")}</p><button type="button" className="button-primary mt-4" disabled={consentLoading || writeLocked("guardian", child.studentUserId)} onClick={() => handleGuardianConsent(child.studentUserId)}>{consentLoading ? t("account.actions.submitting") : t("account.consent.agreeChild")}</button></>
                          ) : (
                            <p className="mt-2 text-sm text-muted">{t("account.consent.waitingChild")}</p>
                          )}
                        </div>
                      )) : <p className="rounded-xl bg-white/80 px-4 py-3 text-sm text-muted">{t("account.consent.noLinkedChild")}</p>}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {!needsPersonalProfile && showStudentAgeGuidance ? (
            <section className="px-4 pb-2 pt-6 sm:px-8 lg:px-12">
              <div className="container">
                <div className="rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-7">
                  <div className="max-w-3xl">
                    <p className="eyebrow">{t("account.ageGuidance.label")}</p>
                    <h2 className="mt-2 text-2xl font-bold text-ink">
                      {isAdultStudent ? t("account.ageGuidance.adult.title") : t("account.ageGuidance.minor.title")}
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-muted">
                      {isAdultStudent ? t("account.ageGuidance.adult.description") : t("account.ageGuidance.minor.description")}
                    </p>
                  </div>
                  <div className="mt-5 grid shrink-0 gap-3 sm:mt-0">
                    <Link href={isAdultStudent ? "/for-young-adults" : "/for-teens"} className="button-primary w-full sm:w-auto">
                      {isAdultStudent ? t("account.ageGuidance.adult.primaryAction") : t("account.ageGuidance.minor.primaryAction")}
                    </Link>
                    <Link href={isAdultStudent ? YOUNG_ADULT_REFERRAL_HREF : "/messages"} className="button-secondary w-full sm:w-auto">
                      {isAdultStudent ? t("account.ageGuidance.adult.secondaryAction") : t("account.ageGuidance.minor.secondaryAction")}
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {!needsPersonalProfile && showStudentAgeGuidance && studentAgeBand ? (
            <AgePathWorkspace ageBand={studentAgeBand as "14_17" | "18_plus"} />
          ) : null}

          {user ? <section className="px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
            <div className="container">
              {notice ? <p className="mb-4 rounded-xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark">{notice}</p> : null}
              <details ref={accountSettings} className="rounded-2xl border border-ink/10 bg-white/70">
                <summary className="cursor-pointer px-5 py-4 text-sm font-bold text-ink sm:px-6">
                  {t("account.settings.title")}
                  <span className="ml-2 font-normal text-muted">{t("account.settings.description")}</span>
                </summary>
                <div className="border-t border-ink/10 px-5 py-6 sm:px-6">
                  <div className="inline-flex max-w-full flex-wrap rounded-xl bg-cream p-1 text-sm font-bold">
                    <button
                      type="button"
                      className={`rounded-lg px-4 py-2 transition ${accountTab === "profile" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                      onClick={() => setAccountTab("profile")}
                    >
                      {isExternallyManagedRole ? t("account.settings.schoolIdentity") : t("account.settings.profile")}
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-4 py-2 transition ${accountTab === "wechat" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                      onClick={() => setAccountTab("wechat")}
                    >
                      {t("account.settings.wechat")}
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-4 py-2 transition ${accountTab === "data" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                      onClick={() => setAccountTab("data")}
                    >
                      {t("account.settings.data")}
                    </button>
                  </div>

                  <OwnContentManagement owner={user.id} actor={actor} active={accountTab === "data"}
                    signingOut={signingOut || accountActionLoading} locale={locale} t={t} />
                  <div className="mt-6 max-w-2xl">
                    {accountTab === "profile" ? (
                      isIdentityLoading ? (
                        <p className="rounded-xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark">{t("account.summary.confirmingRole")}</p>
                      ) : isExternallyManagedRole ? (
                        <div className="grid gap-4">
                          <div className="rounded-xl bg-cream px-4 py-4">
                            <p className="text-xs font-bold text-sage">{t("account.summary.currentRole")}</p>
                            <p className="mt-2 text-lg font-bold text-ink">{roleDisplayLabel(confirmedRoleLabel, t)}</p>
                            <p className="mt-2 text-sm leading-6 text-muted">
                              {isSchoolAssignedStudent ? t("account.settings.roleDescriptions.schoolStudent") : null}
                              {displayRole === "学校负责人" ? t("account.settings.roleDescriptions.schoolLead") : null}
                              {displayRole === "支持老师" ? t("adminPrivateRecords.teacherAccountDescription") : null}
                              {displayRole === "平台管理员" ? t("account.settings.roleDescriptions.platformAdmin") : null}
                              {displayRole === "专业支持者" ? t("account.settings.roleDescriptions.professional") : null}
                            </p>
                          </div>
                          <button type="button" className="button-secondary w-full sm:w-fit" onClick={handleSignOut} disabled={signingOut || loading || consentLoading}>{t(signingOut ? "account.actions.signingOut" : "account.actions.signOut")}</button>
                        </div>
                      ) : (
                        <form className="grid gap-4" onSubmit={handleProfileSubmit}>
                          <label className="grid gap-2 text-sm font-bold text-ink">
                            {t("account.profile.name")}
                            <input className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage" value={name} onChange={(event) => { ++nameEdits.current; setName(event.target.value); }} />
                          </label>
                          <div className="grid gap-2 text-sm font-bold text-ink">
                            <p>{t("account.profile.accountType")}</p>
                            <p className="rounded-xl border border-ink/15 bg-cream px-4 py-3 text-sm">
                              {roleDisplayLabel(confirmedRoleLabel, t)}
                            </p>
                          </div>
                          <div className="grid gap-3 sm:flex">
                            <button type="submit" className="button-primary w-full sm:w-auto" disabled={writeLocked("profile", user.id)}>{t("account.actions.saveProfile")}</button>
                            <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut} disabled={signingOut || loading || consentLoading}>{t(signingOut ? "account.actions.signingOut" : "account.actions.signOut")}</button>
                          </div>
                        </form>
                      )
                    ) : accountTab === "wechat" ? (
                      <div className="grid gap-4">
                        <p className="text-[0.95rem] leading-7 text-muted">
                          {t("account.wechat.description")}
                        </p>
                        {wechatBindSession ? (
                          <div className="w-fit rounded-2xl border border-ink/10 bg-white p-3">
                            <img src={wechatBindSession.qrCodeDataUrl} alt={t("account.wechat.qrAlt")} className="aspect-square w-44 rounded-xl object-contain" />
                            <p className="mt-2 max-w-44 text-center text-xs leading-5 text-muted">{t("account.wechat.qrValidity")}</p>
                          </div>
                        ) : (
                          <p className="rounded-xl bg-cream px-4 py-3 text-sm text-muted">
                            {wechatIdentities.length > 0 ? t("account.wechat.bound") : t("account.wechat.notBound")}
                          </p>
                        )}
                        <button
                          type="button"
                          className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit"
                          onClick={handleCreateWechatBindSession}
                          disabled={wechatLoading}
                        >
                          {wechatLoading ? t("account.wechat.generating") : wechatIdentities.length > 0 ? t("account.wechat.regenerate") : t("account.wechat.generate")}
                        </button>
                        {wechatStatus ? <p className="text-sm font-bold text-sage-dark">{wechatStatus}</p> : null}
                      </div>
                    ) : (
                      <div className="grid gap-6">
                        <div className="rounded-2xl border border-sage/20 bg-mint/35 p-5">
                          <p className="font-bold text-ink">{t("account.dataExport.title")}</p>
                          <p className="mt-2 text-sm leading-7 text-muted">
                            {t("account.dataExport.description")}
                          </p>
                          <button type="button" className="button-secondary mt-4 max-w-full whitespace-normal" disabled={accountActionLoading} onClick={handleDataExport}>
                            {accountActionLoading ? t("account.actions.processing") : t("account.dataExport.action")}
                          </button>
                        </div>

                        <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5">
                          <p className="font-bold text-ink">{t("account.deletion.title")}</p>
                          <p className="mt-2 text-sm leading-7 text-muted">
                            {t("account.deletion.description")}
                          </p>
                          <label className="mt-4 grid gap-2 text-sm font-bold text-ink">
                            {t("account.deletion.emailConfirmation")}
                            <input
                              ref={deletionEmailInput}
                              className="min-w-0 w-full rounded-xl border border-red-200 bg-white px-4 py-3 text-sm outline-none focus:border-red-400"
                              type="email"
                              value={deletionEmail}
                              onChange={(event) => setDeletionEmail(event.target.value)}
                              placeholder={user.email || "name@example.com"}
                              autoComplete="off"
                            />
                          </label>
                          <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-muted">
                            <input type="checkbox" className="mt-1" checked={deletionAcknowledged} onChange={(event) => setDeletionAcknowledged(event.target.checked)} />
                            <span>{t("account.deletion.acknowledgement")}</span>
                          </label>
                          <button
                            type="button"
                            className="mt-4 rounded-xl border border-red-300 bg-white px-5 py-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
                            disabled={accountActionLoading || deletionReceiptBlocksSubmit || !deletionAcknowledged || deletionEmail.trim().toLowerCase() !== user.email?.trim().toLowerCase()}
                            onClick={handleAccountDeletion}
                          >
                            {accountActionLoading ? t("account.actions.processing") : t("account.deletion.action")}
                          </button>
                        </div>
                        <p className="text-sm leading-7 text-muted">
                          {t("account.deletion.privacyPrefix")}
                          {locale === "en" ? " " : null}
                          <Link href="/privacy-safety#account-data" className={`${locale === "en" ? "" : "ml-1 "}font-bold text-sage-dark underline underline-offset-4`}>{t("account.consent.privacyLink")}</Link>{t("account.consent.sentenceEnd")}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </details>
            </div>
          </section> : null}
        </>
      )}

      {user && !needsPersonalProfile && ((isParent && CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED) || isSupportTeacher) ? (
        <section id={isSupportTeacher ? "students" : "family-overview"} className="section section-muted scroll-mt-24">
          <div className="container">
            <SectionHeader title={isParent ? t("account.relationships.childOverview") : t("account.relationships.assignedStudents")}
              description={t("adminPrivateRecords.directoryPrivateBoundary")} />
            {isSupportTeacher ? (
              <div className="mb-5 flex flex-wrap gap-3">
                <Link href="/messages" className="button-primary">{t("siteNavigation.teacherMessages")}</Link>
                <Link href="/referral" className="button-secondary">{t("siteNavigation.supportResources")}</Link>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {relatedPeople.length ? relatedPeople.map((person) => (
                <article key={person.id} className="card">
                  <p className="font-bold text-ink">{person.display_name}</p>
                </article>
              )) : <div className="card"><p className="text-sm text-muted">{isParent ? t("account.relationships.noChild") : t("account.relationships.noStudent")}</p></div>}
            </div>
          </div>
        </section>
      ) : null}

      {user && !needsPersonalProfile && !isPlatformAdmin && isProfessional ? (
        <ProfessionalVerificationCard key={user.id} actorId={user.id} />
      ) : null}
      {user && !needsPersonalProfile && canShowSupportApplication ? (
        <section className="section section-muted py-6">
          <div className="container">
            <div className="card flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-ink">{t("supportStaff.title")}</h2>
                <p className="mt-1 text-sm text-muted">{t("supportStaff.description")}</p>
              </div>
              <Link href={supportApproved ? "/support/workbench" : "/support/apply"} className="button-secondary">{t(supportApproved ? "supportStaff.workbench" : "supportStaff.title")}</Link>
            </div>
          </div>
        </section>
      ) : null}

      {user && !needsPersonalProfile && (!isParent || CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED) ? (
        <section id="records" className="section scroll-mt-24 pt-8 sm:pt-10 lg:pt-12">
          <div className="container">
            <SectionHeader title={recordsTitle(displayRole, t)} />
            {isParent && linkedChildren.length > 0 ? (
              <div className="mb-5 flex flex-wrap gap-2">
                {linkedChildren.map((child) => (
                  <span key={child.id} className="rounded-full bg-mint px-4 py-2 text-sm font-bold text-sage-dark">
                    {child.display_name}
                  </span>
                ))}
              </div>
            ) : null}
            {loading ? <div className="rounded-2xl border border-ink/10 bg-white/75 px-5 py-6 text-sm font-bold text-muted">{t("account.records.loading")}</div> : null}
            {!loading && visibleAccountRecords.length > 0 ? (
              <div className="grid gap-5">
                {visibleAccountRecords.map((record) => {
                  const canDelete = record.user_id === user.id;
                  return (
                    <article key={record.id} className="card">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-sage">{formatDate(record.created_at, locale)}</p>
                          <h3 className="mt-2 text-lg font-bold text-ink sm:text-xl">
                            {linkedChildById.get(record.user_id)?.display_name
                              ? t("account.records.childRecord", { name: linkedChildById.get(record.user_id)?.display_name || "" })
                              : t("account.records.recordTitle")}
                          </h3>
                        </div>
                        {canDelete ? (
                          <button type="button" className="button-secondary w-full px-4 py-2 text-xs sm:w-auto" disabled={writeLocked("sweet", record.id, sweetStoredDay(record.created_at) || undefined)} onClick={() => handleDeleteRecord(record.id)}>{t("account.records.delete")}</button>
                        ) : null}
                      </div>
                      <details className="mt-4 rounded-xl border border-ink/10 bg-white/70">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-sage-dark">
                          {t("account.records.viewFull")}
                        </summary>
                        <div className="grid gap-5 border-t border-ink/10 px-4 py-5">
                          {record.records.map((step, stepIndex) => {
                            const stepKey = step.id || `${record.id}-step-${stepIndex}`;
                            return (
                              <div key={stepKey}>
                                <h4 className="text-sm font-bold text-ink">{step.label} · {storedRecordLabel(locale, `checkIn.steps.${step.id}.title`, step.title)}</h4>
                                <dl className="mt-3 grid gap-3">
                                  {step.fields.map((field, fieldIndex) => (
                                    <div key={field.id || `${stepKey}-field-${fieldIndex}`} className="rounded-xl bg-cream px-4 py-3">
                                      <dt className="text-xs font-bold leading-5 text-muted">{storedRecordLabel(locale, `checkIn.steps.${step.id}.fields.${field.id}.title`, field.title)}</dt>
                                      <dd className="mt-1 text-sm font-bold leading-6 text-ink/85">{formatRecordValue(field.value, locale, t, step.id, field.id)}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                      {record.summary ? (
                        <div className="mt-4">
                          <AiGeneratedLabel />
                          <p className="mt-2 text-[0.95rem] leading-7 text-muted">{record.summary}</p>
                        </div>
                      ) : null}
                      {record.small_step ? <p className="mt-4 rounded-xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">{t("account.records.smallStepPrefix")}{record.small_step}</p> : null}
                      {record.recommended_next_tool ? <p className="mt-3 text-sm leading-7 text-muted">{t("account.records.nextToolPrefix")}{record.recommended_next_tool}</p> : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
            {!loading && visibleAccountRecords.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sage/40 bg-white/55 px-5 py-6 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:px-7">
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("account.records.emptyTitle")}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">{emptyRecordsDescription(displayRole, t)}</p>
                </div>
                <div className="mt-5 shrink-0 sm:mt-0">
                  {displayRole === "学生" ? <Link href="/garden" className="button-primary w-full sm:w-auto">{t("account.records.start")}</Link> : null}
                  {displayRole === "家长" && linkedChildren.length === 0 && CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? <Link href="/contact" className="button-secondary w-full sm:w-auto">{t("account.records.contactSchool")}</Link> : null}
                  {adminAccess ? <Link href="/admin" className="button-secondary w-full sm:w-auto">{t("account.records.admin")}</Link> : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
