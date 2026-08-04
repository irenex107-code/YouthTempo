import { createHash } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { ACCOUNT_DATA_POLICY_VERSION, accountDataRetention } from "@/lib/accountDataPolicy";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(req: NextApiRequest) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

async function rows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function buildAccountExport(user: { id: string; email?: string | null; created_at: string; updated_at?: string; last_sign_in_at?: string }) {
  const supabase = getSupabaseAdmin();
  const email = user.email?.trim().toLowerCase() || "";

  const [
    profile,
    sweetRecords,
    schoolMemberships,
    teacherAssignments,
    studentAssignments,
    guardianLinks,
    studentGuardianLinks,
    studentConsents,
    consentEvents,
    permissionsGranted,
    wechatIdentities,
    sentMessages,
    receivedMessages,
    communityPosts,
    communityComments,
    communityReports,
    communityBlocks,
    communityRestrictions,
    professionalVerifications,
    schoolInvites,
    pilotFeedback,
  ] = await Promise.all([
    rows(supabase.from("profiles").select("id,email,display_name,role,school_id,created_at,updated_at").eq("id", user.id)),
    rows(supabase.from("sweet_records").select("id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at").eq("user_id", user.id).order("created_at")),
    rows(supabase.from("school_members").select("id,school_id,user_id,email,member_role,status,created_at,revoked_at").eq("user_id", user.id)),
    rows(supabase.from("teacher_student_assignments").select("id,school_id,teacher_user_id,student_user_id,status,created_at,updated_at,revoked_at").eq("teacher_user_id", user.id)),
    rows(supabase.from("teacher_student_assignments").select("id,school_id,teacher_user_id,student_user_id,status,created_at,updated_at,revoked_at").eq("student_user_id", user.id)),
    rows(supabase.from("guardian_student_links").select("id,school_id,guardian_user_id,student_user_id,status,created_at,updated_at,revoked_at").eq("guardian_user_id", user.id)),
    rows(supabase.from("guardian_student_links").select("id,school_id,guardian_user_id,student_user_id,status,created_at,updated_at,revoked_at").eq("student_user_id", user.id)),
    rows(supabase.from("student_consents").select("student_user_id,school_id,age_band,policy_version,status,student_assented_at,guardian_consented_at,withdrawn_at,created_at,updated_at").eq("student_user_id", user.id)),
    rows(supabase.from("student_consent_events").select("id,student_user_id,school_id,event_type,age_band,policy_version,created_at").eq("student_user_id", user.id).order("created_at")),
    rows(supabase.from("user_permissions").select("id,owner_user_id,grantee_email,permission_type,status,created_at,revoked_at").eq("owner_user_id", user.id)),
    rows(supabase.from("wechat_identities").select("id,user_id,openid,unionid,created_at,updated_at").eq("user_id", user.id)),
    rows(supabase.from("student_messages").select("id,school_id,sender_user_id,recipient_type,recipient_user_id,anonymous_to_recipient,body,moderation_status,read_at,created_at").eq("sender_user_id", user.id).order("created_at")),
    rows(supabase.from("student_messages").select("id,school_id,sender_user_id,recipient_type,recipient_user_id,anonymous_to_recipient,body,moderation_status,read_at,created_at").eq("recipient_user_id", user.id).neq("sender_user_id", user.id).order("created_at")),
    rows(supabase.from("community_posts").select("id,author_user_id,author_role,title,body,viewer_roles,commenter_roles,moderation_status,created_at,updated_at").eq("author_user_id", user.id).order("created_at")),
    rows(supabase.from("community_comments").select("id,post_id,author_user_id,author_role,body,moderation_status,created_at").eq("author_user_id", user.id).order("created_at")),
    rows(supabase.from("community_reports").select("id,post_id,comment_id,reason,category,priority,status,created_at,target_review_at,resolved_at").eq("reporter_user_id", user.id).order("created_at")),
    rows(supabase.from("community_blocks").select("blocker_user_id,blocked_user_id,created_at").eq("blocker_user_id", user.id)),
    rows(supabase.from("community_restrictions").select("id,user_id,restriction_type,reason,starts_at,ends_at,status,revoked_at,revoked_reason,created_at").eq("user_id", user.id)),
    rows(supabase.from("professional_verifications").select("user_id,status,created_at,updated_at,revoked_at").eq("user_id", user.id)),
    email ? rows(supabase.from("school_invites").select("id,school_id,display_name,assignment_role,status,created_at,updated_at,applied_at,revoked_at").eq("email", email)) : Promise.resolve([]),
    rows(supabase.from("pilot_feedback").select("id,role,form_version,overall_experience,clarity,safety,most_helpful,hard_to_use,suggestion,may_contact,created_at,updated_at").eq("user_id", user.id).order("created_at")),
  ]);

  return {
    format: "YouthTempo account data export",
    formatVersion: 1,
    policyVersion: ACCOUNT_DATA_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    retention: accountDataRetention,
    account: {
      id: user.id,
      email: user.email || null,
      createdAt: user.created_at,
      updatedAt: user.updated_at || null,
      lastSignInAt: user.last_sign_in_at || null,
    },
    data: {
      profile,
      sweetRecords,
      schoolMemberships,
      teacherAssignments,
      studentAssignments,
      guardianLinks,
      studentGuardianLinks,
      studentConsents,
      consentEvents,
      permissionsGranted,
      wechatIdentities,
      messages: [
        ...sentMessages,
        ...receivedMessages.map((message) => message.anonymous_to_recipient
          ? { ...message, sender_user_id: null }
          : message),
      ],
      communityPosts,
      communityComments,
      communityReports,
      communityBlocks,
      communityRestrictions,
      professionalVerifications,
      schoolInvites,
      pilotFeedback,
    },
  };
}

function exportCounts(accountExport: Awaited<ReturnType<typeof buildAccountExport>>) {
  return Object.fromEntries(
    Object.entries(accountExport.data).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]),
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.email) return res.status(401).json({ error: "请先登录。" });
    const accountExport = await buildAccountExport(user);

    if (req.method === "GET") {
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Disposition", `attachment; filename="YouthTempo-data-export-${date}.json"`);
      return res.status(200).json(accountExport);
    }

    const email = user.email.trim().toLowerCase();
    const confirmationEmail = typeof req.body?.confirmationEmail === "string" ? req.body.confirmationEmail.trim().toLowerCase() : "";
    if (req.body?.acknowledge !== true || confirmationEmail !== email) {
      return res.status(400).json({ error: "请输入当前登录邮箱，并确认你理解注销后无法恢复。" });
    }

    const supabase = getSupabaseAdmin();
    const { data: activeAdmin, error: adminError } = await supabase
      .from("admin_roles")
      .select("id")
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle();
    if (adminError) throw adminError;
    if (activeAdmin) {
      return res.status(409).json({ error: "平台管理员暂不能自助注销。请先由另一位平台管理员撤销你的平台权限。" });
    }

    const role = String(accountExport.data.profile[0]?.role || "未设置");
    const { error: expiredAuditError } = await supabase
      .from("account_deletion_audits")
      .delete()
      .lte("expires_at", new Date().toISOString());
    if (expiredAuditError) throw expiredAuditError;

    const auditPayload = {
      subject_hash: sha256(user.id),
      email_hash: sha256(email),
      account_role: role,
      deletion_summary: exportCounts(accountExport),
      status: "cleanup_required",
    };
    const { data: audit, error: auditError } = await supabase
      .from("account_deletion_audits")
      .insert(auditPayload)
      .select("id")
      .single();
    if (auditError) throw auditError;

    const token = bearerToken(req);
    const { error: signOutError } = await supabase.auth.admin.signOut(token, "global");
    if (signOutError) {
      await supabase.from("account_deletion_audits").delete().eq("id", audit.id);
      throw signOutError;
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id, false);
    if (deleteError) {
      await supabase.from("account_deletion_audits").delete().eq("id", audit.id);
      throw deleteError;
    }

    const cleanupResults = await Promise.all([
      supabase.from("school_invites").delete().eq("email", email),
      supabase.from("user_permissions").delete().eq("grantee_email", email),
      supabase.from("admin_roles").delete().eq("email", email),
    ]);
    const cleanupError = cleanupResults.find((result) => result.error)?.error;
    if (cleanupError) {
      console.error("Account deleted but email-reference cleanup needs attention", cleanupError.message);
      return res.status(200).json({ deleted: true, cleanupPending: true });
    }

    const { error: completedError } = await supabase
      .from("account_deletion_audits")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", audit.id);
    if (completedError) console.error("Account deletion audit completion update failed", completedError.message);

    return res.status(200).json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "账户数据操作失败。";
    return res.status(500).json({ error: message });
  }
}
