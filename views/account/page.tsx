import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { PageHero } from "@/components/PageHero";
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
import { getSavedSweetRecords } from "@/lib/localRecords";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function recordPreview(record: CloudSweetRecord) {
  return record.records
    .map((step) => {
      const filled = step.fields.filter((field) =>
        Array.isArray(field.value) ? field.value.length > 0 : String(field.value || "").trim().length > 0,
      );
      return `${step.label} ${filled.length}/${step.fields.length}`;
    })
    .join(" / ");
}

function profileRoleLabel(value?: string | null) {
  if (value === "家长") return "家长";
  if (value === "学校支持人员") return "支持老师";
  return "学生";
}

function recordsTitle(role: string) {
  if (role === "学校负责人") return "本校 SWEET 记录";
  if (role === "支持老师") return "本校 SWEET 记录";
  if (role === "家长") return "孩子分享的 SWEET 记录";
  return "我的 SWEET 历史记录";
}

function recordsDescription(role: string, hasSchool: boolean) {
  if (role === "学校负责人") return "这里显示你负责学校里的学生 SWEET 记录。你也可以进入试点管理台配置本校成员。";
  if (role === "支持老师") return "这里显示你所在学校空间中学生的 SWEET 记录，用于试点支持和早期识别。";
  if (role === "家长") return "家长端暂时不默认开放记录查看。后续会根据学校试点和家庭同意流程单独设计。";
  if (hasSchool) return "你在学校试点空间中的 SWEET 记录会保存在这里，学校支持人员可用于支持和跟进。";
  return "完成 SWEET 后点击保存，记录会出现在这里。当前账号还没有加入学校试点空间。";
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
  const [localCount, setLocalCount] = useState(0);
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

  async function refreshAccount() {
    setLoading(true);
    setIdentityChecking(true);
    setError("");
    setNotice((currentNotice) => currentNotice || "");
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      setLocalCount(getSavedSweetRecords().length);
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
          nonFatalNotice = nonFatalNotice || "账户资料暂时没有加载完整，但不影响退出登录或重新尝试。";
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
      setNotice("账户资料已保存。");
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
      <PageHero
        label="Account & Records"
        title="登录与我的记录"
        subtitle="YouthTempo 面向学校试点场景：学生记录自己的 SWEET 节律，学校支持人员在学校空间内查看学生记录，用于更早支持。"
      />

      {!isSupabaseConfigured() ? (
        <section className="section section-muted">
          <div className="container">
            <div className="card">
              <h2 className="text-[1.7rem] font-bold text-ink">需要先连接 Supabase</h2>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                账号、数据库和学校空间管理已经写入代码。请在 Vercel 环境变量里添加 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY，并在 Supabase 执行 supabase/schema.sql。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="section section-muted">
        <div className="container grid gap-5 lg:grid-cols-[0.95fr_1.05fr] lg:gap-8">
          <div className="card">
            <p className="eyebrow">{user ? "已登录" : "登录"}</p>
            <h2 className="mt-3 text-[1.5rem] font-bold leading-[1.25] text-ink sm:text-[1.7rem]">
              {user
                ? isIdentityLoading
                  ? "正在确认身份"
                  : accountTab === "wechat"
                    ? "微信绑定"
                    : isExternallyManagedRole
                      ? "试点身份"
                      : "账户资料"
                : otpSent
                  ? "输入验证码"
                  : "邮箱登录"}
            </h2>
            {user ? (
              <>
                <div className="mt-5 inline-flex rounded-2xl bg-cream p-1 text-sm font-bold">
                  <button
                    type="button"
                    className={`rounded-xl px-4 py-2 transition ${accountTab === "profile" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                    onClick={() => setAccountTab("profile")}
                  >
                    {isExternallyManagedRole ? "试点身份" : "账户资料"}
                  </button>
                  <button
                    type="button"
                    className={`rounded-xl px-4 py-2 transition ${accountTab === "wechat" ? "bg-white text-ink shadow-sm" : "text-ink/55"}`}
                    onClick={() => setAccountTab("wechat")}
                  >
                    微信绑定
                  </button>
                </div>
                {accountTab === "profile" ? (
                  isIdentityLoading ? (
                    <div className="mt-6 grid gap-4">
                      <p className="overflow-hidden text-ellipsis rounded-2xl bg-cream px-4 py-3 text-sm font-bold text-ink/75">{user.email}</p>
                      <div className="rounded-2xl border border-sage/35 bg-mint px-4 py-4 text-sm leading-7 text-muted">
                        <p className="text-xs font-bold text-sage-dark">正在同步账户身份</p>
                        <p className="mt-2 text-xl font-bold text-ink">请稍等一下</p>
                        <p className="mt-2">系统正在确认这个邮箱是否已加入学校试点空间。确认完成前不会要求你填写学生或家长资料。</p>
                      </div>
                      <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut}>退出登录</button>
                    </div>
                  ) : isExternallyManagedRole ? (
                    <div className="mt-6 grid gap-4">
                      <p className="overflow-hidden text-ellipsis rounded-2xl bg-cream px-4 py-3 text-sm font-bold text-ink/75">{user.email}</p>
                      <div className="rounded-2xl border border-sage/35 bg-mint px-4 py-4 text-sm leading-7 text-muted">
                        <p className="text-xs font-bold text-sage-dark">当前试点身份</p>
                        <p className="mt-2 text-xl font-bold text-ink">{confirmedRoleLabel}</p>
                        <p className="mt-2">
                          这个身份由 YouthTempo 试点管理配置，不需要自己选择学生或家长身份。
                          {isSchoolAssignedStudent ? "你已经加入学校试点空间，可以继续完成 SWEET 记录；学校支持老师和学校负责人会在学校空间内查看记录，用于支持和跟进。" : null}
                          {displayRole === "学校负责人" ? "你可以进入试点管理台添加本校学生和支持老师。" : null}
                          {displayRole === "支持老师" ? "你可以查看本校学生记录，用于试点支持。" : null}
                          {displayRole === "平台管理员" ? "你可以创建学校空间，并指定学校负责人。" : null}
                        </p>
                      </div>
                      <div className="grid gap-3 sm:flex sm:flex-wrap">
                        {adminAccess ? <Link href="/admin" className="button-primary w-full text-center sm:w-auto">进入试点管理台</Link> : null}
                        <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut}>退出登录</button>
                      </div>
                    </div>
                  ) : (
                    <form className="mt-6 grid gap-4" onSubmit={handleProfileSubmit}>
                      <p className="overflow-hidden text-ellipsis rounded-2xl bg-cream px-4 py-3 text-sm font-bold text-ink/75">{user.email}</p>
                      <label className="grid gap-2 text-sm font-bold text-ink">
                        昵称
                        <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={name} onChange={(event) => setName(event.target.value)} />
                      </label>
                      <label className="grid gap-2 text-sm font-bold text-ink">
                        账号类型
                        <select
                          className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage"
                          value={role}
                          onChange={(event) => setRole(event.target.value)}
                        >
                          <option>学生</option>
                          <option>家长</option>
                        </select>
                      </label>
                      <p className="rounded-2xl bg-cream px-4 py-3 text-sm leading-7 text-muted">
                        学校试点中，学生加入学校空间后，本校支持老师和学校负责人可查看学生记录。学校归属由学校统一配置。
                      </p>
                      <div className="grid gap-3 sm:flex sm:flex-wrap">
                        <button type="submit" className="button-primary w-full sm:w-auto">保存资料</button>
                        <button type="button" className="button-secondary w-full sm:w-auto" onClick={handleSignOut}>退出登录</button>
                      </div>
                    </form>
                  )
                ) : (
                  <div className="mt-6 grid gap-4">
                    <p className="text-[0.95rem] leading-7 text-muted">
                      生成绑定码后用微信扫描进入小程序，绑定成功后这个微信身份会关联到当前账户。绑定不影响邮箱登录，也不会改变已有记录。
                    </p>
                    {wechatBindSession ? (
                      <div className="rounded-3xl border border-ink/10 bg-white p-3">
                        <img src={wechatBindSession.qrCodeDataUrl} alt="微信小程序绑定码" className="mx-auto aspect-square w-44 rounded-2xl object-contain" />
                        <p className="mt-3 text-center text-sm leading-7 text-muted">二维码 10 分钟内有效。扫码后小程序会完成绑定，网页会自动刷新状态。</p>
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-cream px-4 py-4 text-sm leading-7 text-muted">
                        {wechatIdentities.length > 0 ? "当前账户已经绑定微信，可继续使用邮箱登录和云端记录。" : "还没有绑定微信。生成绑定码后，二维码会显示在这里。"}
                      </div>
                    )}
                    <button
                      type="button"
                      className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto"
                      onClick={handleCreateWechatBindSession}
                      disabled={wechatLoading}
                    >
                      {wechatLoading ? "正在生成..." : wechatIdentities.length > 0 ? "重新生成绑定码" : "生成微信绑定码"}
                    </button>
                    {wechatStatus ? <p className="text-sm font-bold text-sage-dark">{wechatStatus}</p> : null}
                  </div>
                )}
              </>
            ) : (
              <form className="mt-6 grid gap-4" onSubmit={otpSent ? handleOtpSubmit : handleLogin}>
                {!otpSent ? (
                  <p className="text-[0.95rem] leading-7 text-muted">输入邮箱，获取 8 位验证码。</p>
                ) : null}
                <label className="grid gap-2 text-sm font-bold text-ink">
                  邮箱
                  <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage disabled:bg-cream disabled:text-ink/60" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" disabled={otpSent || authLoading} />
                </label>
                {otpSent ? (
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    8 位验证码
                    <input
                      className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-center text-lg font-bold outline-none focus:border-sage"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="12345678"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />
                  </label>
                ) : null}
                <div className="grid gap-3 sm:flex sm:flex-wrap">
                  <button type="submit" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-auto" disabled={authLoading || !email.trim() || (otpSent && otp.trim().length === 0)}>
                    {authLoading ? "请稍等..." : otpSent ? "登录" : "发送验证码"}
                  </button>
                  {otpSent ? (
                    <button type="button" className="button-secondary w-full sm:w-auto" onClick={resendOtp} disabled={authLoading}>
                      重新发送
                    </button>
                  ) : null}
                </div>
              </form>
            )}
            {notice ? <p className="mt-4 text-sm font-bold text-sage-dark">{notice}</p> : null}
            {error ? <p className="mt-4 text-sm font-bold text-sage-dark">{error}</p> : null}
          </div>

          <div className="card">
            <h2 className="text-[1.5rem] font-bold leading-[1.25] text-ink sm:text-[1.7rem]">账户概览</h2>
            <div className="mt-6 grid gap-3">
              <div className="rounded-2xl bg-cream px-4 py-4">
                <p className="text-xs font-bold text-sage">当前身份</p>
                <p className="mt-2 overflow-hidden text-ellipsis text-base font-bold text-ink">{profile?.display_name || user?.email || "未登录"}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{user ? `账号类型：${isIdentityLoading ? "正在确认试点身份..." : confirmedRoleLabel}` : "登录后可保存云端记录和学校空间信息。"}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-ink/10 bg-white/75 px-4 py-4">
                  <p className="text-xs font-bold text-sage">可见记录</p>
                  <p className="mt-2 text-2xl font-bold text-ink">{records.length} 条</p>
                  <p className="mt-2 text-sm leading-6 text-muted">根据账号角色和学校空间显示。</p>
                </div>
                <div className="rounded-2xl border border-ink/10 bg-white/75 px-4 py-4">
                  <p className="text-xs font-bold text-sage">学校空间</p>
                  <p className="mt-2 text-2xl font-bold text-ink">{isIdentityLoading ? "确认中" : hasSchool ? "已加入" : "未加入"}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">由试点学校统一配置。</p>
                </div>
              </div>
              {displayRole === "学生" && !isIdentityLoading ? (
                <div className="rounded-2xl border border-ink/10 bg-white/75 px-4 py-4">
                  <p className="text-xs font-bold text-sage">本地备份</p>
                  <p className="mt-2 text-2xl font-bold text-ink">{localCount} 条</p>
                  <p className="mt-2 text-sm leading-6 text-muted">保留在当前浏览器。</p>
                </div>
              ) : null}
              {adminAccess ? (
                <div className="rounded-2xl border border-sage/45 bg-mint px-4 py-4">
                  <p className="text-xs font-bold text-sage-dark">管理权限</p>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {adminAccess.scope === "platform"
                      ? "你可以创建学校空间，并指定学校负责人。"
                      : "你可以管理自己学校的学生和支持老师。"}
                  </p>
                  <Link href="/admin" className="button-secondary mt-4 w-full text-center sm:w-fit">进入试点管理台</Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader title={recordsTitle(displayRole)} description={recordsDescription(displayRole, hasSchool)} />
          {loading ? <div className="card text-sm font-bold text-muted">正在加载记录……</div> : null}
          {!loading && records.length > 0 ? (
            <div className="grid gap-5">
              {records.map((record) => {
                const canDelete = displayRole === "学生" && record.user_id === user?.id;
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
                    <p className="mt-4 text-sm leading-7 text-muted">{recordPreview(record)}</p>
                    {record.summary ? <p className="mt-4 text-[0.95rem] leading-7 text-muted">{record.summary}</p> : null}
                    {record.small_step ? <p className="mt-4 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">可以先做的一件小事：{record.small_step}</p> : null}
                    {record.recommended_next_tool ? <p className="mt-3 text-sm leading-7 text-muted">推荐下一步：{record.recommended_next_tool}</p> : null}
                  </article>
                );
              })}
            </div>
          ) : null}
          {!loading && records.length === 0 ? (
            <div className="card">
              <h3 className="text-xl font-bold text-ink">暂时没有可见记录</h3>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                {displayRole === "学生"
                  ? "登录后完成一次 SWEET 节律记录，并在结果页保存。"
                  : "当学校空间中有学生记录，且你的试点身份配置完成后，会显示在这里。"}
              </p>
              {displayRole === "学生" ? <Link href="/check-in" className="button-primary mt-6 w-full sm:w-auto">开始 SWEET 节律记录</Link> : null}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
