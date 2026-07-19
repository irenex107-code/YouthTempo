import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { getSupabase } from "@/lib/supabaseClient";
import { handleAuthRedirect } from "@/lib/cloudRecords";

type School = {
  id: string;
  name: string;
  status: string;
  created_at: string;
};

type AssignmentRole = "学生" | "学校支持人员" | "学校管理员";

type AdminOverview = {
  admin: { email: string; role: string; status: string; scope: "platform" | "school" };
  counts: {
    profiles: number;
    sweetRecords: number;
    schools: number;
    schoolMembers: number;
    wechatBindings: number;
  };
  schools: School[];
  recentRecords: Array<{
    id: string;
    user_id: string;
    school_id: string | null;
    summary: string | null;
    created_at: string;
  }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [assignmentEmail, setAssignmentEmail] = useState("");
  const [assignmentRole, setAssignmentRole] = useState<AssignmentRole>("学生");
  const [actionNotice, setActionNotice] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isPlatformAdmin = overview?.admin.scope === "platform";
  const roleOptions: AssignmentRole[] = isPlatformAdmin ? ["学生", "学校支持人员", "学校管理员"] : ["学生", "学校支持人员"];

  async function loadAdminOverview() {
    setLoading(true);
    setError("");
    try {
      await handleAuthRedirect();
      const supabase = getSupabase();
      if (!supabase) throw new Error("Supabase 还没有配置完成。");
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = data.session?.access_token;
      if (!token) throw new Error("请先登录管理员账号，再进入试点管理台。");
      setAccessToken(token);

      const response = await fetch("/api/admin/overview", {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "管理员概览加载失败。");
      const nextOverview = payload as AdminOverview;
      setOverview(nextOverview);
      setSelectedSchoolId((current) => current || nextOverview.schools[0]?.id || "");
      if (nextOverview.admin.scope === "school" && assignmentRole === "学校管理员") setAssignmentRole("学生");
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : "管理员概览加载失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminOverview();
  }, []);

  async function handleCreateSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;
    setActionLoading(true);
    setActionNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/schools", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: schoolName }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "学校空间创建失败。");
      setSchoolName("");
      setSelectedSchoolId(payload.school.id);
      setActionNotice("学校空间已创建。下一步请添加该校的学校管理员。");
      await loadAdminOverview();
    } catch (schoolError) {
      setError(schoolError instanceof Error ? schoolError.message : "学校空间创建失败。");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAssignUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;
    setActionLoading(true);
    setActionNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/school-assignments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ schoolId: selectedSchoolId, email: assignmentEmail, role: assignmentRole }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "学校空间分配失败。");
      setAssignmentEmail("");
      setActionNotice(`${assignmentRole}已加入 ${payload.school.name}。`);
      await loadAdminOverview();
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : "学校空间分配失败。");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <>
      <PageHero
        label="Pilot Admin"
        title="试点管理台"
        subtitle="平台管理员负责开通学校；学校管理员负责管理本校学生。学生属于学校空间后，学校支持人员可查看本校 SWEET 记录。"
      />

      <section className="section section-muted">
        <div className="container">
          {loading ? <div className="card text-sm font-bold text-muted">正在检查管理权限……</div> : null}
          {!loading && error && !overview ? (
            <div className="card max-w-3xl">
              <p className="eyebrow">Access</p>
              <h2 className="mt-3 text-[1.6rem] font-bold text-ink">需要管理权限</h2>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">{error}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/account" className="button-primary">去登录 / 我的记录</Link>
                <Link href="/contact" className="button-secondary">查看联系入口</Link>
              </div>
            </div>
          ) : null}

          {overview ? (
            <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr] lg:gap-8">
              <div className="card">
                <p className="eyebrow">Signed in</p>
                <h2 className="mt-3 text-[1.6rem] font-bold leading-tight text-ink">{overview.admin.email}</h2>
                <p className="mt-2 text-sm font-bold text-sage-dark">当前权限：{overview.admin.role}</p>
                <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                  {isPlatformAdmin
                    ? "你负责创建试点学校，并指定每个学校的学校管理员。后续学生添加主要交给学校自己完成。"
                    : "你只管理自己学校空间里的学生和支持人员；看不到其他学校的数据。"}
                </p>
                <div className="mt-6 grid gap-3">
                  {[
                    ["平台管理员", "创建学校空间，指定学校管理员，查看试点整体概览。"],
                    ["学校管理员", "管理本校学生和学校支持人员，查看本校记录。"],
                    ["学生", "填写 SWEET、保存自己的记录；加入学校空间后记录归属本校。"],
                  ].map(([title, text]) => (
                    <div key={title} className="rounded-2xl bg-cream px-4 py-4">
                      <p className="text-sm font-bold text-ink">{title}</p>
                      <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="card">
                  <p className="text-xs font-bold text-sage">用户资料</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.profiles}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{isPlatformAdmin ? "全平台账户资料数。" : "本校账户资料数。"}</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">SWEET 记录</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.sweetRecords}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{isPlatformAdmin ? "全平台云端记录。" : "本校学生记录。"}</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">学校空间</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schools}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{isPlatformAdmin ? "已创建试点学校数。" : "你可管理的学校数。"}</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">学校成员</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schoolMembers}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">已配置的学校管理员和支持人员。</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {overview ? (
        <section className="section">
          <div className="container grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="card">
              <p className="eyebrow">School setup</p>
              <h2 className="mt-3 text-[1.5rem] font-bold text-ink">学校空间配置</h2>
              {isPlatformAdmin ? (
                <form className="mt-6 grid gap-4" onSubmit={handleCreateSchool}>
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    新学校名称
                    <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="例如：Special A" />
                  </label>
                  <button type="submit" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit" disabled={actionLoading || !schoolName.trim()}>
                    创建学校
                  </button>
                </form>
              ) : (
                <p className="mt-6 rounded-2xl bg-cream px-4 py-4 text-sm leading-7 text-muted">
                  学校空间由平台管理员创建。你可以在下方把学生和本校支持人员加入你负责的学校。
                </p>
              )}

              <form className="mt-8 grid gap-4 border-t border-ink/10 pt-6" onSubmit={handleAssignUser}>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  选择学校
                  <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}>
                    <option value="">先选择学校</option>
                    {overview.schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  对方登录邮箱
                  <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={assignmentEmail} onChange={(event) => setAssignmentEmail(event.target.value)} placeholder="student@example.com" type="email" />
                </label>
                <p className="rounded-2xl bg-cream px-4 py-3 text-sm leading-7 text-muted">
                  这里填写对方登录 YouthTempo 用的邮箱。对方需要先用邮箱登录一次，系统里才有账户；之后学校管理员就可以把他们加入本校。
                </p>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  加入身份
                  <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={assignmentRole} onChange={(event) => setAssignmentRole(event.target.value as AssignmentRole)}>
                    {roleOptions.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
                <button type="submit" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit" disabled={actionLoading || !selectedSchoolId || !assignmentEmail.trim()}>
                  加入学校空间
                </button>
              </form>
              {actionNotice ? <p className="mt-4 text-sm font-bold text-sage-dark">{actionNotice}</p> : null}
              {error ? <p className="mt-4 text-sm font-bold text-sage-dark">{error}</p> : null}
            </div>

            <div className="card">
              <p className="eyebrow">Schools</p>
              <h2 className="mt-3 text-[1.5rem] font-bold text-ink">{isPlatformAdmin ? "已创建学校" : "我的学校"}</h2>
              <div className="mt-6 grid gap-3">
                {overview.schools.length > 0 ? overview.schools.map((school) => (
                  <button
                    key={school.id}
                    type="button"
                    className={`rounded-2xl border px-4 py-4 text-left transition ${selectedSchoolId === school.id ? "border-sage bg-mint" : "border-ink/10 bg-white/75"}`}
                    onClick={() => setSelectedSchoolId(school.id)}
                  >
                    <p className="font-bold text-ink">{school.name}</p>
                    <p className="mt-2 text-xs font-bold text-sage-dark">{school.status === "active" ? "Active" : school.status}</p>
                  </button>
                )) : <p className="rounded-2xl bg-cream px-4 py-4 text-sm leading-7 text-muted">暂时没有可管理的学校空间。</p>}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {overview ? (
        <section className="section section-muted">
          <div className="container">
            <SectionHeader
              title="最近 SWEET 记录"
              description={isPlatformAdmin ? "这里显示最近云端记录，帮助确认学校空间数据链路是否正常。" : "这里显示你负责学校里的最近学生记录。"}
            />
            <div className="grid gap-4">
              {overview.recentRecords.length > 0 ? overview.recentRecords.map((record) => (
                <article key={record.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-ink">SWEET 节律记录</h3>
                      <p className="mt-2 text-sm leading-7 text-muted">
                        {record.summary || "这条记录暂时没有摘要。"}
                      </p>
                      <p className="mt-2 text-xs leading-6 text-muted">学校空间：{record.school_id ? "已关联" : "未关联"}</p>
                    </div>
                    <p className="rounded-full bg-cream px-4 py-2 text-xs font-bold text-sage-dark">{formatDate(record.created_at)}</p>
                  </div>
                </article>
              )) : <div className="card text-sm font-bold text-muted">还没有云端 SWEET 记录。</div>}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
