import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { SectionHeader } from "@/components/SectionHeader";
import { ProfessionalVerificationCard } from "@/components/ProfessionalVerificationCard";
import {
  AccountStatus,
  CloudProfile,
  CloudSweetRecord,
  StudentConsentResponse,
  WechatBindSession,
  WechatIdentity,
  checkWechatBindSession,
  createWechatBindSession,
  deleteAccountPermanently,
  deleteCloudSweetRecord,
  downloadAccountDataExport,
  getAccountStatus,
  getCurrentUser,
  getProfile,
  getStudentConsentStatus,
  handleAuthRedirect,
  listCloudSweetRecords,
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
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { reportClientOperationFailure } from "@/lib/clientMonitoring";
import { useTranslation } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { dictionaries, type TranslationKey, type TranslationValues } from "@/lib/i18n/dictionaries";
import {
  emailOtpLength,
  otpRequestErrorMessage,
  otpVerificationErrorMessage,
} from "@/lib/emailOtp";
import { rhythmOverview } from "@/lib/rhythmInsights";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

function collectParallelCopy(zhValue: unknown, enValue: unknown, copy: Map<string, string>) {
  if (typeof zhValue === "string" && typeof enValue === "string") {
    copy.set(zhValue, enValue);
    return;
  }
  if (!zhValue || !enValue || typeof zhValue !== "object" || typeof enValue !== "object") return;
  Object.keys(zhValue).forEach((key) => {
    collectParallelCopy(
      (zhValue as Record<string, unknown>)[key],
      (enValue as Record<string, unknown>)[key],
      copy,
    );
  });
}

const savedCheckInCopy = new Map<string, string>();
collectParallelCopy(dictionaries["zh-CN"].checkIn.steps, dictionaries.en.checkIn.steps, savedCheckInCopy);

function localizedStoredValue(value: string, locale: Locale) {
  return locale === "en" ? savedCheckInCopy.get(value) || value : value;
}

function storedRecordLabel(locale: Locale, key: string, fallback: string) {
  const value = key.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, dictionaries[locale]);
  return typeof value === "string" ? value : fallback;
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

function relationshipDaysLabel(period: "fourWeek" | "sevenDay", count: number, locale: Locale, t: Translate) {
  const key = locale === "en" && count === 1
    ? `account.relationships.${period}DaysOne`
    : `account.relationships.${period}Days`;
  return t(key as TranslationKey, { count });
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

function formatRecordValue(value: string | string[], locale: Locale, t: Translate) {
  if (Array.isArray(value)) return value.length ? value.map((item) => localizedStoredValue(item, locale)).join(locale === "en" ? ", " : "、") : t("account.records.notProvided");
  const text = String(value || "").trim();
  return text ? localizedStoredValue(text, locale) : t("account.records.notProvided");
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

function recordsTitle(role: string, t: Translate) {
  if (role === "学校负责人") return t("account.records.titles.school");
  if (role === "支持老师") return t("account.records.titles.teacher");
  if (role === "家长") return t("account.records.titles.guardian");
  return t("account.records.titles.own");
}

function recordsDescription(role: string, hasSchool: boolean, t: Translate) {
  if (role === "平台管理员") return t("account.hero.descriptions.platformAdmin");
  if (role === "学校负责人") return t("account.hero.descriptions.schoolLead");
  if (role === "支持老师") return t("account.hero.descriptions.supportTeacher");
  if (role === "家长") return t("account.hero.descriptions.guardian");
  return hasSchool ? t("account.hero.descriptions.schoolStudent") : t("account.hero.descriptions.personal");
}

function emptyRecordsDescription(role: string, t: Translate) {
  if (role === "学生") return t("account.records.empty.student");
  if (role === "家长") return t("account.records.empty.guardian");
  if (role === "支持老师") return t("account.records.empty.teacher");
  if (role === "学校负责人") return t("account.records.empty.schoolLead");
  return t("account.records.empty.default");
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

export default function AccountPage() {
  const { locale, t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [records, setRecords] = useState<CloudSweetRecord[]>([]);
  const [wechatIdentities, setWechatIdentities] = useState<WechatIdentity[]>([]);
  const [wechatBindSession, setWechatBindSession] = useState<WechatBindSession | null>(null);
  const [wechatStatus, setWechatStatus] = useState("");
  const [wechatLoading, setWechatLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRequestInFlight = useRef(false);
  const [name, setName] = useState("");
  const [accountTab, setAccountTab] = useState<"profile" | "wechat" | "data">("profile");
  const [accountActionLoading, setAccountActionLoading] = useState(false);
  const [deletionEmail, setDeletionEmail] = useState("");
  const [deletionAcknowledged, setDeletionAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [identityChecking, setIdentityChecking] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedRelatedUserId, setSelectedRelatedUserId] = useState("");
  const [consentStatus, setConsentStatus] = useState<StudentConsentResponse | null>(null);
  const [consentLoading, setConsentLoading] = useState(false);
  const [ageBand, setAgeBand] = useState<"under_14" | "14_17" | "18_plus">("14_17");
  const [consentRead, setConsentRead] = useState(false);

  const isIdentityLoading = Boolean(user && identityChecking);
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
  const recentRecordDays = countRecentRecordDays(records, user?.id);
  const accountName = profile?.display_name?.trim() || user?.email || t("account.hero.accountFallback");
  const isInitialAccountLoad = loading && !user;
  const isPlatformAdmin = displayRole === "平台管理员";
  const isSchoolLead = displayRole === "学校负责人";
  const isSupportTeacher = displayRole === "支持老师";
  const isParent = displayRole === "家长";
  const linkedChildren = accountStatus?.linkedChildren || [];
  const assignedStudents = accountStatus?.assignedStudents || [];
  const relatedPeople = isParent ? linkedChildren : isSupportTeacher ? assignedStudents : [];
  const activeRelatedUserId =
    selectedRelatedUserId && relatedPeople.some((person) => person.id === selectedRelatedUserId)
      ? selectedRelatedUserId
      : relatedPeople[0]?.id || "";
  const activeRelatedPerson = relatedPeople.find((person) => person.id === activeRelatedUserId) || null;
  const relatedOverview = rhythmOverview(records, isParent ? 28 : 7, activeRelatedUserId);
  const linkedChildById = new Map(linkedChildren.map((child) => [child.id, child]));
  const accountError = (error: unknown, fallbackKey: TranslationKey) =>
    localizedCloudErrorMessage(error, locale, t(fallbackKey));

  async function refreshAccount() {
    setLoading(true);
    setIdentityChecking(true);
    setError("");
    setNotice((currentNotice) => currentNotice || "");
    try {
      let currentUser: User | null = null;
      try {
        currentUser = await withTimeout(getCurrentUser(), 4_000, t("account.errors.serviceTimeout"));
      } catch (authError) {
        reportClientOperationFailure("auth", "auth_session", authError);
        setUser(null);
        setProfile(null);
        setAccountStatus(null);
        setRecords([]);
        setWechatIdentities([]);
        setConsentStatus(null);
        setNotice(t("account.notices.sessionSlow"));
        return;
      }
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setAccountStatus(null);
        setRecords([]);
        setWechatIdentities([]);
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

      try {
        nextAccountStatus = await getAccountStatus();
        nextProfile = nextAccountStatus.profile;
      } catch (statusError) {
        reportClientOperationFailure("auth", "account_status", statusError);
        nonFatalNotice = t("account.notices.identitySyncing");
      }

      if (!nextProfile) {
        try {
          nextProfile = await getProfile(currentUser);
        } catch (profileError) {
          reportClientOperationFailure("auth", "account_profile", profileError);
          nonFatalNotice = nonFatalNotice || t("account.notices.profileIncomplete");
        }
      }

      const [nextRecords, nextWechatIdentities, nextConsentStatus] = await Promise.all([
        listCloudSweetRecords().catch((recordsError) => {
          reportClientOperationFailure("save", "account_records", recordsError);
          nonFatalNotice = nonFatalNotice || t("account.notices.recordsUnavailable");
          return [] as CloudSweetRecord[];
        }),
        listWechatIdentities().catch((wechatError) => {
          reportClientOperationFailure("auth", "wechat_identities", wechatError);
          return [] as WechatIdentity[];
        }),
        getStudentConsentStatus().catch((consentError) => {
          reportClientOperationFailure("auth", "student_consent", consentError);
          return null;
        }),
      ]);

      setAccountStatus(nextAccountStatus);
      setProfile(nextProfile);
      setName(nextProfile?.display_name || "");
      setRecords(nextRecords);
      setWechatIdentities(nextWechatIdentities);
      setConsentStatus(nextConsentStatus);
      if (nextAccountStatus?.inviteSyncError) {
        setNotice(t("account.notices.inviteSyncDelayed"));
      } else if (nonFatalNotice) {
        setNotice(nonFatalNotice);
      }
    } catch (loadError) {
      setError(accountError(loadError, "account.errors.loadFailed"));
    } finally {
      setLoading(false);
      setIdentityChecking(false);
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
        await refreshAccount();
      }
    }

    loadAccount();
  }, []);

  useEffect(() => {
    if (!wechatBindSession) return;

    const interval = window.setInterval(async () => {
      try {
        const result = await checkWechatBindSession(wechatBindSession.scene);
        if (result.bound) {
          window.clearInterval(interval);
          setWechatStatus(t("account.notices.wechatBound"));
          setWechatBindSession(null);
          await refreshAccount();
        } else if (result.status === "expired") {
          window.clearInterval(interval);
          setWechatStatus(t("account.errors.wechatQrExpired"));
          setWechatBindSession(null);
        }
      } catch (bindError) {
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

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otpRequestInFlight.current) return;
    otpRequestInFlight.current = true;
    setNotice("");
    setError("");
    setAuthLoading(true);
    try {
      await sendEmailOtp(email.trim());
      setOtpSent(true);
      setResendCooldown(60);
      setNotice(t("account.notices.otpSent"));
    } catch (loginError) {
      reportClientOperationFailure("auth", "auth_otp_send", loginError);
      setError(otpRequestErrorMessage(loginError, {
        unauthorized: t("account.errors.otpUnauthorized"),
        rateLimited: t("account.errors.otpRateLimited"),
        network: t("account.errors.otpSendNetwork"),
        fallback: t("account.errors.otpSendFailed"),
      }));
    } finally {
      otpRequestInFlight.current = false;
      setAuthLoading(false);
    }
  }

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    if (otp.trim().length !== emailOtpLength) {
      setError(t("account.errors.otpIncomplete", { count: emailOtpLength }));
      return;
    }
    setAuthLoading(true);
    try {
      await verifyEmailOtp(email.trim(), otp);
      setOtp("");
      setOtpSent(false);
      setNotice(t("account.notices.signedIn"));
      await refreshAccount();
    } catch (loginError) {
      reportClientOperationFailure("auth", "auth_otp_verify", loginError);
      setError(otpVerificationErrorMessage(loginError, {
        invalid: t("account.errors.otpInvalid"),
        rateLimited: t("account.errors.otpVerifyRateLimited"),
        network: t("account.errors.otpVerifyNetwork"),
        fallback: t("account.errors.otpVerifyFailed"),
      }));
    } finally {
      setAuthLoading(false);
    }
  }

  async function resendOtp() {
    if (otpRequestInFlight.current || resendCooldown > 0) return;
    otpRequestInFlight.current = true;
    setNotice("");
    setError("");
    setAuthLoading(true);
    try {
      await sendEmailOtp(email.trim());
      setOtp("");
      setResendCooldown(60);
      setNotice(t("account.notices.otpResent"));
    } catch (loginError) {
      reportClientOperationFailure("auth", "auth_otp_send", loginError);
      setError(otpRequestErrorMessage(loginError, {
        unauthorized: t("account.errors.otpUnauthorized"),
        rateLimited: t("account.errors.otpRateLimited"),
        network: t("account.errors.otpSendNetwork"),
        fallback: t("account.errors.otpSendFailed"),
      }));
    } finally {
      otpRequestInFlight.current = false;
      setAuthLoading(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || isExternallyManagedRole) return;
    setNotice("");
    setError("");
    if (!name.trim()) {
      setError(t("account.errors.nameRequired"));
      return;
    }
    try {
      await saveProfile(user, name.trim());
      await refreshAccount();
      setNotice(t("account.notices.profileSaved"));
    } catch (profileError) {
      setError(accountError(profileError, "account.errors.profileSaveFailed"));
    }
  }

  async function handleDeleteRecord(recordId: string) {
    setNotice("");
    setError("");
    try {
      await deleteCloudSweetRecord(recordId);
      setRecords(await listCloudSweetRecords());
      setNotice(t("account.notices.recordDeleted"));
    } catch (deleteError) {
      setError(accountError(deleteError, "account.errors.recordDeleteFailed"));
    }
  }

  async function handleSignOut() {
    await signOut();
    setNotice(t("account.notices.signedOut"));
    setWechatBindSession(null);
    setWechatStatus("");
    setAccountStatus(null);
    setConsentStatus(null);
    setAccountTab("profile");
    await refreshAccount();
  }

  async function handleDataExport() {
    setAccountActionLoading(true);
    setError("");
    setNotice("");
    try {
      await downloadAccountDataExport();
      setNotice(t("account.notices.exportStarted"));
    } catch (exportError) {
      setError(accountError(exportError, "account.errors.exportFailed"));
    } finally {
      setAccountActionLoading(false);
    }
  }

  async function handleAccountDeletion() {
    if (!user?.email || !deletionAcknowledged || deletionEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      setError(t("account.errors.deletionConfirmationRequired"));
      return;
    }
    setAccountActionLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteAccountPermanently(deletionEmail);
      await signOut().catch(() => undefined);
      setUser(null);
      setProfile(null);
      setAccountStatus(null);
      setRecords([]);
      setConsentStatus(null);
      setDeletionEmail("");
      setDeletionAcknowledged(false);
      setNotice(result.cleanupPending
        ? t("account.notices.accountDeletedCleanupPending")
        : t("account.notices.accountDeleted"));
    } catch (deleteError) {
      setError(accountError(deleteError, "account.errors.accountDeleteFailed"));
    } finally {
      setAccountActionLoading(false);
    }
  }

  async function handleStudentAssent() {
    setConsentLoading(true);
    setError("");
    setNotice("");
    try {
      setConsentStatus(await submitStudentAssent(ageBand));
      setNotice(ageBand === "under_14" ? t("account.notices.under14Ineligible") : ageBand === "18_plus" ? t("account.notices.adultConsentComplete") : t("account.notices.studentAssentRecorded"));
    } catch (consentError) {
      setError(accountError(consentError, "account.errors.studentAssentFailed"));
    } finally {
      setConsentLoading(false);
    }
  }

  async function handleGuardianConsent(studentUserId: string) {
    setConsentLoading(true);
    setError("");
    setNotice("");
    try {
      setConsentStatus(await submitGuardianConsent(studentUserId));
      setNotice(t("account.notices.guardianConsentComplete"));
    } catch (consentError) {
      setError(accountError(consentError, "account.errors.guardianConsentFailed"));
    } finally {
      setConsentLoading(false);
    }
  }

  async function handleWithdrawConsent(studentUserId?: string) {
    setConsentLoading(true);
    setError("");
    setNotice("");
    try {
      setConsentStatus(await withdrawStudentConsent(studentUserId));
      setNotice(t("account.notices.consentWithdrawn"));
    } catch (consentError) {
      setError(accountError(consentError, "account.errors.consentWithdrawFailed"));
    } finally {
      setConsentLoading(false);
    }
  }

  async function handleCreateWechatBindSession() {
    setWechatLoading(true);
    setWechatStatus("");
    setError("");
    try {
      const bindSession = await createWechatBindSession();
      setWechatBindSession(bindSession);
      setWechatStatus(t("account.notices.scanWechatQr"));
    } catch (bindError) {
      setWechatStatus(accountError(bindError, "account.errors.wechatQrFailed"));
    } finally {
      setWechatLoading(false);
    }
  }

  return (
    <>
      {isInitialAccountLoad ? (
        <section className="section section-muted">
          <div className="container max-w-3xl">
            <div className="rounded-2xl border border-ink/10 bg-white/75 px-5 py-8 text-center shadow-soft sm:px-8">
              <p className="text-sm font-bold text-sage">{t("account.visitor.loading")}</p>
            </div>
          </div>
        </section>
      ) : !user ? (
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
              <p className="eyebrow">{otpSent ? t("account.visitor.otpSent") : t("account.visitor.emailLogin")}</p>
              <h2 className="mt-2 text-[1.45rem] font-bold leading-tight text-ink sm:text-[1.7rem]">
                {otpSent ? t("account.visitor.enterOtp", { count: emailOtpLength }) : t("account.visitor.welcome")}
              </h2>

              {!isSupabaseConfigured() ? (
                <div className="mt-6 rounded-2xl bg-cream px-4 py-4">
                  <p className="font-bold text-ink">{t("account.visitor.unavailableTitle")}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{t("account.visitor.unavailableText")}</p>
                </div>
              ) : (
                <form className="mt-6 grid gap-4" onSubmit={otpSent ? handleOtpSubmit : handleLogin}>
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    {t("account.visitor.email")}
                    <input
                      className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/10 disabled:bg-cream disabled:text-ink/60"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                      type="email"
                      autoComplete="email"
                      disabled={otpSent || authLoading}
                    />
                  </label>
                  {otpSent ? (
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      {t("account.visitor.otp")}
                      <input
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-center text-lg font-bold tracking-[0.22em] outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/10"
                        value={otp}
                        onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, emailOtpLength))}
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
                    disabled={authLoading || !email.trim() || (otpSent && otp.trim().length === 0)}
                  >
                    {authLoading ? t("account.visitor.wait") : otpSent ? t("account.visitor.signIn") : t("account.visitor.sendOtp")}
                  </button>
                  {otpSent ? (
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
                          setOtpSent(false);
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
                        ? linkedChildren.length
                          ? t("account.hero.linkedChildren", { names: linkedChildren.map((child) => child.display_name).join(locale === "en" ? ", " : "、") })
                          : t("account.hero.noLinkedChildren")
                        : recordsDescription(displayRole, hasSchool, t)}
                  </p>
                </div>
                {!needsPersonalProfile ? (
                  <div className="grid shrink-0 gap-3 sm:flex">
                    {isPlatformAdmin ? <Link href="/admin" className="button-primary w-full sm:w-auto">{t("account.actions.platformAdmin")}</Link> : null}
                    {isSchoolLead ? <Link href="/admin" className="button-primary w-full sm:w-auto">{t("account.actions.schoolAdmin")}</Link> : null}
                    {isSchoolLead ? <Link href="#records" className="button-secondary w-full sm:w-auto">{t("account.actions.studentRecords")}</Link> : null}
                    {isSupportTeacher ? <Link href="#students" className="button-primary w-full sm:w-auto">{t("account.actions.assignedStudents")}</Link> : null}
                    {isSupportTeacher && adminAccess ? <Link href="/admin" className="button-secondary w-full sm:w-auto">{t("account.actions.followUpWorkspace")}</Link> : null}
                    {isParent ? <Link href="#records" className="button-primary w-full sm:w-auto">{t("account.actions.childRecords")}</Link> : null}
                    {isParent ? <Link href="/referral" className="button-secondary w-full sm:w-auto">{t("account.actions.moreSupport")}</Link> : null}
                    {displayRole === "学生" ? <Link href="/check-in" className="button-primary w-full sm:w-auto">{t("account.actions.recordToday")}</Link> : null}
                  </div>
                ) : null}
              </div>

              {needsPersonalProfile ? (
                <form className="mt-8 max-w-2xl rounded-2xl border border-ink/10 bg-white/90 p-5 shadow-soft sm:p-7" onSubmit={handleProfileSubmit}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      {t("account.profile.name")}
                      <input
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
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
                    <button type="submit" className="button-primary w-full sm:w-auto" disabled={!name.trim()}>
                      {t("account.actions.saveContinue")}
                    </button>
                    <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut}>
                      {t("account.actions.signOut")}
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
                    <p className="mt-2 text-xl font-bold text-ink">{recordCountLabel(records.length, locale, t)}</p>
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

          {!needsPersonalProfile && consentStatus && ["student", "guardian"].includes(consentStatus.role) ? (
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
                              : t("account.consent.minorActive")}
                            {t("account.consent.policyVersion", { version: consentStatus.policyVersion })}
                          </p>
                          <button type="button" className="button-secondary mt-4" disabled={consentLoading} onClick={() => handleWithdrawConsent()}>{t("account.consent.withdraw")}</button>
                        </>
                      ) : consentStatus.consent.status === "pending_guardian" ? (
                        <>
                          <p className="font-bold text-ink">{t("account.consent.pendingTitle")}</p>
                          <p className="mt-2 text-sm leading-6 text-muted">{consentStatus.consent.hasLinkedGuardian ? t("account.consent.askGuardian") : t("account.consent.noGuardian")}</p>
                          <button type="button" className="button-secondary mt-4" disabled={consentLoading} onClick={() => handleWithdrawConsent()}>{t("account.consent.withdrawStudent")}</button>
                        </>
                      ) : (
                        <>
                          {consentStatus.consent.status === "ineligible" ? <p className="mb-4 rounded-xl bg-cream px-4 py-3 text-sm font-bold text-sage-dark">{t("account.consent.ineligible")}</p> : null}
                          <label className="grid max-w-md gap-2 text-sm font-bold text-ink">
                            {t("account.consent.ageRange")}
                            <select className="rounded-xl border border-ink/15 bg-white px-4 py-3" value={ageBand} onChange={(event) => setAgeBand(event.target.value as typeof ageBand)}>
                              <option value="14_17">{t("account.consent.age14to17")}</option>
                              <option value="18_plus">{t("account.consent.age18Plus")}</option>
                              <option value="under_14">{t("account.consent.ageUnder14")}</option>
                            </select>
                          </label>
                          <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-muted">
                            <input type="checkbox" className="mt-1" checked={consentRead} onChange={(event) => setConsentRead(event.target.checked)} />
                            <span>{t("account.consent.acknowledgement")}</span>
                          </label>
                          <button type="button" className="button-primary mt-4 disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45" disabled={consentLoading || !consentRead} onClick={handleStudentAssent}>{consentLoading ? t("account.actions.submitting") : t("account.consent.completeStudent")}</button>
                        </>
                      )}
                    </div>
                  ) : null}

                  {consentStatus.role === "guardian" ? (
                    <div className="mt-6 grid gap-4">
                      {consentStatus.children.length ? consentStatus.children.map((child) => (
                        <div key={child.studentUserId} className="rounded-2xl bg-white/85 p-5">
                          <p className="font-bold text-ink">{child.studentName}</p>
                          {child.status === "active" ? (
                            <><p className="mt-2 text-sm text-muted">{t("account.consent.bothComplete")}</p><button type="button" className="button-secondary mt-4" disabled={consentLoading} onClick={() => handleWithdrawConsent(child.studentUserId)}>{t("account.consent.withdrawGuardian")}</button></>
                          ) : child.status === "pending_guardian" ? (
                            <><p className="mt-2 text-sm leading-6 text-muted">{t("account.consent.guardianPrompt")}</p><button type="button" className="button-primary mt-4" disabled={consentLoading} onClick={() => handleGuardianConsent(child.studentUserId)}>{consentLoading ? t("account.actions.submitting") : t("account.consent.agreeChild")}</button></>
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

          {!needsPersonalProfile ? <section className="px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
            <div className="container">
              {notice ? <p className="mb-4 rounded-xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark">{notice}</p> : null}
              {error ? <p className="mb-4 rounded-xl border border-sage/30 bg-white px-4 py-3 text-sm font-bold text-sage-dark">{error}</p> : null}
              <details className="rounded-2xl border border-ink/10 bg-white/70">
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
                              {displayRole === "支持老师" ? t("account.settings.roleDescriptions.supportTeacher") : null}
                              {displayRole === "平台管理员" ? t("account.settings.roleDescriptions.platformAdmin") : null}
                              {displayRole === "专业支持者" ? t("account.settings.roleDescriptions.professional") : null}
                            </p>
                          </div>
                          <button type="button" className="button-secondary w-full sm:w-fit" onClick={handleSignOut}>{t("account.actions.signOut")}</button>
                        </div>
                      ) : (
                        <form className="grid gap-4" onSubmit={handleProfileSubmit}>
                          <label className="grid gap-2 text-sm font-bold text-ink">
                            {t("account.profile.name")}
                            <input className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage" value={name} onChange={(event) => setName(event.target.value)} />
                          </label>
                          <div className="grid gap-2 text-sm font-bold text-ink">
                            <p>{t("account.profile.accountType")}</p>
                            <p className="rounded-xl border border-ink/15 bg-cream px-4 py-3 text-sm">
                              {roleDisplayLabel(confirmedRoleLabel, t)}
                            </p>
                          </div>
                          <div className="grid gap-3 sm:flex">
                            <button type="submit" className="button-primary w-full sm:w-auto">{t("account.actions.saveProfile")}</button>
                            <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut}>{t("account.actions.signOut")}</button>
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
                          <button type="button" className="button-secondary mt-4" disabled={accountActionLoading} onClick={handleDataExport}>
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
                              className="rounded-xl border border-red-200 bg-white px-4 py-3 text-sm outline-none focus:border-red-400"
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
                            disabled={accountActionLoading || !deletionAcknowledged || deletionEmail.trim().toLowerCase() !== user.email?.trim().toLowerCase()}
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

      {user && !needsPersonalProfile && (isParent || isSupportTeacher) ? (
        <section
          id={isSupportTeacher ? "students" : "family-overview"}
          className="section section-muted scroll-mt-24"
        >
          <div className="container">
            <SectionHeader title={isParent ? t("account.relationships.childOverview") : t("account.relationships.assignedStudents")} />
            {relatedPeople.length ? (
              <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
                <aside className="card">
                  <p className="text-sm font-bold text-ink">{isParent ? t("account.relationships.selectChild") : t("account.relationships.studentList")}</p>
                  <div className="mt-4 grid gap-2">
                    {relatedPeople.map((person) => {
                      const personOverview = rhythmOverview(records, isParent ? 28 : 7, person.id);
                      const selected = person.id === activeRelatedUserId;
                      return (
                        <button
                          key={person.id}
                          type="button"
                          className={`rounded-2xl border px-4 py-4 text-left transition ${
                            selected ? "border-sage bg-mint" : "border-ink/10 bg-white hover:border-sage/60"
                          }`}
                          onClick={() => setSelectedRelatedUserId(person.id)}
                        >
                          <span className="block font-bold text-ink">{person.display_name}</span>
                          <span className="mt-1 block text-xs text-muted">
                            {isParent
                              ? relationshipDaysLabel("fourWeek", personOverview.activeDays, locale, t)
                              : relationshipDaysLabel("sevenDay", personOverview.activeDays, locale, t)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <div className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="eyebrow">{isParent ? t("account.relationships.lastFourWeeks") : t("account.relationships.lastSevenDays")}</p>
                      <h2 className="mt-2 text-[1.5rem] font-bold text-ink">
                        {activeRelatedPerson?.display_name || t("account.relationships.rhythmOverview")}
                      </h2>
                    </div>
                    <span className="rounded-full bg-cream px-4 py-2 text-sm font-bold text-sage-dark">
                      {recordedDaysLabel(relatedOverview.activeDays, locale, t)}
                    </span>
                  </div>

                  {relatedOverview.recordCount ? (
                    <>
                      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        {relatedOverview.dimensions.map((dimension) => (
                          <div key={dimension.id} className="rounded-2xl border border-ink/10 bg-white px-4 py-4">
                            <p className="text-xs font-bold text-sage">{t(`account.rhythm.${dimension.id}` as TranslationKey)}</p>
                            <p className="mt-2 text-sm font-bold leading-6 text-ink">{dimension.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 rounded-2xl bg-cream px-5 py-5">
                        <p className="text-xs font-bold text-sage-dark">{t("account.relationships.latestSummary")}</p>
                        <p className="mt-2 text-sm leading-7 text-muted">
                          {relatedOverview.latestSummary || t("account.relationships.noSummary")}
                        </p>
                      </div>
                      <a href="#records" className="button-secondary mt-5">
                        {t("account.relationships.viewRawAnswers")}
                      </a>
                    </>
                  ) : (
                    <p className="mt-6 rounded-2xl bg-cream px-5 py-5 text-sm leading-7 text-muted">
                      {isParent ? t("account.relationships.childNoRecords") : t("account.relationships.studentNoRecords")}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="card">
                <p className="font-bold text-ink">
                  {isParent ? t("account.relationships.noChild") : t("account.relationships.noStudent")}
                </p>
                <p className="mt-2 text-sm leading-7 text-muted">
                  {isParent ? t("account.relationships.confirmRelationship") : t("account.relationships.assignmentHelp")}
                </p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {user && !needsPersonalProfile && !isPlatformAdmin && isProfessional ? (
        <ProfessionalVerificationCard />
      ) : null}

      {user && !needsPersonalProfile && !isPlatformAdmin ? (
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
            {!loading && records.length > 0 ? (
              <div className="grid gap-5">
                {records.map((record) => {
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
                          <button type="button" className="button-secondary w-full px-4 py-2 text-xs sm:w-auto" onClick={() => handleDeleteRecord(record.id)}>{t("account.records.delete")}</button>
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
                                      <dd className="mt-1 text-sm font-bold leading-6 text-ink/85">{formatRecordValue(field.value, locale, t)}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                      {record.summary ? <p className="mt-4 text-[0.95rem] leading-7 text-muted">{record.summary}</p> : null}
                      {record.small_step ? <p className="mt-4 rounded-xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">{t("account.records.smallStepPrefix")}{record.small_step}</p> : null}
                      {record.recommended_next_tool ? <p className="mt-3 text-sm leading-7 text-muted">{t("account.records.nextToolPrefix")}{record.recommended_next_tool}</p> : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
            {!loading && records.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sage/40 bg-white/55 px-5 py-6 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:px-7">
                <div>
                  <h3 className="text-lg font-bold text-ink">{t("account.records.emptyTitle")}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">{emptyRecordsDescription(displayRole, t)}</p>
                </div>
                <div className="mt-5 shrink-0 sm:mt-0">
                  {displayRole === "学生" ? <Link href="/check-in" className="button-primary w-full sm:w-auto">{t("account.records.start")}</Link> : null}
                  {displayRole === "家长" && linkedChildren.length === 0 ? <Link href="/contact" className="button-secondary w-full sm:w-auto">{t("account.records.contactSchool")}</Link> : null}
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
