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

type AssignmentRole = "学生" | "支持老师" | "学校负责人";

type AdminOverview = {
  admin: {
    email: string;
    role: string;
    status: string;
    scope: "platform" | "school";
    canManageMembers: boolean;
  };
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
  attentionQueue: Array<{
    id: string;
    user_id: string;
    school_id: string;
    student_name: string;
    student_email: string | null;
    summary: string | null;
    created_at: string;
    level: "priority" | "check_in";
    reasons: string[];
    followup_status: "new" | "in_progress" | "resolved";
    followup_note: string;
    followup_updated_at: string | null;
  }>;
};

type FollowupDraft = {
  status: "new" | "in_progress" | "resolved";
  note: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function adminTitle(overview: AdminOverview | null) {
  if (overview?.admin.scope === "school") return "学校工作台";
  return "试点管理台";
}

function adminSubtitle(overview: AdminOverview | null) {
  if (overview?.admin.role === "支持老师") return "查看本校学生近期节律变化，记录支持和跟进进度。";
  if (overview?.admin.scope === "school") return "管理本校成员，查看近期节律变化和支持进度。";
  return "创建学校空间，指定学校负责人，并查看试点整体运行情况。";
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
  const [followupDrafts, setFollowupDrafts] = useState<Record<string, FollowupDraft>>({});
  const [savingFollowupId, setSavingFollowupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isPlatformAdmin = overview?.admin.scope === "platform";
  const selectedSchool = overview?.schools.find((school) => school.id === selectedSchoolId) || overview?.schools[0];
  const roleOptions: AssignmentRole[] = isPlatformAdmin ? ["学生", "支持老师", "学校负责人"] : ["学生", "支持老师"];

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
      setFollowupDrafts(
        Object.fromEntries(
          nextOverview.attentionQueue.map((item) => [
            item.id,
            { status: item.followup_status, note: item.followup_note },
          ]),
        ),
      );
      setSelectedSchoolId((current) => current || nextOverview.schools[0]?.id || "");
      if (nextOverview.admin.scope === "school" && assignmentRole === "学校负责人") setAssignmentRole("学生");
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
      setActionNotice("学校已创建。现在可以添加学校负责人。");
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
      if (!response.ok) throw new Error(payload.error || "学校成员添加失败。");
      setAssignmentEmail("");
      setActionNotice(
        payload.status === "invited"
          ? `已预授权：${assignmentEmail} 之后登录会自动成为${assignmentRole}。`
          : `已添加：${assignmentEmail} 已成为${assignmentRole}。`,
      );
      await loadAdminOverview();
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : "学校成员添加失败。");
    } finally {
      setActionLoading(false);
    }
  }

  async function saveFollowup(recordId: string, schoolId: string) {
    if (!accessToken) return;
    const draft = followupDrafts[recordId];
    if (!draft) return;
    setSavingFollowupId(recordId);
    setActionNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/followups", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ recordId, schoolId, ...draft }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "跟进状态保存失败。");
      setActionNotice("跟进状态已保存。");
      await loadAdminOverview();
    } catch (followupError) {
      setError(followupError instanceof Error ? followupError.message : "跟进状态保存失败。");
    } finally {
      setSavingFollowupId("");
    }
  }

  return (
    <>
      <PageHero label="Pilot Admin" title={adminTitle(overview)} subtitle={adminSubtitle(overview)} />

      <section className="section section-muted">
        <div className="container">
          {loading ? <div className="card text-sm font-bold text-muted">正在检查管理权限……</div> : null}
          {!loading && error && !overview ? (
            <div className="card max-w-3xl">
              <p className="eyebrow">访问权限</p>
              <h2 className="mt-3 text-[1.6rem] font-bold text-ink">需要管理权限</h2>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">{error}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/account" className="button-primary">去登录 / 我的记录</Link>
                <Link href="/contact" className="button-secondary">查看联系入口</Link>
              </div>
            </div>
          ) : null}

          {overview ? (
            <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr] lg:gap-8">
              <div className="card">
                <p className="eyebrow">已登录</p>
                <h2 className="mt-3 overflow-hidden text-ellipsis text-[1.35rem] font-bold leading-tight text-ink sm:text-[1.6rem]">{overview.admin.email}</h2>
                <p className="mt-2 text-sm font-bold text-sage-dark">当前权限：{overview.admin.role}</p>
                <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                  {isPlatformAdmin
                    ? "平台管理员负责创建学校和指定学校负责人。学校负责人再管理本校成员。"
                    : overview.admin.role === "支持老师"
                      ? "你可以查看本校学生近期 SWEET 记录，并记录必要的支持进度。"
                      : "你可以添加本校学生和支持老师，并查看本校 SWEET 记录。"}
                </p>
                {selectedSchool ? (
                  <div className="mt-6 rounded-2xl border border-sage/35 bg-mint px-4 py-4">
                    <p className="text-xs font-bold text-sage-dark">当前学校</p>
                    <p className="mt-2 text-2xl font-bold text-ink">{selectedSchool.name}</p>
                    <p className="mt-2 text-sm font-bold text-sage-dark">{selectedSchool.status === "active" ? "使用中" : selectedSchool.status}</p>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="card">
                  <p className="text-xs font-bold text-sage">学校成员</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schoolMembers}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">学生、学校负责人和支持老师。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">SWEET 记录</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.sweetRecords}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{isPlatformAdmin ? "全平台云端记录。" : "本校学生记录。"}</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">学校空间</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schools}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{isPlatformAdmin ? "已创建试点学校。" : "你可管理的学校。"}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {overview?.admin.canManageMembers ? (
        <section className="section">
          <div className="container grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="card">
              <p className="eyebrow">成员</p>
              <h2 className="mt-3 text-[1.5rem] font-bold text-ink">添加学校成员</h2>

              {isPlatformAdmin ? (
                <form className="mt-6 grid gap-4 rounded-3xl bg-cream p-4" onSubmit={handleCreateSchool}>
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    新学校名称
                    <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="例如：Special A" />
                  </label>
                  <button type="submit" className="button-secondary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit" disabled={actionLoading || !schoolName.trim()}>
                    创建学校
                  </button>
                </form>
              ) : null}

              <form className="mt-6 grid gap-4" onSubmit={handleAssignUser}>
                {overview.schools.length > 1 || isPlatformAdmin ? (
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    学校
                    <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}>
                      <option value="">选择学校</option>
                      {overview.schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <label className="grid gap-2 text-sm font-bold text-ink">
                  成员邮箱
                  <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={assignmentEmail} onChange={(event) => setAssignmentEmail(event.target.value)} placeholder="student@example.com" type="email" />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  成员身份
                  <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={assignmentRole} onChange={(event) => setAssignmentRole(event.target.value as AssignmentRole)}>
                    {roleOptions.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
                <p className="text-sm leading-6 text-muted">对方用这个邮箱登录后，会自动进入对应学校身份。</p>
                <button type="submit" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit" disabled={actionLoading || !selectedSchoolId || !assignmentEmail.trim()}>
                  添加成员
                </button>
              </form>
              {actionNotice ? <p className="mt-4 text-sm font-bold text-sage-dark">{actionNotice}</p> : null}
              {error ? <p className="mt-4 text-sm font-bold text-sage-dark">{error}</p> : null}
            </div>

            <div className="card">
              <p className="eyebrow">学校</p>
              <h2 className="mt-3 text-[1.5rem] font-bold text-ink">{isPlatformAdmin ? "学校列表" : "我的学校"}</h2>
              <div className="mt-6 grid gap-3">
                {overview.schools.length > 0 ? overview.schools.map((school) => (
                  <button
                    key={school.id}
                    type="button"
                    className={`rounded-2xl border px-4 py-4 text-left transition ${selectedSchoolId === school.id ? "border-sage bg-mint" : "border-ink/10 bg-white/75"}`}
                    onClick={() => setSelectedSchoolId(school.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-bold text-ink">{school.name}</p>
                      <p className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-sage-dark">{school.status === "active" ? "使用中" : school.status}</p>
                    </div>
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
              title="需要了解的近期变化"
              description="依据最近一次 SWEET 记录中的日常节律变化整理，帮助学校安排温和的了解和支持。这不是诊断或风险评级，请结合学生的真实情况判断。"
            />
            {actionNotice ? <p className="mb-4 rounded-2xl bg-white/75 px-4 py-3 text-sm font-bold text-sage-dark">{actionNotice}</p> : null}
            {error ? <p className="mb-4 rounded-2xl border border-ink/10 bg-white/75 px-4 py-3 text-sm font-bold text-ink">{error}</p> : null}
            <div className="grid gap-4">
              {overview.attentionQueue.length > 0 ? overview.attentionQueue.map((item) => {
                const draft = followupDrafts[item.id] || {
                  status: item.followup_status,
                  note: item.followup_note,
                };
                const isResolved = draft.status === "resolved";

                return (
                  <article key={item.id} className={`card ${isResolved ? "opacity-75" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-ink">{item.student_name || "学生"}</h3>
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.level === "priority" ? "bg-[#f7e8dc] text-[#824b2d]" : "bg-mint text-sage-dark"}`}>
                            {item.level === "priority" ? "建议尽快了解" : "建议近期了解"}
                          </span>
                        </div>
                        {item.student_email ? <p className="mt-1 break-all text-xs text-muted">{item.student_email}</p> : null}
                      </div>
                      <p className="rounded-full bg-cream px-4 py-2 text-xs font-bold text-sage-dark">{formatDate(item.created_at)}</p>
                    </div>

                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                      {item.reasons.map((reason) => (
                        <p key={reason} className="rounded-2xl border border-ink/10 bg-cream px-4 py-3 text-sm leading-6 text-ink">
                          {reason}
                        </p>
                      ))}
                    </div>
                    {item.summary ? <p className="mt-4 text-sm leading-7 text-muted">{item.summary}</p> : null}

                    <div className="mt-6 grid gap-4 border-t border-ink/10 pt-5 lg:grid-cols-[12rem_1fr_auto] lg:items-end">
                      <label className="grid gap-2 text-sm font-bold text-ink">
                        跟进状态
                        <select
                          className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                          value={draft.status}
                          onChange={(event) => setFollowupDrafts((current) => ({
                            ...current,
                            [item.id]: { ...draft, status: event.target.value as FollowupDraft["status"] },
                          }))}
                        >
                          <option value="new">待了解</option>
                          <option value="in_progress">跟进中</option>
                          <option value="resolved">已完成</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm font-bold text-ink">
                        必要备注
                        <input
                          className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                          value={draft.note}
                          maxLength={500}
                          onChange={(event) => setFollowupDrafts((current) => ({
                            ...current,
                            [item.id]: { ...draft, note: event.target.value },
                          }))}
                          placeholder="只记录必要的支持信息，避免写入无关隐私"
                        />
                      </label>
                      <button
                        type="button"
                        className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 lg:w-auto"
                        disabled={savingFollowupId === item.id}
                        onClick={() => saveFollowup(item.id, item.school_id)}
                      >
                        {savingFollowupId === item.id ? "保存中…" : "保存进度"}
                      </button>
                    </div>
                  </article>
                );
              }) : (
                <div className="card">
                  <p className="font-bold text-ink">目前没有需要单独了解的近期变化。</p>
                  <p className="mt-2 text-sm leading-7 text-muted">新的 SWEET 记录出现明显节律变化时，会整理到这里。</p>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {overview ? (
        <section className="section">
          <div className="container">
            <SectionHeader
              title="全部最近记录"
              description={isPlatformAdmin ? "用于确认学校空间的数据链路和记录同步情况。" : "查看你负责学校中的近期 SWEET 记录。"}
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
