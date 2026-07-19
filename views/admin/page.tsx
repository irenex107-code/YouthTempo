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

type AdminOverview = {
  admin: { email: string; role: string; status: string };
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
  const [assignmentRole, setAssignmentRole] = useState<"学生" | "学校支持人员">("学生");
  const [actionNotice, setActionNotice] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      setActionNotice("学校空间已创建。");
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
        subtitle="以学校空间管理 B2B2C 试点：学生属于学校，学校支持人员查看本校学生记录，用于更早支持和跟进。"
      />

      <section className="section section-muted">
        <div className="container">
          {loading ? <div className="card text-sm font-bold text-muted">正在检查管理员权限……</div> : null}
          {!loading && error && !overview ? (
            <div className="card max-w-3xl">
              <p className="eyebrow">Access</p>
              <h2 className="mt-3 text-[1.6rem] font-bold text-ink">需要管理员权限</h2>
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
                <p className="eyebrow">Signed in as admin</p>
                <h2 className="mt-3 text-[1.6rem] font-bold leading-tight text-ink">{overview.admin.email}</h2>
                <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                  当前权限模型是“学校空间”：学生账号归属某个学校，学校支持人员查看本校学生记录。学生不需要逐个授权，试点边界由管理员统一配置。
                </p>
                <div className="mt-6 grid gap-3">
                  {[
                    ["学生", "填写 SWEET、保存自己的记录；加入学校空间后，记录可被本校支持人员查看。"],
                    ["学校支持人员", "老师、心理老师或项目负责人，查看本校学生记录并用于支持跟进。"],
                    ["管理员", "创建学校空间、添加学校支持人员、把学生分配到学校。"],
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
                  <p className="mt-2 text-sm leading-6 text-muted">已创建账户资料数。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">SWEET 记录</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.sweetRecords}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">云端保存的节律记录。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">学校空间</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schools}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">已创建试点学校数。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">学校成员</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schoolMembers}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">已配置学校支持人员数。</p>
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
              <form className="mt-6 grid gap-4" onSubmit={handleCreateSchool}>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  新学校名称
                  <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="例如：YouthTempo 试点学校" />
                </label>
                <button type="submit" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit" disabled={actionLoading || !schoolName.trim()}>
                  创建学校
                </button>
              </form>

              <form className="mt-8 grid gap-4 border-t border-ink/10 pt-6" onSubmit={handleAssignUser}>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  选择学校
                  <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}>
                    <option value="">先创建或选择学校</option>
                    {overview.schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  已注册用户邮箱
                  <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={assignmentEmail} onChange={(event) => setAssignmentEmail(event.target.value)} placeholder="student@example.com" type="email" />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  加入身份
                  <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={assignmentRole} onChange={(event) => setAssignmentRole(event.target.value as "学生" | "学校支持人员")}>
                    <option>学生</option>
                    <option>学校支持人员</option>
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
              <h2 className="mt-3 text-[1.5rem] font-bold text-ink">已创建学校</h2>
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
                )) : <p className="rounded-2xl bg-cream px-4 py-4 text-sm leading-7 text-muted">还没有学校空间。先创建一个试点学校。</p>}
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
              description="这里先显示最近云端记录，帮助管理员确认学校空间数据链路是否正常。正式试点前可以继续补充按学校筛选、导出和反馈表。"
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
