import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import type { CloudSweetRecord, UserPermission } from "@/lib/cloudRecords";
import {
  createPermission,
  deleteCloudSweetRecord,
  getCurrentUser,
  getProfile,
  listCloudSweetRecords,
  listPermissions,
  revokePermission,
  saveProfile,
  sendMagicLink,
  signOut,
} from "@/lib/cloudRecords";
import { getSavedSweetRecords } from "@/lib/localRecords";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

const roleOptions = ["学生", "家长", "老师", "学校合作方"];
const permissionOptions = [
  { value: "guardian_view", label: "家长查看支持" },
  { value: "school_support", label: "学校支持协作" },
  { value: "research_feedback", label: "试点反馈使用" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function permissionLabel(value: string) {
  return permissionOptions.find((item) => item.value === value)?.label || value;
}

export default function AccountPage() {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(roleOptions[0]);
  const [cloudRecords, setCloudRecords] = useState<CloudSweetRecord[]>([]);
  const [localRecordCount, setLocalRecordCount] = useState(0);
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [granteeEmail, setGranteeEmail] = useState("");
  const [permissionType, setPermissionType] = useState(permissionOptions[0].value);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLocalRecordCount(getSavedSweetRecords().length);
    if (!configured) return;
    refreshAccount();
  }, [configured]);

  async function refreshAccount() {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      if (!currentUser) return;
      setEmail(currentUser.email || "");
      const [profile, records, grants] = await Promise.all([
        getProfile(currentUser),
        listCloudSweetRecords(),
        listPermissions(),
      ]);
      setName(profile?.display_name || "");
      setRole(profile?.role || roleOptions[0]);
      setCloudRecords(records);
      setPermissions(grants);
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "账户信息读取失败，请稍后再试。");
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) {
      setError("还没有连接 Supabase。请先在 Vercel 设置数据库环境变量。");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
    try {
      await sendMagicLink(email);
      setStatus("登录链接已发送到邮箱。打开邮件后回到这个页面即可进入账户。");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录链接发送失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      await saveProfile(user, name, role);
      setStatus("账户资料已保存。");
      await refreshAccount();
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "账户资料保存失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!granteeEmail.trim()) {
      setError("请填写被授权人的邮箱。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await createPermission(granteeEmail, permissionType);
      setGranteeEmail("");
      setStatus("授权记录已创建。你可以随时撤销它。");
      await refreshAccount();
    } catch (permissionError) {
      setError(permissionError instanceof Error ? permissionError.message : "授权记录创建失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteRecord(recordId: string) {
    setLoading(true);
    setError("");
    try {
      await deleteCloudSweetRecord(recordId);
      setStatus("这条历史记录已删除。");
      await refreshAccount();
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : "记录删除失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokePermission(permissionId: string) {
    setLoading(true);
    setError("");
    try {
      await revokePermission(permissionId);
      setStatus("授权已撤销。");
      await refreshAccount();
    } catch (permissionError) {
      setError(permissionError instanceof Error ? permissionError.message : "授权撤销失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    setUser(null);
    setCloudRecords([]);
    setPermissions([]);
    setStatus("已退出登录。");
  }

  return (
    <>
      <PageHero
        label="我的账户"
        title="把 SWEET 记录保存下来，也把授权交还给用户自己。"
        subtitle="账户系统用于保存用户主动提交的节律记录、管理基础资料和查看授权关系。它不是诊断系统，也不会把孩子贴上标签。"
        action={<Link href="/check-in" className="button-primary">填写 SWEET 问卷</Link>}
      />

      <section className="section bg-mist/45">
        <div className="container grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <InfoCard title="账户状态" label="Account">
            {!configured ? (
              <p>当前还没有连接 Supabase。页面会保留本地记录提示；连接数据库后即可启用邮箱登录、云端历史记录和授权管理。</p>
            ) : user ? (
              <div className="space-y-4">
                <p>已登录：<span className="font-bold text-ink">{user.email}</span></p>
                <button type="button" className="button-secondary" onClick={handleSignOut}>退出登录</button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <label className="block text-sm font-bold text-ink" htmlFor="email">邮箱</label>
                <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none focus:border-sage" required />
                <button type="submit" className="button-primary" disabled={loading}>发送登录链接</button>
              </form>
            )}
            {localRecordCount > 0 ? <p className="mt-5 text-sm text-muted">当前浏览器里还有 {localRecordCount} 条本地 SWEET 记录。</p> : null}
          </InfoCard>

          <InfoCard title="用户资料" label="Profile">
            {user ? (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-ink" htmlFor="name">显示名称</label>
                  <input id="name" value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none focus:border-sage" placeholder="可以填写昵称或姓名" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-ink" htmlFor="role">身份</label>
                  <select id="role" value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none focus:border-sage">
                    {roleOptions.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <button type="submit" className="button-primary" disabled={loading}>保存资料</button>
              </form>
            ) : (
              <p>登录后可以保存你的身份和显示名称，便于之后查看历史记录与管理授权。</p>
            )}
          </InfoCard>
        </div>
      </section>

      {(status || error) ? (
        <section className="section py-0"><div className="container">
          {status ? <p className="rounded-2xl bg-mist px-5 py-4 font-bold text-sage-dark">{status}</p> : null}
          {error ? <p className="mt-3 rounded-2xl bg-white px-5 py-4 font-bold text-rose-700 shadow-soft">{error}</p> : null}
        </div></section>
      ) : null}

      <section className="section">
        <div className="container">
          <SectionHeader eyebrow="历史记录" title="已保存的 SWEET 记录" description="这里只显示当前登录用户自己的记录。数据库规则会限制用户只能读取、删除属于自己的内容。" />
          {user && cloudRecords.length ? (
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              {cloudRecords.map((record) => (
                <article key={record.id} className="card">
                  <p className="text-xs font-bold text-sage">{formatDate(record.created_at)}</p>
                  <h3 className="mt-3 text-xl font-bold text-ink">SWEET 节律记录</h3>
                  {record.summary ? <p className="mt-3 leading-7 text-muted">{record.summary}</p> : null}
                  {record.small_step ? <p className="mt-3 rounded-2xl bg-mist px-4 py-3 text-sm font-bold text-sage-dark">下一小步：{record.small_step}</p> : null}
                  <button type="button" className="button-secondary mt-5" onClick={() => handleDeleteRecord(record.id)} disabled={loading}>删除记录</button>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-3xl border border-ink/10 bg-white/75 p-6 text-muted shadow-soft">{user ? "还没有云端 SWEET 记录。填写问卷并点击“保存到我的记录”后会出现在这里。" : "登录后可以查看云端历史记录。"}</div>
          )}
        </div>
      </section>

      <section className="section bg-mist/45">
        <div className="container">
          <SectionHeader eyebrow="授权管理" title="谁可以被你授权参与支持" description="你可以先创建授权记录，也可以随时撤销。当前版本先记录授权关系，后续可扩展为家长端或学校端的精细查看权限。" />
          <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <InfoCard title="新增授权" label="Permission">
              {user ? (
                <form onSubmit={handleCreatePermission} className="space-y-4">
                  <input type="email" value={granteeEmail} onChange={(event) => setGranteeEmail(event.target.value)} placeholder="被授权人的邮箱" className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none focus:border-sage" />
                  <select value={permissionType} onChange={(event) => setPermissionType(event.target.value)} className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none focus:border-sage">
                    {permissionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <button type="submit" className="button-primary" disabled={loading}>创建授权</button>
                </form>
              ) : (
                <p>登录后可以管理授权关系。</p>
              )}
            </InfoCard>

            <div className="grid gap-4">
              {permissions.length ? permissions.map((permission) => (
                <article key={permission.id} className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold text-ink">{permission.grantee_email}</p>
                    <p className="mt-1 text-sm text-muted">{permissionLabel(permission.permission_type)} · {permission.status === "revoked" ? "已撤销" : "有效/待确认"}</p>
                  </div>
                  {permission.status !== "revoked" ? <button type="button" className="button-secondary" onClick={() => handleRevokePermission(permission.id)} disabled={loading}>撤销</button> : null}
                </article>
              )) : <article className="card text-muted">还没有授权记录。</article>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
