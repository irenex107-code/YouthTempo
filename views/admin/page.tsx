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

type AssignmentRole = "学生" | "家长" | "支持老师" | "学校负责人";

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
    schoolUsers: number;
    sweetRecords: number;
    schools: number;
    schoolMembers: number;
    wechatBindings: number;
  };
  schools: School[];
  schoolDirectories: SchoolDirectory[];
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

type SchoolPerson = {
  id: string;
  email: string;
  display_name: string;
};

type SchoolRoster = {
  teachers: SchoolPerson[];
  students: SchoolPerson[];
  guardians: SchoolPerson[];
  assignments: Array<{
    teacher_user_id: string;
    student_user_id: string;
  }>;
  guardianAssignments: Array<{
    guardian_user_id: string;
    student_user_id: string;
  }>;
};

type SchoolDirectory = SchoolRoster & {
  school_id: string;
  leaders: SchoolPerson[];
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
  return "平台管理台";
}

function adminSubtitle(overview: AdminOverview | null) {
  if (overview?.admin.role === "支持老师") return "先查看负责学生，再记录必要的支持进度。";
  if (overview?.admin.scope === "school") return "管理本校成员和负责关系，及时了解学生的近期变化。";
  return "管理学校空间、负责人和全平台协作关系。";
}

function workspaceActions(overview: AdminOverview) {
  if (overview.admin.scope === "platform") {
    return [
      { href: "#schools-overview", label: "学校总览", description: "查看学校、老师、学生与家庭关系" },
      { href: "#member-management", label: "学校配置", description: "创建学校并辅助登记负责人" },
      { href: "#recent-changes", label: "近期变化", description: "查看跨学校的支持进度" },
    ];
  }

  if (overview.admin.role === "支持老师") {
    return [
      { href: "#recent-changes", label: "需要了解", description: "先看负责学生的近期变化" },
      { href: "#recent-records", label: "学生记录", description: "查看负责学生的完整记录" },
      { href: "#support-handoff", label: "连接支持", description: "需要时连接家庭或专业资源" },
    ];
  }

  return [
    { href: "#recent-changes", label: "需要了解", description: "先看本校学生的近期变化" },
    { href: "#member-management", label: "成员管理", description: "登记老师、学生和家长" },
    { href: "#teacher-assignment", label: "负责关系", description: "分配老师负责的学生" },
    { href: "#guardian-assignment", label: "家庭关系", description: "确认家长与孩子" },
  ];
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [assignmentName, setAssignmentName] = useState("");
  const [assignmentEmail, setAssignmentEmail] = useState("");
  const [assignmentRole, setAssignmentRole] = useState<AssignmentRole>("学校负责人");
  const [actionNotice, setActionNotice] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [followupDrafts, setFollowupDrafts] = useState<Record<string, FollowupDraft>>({});
  const [savingFollowupId, setSavingFollowupId] = useState("");
  const [schoolRoster, setSchoolRoster] = useState<SchoolRoster | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedGuardianId, setSelectedGuardianId] = useState("");
  const [selectedGuardianStudentIds, setSelectedGuardianStudentIds] = useState<string[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSaving, setRosterSaving] = useState(false);
  const [guardianSaving, setGuardianSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isPlatformAdmin = overview?.admin.scope === "platform";
  const selectedSchool = overview?.schools.find((school) => school.id === selectedSchoolId) || overview?.schools[0];
  const roleOptions: AssignmentRole[] = isPlatformAdmin
    ? ["学校负责人", "支持老师", "学生", "家长"]
    : ["学生", "家长", "支持老师"];
  const assignedStudentIdSet = new Set(
    schoolRoster?.assignments.map((assignment) => assignment.student_user_id) || [],
  );
  const unassignedStudents =
    schoolRoster?.students.filter((student) => !assignedStudentIdSet.has(student.id)) || [];

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
      setAssignmentRole((current) =>
        nextOverview.admin.scope === "school" && current === "学校负责人" ? "学生" : current,
      );
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : "管理员概览加载失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminOverview();
  }, []);

  async function loadSchoolRoster(schoolId: string, token = accessToken) {
    if (!token || !schoolId || !overview?.admin.canManageMembers) return;
    setRosterLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/teacher-student-assignments?schoolId=${encodeURIComponent(schoolId)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "学校名单加载失败。");
      const roster = payload as SchoolRoster;
      setSchoolRoster(roster);
      setSelectedTeacherId((current) =>
        roster.teachers.some((teacher) => teacher.id === current)
          ? current
          : roster.teachers[0]?.id || "",
      );
      setSelectedGuardianId((current) =>
        roster.guardians.some((guardian) => guardian.id === current)
          ? current
          : roster.guardians[0]?.id || "",
      );
    } catch (rosterError) {
      setError(rosterError instanceof Error ? rosterError.message : "学校名单加载失败。");
    } finally {
      setRosterLoading(false);
    }
  }

  useEffect(() => {
    if (overview?.admin.canManageMembers && selectedSchoolId && accessToken) {
      loadSchoolRoster(selectedSchoolId);
    } else {
      setSchoolRoster(null);
    }
  }, [overview?.admin.canManageMembers, selectedSchoolId, accessToken]);

  useEffect(() => {
    if (!schoolRoster || !selectedTeacherId) {
      setSelectedStudentIds([]);
      return;
    }
    setSelectedStudentIds(
      schoolRoster.assignments
        .filter((assignment) => assignment.teacher_user_id === selectedTeacherId)
        .map((assignment) => assignment.student_user_id),
    );
  }, [schoolRoster, selectedTeacherId]);

  useEffect(() => {
    if (!schoolRoster || !selectedGuardianId) {
      setSelectedGuardianStudentIds([]);
      return;
    }
    setSelectedGuardianStudentIds(
      schoolRoster.guardianAssignments
        .filter((assignment) => assignment.guardian_user_id === selectedGuardianId)
        .map((assignment) => assignment.student_user_id),
    );
  }, [schoolRoster, selectedGuardianId]);

  async function saveTeacherStudents() {
    if (!accessToken || !selectedSchoolId || !selectedTeacherId) return;
    setRosterSaving(true);
    setActionNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/teacher-student-assignments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          teacherUserId: selectedTeacherId,
          studentUserIds: selectedStudentIds,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "老师负责学生保存失败。");
      setSchoolRoster(payload as SchoolRoster);
      setActionNotice("负责学生已保存。支持老师下次打开工作台时只会看到这些学生。");
    } catch (rosterError) {
      setError(rosterError instanceof Error ? rosterError.message : "老师负责学生保存失败。");
    } finally {
      setRosterSaving(false);
    }
  }

  async function saveGuardianStudents() {
    if (!accessToken || !selectedSchoolId || !selectedGuardianId || !schoolRoster) return;
    setGuardianSaving(true);
    setActionNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/guardian-student-assignments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          guardianUserId: selectedGuardianId,
          studentUserIds: selectedGuardianStudentIds,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "亲子关系保存失败。");
      setSchoolRoster({
        ...schoolRoster,
        guardianAssignments: payload.guardianAssignments,
      });
      setActionNotice("亲子关系已确认。家长下次进入账户时会看到对应孩子的记录。");
    } catch (guardianError) {
      setError(guardianError instanceof Error ? guardianError.message : "亲子关系保存失败。");
    } finally {
      setGuardianSaving(false);
    }
  }

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
      setActionNotice("学校已创建。现在可以添加学校负责人。");
      await loadAdminOverview();
      setSelectedSchoolId(payload.school.id);
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
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          name: assignmentName,
          email: assignmentEmail,
          role: assignmentRole,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "学校成员添加失败。");
      const addedName = assignmentName.trim();
      setAssignmentName("");
      setAssignmentEmail("");
      setActionNotice(`已添加 ${addedName}。对方使用 ${assignmentEmail} 登录后，会直接显示姓名和${assignmentRole}身份。`);
      await loadAdminOverview();
      await loadSchoolRoster(selectedSchoolId, accessToken);
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
      <PageHero label="角色工作台" title={adminTitle(overview)} subtitle={adminSubtitle(overview)} />

      {overview ? (
        <section className="border-b border-ink/10 bg-white/70">
          <div className="container py-4 sm:py-5">
            <p className="mb-3 text-xs font-bold text-sage-dark">工作导航</p>
            <nav
              className={`grid border-y border-ink/10 ${
                workspaceActions(overview).length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
              }`}
              aria-label={`${overview.admin.role}工作导航`}
            >
              {workspaceActions(overview).map((action, index) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className={`group px-1 py-4 transition hover:bg-mint/60 sm:px-4 ${
                    index > 0 ? "border-t border-ink/10 sm:border-l sm:border-t-0" : ""
                  }`}
                >
                  <span className="block text-sm font-bold text-ink group-hover:text-sage-dark">{action.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted">{action.description}</span>
                </Link>
              ))}
            </nav>
          </div>
        </section>
      ) : null}

      <section id="role-overview" className="section section-muted scroll-mt-24">
        <div className="container">
          {loading ? <div className="card text-sm font-bold text-muted">正在检查管理权限……</div> : null}
          {!loading && error && !overview ? (
            <div className="card max-w-3xl">
              <p className="eyebrow">访问权限</p>
              <h2 className="mt-3 text-[1.6rem] font-bold text-ink">需要管理权限</h2>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">{error}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/account" className="button-primary">去账号登录</Link>
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
                    ? "你可以查看全部学校的成员和负责关系。学校负责人负责日常维护，你可以在需要时协助添加和调整。"
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
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schoolUsers}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">学生、家长、学校负责人和支持老师。</p>
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
        <section id="member-management" className="section scroll-mt-24">
          <div className="container grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="card">
              <p className="eyebrow">{isPlatformAdmin ? "学校配置" : "成员"}</p>
              <h2 className="mt-3 text-[1.5rem] font-bold text-ink">
                {isPlatformAdmin ? "创建学校与辅助登记" : "添加学校成员"}
              </h2>

              {isPlatformAdmin ? (
                <form className="mt-6 grid gap-4 rounded-3xl bg-cream p-4" onSubmit={handleCreateSchool}>
                  <p className="text-sm font-bold text-sage-dark">第一步 · 创建学校</p>
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
                {isPlatformAdmin ? <p className="text-sm font-bold text-sage-dark">辅助登记学校成员</p> : null}
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
                  成员姓名
                  <input
                    className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage"
                    value={assignmentName}
                    onChange={(event) => setAssignmentName(event.target.value)}
                    placeholder={
                      assignmentRole === "学生"
                        ? "学生姓名"
                        : assignmentRole === "家长"
                          ? "家长姓名"
                        : assignmentRole === "学校负责人"
                          ? "负责人姓名"
                          : "老师姓名"
                    }
                    maxLength={50}
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  成员登录邮箱
                  <input
                    className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage"
                    value={assignmentEmail}
                    onChange={(event) => setAssignmentEmail(event.target.value)}
                    placeholder="name@example.com"
                    type="email"
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-ink">
                  成员身份
                  <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={assignmentRole} onChange={(event) => setAssignmentRole(event.target.value as AssignmentRole)}>
                    {roleOptions.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
                <p className="text-sm leading-6 text-muted">
                  {isPlatformAdmin
                    ? "日常成员维护由学校负责人完成；平台管理员可在学校需要时协助登记。"
                    : "姓名会用于学校名单和登录后的问候；对方不需要再次填写身份资料。"}
                </p>
                <button
                  type="submit"
                  className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit"
                  disabled={actionLoading || !selectedSchoolId || !assignmentName.trim() || !assignmentEmail.trim()}
                >
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
                {overview.schools.length > 0 ? overview.schools.map((school) => {
                  const directory = overview.schoolDirectories.find(
                    (item) => item.school_id === school.id,
                  );
                  return (
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
                      {directory ? (
                        <p className="mt-3 text-xs font-bold text-muted">
                          负责人 {directory.leaders.length} · 老师 {directory.teachers.length} · 学生 {directory.students.length} · 家长 {directory.guardians.length}
                        </p>
                      ) : null}
                    </button>
                  );
                }) : <p className="rounded-2xl bg-cream px-4 py-4 text-sm leading-7 text-muted">暂时没有可管理的学校空间。</p>}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isPlatformAdmin && overview ? (
        <section id="schools-overview" className="section section-muted scroll-mt-24">
          <div className="container">
            <SectionHeader
              title="学校与人员总览"
              description="查看每所学校登记的负责人、支持老师、学生、家长及对应关系。点击上方学校列表可切换后续辅助操作的学校。"
            />
            <div className="grid gap-5">
              {overview.schools.map((school) => {
                const directory = overview.schoolDirectories.find(
                  (item) => item.school_id === school.id,
                );
                if (!directory) return null;
                const assignedStudentIds = new Set(
                  directory.assignments.map((assignment) => assignment.student_user_id),
                );
                const studentsById = new Map(
                  directory.students.map((student) => [student.id, student]),
                );

                return (
                  <article key={school.id} className="card">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="eyebrow">学校</p>
                        <h2 className="mt-2 text-[1.5rem] font-bold text-ink">{school.name}</h2>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-bold text-sage-dark">
                        <span className="rounded-full bg-mint px-3 py-2">负责人 {directory.leaders.length}</span>
                        <span className="rounded-full bg-mint px-3 py-2">老师 {directory.teachers.length}</span>
                        <span className="rounded-full bg-mint px-3 py-2">学生 {directory.students.length}</span>
                        <span className="rounded-full bg-mint px-3 py-2">家长 {directory.guardians.length}</span>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-6 border-t border-ink/10 pt-6 lg:grid-cols-[0.7fr_1.3fr]">
                      <div>
                        <p className="text-sm font-bold text-ink">学校负责人</p>
                        <div className="mt-3 grid gap-2">
                          {directory.leaders.length ? directory.leaders.map((leader) => (
                            <div key={leader.id} className="rounded-2xl bg-cream px-4 py-3">
                              <p className="font-bold text-ink">{leader.display_name || leader.email}</p>
                              {leader.display_name ? <p className="mt-1 break-all text-xs text-muted">{leader.email}</p> : null}
                            </div>
                          )) : (
                            <p className="text-sm text-muted">尚未登记学校负责人。</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-bold text-ink">支持老师与负责学生</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {directory.teachers.length ? directory.teachers.map((teacher) => {
                            const students = directory.assignments
                              .filter((assignment) => assignment.teacher_user_id === teacher.id)
                              .map((assignment) => studentsById.get(assignment.student_user_id))
                              .filter((student): student is SchoolPerson => Boolean(student));

                            return (
                              <div key={teacher.id} className="rounded-2xl border border-ink/10 bg-white px-4 py-4">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-bold text-ink">{teacher.display_name || teacher.email}</p>
                                    {teacher.display_name ? <p className="mt-1 break-all text-xs text-muted">{teacher.email}</p> : null}
                                  </div>
                                  <span className="text-xs font-bold text-sage-dark">{students.length} 名学生</span>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {students.length ? students.map((student) => (
                                    <span key={student.id} className="rounded-full bg-cream px-3 py-1 text-xs font-bold text-ink/75">
                                      {student.display_name || student.email}
                                    </span>
                                  )) : <span className="text-xs text-muted">尚未分配学生</span>}
                                </div>
                              </div>
                            );
                          }) : (
                            <p className="text-sm text-muted">尚未登记支持老师。</p>
                          )}
                        </div>
                        {directory.students.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {directory.students.map((student) => (
                              <span
                                key={student.id}
                                className={`rounded-full px-3 py-2 text-xs font-bold ${
                                  assignedStudentIds.has(student.id)
                                    ? "bg-mint text-sage-dark"
                                    : "border border-ink/10 bg-white text-muted"
                                }`}
                              >
                                {student.display_name || student.email}
                                {assignedStudentIds.has(student.id) ? "" : " · 待分配"}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-4 text-sm text-muted">尚未登记学生。</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-6 border-t border-ink/10 pt-6">
                      <p className="text-sm font-bold text-ink">家长与孩子</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {directory.guardians.length ? directory.guardians.map((guardian) => {
                          const children = directory.guardianAssignments
                            .filter((assignment) => assignment.guardian_user_id === guardian.id)
                            .map((assignment) => studentsById.get(assignment.student_user_id))
                            .filter((student): student is SchoolPerson => Boolean(student));

                          return (
                            <div key={guardian.id} className="rounded-2xl border border-ink/10 bg-white px-4 py-4">
                              <p className="font-bold text-ink">{guardian.display_name || guardian.email}</p>
                              {guardian.display_name ? <p className="mt-1 break-all text-xs text-muted">{guardian.email}</p> : null}
                              <div className="mt-3 flex flex-wrap gap-2">
                                {children.length ? children.map((child) => (
                                  <span key={child.id} className="rounded-full bg-cream px-3 py-1 text-xs font-bold text-ink/75">
                                    {child.display_name || child.email}
                                  </span>
                                )) : <span className="text-xs text-muted">尚未关联孩子</span>}
                              </div>
                            </div>
                          );
                        }) : (
                          <p className="text-sm text-muted">尚未登记家长。</p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {overview?.admin.canManageMembers ? (
        <section id="teacher-assignment" className={`section scroll-mt-24 ${isPlatformAdmin ? "" : "section-muted"}`}>
          <div className="container">
            <details open={!isPlatformAdmin}>
              <summary className={isPlatformAdmin ? "cursor-pointer list-none border-y border-ink/10 py-5 text-[1.25rem] font-bold text-ink" : "hidden"}>
                辅助调整老师负责关系
                <span className="ml-3 text-sm font-normal text-muted">日常由学校负责人维护</span>
              </summary>
              <div className={isPlatformAdmin ? "pt-8" : ""}>
                <SectionHeader
                  title={isPlatformAdmin ? "辅助调整老师负责关系" : "分配老师负责的学生"}
                  description={
                    isPlatformAdmin
                      ? `当前学校：${selectedSchool?.name || "请选择学校"}。平台管理员仅在学校需要时协助调整。`
                      : "支持老师只会看到分配给自己的学生记录；学校负责人仍可查看全校。"
                  }
                />
            <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
              <div className="card">
                <label className="grid gap-2 text-sm font-bold text-ink">
                  支持老师
                  <select
                    className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                    value={selectedTeacherId}
                    onChange={(event) => setSelectedTeacherId(event.target.value)}
                    disabled={rosterLoading || !schoolRoster?.teachers.length}
                  >
                    {!schoolRoster?.teachers.length ? <option value="">还没有支持老师</option> : null}
                    {schoolRoster?.teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.display_name || teacher.email}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-4 text-sm leading-7 text-muted">
                  先在上方添加支持老师和学生，再为每位老师选择负责学生。
                </p>
                <div className="mt-6 rounded-2xl bg-cream px-4 py-4">
                  <p className="text-xs font-bold text-sage-dark">当前已选择</p>
                  <p className="mt-2 text-3xl font-bold text-ink">{selectedStudentIds.length} 人</p>
                </div>
              </div>

              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">学生名单</p>
                    <h2 className="mt-2 text-[1.35rem] font-bold text-ink">选择负责学生</h2>
                  </div>
                  {schoolRoster?.students.length ? (
                    <button
                      type="button"
                      className="text-sm font-bold text-sage-dark"
                      onClick={() =>
                        setSelectedStudentIds(
                          selectedStudentIds.length === schoolRoster.students.length
                            ? []
                            : schoolRoster.students.map((student) => student.id),
                        )
                      }
                    >
                      {selectedStudentIds.length === schoolRoster.students.length ? "取消全选" : "全选"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {rosterLoading ? (
                    <p className="rounded-2xl bg-cream px-4 py-4 text-sm font-bold text-muted">正在加载学校名单……</p>
                  ) : schoolRoster?.students.length ? (
                    schoolRoster.students.map((student) => {
                      const checked = selectedStudentIds.includes(student.id);
                      return (
                        <label
                          key={student.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition ${
                            checked ? "border-sage bg-mint" : "border-ink/10 bg-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-sage"
                            checked={checked}
                            onChange={() =>
                              setSelectedStudentIds((current) =>
                                checked
                                  ? current.filter((id) => id !== student.id)
                                  : [...current, student.id],
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block font-bold text-ink">
                              {student.display_name || "未填写昵称"}
                            </span>
                            <span className="mt-1 block break-all text-xs text-muted">{student.email}</span>
                          </span>
                        </label>
                      );
                    })
                  ) : (
                    <p className="rounded-2xl bg-cream px-4 py-4 text-sm leading-7 text-muted">
                      这所学校还没有学生账号。
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  className="button-primary mt-6 w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit"
                  disabled={rosterSaving || rosterLoading || !selectedTeacherId}
                  onClick={saveTeacherStudents}
                >
                  {rosterSaving ? "保存中…" : "保存负责学生"}
                </button>
              </div>
            </div>

            {schoolRoster && (schoolRoster.teachers.length > 0 || schoolRoster.students.length > 0) ? (
              <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
                <div className="card">
                  <p className="eyebrow">当前分配</p>
                  <h2 className="mt-2 text-[1.35rem] font-bold text-ink">老师负责关系</h2>
                  <div className="mt-5 grid gap-3">
                    {schoolRoster.teachers.length ? schoolRoster.teachers.map((teacher) => {
                      const studentIds = schoolRoster.assignments
                        .filter((assignment) => assignment.teacher_user_id === teacher.id)
                        .map((assignment) => assignment.student_user_id);
                      const students = schoolRoster.students.filter((student) =>
                        studentIds.includes(student.id),
                      );

                      return (
                        <div key={teacher.id} className="rounded-2xl border border-ink/10 bg-white px-4 py-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-bold text-ink">{teacher.display_name || teacher.email}</p>
                              {teacher.display_name ? (
                                <p className="mt-1 break-all text-xs text-muted">{teacher.email}</p>
                              ) : null}
                            </div>
                            <p className="rounded-full bg-mint px-3 py-1 text-xs font-bold text-sage-dark">
                              {students.length} 名学生
                            </p>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {students.length ? students.map((student) => (
                              <span key={student.id} className="rounded-full bg-cream px-3 py-1 text-xs font-bold text-ink/75">
                                {student.display_name || student.email}
                              </span>
                            )) : (
                              <p className="text-sm text-muted">尚未分配学生</p>
                            )}
                          </div>
                        </div>
                      );
                    }) : (
                      <p className="rounded-2xl bg-cream px-4 py-4 text-sm text-muted">还没有支持老师。</p>
                    )}
                  </div>
                </div>

                <div className="card">
                  <p className="eyebrow">待分配</p>
                  <h2 className="mt-2 text-[1.35rem] font-bold text-ink">尚未分配学生</h2>
                  <p className="mt-3 text-sm leading-7 text-muted">
                    未分配学生仍可被学校负责人查看，但支持老师暂时看不到其记录。
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {unassignedStudents.length ? unassignedStudents.map((student) => (
                      <span key={student.id} className="rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-bold text-ink/75">
                        {student.display_name || student.email}
                      </span>
                    )) : (
                      <p className="rounded-2xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark">
                        所有学生都已有负责老师。
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
              </div>
            </details>
          </div>
        </section>
      ) : null}

      {overview?.admin.canManageMembers ? (
        <section id="guardian-assignment" className={`section scroll-mt-24 ${isPlatformAdmin ? "section-muted" : ""}`}>
          <div className="container">
            <details open={!isPlatformAdmin}>
              <summary className={isPlatformAdmin ? "cursor-pointer list-none border-y border-ink/10 py-5 text-[1.25rem] font-bold text-ink" : "hidden"}>
                辅助确认家长与孩子
                <span className="ml-3 text-sm font-normal text-muted">日常由学校负责人维护</span>
              </summary>
              <div className={isPlatformAdmin ? "pt-8" : ""}>
                <SectionHeader
                  title={isPlatformAdmin ? "辅助确认家长与孩子" : "确认家长与孩子"}
                  description={
                    isPlatformAdmin
                      ? `当前学校：${selectedSchool?.name || "请选择学校"}。关系确认后，家长只能看到所关联孩子的记录。`
                      : "先登记家长账号，再选择该家长可以查看的孩子。关系由学校确认，家长不能自行扩大查看范围。"
                  }
                />
                <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
                  <div className="card">
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      家长
                      <select
                        className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={selectedGuardianId}
                        onChange={(event) => setSelectedGuardianId(event.target.value)}
                        disabled={rosterLoading || !schoolRoster?.guardians.length}
                      >
                        {!schoolRoster?.guardians.length ? <option value="">还没有家长账号</option> : null}
                        {schoolRoster?.guardians.map((guardian) => (
                          <option key={guardian.id} value={guardian.id}>
                            {guardian.display_name || guardian.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-6 rounded-2xl bg-cream px-4 py-4">
                      <p className="text-xs font-bold text-sage-dark">已关联孩子</p>
                      <p className="mt-2 text-3xl font-bold text-ink">{selectedGuardianStudentIds.length} 人</p>
                    </div>
                    <Link href="/referral" className="button-secondary mt-5 w-full sm:w-auto">
                      查看专业支持路径
                    </Link>
                  </div>

                  <div className="card">
                    <div>
                      <p className="eyebrow">学生名单</p>
                      <h2 className="mt-2 text-[1.35rem] font-bold text-ink">选择孩子</h2>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {rosterLoading ? (
                        <p className="rounded-2xl bg-cream px-4 py-4 text-sm font-bold text-muted">正在加载学校名单……</p>
                      ) : schoolRoster?.students.length ? (
                        schoolRoster.students.map((student) => {
                          const checked = selectedGuardianStudentIds.includes(student.id);
                          return (
                            <label
                              key={student.id}
                              className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition ${
                                checked ? "border-sage bg-mint" : "border-ink/10 bg-white"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 accent-sage"
                                checked={checked}
                                onChange={() =>
                                  setSelectedGuardianStudentIds((current) =>
                                    checked
                                      ? current.filter((id) => id !== student.id)
                                      : [...current, student.id],
                                  )
                                }
                              />
                              <span className="min-w-0">
                                <span className="block font-bold text-ink">{student.display_name || "未填写姓名"}</span>
                                <span className="mt-1 block break-all text-xs text-muted">{student.email}</span>
                              </span>
                            </label>
                          );
                        })
                      ) : (
                        <p className="rounded-2xl bg-cream px-4 py-4 text-sm leading-7 text-muted">这所学校还没有学生账号。</p>
                      )}
                    </div>

                    <button
                      type="button"
                      className="button-primary mt-6 w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit"
                      disabled={guardianSaving || rosterLoading || !selectedGuardianId}
                      onClick={saveGuardianStudents}
                    >
                      {guardianSaving ? "保存中…" : "确认亲子关系"}
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </section>
      ) : null}

      {overview ? (
        <section id="recent-changes" className="section section-muted scroll-mt-24">
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

      {overview && !isPlatformAdmin ? (
        <section id="support-handoff" className="section scroll-mt-24">
          <div className="container">
            <SectionHeader
              title="家校与专业支持如何衔接"
              description="先由熟悉学生的人温和了解，再根据实际需要连接家庭或专业支持。每一步都只分享完成支持所必需的信息。"
            />
            <div className="grid border-y border-ink/10 md:grid-cols-3">
              {[
                ["01", "校内了解", "由负责老师结合近期节律变化与学生本人沟通，不用一次记录给学生下结论。"],
                ["02", "联系家庭", "需要家庭参与时，由学校联系已确认关联的家长，共同商量可执行的支持。"],
                ["03", "专业支持", "日常生活持续明显受影响或出现安全风险时，再连接合适的专业或医疗资源。"],
              ].map(([step, title, description], index) => (
                <div
                  key={step}
                  className={`py-6 md:px-6 ${index > 0 ? "border-t border-ink/10 md:border-l md:border-t-0" : ""}`}
                >
                  <p className="text-xs font-bold text-sage-dark">{step}</p>
                  <h2 className="mt-2 text-lg font-bold text-ink">{title}</h2>
                  <p className="mt-3 text-sm leading-7 text-muted">{description}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/for-parents#conversation" className="button-secondary">
                查看家长沟通参考
              </Link>
              <Link href="/referral" className="button-primary">
                查看专业支持路径
              </Link>
            </div>
            <p className="mt-4 text-xs leading-6 text-muted">
              专业或医疗人员不会自动获得 YouthTempo 记录；如需共享，应由学校和家庭按照适用规则另行确认。
            </p>
          </div>
        </section>
      ) : null}

      {overview ? (
        <section id="recent-records" className="section scroll-mt-24">
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
