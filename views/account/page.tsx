import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import {
  CloudProfile,
  CloudSweetRecord,
  UserPermission,
  createPermission,
  deleteCloudSweetRecord,
  getCurrentUser,
  getProfile,
  handleAuthRedirect,
  listCloudSweetRecords,
  listPermissions,
  revokePermission,
  saveProfile,
  sendMagicLink,
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

function permissionLabel(value: string) {
  if (value === "guardian_view") return "家长查看支持";
  if (value === "school_support") return "学校支持协作";
  return "试点反馈研究";
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [records, setRecords] = useState<CloudSweetRecord[]>([]);
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [localCount, setLocalCount] = useState(0);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("学生");
  const [granteeEmail, setGranteeEmail] = useState("");
  const [permissionType, setPermissionType] = useState("guardian_view");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refreshAccount() {
    setLoading(true);
    setError("");
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      setLocalCount(getSavedSweetRecords().length);
      if (!currentUser) {
        setProfile(null);
        setRecords([]);
        setPermissions([]);
        return;
      }
      const [nextProfile, nextRecords, nextPermissions] = await Promise.all([
        getProfile(currentUser),
        listCloudSweetRecords(),
        listPermissions(),
      ]);
      setProfile(nextProfile);
      setName(nextProfile?.display_name || currentUser.email?.split("@")[0] || "");
      setRole(nextProfile?.role || "学生");
      setRecords(nextRecords);
      setPermissions(nextPermissions);
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "账户信息加载失败。");
    } finally {
      setLoading(false);
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

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    setAuthLoading(true);
    try {
      await sendMagicLink(email.trim());
      setOtpSent(true);
      setNotice("验证码已发送到邮箱。请输入邮件里的 6 位验证码；如果邮件里只有登录按钮，也可以点击按钮完成登录。");
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
    setAuthLoading(true);
    try {
      await verifyEmailOtp(email.trim(), otp);
      setOtp("");
      setOtpSent(false);
      setNotice("登录成功。");
      await refreshAccount();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "验证码验证失败，请检查后重试。");
    } finally {
      setAuthLoading(false);
    }
  }

  async function resendOtp() {
    setNotice("");
    setError("");
    setAuthLoading(true);
    try {
      await sendMagicLink(email.trim());
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
    if (!user) return;
    setNotice("");
    setError("");
    try {
      const nextProfile = await saveProfile(user, name.trim(), role);
      setProfile(nextProfile);
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

  async function handlePermissionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    if (!granteeEmail.trim()) {
      setError("请填写被授权人的邮箱。");
      return;
    }
    try {
      await createPermission(granteeEmail, permissionType);
      setGranteeEmail("");
      setPermissions(await listPermissions());
      setNotice("授权已创建，可在下方随时撤销。");
    } catch (permissionError) {
      setError(permissionError instanceof Error ? permissionError.message : "创建授权失败。");
    }
  }

  async function handleRevokePermission(permissionId: string) {
    setNotice("");
    setError("");
    try {
      await revokePermission(permissionId);
      setPermissions(await listPermissions());
      setNotice("授权已撤销。");
    } catch (permissionError) {
      setError(permissionError instanceof Error ? permissionError.message : "撤销授权失败。");
    }
  }

  async function handleSignOut() {
    await signOut();
    setNotice("已退出登录。");
    await refreshAccount();
  }

  return (
    <>
      <PageHero
        label="Account & Records"
        title="登录与我的记录"
        subtitle="用邮箱登录后，可以保存 SWEET 节律记录、回看历史，并管理是否授权家长或学校支持者参与支持。"
      />

      {!isSupabaseConfigured() ? (
        <section className="section section-muted">
          <div className="container">
            <div className="card">
              <h2 className="text-[1.7rem] font-bold text-ink">需要先连接 Supabase</h2>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                账号、数据库和授权管理已经写入代码。请在 Vercel 环境变量里添加 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY，并在 Supabase 执行 supabase/schema.sql。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="section section-muted">
        <div className="container grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="card">
            <p className="eyebrow">{user ? "Signed in" : "Sign in"}</p>
            <h2 className="mt-3 text-[1.7rem] font-bold leading-[1.25] text-ink">
              {user ? "账户资料" : otpSent ? "输入邮箱验证码" : "邮箱验证码登录"}
            </h2>
            {user ? (
              <form className="mt-6 grid gap-4" onSubmit={handleProfileSubmit}>
                <p className="rounded-2xl bg-cream px-4 py-3 text-sm font-bold text-ink/75">{user.email}</p>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  昵称
                  <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  角色
                  <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={role} onChange={(event) => setRole(event.target.value)}>
                    <option>学生</option>
                    <option>家长</option>
                    <option>老师</option>
                    <option>学校合作方</option>
                  </select>
                </label>
                <div className="flex flex-wrap gap-3">
                  <button type="submit" className="button-primary">保存资料</button>
                  <button type="button" className="button-secondary" onClick={handleSignOut}>退出登录</button>
                </div>
              </form>
            ) : (
              <form className="mt-6 grid gap-4" onSubmit={otpSent ? handleOtpSubmit : handleLogin}>
                <p className="text-[0.95rem] leading-7 text-muted">
                  输入邮箱后会收到验证码，不需要记密码。邮件里的登录按钮也会保留，方便不同邮箱客户端使用。
                </p>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  邮箱
                  <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage disabled:bg-cream disabled:text-ink/60" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" disabled={otpSent || authLoading} />
                </label>
                {otpSent ? (
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    6 位验证码
                    <input
                      className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-center text-lg font-bold outline-none focus:border-sage"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <button type="submit" className="button-primary disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45" disabled={authLoading || !email.trim() || (otpSent && otp.length < 6)}>
                    {authLoading ? "请稍等..." : otpSent ? "验证并登录" : "发送验证码"}
                  </button>
                  {otpSent ? (
                    <button type="button" className="button-secondary" onClick={resendOtp} disabled={authLoading}>
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
            <p className="eyebrow">Account overview</p>
            <h2 className="mt-3 text-[1.7rem] font-bold leading-[1.25] text-ink">账户概览</h2>
            <div className="mt-6 grid gap-3">
              <div className="rounded-2xl bg-cream px-4 py-4">
                <p className="text-xs font-bold text-sage">当前身份</p>
                <p className="mt-2 text-base font-bold text-ink">{profile?.display_name || user?.email || "未登录"}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{user ? `角色：${profile?.role || role}` : "登录后可保存云端记录和授权设置。"}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-ink/10 bg-white/75 px-4 py-4">
                  <p className="text-xs font-bold text-sage">云端记录</p>
                  <p className="mt-2 text-2xl font-bold text-ink">{records.length} 条</p>
                  <p className="mt-2 text-sm leading-6 text-muted">登录后保存的 SWEET 历史。</p>
                </div>
                <div className="rounded-2xl border border-ink/10 bg-white/75 px-4 py-4">
                  <p className="text-xs font-bold text-sage">本地备份</p>
                  <p className="mt-2 text-2xl font-bold text-ink">{localCount} 条</p>
                  <p className="mt-2 text-sm leading-6 text-muted">保留在当前浏览器。</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader title="我的 SWEET 历史记录" description="完成 SWEET 后点击保存，记录会出现在这里。先看变化，不给自己贴标签。" />
          {loading ? <div className="card text-sm font-bold text-muted">正在加载记录……</div> : null}
          {!loading && records.length > 0 ? (
            <div className="grid gap-5">
              {records.map((record) => (
                <article key={record.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-sage">{formatDate(record.created_at)}</p>
                      <h3 className="mt-2 text-xl font-bold text-ink">SWEET 节律记录</h3>
                    </div>
                    <button type="button" className="button-secondary px-4 py-2 text-xs" onClick={() => handleDeleteRecord(record.id)}>删除</button>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-muted">{recordPreview(record)}</p>
                  {record.summary ? <p className="mt-4 text-[0.95rem] leading-7 text-muted">{record.summary}</p> : null}
                  {record.small_step ? <p className="mt-4 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">可以先做的一件小事：{record.small_step}</p> : null}
                  {record.recommended_next_tool ? <p className="mt-3 text-sm leading-7 text-muted">推荐下一步：{record.recommended_next_tool}</p> : null}
                </article>
              ))}
            </div>
          ) : null}
          {!loading && records.length === 0 ? (
            <div className="card">
              <h3 className="text-xl font-bold text-ink">还没有云端记录</h3>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">登录后完成一次 SWEET 节律记录，并在结果页保存。</p>
              <Link href="/check-in" className="button-primary mt-6">开始 SWEET 节律记录</Link>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader title="授权管理" description="需要别人一起支持时，再授权；不需要时，可以撤销。默认只显示你自己的记录。" />
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <form className="card grid gap-4" onSubmit={handlePermissionSubmit}>
              <label className="grid gap-2 text-sm font-bold text-ink">
                被授权人邮箱
                <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={granteeEmail} onChange={(event) => setGranteeEmail(event.target.value)} placeholder="parent@example.com" type="email" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-ink">
                授权类型
                <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={permissionType} onChange={(event) => setPermissionType(event.target.value)}>
                  <option value="guardian_view">家长查看支持</option>
                  <option value="school_support">学校支持协作</option>
                  <option value="research_feedback">试点反馈研究</option>
                </select>
              </label>
              <button type="submit" className="button-primary w-fit" disabled={!user}>创建授权</button>
            </form>
            <div className="grid gap-4">
              {permissions.length > 0 ? permissions.map((permission) => (
                <article key={permission.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-ink">{permission.grantee_email}</h3>
                      <p className="mt-2 text-sm leading-7 text-muted">{permissionLabel(permission.permission_type)} / 状态：{permission.status}</p>
                    </div>
                    {permission.status !== "revoked" ? (
                      <button type="button" className="button-secondary px-4 py-2 text-xs" onClick={() => handleRevokePermission(permission.id)}>撤销</button>
                    ) : null}
                  </div>
                </article>
              )) : <div className="card text-sm font-bold text-muted">还没有创建授权。</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
