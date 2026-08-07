import type { NextApiRequest, NextApiResponse } from "next";
import { canManageSchool, canManageSchoolMembers, findAuthUserByEmail, getAdminContext } from "@/lib/adminAccess";
import { inviteRoleFromLabel, memberRoleFromInvite } from "@/lib/schoolInvites";

const roleLabels = ["学生", "家长", "支持老师", "学校负责人", "专业支持者"] as const;
type AssignmentRole = (typeof roleLabels)[number];

function normalizeRole(value: unknown): AssignmentRole {
  if (value === "学校负责人" || value === "学校管理员") return "学校负责人";
  if (value === "支持老师" || value === "学校支持人员") return "支持老师";
  if (value === "专业支持者") return "专业支持者";
  if (value === "家长") return "家长";
  return "学生";
}

async function runMutation(query: PromiseLike<{ error: unknown }>) {
  const { error } = await query;
  if (error) throw error;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const context = await getAdminContext(req);
    const { supabase } = context;
    const schoolId = typeof req.body?.schoolId === "string" ? req.body.schoolId.trim() : "";
    const memberUserId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";

    if (req.method === "DELETE") {
      if (!schoolId) return res.status(400).json({ error: "请选择学校空间。" });
      if (!memberUserId) return res.status(400).json({ error: "请选择要移出的成员。" });
      if (!canManageSchool(context, schoolId)) return res.status(403).json({ error: "你只能管理自己学校空间里的成员。" });
      if (!canManageSchoolMembers(context, schoolId)) return res.status(403).json({ error: "只有学校负责人可以移出学校成员。" });
      if (context.user.id === memberUserId) return res.status(400).json({ error: "不能从当前学校移出你自己的账号。" });

      const [{ data: membership, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
        supabase
          .from("school_members")
          .select("id,member_role,status")
          .eq("school_id", schoolId)
          .eq("user_id", memberUserId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("id,email,display_name,role,school_id")
          .eq("id", memberUserId)
          .maybeSingle(),
      ]);
      if (membershipError) throw membershipError;
      if (profileError) throw profileError;
      if (!membership && profile?.school_id !== schoolId) {
        return res.status(404).json({ error: "这名成员已不在当前学校。" });
      }
      if (
        context.kind === "school" &&
        membership?.member_role === "school_admin"
      ) {
        return res.status(403).json({ error: "学校负责人不能移出其他负责人，请联系平台管理员。" });
      }

      const now = new Date().toISOString();
      await Promise.all([
        runMutation(supabase
          .from("school_members")
          .update({ status: "revoked", revoked_at: now })
          .eq("school_id", schoolId)
          .eq("user_id", memberUserId)
          .eq("status", "active")),
        runMutation(supabase
          .from("teacher_student_assignments")
          .update({ status: "revoked", revoked_at: now, updated_at: now })
          .eq("school_id", schoolId)
          .eq("teacher_user_id", memberUserId)
          .eq("status", "active")),
        runMutation(supabase
          .from("teacher_student_assignments")
          .update({ status: "revoked", revoked_at: now, updated_at: now })
          .eq("school_id", schoolId)
          .eq("student_user_id", memberUserId)
          .eq("status", "active")),
        runMutation(supabase
          .from("guardian_student_links")
          .update({ status: "revoked", revoked_at: now, updated_at: now })
          .eq("school_id", schoolId)
          .eq("guardian_user_id", memberUserId)
          .eq("status", "active")),
        runMutation(supabase
          .from("guardian_student_links")
          .update({ status: "revoked", revoked_at: now, updated_at: now })
          .eq("school_id", schoolId)
          .eq("student_user_id", memberUserId)
          .eq("status", "active")),
        runMutation(supabase
          .from("sweet_records")
          .update({ school_id: null })
          .eq("school_id", schoolId)
          .eq("user_id", memberUserId)),
        profile?.email
          ? runMutation(supabase
              .from("school_invites")
              .update({ status: "revoked", revoked_at: now, updated_at: now })
              .eq("school_id", schoolId)
              .ilike("email", profile.email)
              .in("status", ["active", "applied"]))
          : Promise.resolve(),
        profile?.role === "专业支持者"
          ? runMutation(supabase
              .from("professional_verifications")
              .update({ status: "revoked", revoked_at: now, updated_at: now })
              .eq("user_id", memberUserId))
          : Promise.resolve(),
      ]);

      const { data: remainingMemberships, error: remainingMembershipError } = await supabase
        .from("school_members")
        .select("school_id")
        .eq("user_id", memberUserId)
        .eq("status", "active")
        .limit(1);
      if (remainingMembershipError) throw remainingMembershipError;

      if (profile?.school_id === schoolId) {
        const profileUpdates: {
          school_id: null;
          updated_at: string;
          role?: "学生";
        } = {
          school_id: null,
          updated_at: now,
        };
        if (
          ["学校支持人员", "专业支持者"].includes(profile?.role || "") &&
          !remainingMemberships?.length
        ) {
          profileUpdates.role = "学生";
        }
        const { error: profileUpdateError } = await supabase
          .from("profiles")
          .update(profileUpdates)
          .eq("id", memberUserId);
        if (profileUpdateError) throw profileUpdateError;
      }

      return res.status(200).json({
        removedUserId: memberUserId,
        displayName: profile?.display_name || profile?.email || "成员",
      });
    }

    const displayName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const assignmentRole = normalizeRole(req.body?.role);
    const inviteRole = ["家长", "专业支持者"].includes(assignmentRole) ? null : inviteRoleFromLabel(assignmentRole);
    let teacherUserId = typeof req.body?.teacherUserId === "string" ? req.body.teacherUserId.trim() : "";
    let guardianUserId = typeof req.body?.guardianUserId === "string" ? req.body.guardianUserId.trim() : "";
    const teacherEmail = typeof req.body?.teacherEmail === "string" ? req.body.teacherEmail.trim().toLowerCase() : "";
    const guardianEmail = typeof req.body?.guardianEmail === "string" ? req.body.guardianEmail.trim().toLowerCase() : "";

    if (!schoolId) return res.status(400).json({ error: "请选择学校空间。" });
    if (!displayName) return res.status(400).json({ error: "请输入成员姓名。" });
    if (displayName.length > 50) return res.status(400).json({ error: "成员姓名请控制在 50 个字符以内。" });
    if (!email) return res.status(400).json({ error: "请输入对方登录 YouthTempo 使用的邮箱。" });
    if (!canManageSchool(context, schoolId)) return res.status(403).json({ error: "你只能管理自己学校空间里的成员。" });
    if (!canManageSchoolMembers(context, schoolId)) return res.status(403).json({ error: "只有学校负责人可以添加学校成员。" });
    if (context.kind === "school" && assignmentRole === "学校负责人") {
      return res.status(403).json({ error: "学校负责人不能新增其他学校负责人。如需新增，请联系平台管理员。" });
    }
    if (context.kind !== "platform" && assignmentRole === "专业支持者") {
      return res.status(403).json({ error: "专业支持者身份需要由平台管理员确认。" });
    }

    if (assignmentRole === "学生" && teacherEmail && !teacherUserId) {
      const teacher = await findAuthUserByEmail(supabase, teacherEmail);
      if (!teacher) return res.status(400).json({ error: `找不到老师邮箱 ${teacherEmail}，请先添加老师。` });
      teacherUserId = teacher.id;
    }
    if (assignmentRole === "学生" && guardianEmail && !guardianUserId) {
      const guardian = await findAuthUserByEmail(supabase, guardianEmail);
      if (!guardian) return res.status(400).json({ error: `找不到家长邮箱 ${guardianEmail}，请先添加家长。` });
      guardianUserId = guardian.id;
    }

    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .select("id,name,status")
      .eq("id", schoolId)
      .eq("status", "active")
      .maybeSingle();
    if (schoolError) throw schoolError;
    if (!school) return res.status(404).json({ error: "找不到这个学校空间。" });

    if (assignmentRole === "学生" && teacherUserId) {
      const { data: teacher, error: teacherError } = await supabase
        .from("school_members")
        .select("user_id")
        .eq("school_id", schoolId)
        .eq("user_id", teacherUserId)
        .eq("member_role", "school_support")
        .eq("status", "active")
        .maybeSingle();
      if (teacherError) throw teacherError;
      if (!teacher) return res.status(400).json({ error: "所选老师不在当前学校，请重新选择。" });
    }
    if (assignmentRole === "学生" && guardianUserId) {
      const { data: guardian, error: guardianError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", guardianUserId)
        .eq("school_id", schoolId)
        .eq("role", "家长")
        .maybeSingle();
      if (guardianError) throw guardianError;
      if (!guardian) return res.status(400).json({ error: "所选家长不在当前学校，请重新选择。" });
    }

    let authUser = await findAuthUserByEmail(supabase, email);
    let status: "active" | "created" | "confirmed" = "active";

    if (!authUser) {
      const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          source: "school_assignment",
        },
      });
      if (createUserError) throw createUserError;
      if (!createdUser.user) throw new Error("账号创建失败，请稍后重试。");
      authUser = createdUser.user;
      status = "created";
    } else if (!authUser.email_confirmed_at) {
      const { data: confirmedUser, error: confirmUserError } = await supabase.auth.admin.updateUserById(authUser.id, {
        email_confirm: true,
      });
      if (confirmUserError) throw confirmUserError;
      if (confirmedUser.user) authUser = confirmedUser.user;
      status = "confirmed";
    }

    if (authUser.user_metadata?.display_name !== displayName) {
      const { data: updatedUser, error: updateUserError } = await supabase.auth.admin.updateUserById(authUser.id, {
        user_metadata: {
          ...authUser.user_metadata,
          display_name: displayName,
          source: "school_assignment",
        },
      });
      if (updateUserError) throw updateUserError;
      if (updatedUser.user) authUser = updatedUser.user;
    }

    const memberRole = inviteRole ? memberRoleFromInvite(inviteRole) : null;
    if (memberRole) {
      const { error: memberError } = await supabase.from("school_members").upsert({
        school_id: schoolId,
        user_id: authUser.id,
        email,
        member_role: memberRole,
        status: "active",
        revoked_at: null,
      }, { onConflict: "school_id,user_id" });
      if (memberError) throw memberError;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: authUser.id,
        email,
        display_name: displayName,
        role:
          assignmentRole === "学生"
            ? "学生"
            : assignmentRole === "家长"
              ? "家长"
              : assignmentRole === "专业支持者"
                ? "专业支持者"
                : "学校支持人员",
        school_id: schoolId,
        updated_at: new Date().toISOString(),
      })
      .select("id,email,display_name,role,school_id")
      .single();
    if (profileError) throw profileError;

    if (assignmentRole === "专业支持者") {
      const { error: verificationError } = await supabase
        .from("professional_verifications")
        .upsert({
          user_id: authUser.id,
          verified_by: null,
          status: "pending",
          verification_basis: "document_review",
          credential_verified: false,
          institution_verified: false,
          revoked_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id", ignoreDuplicates: true });
      if (verificationError) throw verificationError;
    } else {
      const now = new Date().toISOString();
      const { error: revokeVerificationError } = await supabase
        .from("professional_verifications")
        .update({ status: "revoked", revoked_at: now, updated_at: now })
        .eq("user_id", authUser.id)
        .eq("status", "active");
      if (revokeVerificationError) throw revokeVerificationError;
    }

    if (assignmentRole === "学生") {
      const { error: recordsError } = await supabase
        .from("sweet_records")
        .update({ school_id: schoolId })
        .eq("user_id", authUser.id)
        .is("school_id", null);
      if (recordsError) throw recordsError;

      if (teacherUserId) {
        const { error: teacherAssignmentError } = await supabase
          .from("teacher_student_assignments")
          .upsert({
            school_id: schoolId,
            teacher_user_id: teacherUserId,
            student_user_id: authUser.id,
            assigned_by: context.user.id,
            status: "active",
            revoked_at: null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "school_id,teacher_user_id,student_user_id" });
        if (teacherAssignmentError) throw teacherAssignmentError;
      }

      if (guardianUserId) {
        const { error: guardianAssignmentError } = await supabase
          .from("guardian_student_links")
          .upsert({
            school_id: schoolId,
            guardian_user_id: guardianUserId,
            student_user_id: authUser.id,
            confirmed_by: context.user.id,
            status: "active",
            revoked_at: null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "school_id,guardian_user_id,student_user_id" });
        if (guardianAssignmentError) throw guardianAssignmentError;
      }
    }

    if (inviteRole) {
      await supabase
        .from("school_invites")
        .update({
          status: "applied",
          applied_user_id: authUser.id,
          applied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("school_id", schoolId)
        .eq("assignment_role", inviteRole)
        .ilike("email", email)
        .eq("status", "active");
    }

    return res.status(200).json({ profile, school, assignmentRole, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "学校空间分配失败。";
    const status = message.includes("没有") || message.includes("只有") || message.includes("只能") || message.includes("不能") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: status >= 500 ? "学校空间分配暂时无法完成，请稍后再试。" : message });
  }
}
