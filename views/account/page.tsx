import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { SectionHeader } from "@/components/SectionHeader";
import {
  AccountStatus,
  CloudProfile,
  CloudSweetRecord,
  WechatBindSession,
  WechatIdentity,
  checkWechatBindSession,
  createWechatBindSession,
  deleteCloudSweetRecord,
  getAccountStatus,
  getCurrentUser,
  getProfile,
  handleAuthRedirect,
  listCloudSweetRecords,
  listWechatIdentities,
  saveProfile,
  sendEmailOtp,
  signOut,
  verifyEmailOtp,
} from "@/lib/cloudRecords";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

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
  if (value === "学校支持人员") return "支持老师";
  return "学生";
}

function recordsTitle(role: string) {
  if (role === "平台管理员") return "试点 SWEET 记录";
  if (role === "学校负责人") return "本校学生的 SWEET 记录";
  if (role === "支持老师") return "负责学生的 SWEET 记录";
  if (role === "家长") return "这个账号保存的 SWEET 记录";
  return "我的 SWEET 历史记录";
}

function recordsDescription(role: string, hasSchool: boolean) {
  if (role === "平台管理员") return "查看试点记录概况，具体学校管理请进入试点管理台。";
  if (role === "学校负责人") return "查看本校学生提交的记录，并进入管理台配置成员。";
  if (role === "支持老师") return "这里只显示由学校分配给你的学生记录。";
  if (role === "家长") return "目前只显示这个账号自己保存的记录，不会自动显示孩子的记录。";
  if (hasSchool) return "你保存的记录会出现在这里，并按照学校的支持安排开放给对应老师。";
  return "完成 SWEET 后保存，即可在这里回看。";
}

function emptyRecordsDescription(role: string) {
  if (role === "学生") return "完成一次 SWEET 节律记录并保存后，会显示在这里。";
  if (role === "家长") return "家长账号目前不会自动显示孩子的记录。家长入口提供观察和沟通指引。";
  if (role === "支持老师") return "学校负责人分配学生后，这里会显示你负责学生的记录。";
  if (role === "学校负责人") return "本校学生保存 SWEET 记录后，会显示在这里。";
  return "试点产生记录后，会显示在这里。";
}

function otpErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "验证码验证失败。";
  const lower = message.toLowerCase();
  if (lower.includes("token") || lower.includes("otp") || lower.includes("invalid") || lower.includes("expired")) {
    return "验证码不正确或已过期，请重新输入，或重新发送。";
  }
  return message || "验证码验证失败，请稍后重试。";
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
  const [name, setName] = useState("");
  const [role, setRole] = useState("学生");
  const [accountTab, setAccountTab] = useState<"profile" | "wechat">("profile");
  const [loading, setLoading] = useState(true);
  const [identityChecking, setIdentityChecking] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const isIdentityLoading = Boolean(user && identityChecking);
  const displayRole = isIdentityLoading ? "正在确认" : accountStatus?.displayRole || profileRoleLabel(profile?.role || role);
  const adminAccess = accountStatus?.adminAccess || null;
  const hasSchool = Boolean(accountStatus?.hasSchool || profile?.school_id);
  const isManagedSchoolRole = !isIdentityLoading && (displayRole === "学校负责人" || displayRole === "支持老师" || displayRole === "平台管理员");
  const isSchoolAssignedStudent = !isIdentityLoading && displayRole === "学生" && hasSchool;
  const isExternallyManagedRole = isManagedSchoolRole || isSchoolAssignedStudent;
  const confirmedRoleLabel = isSchoolAssignedStudent ? "学校学生" : displayRole;
  const recentRecordDays = countRecentRecordDays(records, user?.id);
  const accountName = profile?.display_name?.trim() || user?.email || "你的账户";
  const isInitialAccountLoad = loading && !user;

  async function refreshAccount() {
    setLoading(true);
    setIdentityChecking(true);
    setError("");
    setNotice((currentNotice) => currentNotice || "");
    try {
      const currentUser = await getCurrentUser();
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

      const [nextRecords, nextWechatIdentities] = await Promise.all([
        listCloudSweetRecords().catch((recordsError) => {
          console.warn("Cloud records failed", recordsError);
          nonFatalNotice = nonFatalNotice || "记录暂时没有加载出来，请稍后刷新。";
          return [] as CloudSweetRecord[];
        }),
        listWechatIdentities().catch((wechatError) => {
          console.warn("Wechat identities failed", wechatError);
          return [] as WechatIdentity[];
        }),
      ]);

      setAccountStatus(nextAccountStatus);
      setProfile(nextProfile);
      setName(nextProfile?.display_name || currentUser.email?.split("@")[0] || "");
      setRole(profileRoleLabel(nextProfile?.role));
      setRecords(nextRecords);
      setWechatIdentities(nextWechatIdentities);
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
        const handledRedirect = await handleAuthRedirect();
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

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    setAuthLoading(true);
    try {
      await sendEmailOtp(email.trim());
      setOtpSent(true);
      setNotice("验证码已发送。请查看邮箱。");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "验证码发送失败。");
    } finally {
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
    setNotice("");
    setError("");
    setAuthLoading(true);
    try {
      await sendEmailOtp(email.trim());
      setOtp("");
      setNotice("新的验证码已发送。");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "验证码重新发送失败。");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || isExternallyManagedRole) return;
    setNotice("");
    setError("");
    try {
      const nextProfile = await saveProfile(user, name.trim(), role);
      setProfile(nextProfile);
      setRole(profileRoleLabel(nextProfile.role));
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
    setAccountTab("profile");
    await refreshAccount();
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
                      <button type="button" className="font-bold text-sage-dark hover:text-sage" onClick={resendOtp} disabled={authLoading}>
                        重新发送验证码
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
                  <p className="eyebrow">我的账户</p>
                  <h1 className="mt-2 overflow-hidden text-ellipsis text-[2rem] font-bold leading-tight text-ink sm:text-[2.5rem]">
                    你好，{accountName}
                  </h1>
                  <p className="mt-3 max-w-2xl text-[0.95rem] leading-7 text-muted">
                    {recordsDescription(displayRole, hasSchool)}
                  </p>
                </div>
                <div className="grid shrink-0 gap-3 sm:flex">
                  {adminAccess ? <Link href="/admin" className="button-secondary w-full sm:w-auto">进入管理台</Link> : null}
                  {displayRole === "学生" ? <Link href="/check-in" className="button-primary w-full sm:w-auto">记录今天</Link> : null}
                </div>
              </div>

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
                    <p className="mt-2 text-sm text-muted">由试点学校配置</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
            <div className="container">
              <details className="rounded-2xl border border-ink/10 bg-white/70">
                <summary className="cursor-pointer px-5 py-4 text-sm font-bold text-ink sm:px-6">
                  账户设置
                  <span className="ml-2 font-normal text-muted">资料、微信绑定与退出</span>
                </summary>
                <div className="border-t border-ink/10 px-5 py-6 sm:px-6">
                  <div className="inline-flex rounded-xl bg-cream p-1 text-sm font-bold">
                    <button
                      type="button"
                      className={`rounded-lg px-4 py-2 transition ${accountTab === "profile" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                      onClick={() => setAccountTab("profile")}
                    >
                      {isExternallyManagedRole ? "试点身份" : "账号资料"}
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-4 py-2 transition ${accountTab === "wechat" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                      onClick={() => setAccountTab("wechat")}
                    >
                      微信绑定
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
                            昵称
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
                    ) : (
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
                    )}
                  </div>
                  {notice ? <p className="mt-5 text-sm font-bold text-sage-dark">{notice}</p> : null}
                  {error ? <p className="mt-5 text-sm font-bold text-sage-dark">{error}</p> : null}
                </div>
              </details>
            </div>
          </section>
        </>
      )}

      {user ? (
        <section className="section pt-8 sm:pt-10 lg:pt-12">
          <div className="container">
            <SectionHeader title={recordsTitle(displayRole)} />
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
                          <h3 className="mt-2 text-lg font-bold text-ink sm:text-xl">SWEET 节律记录</h3>
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
                  {displayRole === "家长" ? <Link href="/for-parents" className="button-secondary w-full sm:w-auto">查看家长入口</Link> : null}
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
