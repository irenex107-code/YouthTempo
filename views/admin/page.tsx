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
    school_name: string | null;
    student_name: string;
    student_email: string | null;
    summary: string;
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

function recentRecordCount(
  records: AdminOverview["recentRecords"],
  userIds: string[],
  days = 28,
) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const ids = new Set(userIds);
  return records.filter(
    (record) => ids.has(record.user_id) && new Date(record.created_at).getTime() >= cutoff,
  ).length;
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
      { href: "#member-management", label: "学校与成员", description: "创建学校；仅在学校需要时代为登记成员" },
      { href: "#recent-changes", label: "近期变化", description: "查看跨学校的支持进度" },
    ];
  }

  if (overview.admin.role === "支持老师") {
    return [
      { href: "#recent-changes", label: "需要了解", description: "先看负责学生的近期变化" },
      { href: "#recent-records", label: "学生记录", description: "查看负责学生的完整记录" },
      { href: "/referral", label: "支持路径", description: "需要时连接更多支持" },
    ];
  }

  return [
    { href: "#schools-overview", label: "学校概览", description: "按老师查看近 4 周总体情况" },
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
  const [newStudentTeacherId, setNewStudentTeacherId] = useState("");
  const [newStudentGuardianId, setNewStudentGuardianId] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [creatingSchool, setCreatingSchool] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState("");
  const [recordSchoolFilter, setRecordSchoolFilter] = useState("all");
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
  const selectedDirectory = overview?.schoolDirectories.find(
    (directory) => directory.school_id === selectedSchool?.id,
  );
  const roleOptions: AssignmentRole[] = isPlatformAdmin
    ? ["学校负责人", "支持老师", "学生", "家长"]
    : ["学生", "家长", "支持老师"];
  const assignedStudentIdSet = new Set(
    schoolRoster?.assignments.map((assignment) => assignment.student_user_id) || [],
  );
  const unassignedStudents =
    schoolRoster?.students.filter((student) => !assignedStudentIdSet.has(student.id)) || [];
  const filteredRecentRecords =
    recordSchoolFilter === "all"
      ? overview?.recentRecords || []
      : overview?.recentRecords.filter((record) => record.school_id === recordSchoolFilter) || [];

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
    setCreatingSchool(true);
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
      const newSchool = payload.school as School;
      setSchoolName("");
      setActionNotice("学校已创建。现在可以添加学校负责人。");
      setOverview((current) => current ? {
        ...current,
        counts: {
          ...current.counts,
          schools: current.counts.schools + 1,
        },
        schools: [newSchool, ...current.schools],
        schoolDirectories: [
          {
            school_id: newSchool.id,
            leaders: [],
            teachers: [],
            students: [],
            guardians: [],
            assignments: [],
            guardianAssignments: [],
          },
          ...current.schoolDirectories,
        ],
      } : current);
      setSelectedSchoolId(newSchool.id);
    } catch (schoolError) {
      setError(schoolError instanceof Error ? schoolError.message : "学校空间创建失败。");
    } finally {
      setCreatingSchool(false);
    }
  }

  async function handleAssignUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;
    setAddingMember(true);
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
          teacherUserId: assignmentRole === "学生" ? newStudentTeacherId : "",
          guardianUserId: assignmentRole === "学生" ? newStudentGuardianId : "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "学校成员添加失败。");
      const addedName = assignmentName.trim();
      setAssignmentName("");
      setAssignmentEmail("");
      setNewStudentTeacherId("");
      setNewStudentGuardianId("");
      setActionNotice(
        assignmentRole === "学生" && (newStudentTeacherId || newStudentGuardianId)
          ? `已为 ${addedName} 建档并保存负责关系。`
          : `已添加 ${addedName}。`,
      );
      await loadAdminOverview();
      await loadSchoolRoster(selectedSchoolId, accessToken);
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : "学校成员添加失败。");
    } finally {
      setAddingMember(false);
    }
  }

  async function removeSchoolMember(person: SchoolPerson, role: AssignmentRole) {
    if (!accessToken || !selectedSchoolId || removingMemberId) return;
    const confirmed = window.confirm(
      `确定将“${person.display_name || person.email}”移出${selectedSchool?.name || "当前学校"}吗？\n\n账号和个人历史不会被删除，但该成员会失去当前学校的查看权限和负责关系。`,
    );
    if (!confirmed) return;

    setRemovingMemberId(person.id);
    setActionNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/school-assignments", {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          userId: person.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "成员移出失败。");

      setOverview((current) => current ? {
        ...current,
        counts: {
          ...current.counts,
          schoolUsers: Math.max(0, current.counts.schoolUsers - 1),
          schoolMembers:
            role === "学校负责人" || role === "支持老师"
              ? Math.max(0, current.counts.schoolMembers - 1)
              : current.counts.schoolMembers,
        },
        schoolDirectories: current.schoolDirectories.map((directory) =>
          directory.school_id !== selectedSchoolId
            ? directory
            : {
                ...directory,
                leaders: directory.leaders.filter((member) => member.id !== person.id),
                teachers: directory.teachers.filter((member) => member.id !== person.id),
                students: directory.students.filter((member) => member.id !== person.id),
                guardians: directory.guardians.filter((member) => member.id !== person.id),
                assignments: directory.assignments.filter(
                  (assignment) =>
                    assignment.teacher_user_id !== person.id &&
                    assignment.student_user_id !== person.id,
                ),
                guardianAssignments: directory.guardianAssignments.filter(
                  (assignment) =>
                    assignment.guardian_user_id !== person.id &&
                    assignment.student_user_id !== person.id,
                ),
              },
        ),
        attentionQueue: current.attentionQueue.filter((item) => item.user_id !== person.id),
      } : current);
      setSchoolRoster((current) => current ? {
        ...current,
        teachers: current.teachers.filter((member) => member.id !== person.id),
        students: current.students.filter((member) => member.id !== person.id),
        guardians: current.guardians.filter((member) => member.id !== person.id),
        assignments: current.assignments.filter(
          (assignment) =>
            assignment.teacher_user_id !== person.id &&
            assignment.student_user_id !== person.id,
        ),
        guardianAssignments: current.guardianAssignments.filter(
          (assignment) =>
            assignment.guardian_user_id !== person.id &&
            assignment.student_user_id !== person.id,
        ),
      } : current);
      setActionNotice(`${payload.displayName || person.display_name || person.email} 已移出当前学校。`);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "成员移出失败。");
    } finally {
      setRemovingMemberId("");
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
              className={`grid gap-3 ${
                workspaceActions(overview).length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
              }`}
              aria-label={`${overview.admin.role}工作导航`}
            >
              {workspaceActions(overview).map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group rounded-2xl border border-ink/10 bg-white px-4 py-4 shadow-sm transition hover:border-sage hover:bg-mint/60"
                >
                  <span className="flex items-center justify-between gap-3 text-sm font-bold text-ink group-hover:text-sage-dark">
                    {action.label}
                    <span className="text-sage-dark" aria-hidden="true">→</span>
                  </span>
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
                {isPlatformAdmin ? "创建学校；必要时代学校登记成员" : "添加学校成员"}
              </h2>

              {isPlatformAdmin ? (
                <form className="mt-6 grid gap-4 rounded-3xl bg-cream p-4" onSubmit={handleCreateSchool}>
                  <p className="text-sm font-bold text-sage-dark">第一步 · 创建学校</p>
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    新学校名称
                    <input className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="例如：Special A" />
                  </label>
                  <button type="submit" className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit" disabled={creatingSchool || !schoolName.trim()}>
                    {creatingSchool ? "创建中…" : "创建学校"}
                  </button>
                </form>
              ) : null}

              <form className="mt-6 grid gap-4" onSubmit={handleAssignUser}>
                {isPlatformAdmin ? (
                  <div className="rounded-2xl border border-sage/25 bg-mint/45 p-4">
                    <p className="text-sm font-bold text-sage-dark">平台协助区 · 代学校登记成员</p>
                    <p className="mt-2 text-xs leading-6 text-muted">日常成员维护由学校负责人完成。只有学校需要协助时，平台管理员才在这里代为登记。</p>
                  </div>
                ) : null}
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
                {assignmentRole === "学生" ? (
                  <div className="grid gap-4 rounded-2xl border border-sage/25 bg-mint/45 p-4">
                    <p className="text-sm font-bold text-sage-dark">同时建立负责关系（可稍后补充）</p>
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      负责老师
                      <select
                        className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={newStudentTeacherId}
                        onChange={(event) => setNewStudentTeacherId(event.target.value)}
                      >
                        <option value="">暂不选择</option>
                        {selectedDirectory?.teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>{teacher.display_name || teacher.email}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2 text-sm font-bold text-ink">
                      关联家长
                      <select
                        className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-sage"
                        value={newStudentGuardianId}
                        onChange={(event) => setNewStudentGuardianId(event.target.value)}
                      >
                        <option value="">暂不选择</option>
                        {selectedDirectory?.guardians.map((guardian) => (
                          <option key={guardian.id} value={guardian.id}>{guardian.display_name || guardian.email}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                <p className="text-sm leading-6 text-muted">
                  {assignmentRole === "学生"
                    ? "老师或家长尚未加入时，可以先完成学生建档，之后在关系管理中补充。"
                    : isPlatformAdmin
                      ? "日常成员维护由学校负责人完成；平台管理员可在学校需要时协助登记。"
                      : "添加后，对方可以直接使用这个邮箱登录。"}
                </p>
                <button
                  type="submit"
                  className="button-primary w-full disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 sm:w-fit"
                  disabled={addingMember || !selectedSchoolId || !assignmentName.trim() || !assignmentEmail.trim()}
                >
                  {addingMember ? "添加中…" : "添加成员"}
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
                        <p className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-sage-dark">
                          {selectedSchoolId === school.id ? "正在管理" : school.status === "active" ? "选择管理" : school.status}
                        </p>
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

              {selectedDirectory ? (
                <div className="mt-7 border-t border-ink/10 pt-6">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="eyebrow">人员管理</p>
                      <h3 className="mt-2 text-xl font-bold text-ink">{selectedSchool?.name}</h3>
                    </div>
                    <p className="text-xs leading-5 text-muted">移出学校不会删除账号或个人历史</p>
                  </div>
                  <div className="mt-5 grid gap-5">
                    {([
                      ["学校负责人", selectedDirectory.leaders],
                      ["支持老师", selectedDirectory.teachers],
                      ["学生", selectedDirectory.students],
                      ["家长", selectedDirectory.guardians],
                    ] as Array<[AssignmentRole, SchoolPerson[]]>).map(([role, people]) => (
                      <div key={role}>
                        <p className="mb-2 text-xs font-bold text-sage-dark">{role} · {people.length}</p>
                        <div className="grid gap-2">
                          {people.length ? people.map((person) => (
                            <div key={person.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3">
                              <div className="min-w-0">
                                <p className="font-bold text-ink">{person.display_name || person.email}</p>
                                {person.display_name ? <p className="mt-1 break-all text-xs text-muted">{person.email}</p> : null}
                              </div>
                              {person.email === overview.admin.email ? (
                                <span className="text-xs font-bold text-muted">当前账号</span>
                              ) : (
                                <button
                                  type="button"
                                  className="rounded-xl border border-[#b8644d]/35 bg-white px-3 py-2 text-xs font-bold text-[#8a4634] transition hover:bg-[#f9eee9] disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={Boolean(removingMemberId)}
                                  onClick={() => removeSchoolMember(person, role)}
                                >
                                  {removingMemberId === person.id ? "正在移出…" : "移出学校"}
                                </button>
                              )}
                            </div>
                          )) : (
                            <p className="rounded-2xl bg-cream px-4 py-3 text-sm text-muted">暂无{role}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {overview && overview.admin.role !== "支持老师" ? (
        <section id="schools-overview" className="section section-muted scroll-mt-24">
          <div className="container">
            <SectionHeader
              title={isPlatformAdmin ? "学校与人员总览" : "学校近 4 周概览"}
              description={isPlatformAdmin
                ? "按学校和老师查看人员关系与近期参与情况。"
                : "先了解每位老师负责学生的整体情况，需要时再进入下方查看具体记录。"}
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
                            const studentIds = students.map((student) => student.id);
                            const fourWeekRecords = recentRecordCount(overview.recentRecords, studentIds);
                            const attentionCount = overview.attentionQueue.filter(
                              (item) => studentIds.includes(item.user_id) && item.school_id === school.id,
                            ).length;

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
                                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-ink/10 pt-4 text-xs">
                                  <p className="rounded-xl bg-cream px-3 py-2 font-bold text-ink">
                                    近 4 周 {fourWeekRecords} 条记录
                                  </p>
                                  <p className={`rounded-xl px-3 py-2 font-bold ${
                                    attentionCount ? "bg-[#f7e8dc] text-[#824b2d]" : "bg-mint text-sage-dark"
                                  }`}>
                                    {attentionCount ? `${attentionCount} 人建议了解` : "暂无待了解变化"}
                                  </p>
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
            <details className="group" open={!isPlatformAdmin}>
              <summary className={isPlatformAdmin ? "flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white px-5 py-5 shadow-sm transition hover:border-sage" : "hidden"}>
                <span>
                  <span className="block text-[1.25rem] font-bold text-ink">老师与学生分配</span>
                  <span className="mt-1 block text-sm font-normal text-muted">选择老师可以查看和跟进的学生</span>
                </span>
                <span className="button-secondary pointer-events-none group-open:hidden">展开管理</span>
                <span className="button-secondary pointer-events-none hidden group-open:inline-flex">收起</span>
              </summary>
              <div className={isPlatformAdmin ? "pt-8" : ""}>
                <SectionHeader
                  title={isPlatformAdmin ? "老师与学生分配" : "分配老师负责的学生"}
                  description={
                    isPlatformAdmin
                      ? `当前学校：${selectedSchool?.name || "请选择学校"}。保存后，老师只会看到分配给自己的学生。`
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
            <details className="group" open={!isPlatformAdmin}>
              <summary className={isPlatformAdmin ? "flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white px-5 py-5 shadow-sm transition hover:border-sage" : "hidden"}>
                <span>
                  <span className="block text-[1.25rem] font-bold text-ink">家长与孩子关联</span>
                  <span className="mt-1 block text-sm font-normal text-muted">设置家长可以查看哪位孩子的记录</span>
                </span>
                <span className="button-secondary pointer-events-none group-open:hidden">展开管理</span>
                <span className="button-secondary pointer-events-none hidden group-open:inline-flex">收起</span>
              </summary>
              <div className={isPlatformAdmin ? "pt-8" : ""}>
                <SectionHeader
                  title={isPlatformAdmin ? "家长与孩子关联" : "确认家长与孩子"}
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

      {overview ? (
        <section id="recent-records" className="section scroll-mt-24">
          <div className="container">
            <SectionHeader
              title="全部最近记录"
              description={isPlatformAdmin ? "先查看全平台记录，也可以切换到一所学校。" : "查看你负责学校中的近期 SWEET 记录。"}
            />
            {!isPlatformAdmin && overview.admin.role === "学校负责人" ? (
              <div className="mb-6">
                <Link href="/account#records" className="button-secondary">
                  查看学生原始回答
                </Link>
              </div>
            ) : null}
            {isPlatformAdmin && overview.schools.length ? (
              <div className="mb-6">
                <p className="mb-3 text-sm font-bold text-ink">记录范围</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="按学校筛选记录">
                  <button
                    type="button"
                    className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                      recordSchoolFilter === "all"
                        ? "border-sage bg-sage text-white"
                        : "border-ink/10 bg-white text-ink hover:border-sage"
                    }`}
                    onClick={() => setRecordSchoolFilter("all")}
                  >
                    全部学校
                  </button>
                  {overview.schools.map((school) => (
                    <button
                      key={school.id}
                      type="button"
                      className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                        recordSchoolFilter === school.id
                          ? "border-sage bg-sage text-white"
                          : "border-ink/10 bg-white text-ink hover:border-sage"
                      }`}
                      onClick={() => setRecordSchoolFilter(school.id)}
                    >
                      {school.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-4">
              {filteredRecentRecords.length > 0 ? filteredRecentRecords.map((record) => (
                <article key={record.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-ink">{record.student_name}</h3>
                        <span className="rounded-full bg-mint px-3 py-1 text-xs font-bold text-sage-dark">
                          {record.school_name || "未关联学校"}
                        </span>
                      </div>
                      {record.student_email ? <p className="mt-1 break-all text-xs text-muted">{record.student_email}</p> : null}
                      <p className="mt-4 text-sm leading-7 text-muted">{record.summary}</p>
                    </div>
                    <p className="rounded-full bg-cream px-4 py-2 text-xs font-bold text-sage-dark">{formatDate(record.created_at)}</p>
                  </div>
                </article>
              )) : (
                <div className="card">
                  <p className="font-bold text-ink">
                    {recordSchoolFilter === "all" ? "还没有云端 SWEET 记录。" : "这所学校还没有 SWEET 记录。"}
                  </p>
                  {recordSchoolFilter !== "all" ? (
                    <button
                      type="button"
                      className="button-secondary mt-4"
                      onClick={() => setRecordSchoolFilter("all")}
                    >
                      查看全部学校
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
