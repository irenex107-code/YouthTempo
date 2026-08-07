import type { NextApiRequest, NextApiResponse } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminContext } from "@/lib/adminAccess";
import { assessSweetRecord } from "@/lib/attentionSignals";
import {
  buildSchoolMonthlyTrends,
  buildTeacherWeeklySummaries,
  type InsightTeacher,
} from "@/lib/schoolDashboardInsights";

async function getCount(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function getInsightRecords(
  supabase: SupabaseClient,
  since: string,
  schoolIds: string[] | null,
  studentIds: string[] | null,
) {
  const pageSize = 1000;
  const maxRecords = 10_000;
  const records: Array<{ user_id: string; school_id: string; created_at: string }> = [];

  for (let from = 0; from < maxRecords; from += pageSize) {
    let query = supabase
      .from("sweet_records")
      .select("user_id,school_id,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (schoolIds) query = query.in("school_id", schoolIds);
    if (studentIds) query = query.in("user_id", studentIds);
    const { data, error } = await query;
    if (error) throw error;
    records.push(...(data || []));
    if ((data || []).length < pageSize) return records;
  }

  throw new Error("近四周记录量超出当前汇总上限，请联系平台负责人处理。");
}

function recordPreview(records: unknown) {
  if (!Array.isArray(records)) return "已完成一份 SWEET 节律记录。";

  const dimensions = records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const item = record as Record<string, unknown>;
    const label =
      typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : typeof item.label === "string"
          ? item.label.trim()
          : "";
    const fields = Array.isArray(item.fields) ? item.fields : [];
    const firstAnswer = fields.flatMap((field) => {
      if (!field || typeof field !== "object") return [];
      const value = (field as Record<string, unknown>).value;
      if (typeof value === "string" && value.trim()) return [value.trim()];
      if (Array.isArray(value)) {
        const text = value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).join("、");
        return text ? [text] : [];
      }
      return [];
    })[0];
    return label && firstAnswer ? [`${label}：${firstAnswer}`] : [];
  });

  return dimensions.length
    ? dimensions.slice(0, 3).join("；")
    : "已完成一份 SWEET 节律记录。";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const context = await getAdminContext(req);
    const { supabase } = context;
    const isSupportOnly =
      context.kind === "school" &&
      !Object.values(context.schoolRoles).includes("school_admin");
    const assignedStudentIds = context.assignedStudentIds;

    const schoolsQuery = supabase
      .from("schools")
      .select("id,name,status,created_at")
      .order("created_at", { ascending: false });

    const { data: schools, error: schoolsError } = context.kind === "school"
      ? await schoolsQuery.in("id", context.managedSchoolIds)
      : await schoolsQuery;
    if (schoolsError) throw schoolsError;

    const schoolIds = (schools || []).map((school) => school.id as string);
    const hasScopedSchools = context.kind === "platform" || schoolIds.length > 0;
    const canManageMembers =
      context.kind === "platform" ||
      Object.values(context.schoolRoles).includes("school_admin");
    const directorySchoolIds =
      context.kind === "platform"
        ? schoolIds
        : schoolIds.filter((schoolId) => context.schoolRoles[schoolId] === "school_admin");

    let schoolDirectories: Array<{
      school_id: string;
      leaders: Array<{ id: string; email: string; display_name: string }>;
      teachers: Array<{ id: string; email: string; display_name: string }>;
      students: Array<{ id: string; email: string; display_name: string }>;
      guardians: Array<{ id: string; email: string; display_name: string }>;
      professionals: Array<{ id: string; email: string; display_name: string }>;
      assignments: Array<{ teacher_user_id: string; student_user_id: string }>;
      guardianAssignments: Array<{ guardian_user_id: string; student_user_id: string }>;
    }> = [];

    if (canManageMembers && directorySchoolIds.length > 0) {
      const [
        { data: memberships, error: membershipDirectoryError },
        { data: students, error: studentDirectoryError },
        { data: guardians, error: guardianDirectoryError },
        { data: professionals, error: professionalDirectoryError },
        { data: assignments, error: assignmentDirectoryError },
        { data: guardianAssignments, error: guardianAssignmentDirectoryError },
      ] = await Promise.all([
        supabase
          .from("school_members")
          .select("school_id,user_id,email,member_role")
          .in("school_id", directorySchoolIds)
          .in("member_role", ["school_admin", "school_support"])
          .eq("status", "active"),
        supabase
          .from("profiles")
          .select("id,email,display_name,school_id")
          .in("school_id", directorySchoolIds)
          .eq("role", "学生"),
        supabase
          .from("profiles")
          .select("id,email,display_name,school_id")
          .in("school_id", directorySchoolIds)
          .eq("role", "家长"),
        supabase
          .from("profiles")
          .select("id,email,display_name,school_id")
          .in("school_id", directorySchoolIds)
          .eq("role", "专业支持者"),
        supabase
          .from("teacher_student_assignments")
          .select("school_id,teacher_user_id,student_user_id")
          .in("school_id", directorySchoolIds)
          .eq("status", "active"),
        supabase
          .from("guardian_student_links")
          .select("school_id,guardian_user_id,student_user_id")
          .in("school_id", directorySchoolIds)
          .eq("status", "active"),
      ]);
      if (membershipDirectoryError) throw membershipDirectoryError;
      if (studentDirectoryError) throw studentDirectoryError;
      if (guardianDirectoryError) throw guardianDirectoryError;
      if (professionalDirectoryError) throw professionalDirectoryError;
      if (assignmentDirectoryError) throw assignmentDirectoryError;
      if (guardianAssignmentDirectoryError) throw guardianAssignmentDirectoryError;

      const memberUserIds = Array.from(
        new Set((memberships || []).map((membership) => membership.user_id as string)),
      );
      const { data: memberProfiles, error: memberProfileError } = memberUserIds.length
        ? await supabase
            .from("profiles")
            .select("id,email,display_name")
            .in("id", memberUserIds)
        : { data: [], error: null };
      if (memberProfileError) throw memberProfileError;

      const memberProfileById = new Map(
        (memberProfiles || []).map((profile) => [profile.id as string, profile]),
      );
      schoolDirectories = directorySchoolIds.map((schoolId) => {
        const schoolMemberships = (memberships || []).filter(
          (membership) => membership.school_id === schoolId,
        );
        const peopleForRole = (memberRole: "school_admin" | "school_support") =>
          schoolMemberships
            .filter((membership) => membership.member_role === memberRole)
            .map((membership) => {
              const profile = memberProfileById.get(membership.user_id as string);
              return {
                id: membership.user_id as string,
                email: profile?.email || membership.email || "",
                display_name: profile?.display_name || "",
              };
            });

        return {
          school_id: schoolId,
          leaders: peopleForRole("school_admin"),
          teachers: peopleForRole("school_support"),
          students: (students || [])
            .filter((student) => student.school_id === schoolId)
            .map((student) => ({
              id: student.id as string,
              email: student.email || "",
              display_name: student.display_name || "",
            })),
          guardians: (guardians || [])
            .filter((guardian) => guardian.school_id === schoolId)
            .map((guardian) => ({
              id: guardian.id as string,
              email: guardian.email || "",
              display_name: guardian.display_name || "",
            })),
          professionals: (professionals || [])
            .filter((professional) => professional.school_id === schoolId)
            .map((professional) => ({
              id: professional.id as string,
              email: professional.email || "",
              display_name: professional.display_name || "",
            })),
          assignments: (assignments || [])
            .filter((assignment) => assignment.school_id === schoolId)
            .map((assignment) => ({
              teacher_user_id: assignment.teacher_user_id as string,
              student_user_id: assignment.student_user_id as string,
            })),
          guardianAssignments: (guardianAssignments || [])
            .filter((assignment) => assignment.school_id === schoolId)
            .map((assignment) => ({
              guardian_user_id: assignment.guardian_user_id as string,
              student_user_id: assignment.student_user_id as string,
            })),
        };
      });
    }

    let profileCountQuery = context.kind === "school"
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).in("school_id", schoolIds)
      : supabase.from("profiles").select("id", { count: "exact", head: true });
    let schoolUserCountQuery = context.kind === "school"
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).in("school_id", schoolIds)
      : supabase.from("profiles").select("id", { count: "exact", head: true }).not("school_id", "is", null);
    let recordCountQuery = context.kind === "school"
      ? supabase.from("sweet_records").select("id", { count: "exact", head: true }).in("school_id", schoolIds)
      : supabase.from("sweet_records").select("id", { count: "exact", head: true });
    const memberCountQuery = context.kind === "school"
      ? supabase.from("school_members").select("id", { count: "exact", head: true }).in("school_id", schoolIds).eq("status", "active")
      : supabase.from("school_members").select("id", { count: "exact", head: true });
    const wechatCountQuery = supabase.from("wechat_identities").select("id", { count: "exact", head: true });

    if (isSupportOnly && assignedStudentIds.length > 0) {
      profileCountQuery = profileCountQuery.in("id", assignedStudentIds);
      schoolUserCountQuery = schoolUserCountQuery.in("id", assignedStudentIds);
      recordCountQuery = recordCountQuery.in("user_id", assignedStudentIds);
    }

    const [profileCount, schoolUserCount, sweetRecordCount, schoolMemberCount, wechatIdentityCount] = hasScopedSchools
      ? isSupportOnly && assignedStudentIds.length === 0
        ? [0, 0, 0, 0, 0]
        : await Promise.all([
          getCount(profileCountQuery),
          getCount(schoolUserCountQuery),
          getCount(recordCountQuery),
          getCount(memberCountQuery),
          getCount(wechatCountQuery),
        ])
      : [0, 0, 0, 0, 0];

    let recentRecordsQuery = supabase
      .from("sweet_records")
      .select("id,user_id,school_id,records,summary,created_at")
      .order("created_at", { ascending: false })
      .limit(40);
    if (context.kind === "school") recentRecordsQuery = recentRecordsQuery.in("school_id", schoolIds);
    if (isSupportOnly && assignedStudentIds.length > 0) {
      recentRecordsQuery = recentRecordsQuery.in("user_id", assignedStudentIds);
    }
    const { data: recentRecords, error: recordsError } =
      isSupportOnly && assignedStudentIds.length === 0
        ? { data: [], error: null }
        : await recentRecordsQuery;
    if (recordsError) throw recordsError;

    const recentUserIds = Array.from(
      new Set((recentRecords || []).map((record) => record.user_id as string)),
    );
    const { data: recentProfiles, error: recentProfileError } = recentUserIds.length
      ? await supabase
          .from("profiles")
          .select("id,email,display_name")
          .in("id", recentUserIds)
      : { data: [], error: null };
    if (recentProfileError) throw recentProfileError;
    const recentProfileById = new Map(
      (recentProfiles || []).map((profile) => [profile.id as string, profile]),
    );
    const schoolById = new Map((schools || []).map((school) => [school.id as string, school]));
    const recentRecordItems = (recentRecords || []).map((record) => {
      const profile = recentProfileById.get(record.user_id as string);
      const school = record.school_id ? schoolById.get(record.school_id as string) : null;
      return {
        id: record.id,
        user_id: record.user_id,
        school_id: record.school_id,
        school_name: school?.name || null,
        student_name: profile?.display_name || profile?.email || "未命名学生",
        student_email: profile?.email || null,
        summary: record.summary?.trim() || recordPreview(record.records),
        created_at: record.created_at,
      };
    });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let attentionRecordsQuery = supabase
      .from("sweet_records")
      .select("id,user_id,school_id,records,summary,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    if (context.kind === "school") attentionRecordsQuery = attentionRecordsQuery.in("school_id", schoolIds);
    if (isSupportOnly && assignedStudentIds.length > 0) {
      attentionRecordsQuery = attentionRecordsQuery.in("user_id", assignedStudentIds);
    }
    const { data: attentionRecords, error: attentionError } =
      isSupportOnly && assignedStudentIds.length === 0
        ? { data: [], error: null }
        : await attentionRecordsQuery;
    if (attentionError) throw attentionError;

    const latestAttentionByUser = new Map<string, {
      id: string;
      user_id: string;
      school_id: string;
      summary: string | null;
      created_at: string;
      level: "priority" | "check_in";
      reasons: string[];
    }>();
    (attentionRecords || []).forEach((record) => {
      if (!record.school_id || latestAttentionByUser.has(record.user_id)) return;
      const assessment = assessSweetRecord(record.records);
      if (assessment.level === "routine") return;
      latestAttentionByUser.set(record.user_id, {
        id: record.id,
        user_id: record.user_id,
        school_id: record.school_id,
        summary: record.summary,
        created_at: record.created_at,
        level: assessment.level,
        reasons: assessment.reasons,
      });
    });

    const attentionItems = Array.from(latestAttentionByUser.values());
    const attentionUserIds = attentionItems.map((item) => item.user_id);
    const attentionRecordIds = attentionItems.map((item) => item.id);
    const { data: attentionProfiles, error: profileError } = attentionUserIds.length
      ? await supabase.from("profiles").select("id,email,display_name").in("id", attentionUserIds)
      : { data: [], error: null };
    if (profileError) throw profileError;
    const { data: followups, error: followupError } = attentionRecordIds.length
      ? await supabase
          .from("school_followups")
          .select("record_id,status,note,updated_at")
          .in("record_id", attentionRecordIds)
      : { data: [], error: null };
    if (followupError) throw followupError;

    const profileById = new Map((attentionProfiles || []).map((profile) => [profile.id, profile]));
    const followupByRecordId = new Map((followups || []).map((followup) => [followup.record_id, followup]));
    const attentionQueue = attentionItems.map((item) => {
      const profile = profileById.get(item.user_id);
      const followup = followupByRecordId.get(item.id);
      return {
        ...item,
        student_name: profile?.display_name || profile?.email || "未命名学生",
        student_email: profile?.email || null,
        followup_status: followup?.status || "new",
        followup_note: followup?.note || "",
        followup_updated_at: followup?.updated_at || null,
      };
    });

    const insightSince = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
    const insightRecords =
      isSupportOnly && assignedStudentIds.length === 0
        ? []
        : await getInsightRecords(
            supabase,
            insightSince,
            context.kind === "school" ? schoolIds : null,
            isSupportOnly ? assignedStudentIds : null,
          );

    let insightTeachers: InsightTeacher[] = schoolDirectories.flatMap((directory) => directory.teachers.map((teacher) => ({
      school_id: directory.school_id,
      teacher_user_id: teacher.id,
      teacher_name: teacher.display_name || teacher.email,
      student_ids: directory.assignments
        .filter((assignment) => assignment.teacher_user_id === teacher.id)
        .map((assignment) => assignment.student_user_id),
    })));
    const ownSupportSchoolIds = context.kind === "school"
      ? schoolIds.filter((schoolId) => context.schoolRoles[schoolId] === "school_support")
      : [];
    if (ownSupportSchoolIds.length > 0) {
      const { data: ownAssignments, error: ownAssignmentsError } = await supabase
        .from("teacher_student_assignments")
        .select("school_id,student_user_id")
        .eq("teacher_user_id", context.user.id)
        .eq("status", "active")
        .in("school_id", ownSupportSchoolIds);
      if (ownAssignmentsError) throw ownAssignmentsError;
      insightTeachers = insightTeachers.concat(ownSupportSchoolIds.map((schoolId) => ({
        school_id: schoolId,
        teacher_user_id: context.user.id,
        teacher_name: context.email,
        student_ids: (ownAssignments || [])
          .filter((assignment) => assignment.school_id === schoolId)
          .map((assignment) => assignment.student_user_id as string),
      })));
    }

    const teacherWeeklySummaries = buildTeacherWeeklySummaries(
      insightRecords,
      insightTeachers,
      attentionQueue.map((item) => item.user_id),
    );
    const schoolMonthlyTrends = buildSchoolMonthlyTrends(
      insightRecords,
      (schools || []).filter((school) => directorySchoolIds.includes(school.id as string)).map((school) => ({
        school_id: school.id as string,
        school_name: school.name as string,
        student_count: schoolDirectories.find((directory) => directory.school_id === school.id)?.students.length || 0,
      })),
    );

    return res.status(200).json({
      admin: {
        email: context.email,
        role: context.roleLabel,
        status: "active",
        scope: context.kind,
        canManageMembers,
      },
      counts: {
        profiles: profileCount,
        schoolUsers: schoolUserCount,
        sweetRecords: sweetRecordCount,
        schools: schools?.length || 0,
        schoolMembers: schoolMemberCount,
        wechatBindings: context.kind === "platform" ? wechatIdentityCount : 0,
      },
      schools: schools || [],
      schoolDirectories,
      recentRecords: recentRecordItems,
      attentionQueue,
      teacherWeeklySummaries,
      schoolMonthlyTrends,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "管理员概览加载失败。";
    const status = message.includes("没有") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: status >= 500 ? "管理员概览暂时无法加载，请稍后再试。" : message });
  }
}
