import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { SectionHeader } from "@/components/SectionHeader";
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
} from "@/lib/cloudRecords";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { rhythmOverview } from "@/lib/rhythmInsights";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

function formatRecordValue(value: string | string[]) {
  if (Array.isArray(value)) return value.length ? value.join("、") : "未填写";
  return String(value || "").trim() || "未填写";
}

function profileRoleLabel(value?: string | null) {
  if (value === "家长") return "家长";
  if (value === "专业支持者") return "专业支持者";
  if (value === "学校支持人员") return "支持老师";
  return "学生";
}

function recordsTitle(role: string) {
  if (role === "学校负责人") return "本校学生的 SWEET 记录";
  if (role === "支持老师") return "负责学生的 SWEET 记录";
  if (role === "家长") return "孩子的 SWEET 记录";
  return "我的 SWEET 历史记录";
}

function recordsDescription(role: string, hasSchool: boolean) {
  if (role === "平台管理员") return "进入平台管理，查看全部学校、成员和负责关系。";
  if (role === "学校负责人") return "管理本校成员，同时查看本校学生提交的记录。";
  if (role === "支持老师") return "查看学校分配给你的学生记录和近期变化。";
  if (role === "家长") return "亲子关系确认后，在这里查看孩子共享的节律记录。";
  if (hasSchool) return "你保存的记录会出现在这里，并按照学校的支持安排开放给对应老师。";
  return "完成 SWEET 后保存，即可在这里回看。";
}

function emptyRecordsDescription(role: string) {
  if (role === "学生") return "完成一次 SWEET 节律记录并保存后，会显示在这里。";
  if (role === "家长") return "尚未关联孩子，或孩子暂时还没有保存记录。亲子关系需要由学校管理员确认。";
  if (role === "支持老师") return "学校负责人分配学生后，这里会显示你负责学生的记录。";
  if (role === "学校负责人") return "本校学生保存 SWEET 记录后，会显示在这里。";
  return "保存记录后，会显示在这里。";
}

function otpErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "验证码验证失败。";
  const lower = message.toLowerCase();
  if (lower.includes("token") || lower.includes("otp") || lower.includes("invalid") || lower.includes("expired")) {
    return "验证码不正确或已过期，请重新输入，或重新发送。";
  }
  return message || "验证码验证失败，请稍后重试。";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: number | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("账户服务响应超时。")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export default function AccountPage() {
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
  const [role, setRole] = useState("学生");
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
  const displayRole = isIdentityLoading ? "正在确认" : accountStatus?.displayRole || profileRoleLabel(profile?.role || role);
  const adminAccess = accountStatus?.adminAccess || null;
  const hasSchool = Boolean(accountStatus?.hasSchool || profile?.school_id);
  const isManagedSchoolRole = !isIdentityLoading && (displayRole === "学校负责人" || displayRole === "支持老师" || displayRole === "平台管理员");
  const isSchoolAssignedStudent = !isIdentityLoading && displayRole === "学生" && hasSchool;
  const isSchoolAssignedParent = !isIdentityLoading && displayRole === "家长" && hasSchool;
  const isExternallyManagedRole = isManagedSchoolRole || isSchoolAssignedStudent || isSchoolAssignedParent;
  const needsPersonalProfile = Boolean(
    user && !isIdentityLoading && !isExternallyManagedRole && (!profile || !profile.display_name?.trim()),
  );
  const confirmedRoleLabel = isSchoolAssignedStudent
    ? "学校学生"
    : isSchoolAssignedParent
      ? "学校家长"
      : displayRole;
  const recentRecordDays = countRecentRecordDays(records, user?.id);
  const accountName = profile?.display_name?.trim() || user?.email || "你的账户";
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

  async function refreshAccount() {
    setLoading(true);
    setIdentityChecking(true);
    setError("");
    setNotice((currentNotice) => currentNotice || "");
    try {
      let currentUser: User | null = null;
      try {
        currentUser = await withTimeout(getCurrentUser(), 4_000);
      } catch (authError) {
        console.warn("Initial auth check timed out", authError);
        setUser(null);
        setProfile(null);
        setAccountStatus(null);
        setRecords([]);
        setWechatIdentities([]);
        setConsentStatus(null);
        setNotice("登录状态加载较慢。你仍可以重新登录，或刷新页面再试一次。");
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
        console.warn("Account status failed", statusError);
        nonFatalNotice = "账户身份正在重新同步。如果你是学校负责人，请稍后刷新页面。";
      }

      if (!nextProfile) {
        try {
          nextProfile = await getProfile(currentUser);
        } catch (profileError) {
          console.warn("Profile fallback failed", profileError);
          nonFatalNotice = nonFatalNotice || "账号资料暂时没有加载完整，可以稍后重试。";
        }
      }

      const [nextRecords, nextWechatIdentities, nextConsentStatus] = await Promise.all([
        listCloudSweetRecords().catch((recordsError) => {
          console.warn("Cloud records failed", recordsError);
          nonFatalNotice = nonFatalNotice || "记录暂时没有加载出来，请稍后刷新。";
          return [] as CloudSweetRecord[];
        }),
        listWechatIdentities().catch((wechatError) => {
          console.warn("Wechat identities failed", wechatError);
          return [] as WechatIdentity[];
        }),
        getStudentConsentStatus().catch((consentError) => {
          console.warn("Student consent status failed", consentError);
          return null;
        }),
      ]);

      setAccountStatus(nextAccountStatus);
      setProfile(nextProfile);
      setName(nextProfile?.display_name || "");
      setRole(profileRoleLabel(nextProfile?.role));
      setRecords(nextRecords);
      setWechatIdentities(nextWechatIdentities);
      setConsentStatus(nextConsentStatus);
      if (nextAccountStatus?.inviteSyncError) {
        setNotice("账户身份已加载，但学校邀请同步需要稍后再试。");
      } else if (nonFatalNotice) {
        setNotice(nonFatalNotice);
      }
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "账户信息加载失败。");
    } finally {
      setLoading(false);
      setIdentityChecking(false);
    }
  }

  useEffect(() => {
    async function loadAccount() {
      try {
        const handledRedirect = await withTimeout(handleAuthRedirect(), 8_000);
        if (handledRedirect) setNotice("登录成功，已进入你的账户。");
      } catch (redirectError) {
        setError(redirectError instanceof Error ? redirectError.message : "登录链接处理失败，请重新发送验证码。");
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
          setWechatStatus("微信绑定成功。");
          setWechatBindSession(null);
          await refreshAccount();
        } else if (result.status === "expired") {
          window.clearInterval(interval);
          setWechatStatus("二维码已过期，请重新生成。");
          setWechatBindSession(null);
        }
      } catch (bindError) {
        window.clearInterval(interval);
        setWechatStatus(bindError instanceof Error ? bindError.message : "微信绑定状态检查失败。");
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
      setNotice("验证码已发送。请查看邮箱。");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "验证码发送失败。");
    } finally {
      otpRequestInFlight.current = false;
      setAuthLoading(false);
    }
  }

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    if (otp.trim().length < 8) {
      setError("请输入完整的 8 位验证码。");
      return;
    }
    setAuthLoading(true);
    try {
      await verifyEmailOtp(email.trim(), otp);
      setOtp("");
      setOtpSent(false);
      setNotice("登录成功。");
      await refreshAccount();
    } catch (loginError) {
      setError(otpErrorMessage(loginError));
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
      setNotice("新的验证码已发送。");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "验证码重新发送失败。");
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
      setError("请填写姓名。");
      return;
    }
    try {
      await saveProfile(user, name.trim(), role);
      await refreshAccount();
      setNotice("账号资料已保存。");
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "资料保存失败。");
    }
  }

  async function handleDeleteRecord(recordId: string) {
    setNotice("");
    setError("");
    try {
      await deleteCloudSweetRecord(recordId);
      setRecords(await listCloudSweetRecords());
      setNotice("记录已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除记录失败。");
    }
  }

  async function handleSignOut() {
    await signOut();
    setNotice("已退出登录。");
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
      setNotice("数据导出已开始下载。文件只保存在你的设备上。");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "账户数据导出失败。");
    } finally {
      setAccountActionLoading(false);
    }
  }

  async function handleAccountDeletion() {
    if (!user?.email || !deletionAcknowledged || deletionEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      setError("请输入当前登录邮箱，并勾选不可恢复确认。");
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
        ? "账号已注销。少量内部清理已进入安全队列，不影响你停止使用服务。"
        : "账号及关联数据已注销，当前设备也已退出登录。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "账户注销失败。");
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
      setNotice(ageBand === "under_14" ? "当前试点暂不接收 14 岁以下学生，请联系学校负责人。" : ageBand === "18_plus" ? "知情确认已完成。" : "学生确认已记录，下一步请已关联的监护人登录完成确认。");
    } catch (consentError) {
      setError(consentError instanceof Error ? consentError.message : "学生确认提交失败。");
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
      setNotice("监护人确认已记录，孩子可以使用云端保存和社区发布功能。");
    } catch (consentError) {
      setError(consentError instanceof Error ? consentError.message : "监护人确认提交失败。");
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
      setNotice("确认已撤回。新的云端记录、留言和社区发布已停止；已有数据将按保存与删除规则另行处理。");
    } catch (consentError) {
      setError(consentError instanceof Error ? consentError.message : "撤回确认失败。");
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
      setWechatStatus("请用微信扫描小程序码，完成后此页面会自动更新。");
    } catch (bindError) {
      setWechatStatus(bindError instanceof Error ? bindError.message : "微信绑定二维码生成失败。");
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
              <p className="text-sm font-bold text-sage">正在进入账户…</p>
            </div>
          </div>
        </section>
      ) : !user ? (
        <section className="section section-muted">
          <div className="container grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div className="max-w-xl">
              <p className="eyebrow">YouthTempo 账号</p>
              <h1 className="mt-3 text-[2rem] font-bold leading-tight text-ink sm:text-[2.7rem]">
                登录后继续记录
              </h1>
              <p className="mt-4 max-w-lg text-[0.95rem] leading-7 text-muted sm:text-base sm:leading-8">
                使用邮箱验证码登录。你的 SWEET 记录会保存在云端，换设备后仍可查看。
              </p>
              <div className="mt-7 grid gap-3 text-sm leading-6 text-muted sm:grid-cols-2">
                <p className="border-l-2 border-sage/45 pl-4">无需设置密码</p>
                <p className="border-l-2 border-sage/45 pl-4">首次登录会自动创建账号</p>
              </div>
            </div>

            <div className="w-full rounded-2xl border border-ink/10 bg-white/90 p-5 shadow-soft sm:p-7 lg:max-w-lg lg:justify-self-end">
              <p className="eyebrow">{otpSent ? "验证码已发送" : "邮箱登录"}</p>
              <h2 className="mt-2 text-[1.45rem] font-bold leading-tight text-ink sm:text-[1.7rem]">
                {otpSent ? "输入 8 位验证码" : "欢迎回来"}
              </h2>

              {!isSupabaseConfigured() ? (
                <div className="mt-6 rounded-2xl bg-cream px-4 py-4">
                  <p className="font-bold text-ink">账号服务暂不可用</p>
                  <p className="mt-2 text-sm leading-6 text-muted">请稍后再试，或通过联系我们页面反馈问题。</p>
                </div>
              ) : (
                <form className="mt-6 grid gap-4" onSubmit={otpSent ? handleOtpSubmit : handleLogin}>
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    邮箱
                    <input
                      className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/10 disabled:bg-cream disabled:text-ink/60"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                      type="email"
                      disabled={otpSent || authLoading}
                    />
                  </label>
                  {otpSent ? (
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      验证码
                      <input
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-center text-lg font-bold tracking-[0.22em] outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/10"
                        value={otp}
                        onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
                        placeholder="12345678"
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
                    {authLoading ? "请稍等..." : otpSent ? "登录" : "发送验证码"}
                  </button>
                  {otpSent ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <button
                        type="button"
                        className="font-bold text-sage-dark hover:text-sage disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={resendOtp}
                        disabled={authLoading || resendCooldown > 0}
                      >
                        {resendCooldown > 0 ? `${resendCooldown} 秒后可重新发送` : "重新发送验证码"}
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
                        更换邮箱
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
                  <p className="eyebrow">{needsPersonalProfile ? "首次登录" : "我的账户"}</p>
                  <h1 className="mt-2 overflow-hidden text-ellipsis text-[2rem] font-bold leading-tight text-ink sm:text-[2.5rem]">
                    {needsPersonalProfile ? "先完善你的资料" : `你好，${accountName}`}
                  </h1>
                  <p className="mt-3 max-w-2xl text-[0.95rem] leading-7 text-muted">
                    {needsPersonalProfile
                      ? "填写姓名并选择身份。之后登录时会直接进入你的记录页。"
                      : isParent
                        ? linkedChildren.length
                          ? `已关联 ${linkedChildren.map((child) => child.display_name).join("、")}，可以查看学校确认范围内的节律记录。`
                          : "亲子关系由学校管理员确认。关联完成后，这里会直接显示孩子的节律记录。"
                        : recordsDescription(displayRole, hasSchool)}
                  </p>
                </div>
                {!needsPersonalProfile ? (
                  <div className="grid shrink-0 gap-3 sm:flex">
                    {isPlatformAdmin ? <Link href="/admin" className="button-primary w-full sm:w-auto">进入平台管理</Link> : null}
                    {isSchoolLead ? <Link href="/admin" className="button-primary w-full sm:w-auto">进入学校管理</Link> : null}
                    {isSchoolLead ? <Link href="#records" className="button-secondary w-full sm:w-auto">查看学生记录</Link> : null}
                    {isSupportTeacher ? <Link href="#students" className="button-primary w-full sm:w-auto">查看负责学生</Link> : null}
                    {isSupportTeacher && adminAccess ? <Link href="/admin" className="button-secondary w-full sm:w-auto">跟进工作台</Link> : null}
                    {isParent ? <Link href="#records" className="button-primary w-full sm:w-auto">查看孩子记录</Link> : null}
                    {isParent ? <Link href="/referral" className="button-secondary w-full sm:w-auto">需要更多支持</Link> : null}
                    {displayRole === "学生" ? <Link href="/check-in" className="button-primary w-full sm:w-auto">记录今天</Link> : null}
                  </div>
                ) : null}
              </div>

              {needsPersonalProfile ? (
                <form className="mt-8 max-w-2xl rounded-2xl border border-ink/10 bg-white/90 p-5 shadow-soft sm:p-7" onSubmit={handleProfileSubmit}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      姓名
                      <input
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="怎么称呼你"
                        maxLength={50}
                        autoFocus
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      账号类型
                      <select
                        className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={role}
                        onChange={(event) => setRole(event.target.value)}
                      >
                        <option>学生</option>
                        <option>家长</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-5 grid gap-3 sm:flex">
                    <button type="submit" className="button-primary w-full sm:w-auto" disabled={!name.trim()}>
                      保存并继续
                    </button>
                    <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut}>
                      退出登录
                    </button>
                  </div>
                  {error ? <p className="mt-4 text-sm font-bold text-sage-dark">{error}</p> : null}
                </form>
              ) : (
                <div className="mt-8 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-ink/10 bg-white/80 px-5 py-5">
                    <p className="text-xs font-bold text-sage">当前身份</p>
                    <p className="mt-2 text-xl font-bold text-ink">{isIdentityLoading ? "正在确认" : confirmedRoleLabel}</p>
                    <p className="mt-2 overflow-hidden text-ellipsis text-sm text-muted">{user.email}</p>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-white/80 px-5 py-5">
                    <p className="text-xs font-bold text-sage">可见记录</p>
                    <p className="mt-2 text-xl font-bold text-ink">{records.length} 条</p>
                    <p className="mt-2 text-sm text-muted">保存在当前账号</p>
                  </div>
                  {!isIdentityLoading && displayRole === "学生" ? (
                    <div className="rounded-2xl border border-sage/30 bg-mist/70 px-5 py-5">
                      <p className="text-xs font-bold text-sage">最近 7 天</p>
                      <p className="mt-2 text-xl font-bold text-ink">{recentRecordDays} 天有记录</p>
                      <p className="mt-2 text-sm text-muted">不需要每天都完成</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-ink/10 bg-white/80 px-5 py-5">
                      <p className="text-xs font-bold text-sage">学校空间</p>
                      <p className="mt-2 text-xl font-bold text-ink">{isIdentityLoading ? "正在确认" : hasSchool ? "已加入" : "未加入"}</p>
                      <p className="mt-2 text-sm text-muted">由学校管理员配置</p>
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
                  <p className="eyebrow">试点知情同意</p>
                  <h2 className="mt-2 text-2xl font-bold text-ink">学生本人和监护人都清楚数据如何使用</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
                    SWEET 回答、AI 小结和“想说的话”可能包含敏感生活与健康信息。我们只用于提供节律整理和学校支持，不用于广告或公开展示；学生或监护人可随时撤回。完整说明见
                    <Link href="/privacy-safety#student-consent" className="ml-1 font-bold text-sage-dark underline underline-offset-4">隐私与安全</Link>。
                  </p>

                  {consentStatus.role === "student" && consentStatus.consent ? (
                    <div className="mt-6 rounded-2xl bg-white/85 p-5">
                      {consentStatus.consent.status === "active" ? (
                        <>
                          <p className="font-bold text-sage-dark">已完成知情确认</p>
                          <p className="mt-2 text-sm leading-6 text-muted">当前版本：{consentStatus.policyVersion}。可以保存 SWEET 记录、发送留言和参与社区发布。</p>
                          <button type="button" className="button-secondary mt-4" disabled={consentLoading} onClick={() => handleWithdrawConsent()}>撤回确认</button>
                        </>
                      ) : consentStatus.consent.status === "pending_guardian" ? (
                        <>
                          <p className="font-bold text-ink">学生确认已完成，等待监护人确认</p>
                          <p className="mt-2 text-sm leading-6 text-muted">{consentStatus.consent.hasLinkedGuardian ? "请已关联家长登录自己的账户完成确认。" : "当前还没有学校确认的监护人关联，请联系学校负责人。"}</p>
                          <button type="button" className="button-secondary mt-4" disabled={consentLoading} onClick={() => handleWithdrawConsent()}>撤回学生确认</button>
                        </>
                      ) : (
                        <>
                          {consentStatus.consent.status === "ineligible" ? <p className="mb-4 rounded-xl bg-cream px-4 py-3 text-sm font-bold text-sage-dark">当前试点面向 14–18 岁在校青少年。14 岁以下请由监护人联系学校负责人。</p> : null}
                          <label className="grid max-w-md gap-2 text-sm font-bold text-ink">
                            你的年龄范围（不收集具体生日）
                            <select className="rounded-xl border border-ink/15 bg-white px-4 py-3" value={ageBand} onChange={(event) => setAgeBand(event.target.value as typeof ageBand)}>
                              <option value="14_17">14–17 岁</option>
                              <option value="18_plus">已满 18 岁</option>
                              <option value="under_14">未满 14 岁</option>
                            </select>
                          </label>
                          <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-muted">
                            <input type="checkbox" className="mt-1" checked={consentRead} onChange={(event) => setConsentRead(event.target.checked)} />
                            <span>我已阅读说明，理解会处理哪些信息、用途、谁能查看以及如何撤回，并自愿确认。</span>
                          </label>
                          <button type="button" className="button-primary mt-4 disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45" disabled={consentLoading || !consentRead} onClick={handleStudentAssent}>{consentLoading ? "正在提交…" : "完成学生确认"}</button>
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
                            <><p className="mt-2 text-sm text-muted">学生与监护人确认均已完成。</p><button type="button" className="button-secondary mt-4" disabled={consentLoading} onClick={() => handleWithdrawConsent(child.studentUserId)}>撤回监护人确认</button></>
                          ) : child.status === "pending_guardian" ? (
                            <><p className="mt-2 text-sm leading-6 text-muted">孩子已完成学生确认。请确认你理解数据范围、用途、学校可见范围和撤回方式。</p><button type="button" className="button-primary mt-4" disabled={consentLoading} onClick={() => handleGuardianConsent(child.studentUserId)}>{consentLoading ? "正在提交…" : "同意孩子参加试点"}</button></>
                          ) : (
                            <p className="mt-2 text-sm text-muted">等待孩子先登录自己的账户阅读说明并完成学生确认。</p>
                          )}
                        </div>
                      )) : <p className="rounded-xl bg-white/80 px-4 py-3 text-sm text-muted">尚未关联孩子。亲子关系需由学校负责人确认。</p>}
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
                  账户设置
                  <span className="ml-2 font-normal text-muted">资料、数据导出、注销与退出</span>
                </summary>
                <div className="border-t border-ink/10 px-5 py-6 sm:px-6">
                  <div className="inline-flex max-w-full flex-wrap rounded-xl bg-cream p-1 text-sm font-bold">
                    <button
                      type="button"
                      className={`rounded-lg px-4 py-2 transition ${accountTab === "profile" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                      onClick={() => setAccountTab("profile")}
                    >
                      {isExternallyManagedRole ? "学校身份" : "账号资料"}
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-4 py-2 transition ${accountTab === "wechat" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                      onClick={() => setAccountTab("wechat")}
                    >
                      微信绑定
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-4 py-2 transition ${accountTab === "data" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                      onClick={() => setAccountTab("data")}
                    >
                      数据与注销
                    </button>
                  </div>

                  <div className="mt-6 max-w-2xl">
                    {accountTab === "profile" ? (
                      isIdentityLoading ? (
                        <p className="rounded-xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark">正在确认身份…</p>
                      ) : isExternallyManagedRole ? (
                        <div className="grid gap-4">
                          <div className="rounded-xl bg-cream px-4 py-4">
                            <p className="text-xs font-bold text-sage">当前身份</p>
                            <p className="mt-2 text-lg font-bold text-ink">{confirmedRoleLabel}</p>
                            <p className="mt-2 text-sm leading-6 text-muted">
                              {isSchoolAssignedStudent ? "学校已经为这个账号配置学生身份。" : null}
                              {displayRole === "学校负责人" ? "你可以在管理台配置本校学生和支持老师。" : null}
                              {displayRole === "支持老师" ? "你可以查看学校分配给你的学生记录。" : null}
                              {displayRole === "平台管理员" ? "你可以创建学校空间并指定负责人。" : null}
                            </p>
                          </div>
                          <button type="button" className="button-secondary w-full sm:w-fit" onClick={handleSignOut}>退出登录</button>
                        </div>
                      ) : (
                        <form className="grid gap-4" onSubmit={handleProfileSubmit}>
                          <label className="grid gap-2 text-sm font-bold text-ink">
                            姓名
                            <input className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage" value={name} onChange={(event) => setName(event.target.value)} />
                          </label>
                          <label className="grid gap-2 text-sm font-bold text-ink">
                            账号类型
                            <select
                              className="rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                              value={role}
                              onChange={(event) => setRole(event.target.value)}
                            >
                              <option>学生</option>
                              <option>家长</option>
                            </select>
                          </label>
                          <div className="grid gap-3 sm:flex">
                            <button type="submit" className="button-primary w-full sm:w-auto">保存资料</button>
                            <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut}>退出登录</button>
                          </div>
                        </form>
                      )
                    ) : accountTab === "wechat" ? (
                      <div className="grid gap-4">
                        <p className="text-[0.95rem] leading-7 text-muted">
                          绑定后，可以在小程序中使用同一个 YouthTempo 账号。
                        </p>
                        {wechatBindSession ? (
                          <div className="w-fit rounded-2xl border border-ink/10 bg-white p-3">
                            <img src={wechatBindSession.qrCodeDataUrl} alt="微信小程序绑定码" className="aspect-square w-44 rounded-xl object-contain" />
                            <p className="mt-2 max-w-44 text-center text-xs leading-5 text-muted">二维码 10 分钟内有效</p>
                          </div>
                        ) : (
                          <p className="rounded-xl bg-cream px-4 py-3 text-sm text-muted">
                            {wechatIdentities.length > 0 ? "已绑定微信。" : "尚未绑定微信。"}
                          </p>
                        )}
                        <button
                          type="button"
                          className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit"
                          onClick={handleCreateWechatBindSession}
                          disabled={wechatLoading}
                        >
                          {wechatLoading ? "正在生成..." : wechatIdentities.length > 0 ? "重新生成绑定码" : "生成微信绑定码"}
                        </button>
                        {wechatStatus ? <p className="text-sm font-bold text-sage-dark">{wechatStatus}</p> : null}
                      </div>
                    ) : (
                      <div className="grid gap-6">
                        <div className="rounded-2xl border border-sage/20 bg-mint/35 p-5">
                          <p className="font-bold text-ink">下载我的数据</p>
                          <p className="mt-2 text-sm leading-7 text-muted">
                            下载账号资料、你自己的 SWEET 记录、留言、社区内容、同意记录和学校关系。文件为 JSON，服务器不会保存导出副本。
                          </p>
                          <button type="button" className="button-secondary mt-4" disabled={accountActionLoading} onClick={handleDataExport}>
                            {accountActionLoading ? "正在处理…" : "下载数据副本"}
                          </button>
                        </div>

                        <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5">
                          <p className="font-bold text-ink">永久注销账号</p>
                          <p className="mt-2 text-sm leading-7 text-muted">
                            注销后，账号、SWEET 记录、留言、学校关系、微信绑定和社区内容会从生产数据库删除，无法恢复。建议先下载数据副本。平台管理员需先由另一位管理员撤销平台权限。
                          </p>
                          <label className="mt-4 grid gap-2 text-sm font-bold text-ink">
                            输入当前登录邮箱确认
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
                            <span>我理解注销会永久删除账号关联数据，且无法撤销。</span>
                          </label>
                          <button
                            type="button"
                            className="mt-4 rounded-xl border border-red-300 bg-white px-5 py-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
                            disabled={accountActionLoading || !deletionAcknowledged || deletionEmail.trim().toLowerCase() !== user.email?.trim().toLowerCase()}
                            onClick={handleAccountDeletion}
                          >
                            {accountActionLoading ? "正在处理…" : "永久注销账号"}
                          </button>
                        </div>
                        <p className="text-sm leading-7 text-muted">
                          具体保存期限、注销后的最小安全审计和备份处理说明见
                          <Link href="/privacy-safety#account-data" className="ml-1 font-bold text-sage-dark underline underline-offset-4">隐私与安全</Link>。
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
            <SectionHeader title={isParent ? "孩子的节律概览" : "我负责的学生"} />
            {relatedPeople.length ? (
              <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
                <aside className="card">
                  <p className="text-sm font-bold text-ink">{isParent ? "选择孩子" : "学生列表"}</p>
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
                              ? `近 4 周 ${personOverview.activeDays} 天有记录`
                              : `近 7 天 ${personOverview.activeDays} 天有记录`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <div className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="eyebrow">{isParent ? "近 4 周" : "近 7 天"}</p>
                      <h2 className="mt-2 text-[1.5rem] font-bold text-ink">
                        {activeRelatedPerson?.display_name || "节律概览"}
                      </h2>
                    </div>
                    <span className="rounded-full bg-cream px-4 py-2 text-sm font-bold text-sage-dark">
                      {relatedOverview.activeDays} 天有记录
                    </span>
                  </div>

                  {relatedOverview.recordCount ? (
                    <>
                      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        {relatedOverview.dimensions.map((dimension) => (
                          <div key={dimension.id} className="rounded-2xl border border-ink/10 bg-white px-4 py-4">
                            <p className="text-xs font-bold text-sage">{dimension.label}</p>
                            <p className="mt-2 text-sm font-bold leading-6 text-ink">{dimension.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 rounded-2xl bg-cream px-5 py-5">
                        <p className="text-xs font-bold text-sage-dark">最近小结</p>
                        <p className="mt-2 text-sm leading-7 text-muted">
                          {relatedOverview.latestSummary || "最近一条记录还没有生成小结，可以在下方查看原始回答。"}
                        </p>
                      </div>
                      <a href="#records" className="button-secondary mt-5">
                        查看原始回答
                      </a>
                    </>
                  ) : (
                    <p className="mt-6 rounded-2xl bg-cream px-5 py-5 text-sm leading-7 text-muted">
                      {isParent ? "孩子暂时还没有保存 SWEET 记录。" : "这名学生近 7 天还没有保存 SWEET 记录。"}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="card">
                <p className="font-bold text-ink">
                  {isParent ? "暂时还没有关联孩子。" : "学校暂时还没有为你分配学生。"}
                </p>
                <p className="mt-2 text-sm leading-7 text-muted">
                  {isParent ? "请联系学校负责人确认亲子关系。" : "分配完成后，学生概览会显示在这里。"}
                </p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {user && !needsPersonalProfile && !isPlatformAdmin ? (
        <section id="records" className="section scroll-mt-24 pt-8 sm:pt-10 lg:pt-12">
          <div className="container">
            <SectionHeader title={recordsTitle(displayRole)} />
            {isParent && linkedChildren.length > 0 ? (
              <div className="mb-5 flex flex-wrap gap-2">
                {linkedChildren.map((child) => (
                  <span key={child.id} className="rounded-full bg-mint px-4 py-2 text-sm font-bold text-sage-dark">
                    {child.display_name}
                  </span>
                ))}
              </div>
            ) : null}
            {loading ? <div className="rounded-2xl border border-ink/10 bg-white/75 px-5 py-6 text-sm font-bold text-muted">正在加载记录…</div> : null}
            {!loading && records.length > 0 ? (
              <div className="grid gap-5">
                {records.map((record) => {
                  const canDelete = record.user_id === user.id;
                  return (
                    <article key={record.id} className="card">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-sage">{formatDate(record.created_at)}</p>
                          <h3 className="mt-2 text-lg font-bold text-ink sm:text-xl">
                            {linkedChildById.get(record.user_id)?.display_name
                              ? `${linkedChildById.get(record.user_id)?.display_name}的 SWEET 记录`
                              : "SWEET 节律记录"}
                          </h3>
                        </div>
                        {canDelete ? (
                          <button type="button" className="button-secondary w-full px-4 py-2 text-xs sm:w-auto" onClick={() => handleDeleteRecord(record.id)}>删除</button>
                        ) : null}
                      </div>
                      <details className="mt-4 rounded-xl border border-ink/10 bg-white/70">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-sage-dark">
                          查看完整记录
                        </summary>
                        <div className="grid gap-5 border-t border-ink/10 px-4 py-5">
                          {record.records.map((step) => (
                            <div key={step.id}>
                              <h4 className="text-sm font-bold text-ink">{step.label} · {step.title}</h4>
                              <dl className="mt-3 grid gap-3">
                                {step.fields.map((field) => (
                                  <div key={field.id} className="rounded-xl bg-cream px-4 py-3">
                                    <dt className="text-xs font-bold leading-5 text-muted">{field.title}</dt>
                                    <dd className="mt-1 text-sm font-bold leading-6 text-ink/85">{formatRecordValue(field.value)}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ))}
                        </div>
                      </details>
                      {record.summary ? <p className="mt-4 text-[0.95rem] leading-7 text-muted">{record.summary}</p> : null}
                      {record.small_step ? <p className="mt-4 rounded-xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">可以先做的一件小事：{record.small_step}</p> : null}
                      {record.recommended_next_tool ? <p className="mt-3 text-sm leading-7 text-muted">推荐下一步：{record.recommended_next_tool}</p> : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
            {!loading && records.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sage/40 bg-white/55 px-5 py-6 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:px-7">
                <div>
                  <h3 className="text-lg font-bold text-ink">暂时没有可见记录</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">{emptyRecordsDescription(displayRole)}</p>
                </div>
                <div className="mt-5 shrink-0 sm:mt-0">
                  {displayRole === "学生" ? <Link href="/check-in" className="button-primary w-full sm:w-auto">开始记录</Link> : null}
                  {displayRole === "家长" && linkedChildren.length === 0 ? <Link href="/contact" className="button-secondary w-full sm:w-auto">联系学校确认关系</Link> : null}
                  {adminAccess ? <Link href="/admin" className="button-secondary w-full sm:w-auto">进入管理台</Link> : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
