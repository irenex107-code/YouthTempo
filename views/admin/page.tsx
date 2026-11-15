import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { CommunityModerationQueue } from "@/components/CommunityModerationQueue";
import { PilotFeedbackOverview } from "@/components/PilotFeedbackOverview";
import { MicroFeedbackOverview } from "@/components/MicroFeedbackOverview";
import { ProfessionalVerificationQueue } from "@/components/ProfessionalVerificationQueue";
import { PilotDutyMessageQueue } from "@/components/PilotDutyMessageQueue";
import { useSessionActor, type SessionActor } from "@/lib/useSessionActor";
import { useTranslation } from "@/lib/i18n/client";
import { handleAuthRedirect } from "@/lib/cloudRecords";
import { CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED } from "@/lib/guardianAccessPolicy";
import { findStudentRelationshipGaps } from "@/lib/schoolRelationshipGaps";
import {
  parseSchoolRosterCsv,
  rosterImportTemplate,
  type RosterImportRow,
} from "@/lib/schoolRosterImport";

type School = {
  id: string;
  name: string;
  status: string;
  created_at: string;
};

type AssignmentRole = "学生" | "家长" | "支持老师" | "学校负责人" | "专业支持者";

type AdminOverview = {
  privateRecordsRestricted: boolean;
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
    sweetRecords: number | null;
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
  teacherWeeklySummaries: Array<{
    school_id: string;
    teacher_user_id: string;
    teacher_name: string;
    student_count: number;
    current_record_count: number;
    previous_record_count: number;
    record_change: number;
    active_student_count: number;
    attention_student_count: number;
    latest_record_at: string | null;
    period_start: string;
    period_end: string;
  }>;
  schoolMonthlyTrends: Array<{
    school_id: string;
    school_name: string;
    student_count: number;
    record_count: number;
    active_student_count: number;
    period_start: string;
    period_end: string;
    weeks: Array<{
      label: string;
      start: string;
      end: string;
      record_count: number;
      active_student_count: number;
    }>;
  }>;
  studentParticipationStats: Array<{
    school_id: string;
    school_name: string;
    user_id: string;
    student_name: string;
    student_email: string;
    record_count: number;
    total_record_days: number;
    last_7_active_days: number;
    last_28_active_days: number;
    current_streak_days: number;
    longest_streak_days: number;
    latest_record_at: string | null;
  }>;
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
  professionals: SchoolPerson[];
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

function adminTitle(overview: AdminOverview | null, t: Translate) {
  if (overview?.admin.role === "支持老师") return t("rolePaths.teacherWorkspace");
  if (overview?.admin.scope === "school") return "学校工作台";
  return "平台管理台";
}

type Translate = ReturnType<typeof useTranslation>["t"];

function adminSubtitle(overview: AdminOverview | null, t: Translate) {
  if (overview?.admin.role === "支持老师") return t("adminPrivateRecords.teacherDescription");
  if (overview?.admin.scope === "school") return t("adminPrivateRecords.schoolDescription");
  return "优先处理审核与反馈，再维护学校空间和全平台协作关系。";
}

function workspaceActions(overview: AdminOverview, t: Translate) {
  const boundary = { href: "#private-records-boundary", label: t("adminPrivateRecords.title"), description: t("adminPrivateRecords.navigationDescription") };
  if (overview.admin.scope === "platform") return [
    { href: "#community-moderation", label: "社区审核", description: "优先处理举报与安全待确认内容" },
    { href: "#pilot-feedback", label: "试点反馈", description: "查看学生、家长和老师的反馈" },
    { href: "#professional-verifications", label: "专业身份", description: "核对个人资质与专业方向" },
    { href: "#member-management", label: "学校与成员", description: "创建学校；仅在学校需要时代为登记成员" },
    boundary,
  ];
  if (overview.admin.role === "支持老师") return [
    { href: "/messages", label: t("rolePaths.teacherMessages"), description: t("rolePaths.teacherMessagesDescription") },
    { href: "/account#students", label: t("rolePaths.teacherStudents"), description: t("rolePaths.teacherStudentsDescription") },
    boundary,
    { href: "/referral", label: "支持路径", description: "需要时连接更多支持" },
  ];
  const actions = [
    { href: "#schools-overview", label: "学校概览", description: t("adminPrivateRecords.directoryDescription") },
    { href: "#member-management", label: "成员管理", description: "登记老师和学生" },
    { href: "#teacher-assignment", label: "负责关系", description: "分配老师负责的学生" },
    boundary,
  ];
  if (CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED) actions.push({ href: "#guardian-assignment", label: "家庭关系", description: "确认家长与孩子" });
  return actions;
}

export default function AdminPage() {
  const actor = useSessionActor();
  return <AdminSession key={`${actor.phase}:${actor.actorId}`} actor={actor} />;
}

function AdminSession({ actor }: { actor: SessionActor }) {
  const [accessError, setAccessError] = useState("");
  // A denied trusted request discards all privileged children and form state.
  return <AdminWorkspace key={accessError ? "denied" : "active"} actor={actor} accessError={accessError} onAccessDenied={setAccessError} />;
}

function AdminWorkspace({ actor, accessError, onAccessDenied }: { actor: SessionActor; accessError: string; onAccessDenied: (message: string) => void }) {
  const { t } = useTranslation();
  const workspaceActive = useRef(true);
  const overviewRequest = useRef(0);
  const rosterRequest = useRef(0);
  const schoolRevision = useRef(0);
  const currentSchoolId = useRef("");
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
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveConfirmation, setArchiveConfirmation] = useState("");
  const [archivingSchool, setArchivingSchool] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [batchRows, setBatchRows] = useState<RosterImportRow[]>([]);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [batchFileName, setBatchFileName] = useState("");
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchResults, setBatchResults] = useState<string[]>([]);
  const [removingMemberId, setRemovingMemberId] = useState("");
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
  const activeSchools = overview?.schools.filter((school) => school.status === "active") || [];
  const selectedSchool = activeSchools.find((school) => school.id === selectedSchoolId);
  const selectedDirectory = overview?.schoolDirectories.find(
    (directory) => directory.school_id === selectedSchool?.id,
  );
  const roleOptions: AssignmentRole[] = isPlatformAdmin
    ? ["学校负责人", "支持老师", "学生", "专业支持者"]
    : ["学生", "支持老师"];
  const assignedStudentIdSet = new Set(
    schoolRoster?.assignments.map((assignment) => assignment.student_user_id) || [],
  );
  const unassignedStudents =
    schoolRoster?.students.filter((student) => !assignedStudentIdSet.has(student.id)) || [];

  useEffect(() => {
    workspaceActive.current = true;
    return () => { workspaceActive.current = false; };
  }, []);

  function trackWorkspaceRequest(schoolId?: string) {
    const sameActor = actor.trackRequest();
    const revision = schoolRevision.current;
    return () => workspaceActive.current && !accessError && sameActor() && actor.isSameActor(actor.actorId)
      && (schoolId === undefined || (currentSchoolId.current === schoolId && schoolRevision.current === revision));
  }

  const rejectAccess = useCallback(() => {
    workspaceActive.current = false;
    ++overviewRequest.current;
    ++rosterRequest.current;
    onAccessDenied("请重新登录有管理权限的账号，再进入工作台。");
  }, [onAccessDenied]);

  const queueRequest = useCallback(async (url: string, init: RequestInit = {}) => {
    // Only these existing same-origin queue APIs may receive an Auth token.
    const allowedPaths = new Set([
      "/api/admin/message-duty", "/api/admin/community-moderation", "/api/admin/community-restrictions",
      "/api/admin/pilot-feedback", "/api/admin/pilot-experience", "/api/admin/professional-verifications",
    ]);
    const unavailable = () => new Error("请重新登录有管理权限的账号，再进入工作台。");
    if (!allowedPaths.has(url)) throw unavailable();
    const sameActor = actor.trackRequest();
    const current = () => workspaceActive.current && !accessError && sameActor() && actor.isSameActor(actor.actorId);
    if (!current()) throw unavailable();
    let token: string;
    try {
      token = await actor.getToken(actor.actorId);
    } catch {
      if (current()) rejectAccess();
      throw unavailable();
    }
    if (!current()) throw unavailable();
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(url, { ...init, headers, redirect: "error" });
    if (!current()) throw unavailable();
    if (response.status === 401 || response.status === 403) {
      rejectAccess();
      throw unavailable();
    }
    return response;
  }, [actor.actorId, actor.getToken, actor.isSameActor, actor.trackRequest, accessError, rejectAccess]);

  async function adminRequest(url: string, init: RequestInit, current: () => boolean) {
    let token: string;
    try {
      token = await actor.getToken(actor.actorId);
    } catch {
      if (current()) rejectAccess();
      return null;
    }
    if (!current()) return null;
    const response = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
    if (!current()) return null;
    if (response.status === 401 || response.status === 403) {
      rejectAccess();
      return null;
    }
    const payload = await response.json();
    if (!current()) return null;
    return { response, payload, token };
  }

  function changeSelectedSchool(schoolId: string) {
    if (currentSchoolId.current !== schoolId) {
      currentSchoolId.current = schoolId;
      ++schoolRevision.current;
      ++rosterRequest.current;
      setSchoolRoster(null);
      setSelectedTeacherId("");
      setSelectedStudentIds([]);
      setSelectedGuardianId("");
      setSelectedGuardianStudentIds([]);
      setNewStudentTeacherId("");
      setNewStudentGuardianId("");
      setAssignmentName("");
      setAssignmentEmail("");
      setArchiveReason("");
      setArchiveConfirmation("");
      setBatchRows([]);
      setBatchErrors([]);
      setBatchFileName("");
      setBatchResults([]);
      setBatchProgress(0);
      setBatchImporting(false);
      setRosterLoading(false);
      setRosterSaving(false);
      setGuardianSaving(false);
      setAddingMember(false);
      setArchivingSchool(false);
      setRemovingMemberId("");
      setActionNotice("");
      setError("");
    }
    setSelectedSchoolId(schoolId);
  }
  async function loadAdminOverview() {
    const sameWorkspace = trackWorkspaceRequest();
    const request = ++overviewRequest.current;
    const current = () => sameWorkspace() && request === overviewRequest.current;
    if (!current()) return;
    setLoading(true);
    setError("");
    try {
      await handleAuthRedirect();
      if (!current()) return;
      const result = await adminRequest("/api/admin/overview", {}, current);
      if (!result) return;
      const { response, payload, token } = result;
      if (!response.ok) throw new Error(payload.error || "管理员概览加载失败。");
      const nextOverview = payload as AdminOverview;
      if (nextOverview.privateRecordsRestricted !== true) {
        workspaceActive.current = false;
        onAccessDenied(t("adminPrivateRecords.scopeUnconfirmed"));
        return;
      }
      setAccessToken(token);
      setOverview(nextOverview);
      changeSelectedSchool(
        nextOverview.schools.some((school) => school.id === currentSchoolId.current && school.status === "active")
          ? currentSchoolId.current
          : nextOverview.schools.find((school) => school.status === "active")?.id || "",
      );
      setAssignmentRole((current) =>
        nextOverview.admin.scope === "school" && current === "学校负责人" ? "学生" : current,
      );
    } catch (adminError) {
      if (current()) setError(adminError instanceof Error ? adminError.message : "管理员概览加载失败。");
    } finally {
      if (current()) setLoading(false);
    }
  }

  useEffect(() => {
    if (accessError || actor.phase !== "ready") {
      setLoading(actor.phase === "loading");
      setError(accessError || (actor.phase === "loading" ? "" : "请先登录有管理权限的账号，再进入工作台。"));
      return;
    }
    void loadAdminOverview();
  }, []);

  async function loadSchoolRoster(schoolId: string) {
    if (!accessToken || !schoolId || !overview?.admin.canManageMembers || currentSchoolId.current !== schoolId) return;
    const sameSchool = trackWorkspaceRequest(schoolId);
    const request = ++rosterRequest.current;
    const current = () => sameSchool() && request === rosterRequest.current;
    if (!current()) return;
    setRosterLoading(true);
    setError("");
    try {
      const result = await adminRequest(
        `/api/admin/teacher-student-assignments?schoolId=${encodeURIComponent(schoolId)}`,
        {}, current,
      );
      if (!result) return;
      const { response, payload } = result;
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
      if (current()) setError(rosterError instanceof Error ? rosterError.message : "学校名单加载失败。");
    } finally {
      if (current()) setRosterLoading(false);
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
    if (!accessToken || !selectedSchoolId || !selectedTeacherId || !schoolRoster || rosterLoading) return;
    const current = trackWorkspaceRequest(selectedSchoolId);
    if (!current()) return;
    setRosterSaving(true);
    setActionNotice("");
    setError("");
    try {
      const result = await adminRequest("/api/admin/teacher-student-assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          teacherUserId: selectedTeacherId,
          studentUserIds: selectedStudentIds,
        }),
      }, current);
      if (!result) return;
      const { response, payload } = result;
      if (!response.ok) throw new Error(payload.error || "老师负责学生保存失败。");
      setSchoolRoster(payload as SchoolRoster);
      setActionNotice("负责学生已保存。支持老师下次打开工作台时只会看到这些学生。");
    } catch (rosterError) {
      if (current()) setError(rosterError instanceof Error ? rosterError.message : "老师负责学生保存失败。");
    } finally {
      if (current()) setRosterSaving(false);
    }
  }

  async function saveGuardianStudents() {
    if (!accessToken || !selectedSchoolId || !selectedGuardianId || !schoolRoster || rosterLoading) return;
    const current = trackWorkspaceRequest(selectedSchoolId);
    if (!current()) return;
    setGuardianSaving(true);
    setActionNotice("");
    setError("");
    try {
      const result = await adminRequest("/api/admin/guardian-student-assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          guardianUserId: selectedGuardianId,
          studentUserIds: selectedGuardianStudentIds,
        }),
      }, current);
      if (!result) return;
      const { response, payload } = result;
      if (!response.ok) throw new Error(payload.error || "亲子关系保存失败。");
      setSchoolRoster({
        ...schoolRoster,
        guardianAssignments: payload.guardianAssignments,
      });
      setActionNotice(t("adminPrivateRecords.guardianRelationshipSaved"));
    } catch (guardianError) {
      if (current()) setError(guardianError instanceof Error ? guardianError.message : "亲子关系保存失败。");
    } finally {
      if (current()) setGuardianSaving(false);
    }
  }

  async function handleCreateSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;
    const current = trackWorkspaceRequest();
    if (!current()) return;
    setCreatingSchool(true);
    setActionNotice("");
    setError("");
    try {
      const result = await adminRequest("/api/admin/schools", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: schoolName }),
      }, current);
      if (!result) return;
      const { response, payload } = result;
      if (!response.ok) throw new Error(payload.error || "学校空间创建失败。");
      const newSchool = payload.school as School;
      setSchoolName("");
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
            professionals: [],
            assignments: [],
            guardianAssignments: [],
          },
          ...current.schoolDirectories,
        ],
      } : current);
      changeSelectedSchool(newSchool.id);
      setActionNotice("学校已创建。现在可以添加学校负责人。");
    } catch (schoolError) {
      if (current()) setError(schoolError instanceof Error ? schoolError.message : "学校空间创建失败。");
    } finally {
      if (current()) setCreatingSchool(false);
    }
  }

  async function handleAssignUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !selectedSchoolId) return;
    const current = trackWorkspaceRequest(selectedSchoolId);
    if (!current()) return;
    setAddingMember(true);
    setActionNotice("");
    setError("");
    try {
      const result = await adminRequest("/api/admin/school-assignments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          name: assignmentName,
          email: assignmentEmail,
          role: assignmentRole,
          teacherUserId: assignmentRole === "学生" ? newStudentTeacherId : "",
          guardianUserId: assignmentRole === "学生" && CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? newStudentGuardianId : "",
        }),
      }, current);
      if (!result) return;
      const { response, payload } = result;
      if (!response.ok) throw new Error(payload.error || "学校成员添加失败。");
      const addedName = assignmentName.trim();
      setAssignmentName("");
      setAssignmentEmail("");
      setNewStudentTeacherId("");
      setNewStudentGuardianId("");
      setActionNotice(
        assignmentRole === "学生" && newStudentTeacherId
          ? `已为 ${addedName} 建档并保存负责关系。`
          : `已添加 ${addedName}。`,
      );
      await loadAdminOverview();
      if (current()) await loadSchoolRoster(selectedSchoolId);
    } catch (assignmentError) {
      if (current()) setError(assignmentError instanceof Error ? assignmentError.message : "学校成员添加失败。");
    } finally {
      if (current()) setAddingMember(false);
    }
  }

  function downloadRosterTemplate() {
    const blob = new Blob([`\uFEFF${rosterImportTemplate()}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "YouthTempo-学校成员导入模板.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function readRosterFile(file: File | undefined) {
    const current = trackWorkspaceRequest(selectedSchoolId);
    if (!current()) return;
    setBatchResults([]);
    setBatchProgress(0);
    if (!file) {
      setBatchFileName("");
      setBatchRows([]);
      setBatchErrors([]);
      return;
    }
    if (file.size > 512 * 1024) {
      setBatchFileName(file.name);
      setBatchRows([]);
      setBatchErrors(["文件不能超过 512 KB。"]);
      return;
    }
    const result = parseSchoolRosterCsv(await file.text());
    if (!current()) return;
    setBatchFileName(file.name);
    setBatchRows(result.rows);
    setBatchErrors(result.errors);
  }

  async function importRosterRows() {
    if (!accessToken || !selectedSchoolId || !batchRows.length || batchErrors.length) return;
    const current = trackWorkspaceRequest(selectedSchoolId);
    if (!current()) return;
    setBatchImporting(true);
    setBatchProgress(0);
    setBatchResults([]);
    setActionNotice("");
    setError("");

    const orderedRows = [...batchRows].sort((left, right) => {
      const priority = (row: RosterImportRow) => row.role === "学生" ? 1 : 0;
      return priority(left) - priority(right) || left.rowNumber - right.rowNumber;
    });
    const results: string[] = [];

    for (const [index, row] of orderedRows.entries()) {
      if (!current()) return;
      try {
        const result = await adminRequest("/api/admin/school-assignments", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            schoolId: selectedSchoolId,
            name: row.name,
            email: row.email,
            role: row.role,
            teacherEmail: row.teacherEmail,
            guardianEmail: row.guardianEmail,
          }),
        }, current);
        if (!result) return;
        const { response, payload } = result;
        if (!response.ok) throw new Error(payload.error || "添加失败");
        results.push(`第 ${row.rowNumber} 行 · ${row.name}：已添加`);
      } catch (rowError) {
        if (!current()) return;
        const message = rowError instanceof Error ? rowError.message : "添加失败";
        results.push(`第 ${row.rowNumber} 行 · ${row.name}：${message}`);
      }
      setBatchProgress(index + 1);
      setBatchResults([...results]);
    }

    const failedCount = results.filter((result) => !result.endsWith("已添加")).length;
    setActionNotice(
      failedCount
        ? `批量登记完成：成功 ${results.length - failedCount} 人，未完成 ${failedCount} 人。请按下方提示修正后单独补充。`
        : `批量登记完成，共 ${results.length} 人。`,
    );
    await loadAdminOverview();
    if (current()) await loadSchoolRoster(selectedSchoolId);
    if (current()) setBatchImporting(false);
  }

  async function handleArchiveSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !selectedSchool || selectedSchool.status !== "active") return;
    const current = trackWorkspaceRequest(selectedSchool.id);
    if (!current()) return;
    setArchivingSchool(true);
    setActionNotice("");
    setError("");
    try {
      const result = await adminRequest("/api/admin/schools", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schoolId: selectedSchool.id,
          confirmationName: archiveConfirmation,
          reason: archiveReason,
        }),
      }, current);
      if (!result) return;
      const { response, payload } = result;
      if (!response.ok) throw new Error(payload.error || "学校退出试点失败。");
      const archivedName = selectedSchool.name;
      const nextSchoolId = activeSchools.find((school) => school.id !== selectedSchool.id)?.id || "";
      setArchiveReason("");
      setArchiveConfirmation("");
      changeSelectedSchool(nextSchoolId);
      setArchivingSchool(false);
      setActionNotice(`${archivedName} 已退出试点，学校访问权限和关系已解除。`);
      await loadAdminOverview();
    } catch (archiveError) {
      if (current()) setError(archiveError instanceof Error ? archiveError.message : "学校退出试点失败。");
    } finally {
      if (current()) setArchivingSchool(false);
    }
  }

  async function removeSchoolMember(person: SchoolPerson, role: AssignmentRole) {
    if (!accessToken || !selectedSchoolId || removingMemberId) return;
    const current = trackWorkspaceRequest(selectedSchoolId);
    if (!current()) return;
    const confirmed = window.confirm(
      `确定将“${person.display_name || person.email}”移出${selectedSchool?.name || "当前学校"}吗？\n\n账号和个人历史不会被删除，但该成员会失去当前学校的查看权限和负责关系。`,
    );
    if (!confirmed || !current()) return;

    setRemovingMemberId(person.id);
    setActionNotice("");
    setError("");
    try {
      const result = await adminRequest("/api/admin/school-assignments", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          userId: person.id,
        }),
      }, current);
      if (!result) return;
      const { response, payload } = result;
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
                professionals: directory.professionals.filter((member) => member.id !== person.id),
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
      if (current()) setError(removeError instanceof Error ? removeError.message : "成员移出失败。");
    } finally {
      if (current()) setRemovingMemberId("");
    }
  }

  return (
    <>
      <PageHero label="角色工作台" title={adminTitle(overview, t)} subtitle={adminSubtitle(overview, t)} />
      {isPlatformAdmin ? (
        <nav className="container flex flex-wrap gap-3 py-4" aria-label={t("adminSupport.title")}>
          <Link href="/admin/role-preview" className="button-secondary">{t("adminRolePreview.action")}</Link>
          <Link href="/admin/support" className="button-secondary">{t("adminSupport.title")}</Link>
          <Link href="/admin/peer-space" className="button-secondary">{t("peerSpaceReview.title")}</Link>
        </nav>
      ) : null}

      {overview ? (
        <section className="border-b border-ink/10 bg-white/70">
          <div className="container py-4 sm:py-5">
            <p className="mb-3 text-xs font-bold text-sage-dark">工作导航</p>
            <nav
              className={`grid gap-3 ${
                workspaceActions(overview, t).length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
              }`}
              aria-label={`${overview.admin.role}工作导航`}
            >
              {workspaceActions(overview, t).map((action) => (
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
                <Link href="/account?next=/admin" className="button-primary">去账号登录</Link>
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
                      ? t("adminPrivateRecords.teacherDescription")
                      : t("adminPrivateRecords.schoolDescription")}
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
                  <p className="mt-2 text-sm leading-6 text-muted">学生、学校负责人和支持老师；当前试点不新建家长账号。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">{t("adminPrivateRecords.recordsLabel")}</p>
                  <p className="mt-3 text-lg font-bold text-ink">{t("adminPrivateRecords.restrictedValue")}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{t("adminPrivateRecords.countUnavailable")}</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">在用学校</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schools}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">{isPlatformAdmin ? "当前正在试点的学校。" : "你可管理的学校。"}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {isPlatformAdmin && accessToken ? <PilotDutyMessageQueue accessToken={accessToken} request={queueRequest} /> : null}

      {isPlatformAdmin && accessToken ? <CommunityModerationQueue accessToken={accessToken} request={queueRequest} /> : null}

      {isPlatformAdmin && accessToken ? <PilotFeedbackOverview accessToken={accessToken} request={queueRequest} /> : null}
      {isPlatformAdmin && accessToken ? <MicroFeedbackOverview accessToken={accessToken} request={queueRequest} /> : null}

      {isPlatformAdmin && accessToken ? <ProfessionalVerificationQueue accessToken={accessToken} request={queueRequest} /> : null}

      {overview ? (
        <section id="private-records-boundary" className="section scroll-mt-24">
          <div className="container">
            <div className="card" role="status">
              <h2 className="text-lg font-bold text-ink">{t("adminPrivateRecords.title")}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{t("adminPrivateRecords.description")}</p>
              <p className="mt-2 text-sm leading-7 text-muted">{t("adminPrivateRecords.safetyDescription")}</p>
            </div>
          </div>
        </section>
      ) : null}

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
                    <select className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage" value={selectedSchoolId} onChange={(event) => changeSelectedSchool(event.target.value)}>
                      <option value="">选择学校</option>
                      {activeSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
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
                          : assignmentRole === "专业支持者"
                            ? "专业支持者姓名"
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
                    {CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? (
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
                    ) : (
                      <p className="text-sm leading-6 text-muted">当前学生自主试点不创建家长账号或亲子关系；未成年人家长功能留待后续批准。</p>
                    )}
                  </div>
                ) : null}
                <p className="text-sm leading-6 text-muted">
                  {assignmentRole === "学生"
                    ? "可以先完成学生建档，并按需要分配负责老师；当前试点不创建家长关系。"
                    : assignmentRole === "专业支持者"
                      ? "账号创建后，对方需要登录账户提交个人资质资料；机构信息可以不填，审核通过前不会显示专业身份标记。"
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

              <details className="group mt-7 border-t border-ink/10 pt-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-4">
                  <span>
                    <span className="block text-sm font-bold text-ink">一次登记多名成员</span>
                    <span className="mt-1 block text-xs leading-5 text-muted">上传 CSV，先检查再登记，最多 100 人</span>
                  </span>
                  <span className="text-sm font-bold text-sage-dark group-open:hidden">展开</span>
                  <span className="hidden text-sm font-bold text-sage-dark group-open:inline">收起</span>
                </summary>
                <div className="mt-4 grid gap-4 rounded-2xl border border-ink/10 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-ink">准备名单</p>
                      <p className="mt-1 text-xs leading-5 text-muted">必填：姓名、邮箱、身份。学生还可填写老师邮箱；当前模板不包含家长。</p>
                    </div>
                    <button type="button" className="button-secondary" onClick={downloadRosterTemplate}>
                      下载 CSV 模板
                    </button>
                  </div>
                  <label className="grid gap-2 text-sm font-bold text-ink">
                    选择名单文件
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="field-control text-sm file:mr-3 file:rounded-full file:border-0 file:bg-mint file:px-3 file:py-2 file:font-bold file:text-sage-dark"
                      disabled={batchImporting}
                      onChange={(event) => readRosterFile(event.target.files?.[0])}
                    />
                  </label>
                  {batchFileName ? <p className="text-xs text-muted">已读取：{batchFileName}</p> : null}
                  {batchErrors.length ? (
                    <div className="rounded-2xl border border-[#b8644d]/25 bg-[#f9eee9] px-4 py-4" role="alert">
                      <p className="text-sm font-bold text-[#8a4634]">请先修正文件</p>
                      <ul className="mt-2 grid gap-1 text-xs leading-5 text-[#8a4634]">
                        {batchErrors.slice(0, 12).map((message) => <li key={message}>· {message}</li>)}
                      </ul>
                      {batchErrors.length > 12 ? <p className="mt-2 text-xs text-[#8a4634]">另有 {batchErrors.length - 12} 条提示。</p> : null}
                    </div>
                  ) : null}
                  {batchRows.length > 0 && !batchErrors.length ? (
                    <div className="overflow-hidden rounded-2xl border border-sage/25 bg-mint/35">
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <p className="text-sm font-bold text-sage-dark">检查通过，共 {batchRows.length} 人</p>
                        <p className="text-xs text-muted">老师会先登记，再建立负责学生关系</p>
                      </div>
                      <div className="max-h-56 overflow-auto border-t border-sage/20 bg-white">
                        {batchRows.map((row) => (
                          <div key={`${row.rowNumber}-${row.email}`} className="grid gap-1 border-b border-ink/5 px-4 py-3 text-xs last:border-0 sm:grid-cols-[3rem_1fr_1.2fr_auto] sm:items-center">
                            <span className="text-muted">{row.rowNumber} 行</span>
                            <span className="font-bold text-ink">{row.name}</span>
                            <span className="break-all text-muted">{row.email}</span>
                            <span className="font-bold text-sage-dark">{row.role}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {batchImporting ? (
                    <p className="text-sm font-bold text-sage-dark" aria-live="polite">
                      正在登记 {batchProgress}/{batchRows.length}…
                    </p>
                  ) : null}
                  {batchResults.length ? (
                    <div className="max-h-48 overflow-auto rounded-2xl bg-cream px-4 py-3 text-xs leading-6 text-muted" aria-live="polite">
                      {batchResults.map((result) => <p key={result}>{result}</p>)}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="button-primary w-full sm:w-fit"
                    disabled={batchImporting || !batchRows.length || Boolean(batchErrors.length) || !selectedSchoolId}
                    onClick={importRosterRows}
                  >
                    {batchImporting ? "正在登记…" : `确认登记 ${batchRows.length || 0} 人`}
                  </button>
                  <p className="text-xs leading-5 text-muted">如果个别行失败，已成功的成员会保留，下方会逐行说明，避免整份名单反复提交。</p>
                </div>
              </details>
              {actionNotice ? <p className="mt-4 text-sm font-bold text-sage-dark">{actionNotice}</p> : null}
              {error ? <p className="mt-4 text-sm font-bold text-sage-dark">{error}</p> : null}
            </div>

            <div className="card">
              <p className="eyebrow">学校</p>
              <h2 className="mt-3 text-[1.5rem] font-bold text-ink">{isPlatformAdmin ? "在用学校" : "我的学校"}</h2>
              {isPlatformAdmin ? (
                <p className="mt-2 text-sm leading-6 text-muted">
                  这里只显示正在试点的学校。已退出学校保留审计记录，但不再出现在日常管理列表中。
                </p>
              ) : null}
              <div className="mt-6 grid gap-3">
                {activeSchools.length > 0 ? activeSchools.map((school) => {
                  const directory = overview.schoolDirectories.find(
                    (item) => item.school_id === school.id,
                  );
                  return (
                    <button
                      key={school.id}
                      type="button"
                      className={`rounded-2xl border px-4 py-4 text-left transition ${selectedSchoolId === school.id ? "border-sage bg-mint" : "border-ink/10 bg-white/75"}`}
                      onClick={() => changeSelectedSchool(school.id)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-bold text-ink">{school.name}</p>
                        <p className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-sage-dark">
                          {selectedSchoolId === school.id ? "正在管理" : school.status === "active" ? "选择管理" : school.status}
                        </p>
                      </div>
                      {directory ? (
                        <p className="mt-3 text-xs font-bold text-muted">
                          负责人 {directory.leaders.length} · 老师 {directory.teachers.length} · 学生 {directory.students.length}
                          {CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? ` · 家长 ${directory.guardians.length}` : ""}
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
                      ["专业支持者", selectedDirectory.professionals],
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

              {isPlatformAdmin && selectedSchool?.status === "active" ? (
                <form className="mt-7 border-t border-[#b8644d]/25 pt-6" onSubmit={handleArchiveSchool}>
                  <p className="eyebrow text-[#8a4634]">退出试点</p>
                  <h3 className="mt-2 text-xl font-bold text-ink">关闭 {selectedSchool.name} 的学校访问</h3>
                  <p className="mt-3 text-sm leading-7 text-muted">
                    生效后，学校成员和负责关系立即解除，学校跟进笔记与未完成邀请删除；个人账号、个人记录和社区内容不会因此删除。
                  </p>
                  <label className="mt-4 grid gap-2 text-sm font-bold text-ink">
                    退出原因
                    <textarea
                      className="min-h-24 rounded-2xl border border-[#b8644d]/25 bg-white px-4 py-3 text-sm outline-none focus:border-[#b8644d]"
                      value={archiveReason}
                      onChange={(event) => setArchiveReason(event.target.value)}
                      placeholder="说明退出日期、学校确认情况和后续联系人（10–500 字）"
                      maxLength={500}
                    />
                  </label>
                  <label className="mt-4 grid gap-2 text-sm font-bold text-ink">
                    输入完整学校名称确认
                    <input
                      className="rounded-2xl border border-[#b8644d]/25 bg-white px-4 py-3 text-sm outline-none focus:border-[#b8644d]"
                      value={archiveConfirmation}
                      onChange={(event) => setArchiveConfirmation(event.target.value)}
                      placeholder={selectedSchool.name}
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="submit"
                    className="mt-4 rounded-xl border border-[#b8644d]/35 bg-white px-4 py-3 text-sm font-bold text-[#8a4634] transition hover:bg-[#f9eee9] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={archivingSchool || archiveReason.trim().length < 10 || archiveConfirmation.trim() !== selectedSchool.name}
                  >
                    {archivingSchool ? "正在退出…" : "确认退出试点"}
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {overview && overview.admin.role !== "支持老师" ? (
        <section id="schools-overview" className="section scroll-mt-24">
          <div className="container">
            <SectionHeader
              title={t("adminPrivateRecords.directoryTitle")}
              description={t("adminPrivateRecords.directoryDescription")}
            />
            <div className="grid gap-5">
              {activeSchools.map((school) => {
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
                const relationshipGaps = findStudentRelationshipGaps(directory);

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
                        {CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? <span className="rounded-full bg-mint px-3 py-2">家长 {directory.guardians.length}</span> : null}
                      </div>
                    </div>

                    {relationshipGaps.withoutTeacher.length ? (
                      <div className="mt-5 rounded-2xl border border-[#d7a76f]/35 bg-[#fff8ed] px-4 py-4 sm:px-5">
                        <p className="font-bold text-ink">关系待补充</p>
                        <p className="mt-1 text-sm leading-6 text-muted">
                          及时补充负责老师，避免需要校内支持时没有明确承接人。当前试点不把家长关系计为完整度要求。
                        </p>
                        <div className="mt-3 grid gap-3">
                          <div className="rounded-xl bg-white/80 px-4 py-3">
                            <p className="text-xs font-bold text-[#8a5b2f]">
                              未分配老师 {relationshipGaps.withoutTeacher.length} 人
                            </p>
                            <p className="mt-2 text-sm text-ink">
                              {relationshipGaps.withoutTeacher.length
                                ? relationshipGaps.withoutTeacher
                                    .map((student) => student.display_name || student.email)
                                    .join("、")
                                : "全部学生均已分配"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-5 rounded-2xl bg-mint px-4 py-3 text-sm font-bold text-sage-dark">
                        所有学生都已有负责老师；当前试点不要求家长加入。
                      </p>
                    )}

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
                                <p className="mt-4 border-t border-ink/10 pt-4 text-xs leading-6 text-muted">{t("adminPrivateRecords.directoryPrivateBoundary")}</p>
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
                    {CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? <div className="mt-6 border-t border-ink/10 pt-6">
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
                    </div> : null}
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
                  <span className="mt-1 block text-sm font-normal text-muted">{t("adminPrivateRecords.assignmentDescription")}</span>
                </span>
                <span className="button-secondary pointer-events-none group-open:hidden">展开管理</span>
                <span className="button-secondary pointer-events-none hidden group-open:inline-flex">收起</span>
              </summary>
              <div className={isPlatformAdmin ? "pt-8" : ""}>
                <SectionHeader
                  title={isPlatformAdmin ? "老师与学生分配" : "分配老师负责的学生"}
                  description={t("adminPrivateRecords.assignmentDescription")}
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
                    {t("adminPrivateRecords.directoryPrivateBoundary")}
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

      {overview?.admin.canManageMembers && CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED ? (
        <section id="guardian-assignment" className={`section scroll-mt-24 ${isPlatformAdmin ? "section-muted" : ""}`}>
          <div className="container">
            <details className="group" open={!isPlatformAdmin}>
              <summary className={isPlatformAdmin ? "flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white px-5 py-5 shadow-sm transition hover:border-sage" : "hidden"}>
                <span>
                  <span className="block text-[1.25rem] font-bold text-ink">家长与孩子关联</span>
                  <span className="mt-1 block text-sm font-normal text-muted">{t("adminPrivateRecords.directoryPrivateBoundary")}</span>
                </span>
                <span className="button-secondary pointer-events-none group-open:hidden">展开管理</span>
                <span className="button-secondary pointer-events-none hidden group-open:inline-flex">收起</span>
              </summary>
              <div className={isPlatformAdmin ? "pt-8" : ""}>
                <SectionHeader
                  title={isPlatformAdmin ? "家长与孩子关联" : "确认家长与孩子"}
                  description={t("adminPrivateRecords.directoryPrivateBoundary")}
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

    </>
  );
}
