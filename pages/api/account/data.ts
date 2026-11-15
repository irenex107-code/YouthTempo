import type { NextApiRequest, NextApiResponse } from "next";
import { ACCOUNT_DATA_POLICY_VERSION, accountDataRetention } from "@/lib/accountDataPolicy";
import { authAccountState, completeDeletionAudit, DeletionAttemptBusy, DeletionReceiptConflict, parseDeletionReceipt, prepareDeletionAudit } from "@/lib/accountDeletionReceiptServer";
import { getRequestLocale, getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { transitionSupportCase } from "@/lib/supportWorkflow";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { canAccessTeacherMessage, loadTeacherMessageScope } from "@/lib/studentMessageAccess";

const accountPageSize = 500;
type PageQuery<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }> & {
  order(column: string, options?: { ascending?: boolean }): PageQuery<T>;
  range(from: number, to: number): PageQuery<T>;
};
async function rows<T>(query: PageQuery<T>, uniqueKeys: readonly string[] = ["id"]) {
  // A unique tie-breaker prevents equal dates from shuffling between ranges.
  // These separate requests are an export, not a transaction-wide snapshot.
  let ordered = query;
  for (const key of uniqueKeys) ordered = ordered.order(key, { ascending: true });
  const all: T[] = [];
  for (let offset = 0; ; offset += accountPageSize) {
    const { data, error } = await ordered.range(offset, offset + accountPageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    all.push(...page);
    if (page.length < accountPageSize) return all;
  }
}
type KeysetQuery<T> = PageQuery<T> & { gt(column: string, value: string): KeysetQuery<T> };
async function snapshotRows<T extends { id: string }>(makeQuery: () => KeysetQuery<T>) {
  const all: T[] = [];
  let after: string | undefined;
  for (;;) {
    const query = makeQuery();
    const { data, error } = await (after ? query.gt("id", after) : query).order("id", { ascending: true }).range(0, accountPageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    all.push(...page);
    if (page.length < accountPageSize) return all;
    const next = page[page.length - 1].id;
    if (after && next <= after) throw new Error("account_cleanup_snapshot_order");
    after = next;
  }
}
async function cleanupInBatches<T>(items: readonly T[], remove: (item: T) => PromiseLike<{ error: unknown }>) {
  let failed = false;
  for (let offset = 0; offset < items.length; offset += 20) {
    const batch = await Promise.all(items.slice(offset, offset + 20).map(remove));
    if (batch.some((result) => result.error)) failed = true;
  }
  return failed;
}

const receivedMessageColumns = "id,school_id,sender_user_id,recipient_type,recipient_user_id,anonymous_to_recipient,body,moderation_status,read_at,created_at";
async function receivedMessagesForExport(
  supabase: ReturnType<typeof getSupabaseAdmin>, userId: string, purpose: "download" | "deletionAudit",
) {
  const receivedQuery = () => supabase.from("student_messages").select(receivedMessageColumns)
    .eq("recipient_user_id", userId).neq("sender_user_id", userId).order("created_at");
  // Internal deletion accounting retains its original scope and never grants viewing rights.
  if (purpose === "deletionAudit") return rows(receivedQuery());
  const scope = await loadTeacherMessageScope(supabase, userId);
  const received = await rows(receivedQuery().neq("recipient_type", "teacher"));
  for (let offset = 0; offset < scope.studentIds.length; offset += 100) {
    const page = await rows(receivedQuery().eq("recipient_type", "teacher").eq("school_id", scope.schoolId)
      .in("sender_user_id", scope.studentIds.slice(offset, offset + 100)));
    received.push(...page);
  }
  return received.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
}

async function buildAccountExport(user: { id: string; email?: string | null; created_at: string; updated_at?: string; last_sign_in_at?: string }, purpose: "download" | "deletionAudit") {
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
    tempoCheckIns,
    tempoReminderPreferences,
    tempoGardenCareEvents,
    tempoGardenLayoutItems,
    tempoGardenKeepsakes,
    peerSpaceMessages,
    peerSpaceReports,
    peerSpaceControls,
    pilotExperienceFeedback,
    supportStaffApplications,
    supportStaffTraining,
    supportCases,
  ] = await Promise.all([
    rows(supabase.from("profiles").select("id,email,display_name,role,school_id,created_at,updated_at").eq("id", user.id)),
    rows(supabase.from("sweet_records").select("id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at").eq("user_id", user.id).order("created_at")),
    rows(supabase.from("school_members").select("id,school_id,user_id,email,member_role,status,created_at,revoked_at").eq("user_id", user.id)),
    rows(supabase.from("teacher_student_assignments").select("id,school_id,teacher_user_id,student_user_id,status,created_at,updated_at,revoked_at").eq("teacher_user_id", user.id)),
    rows(supabase.from("teacher_student_assignments").select("id,school_id,teacher_user_id,student_user_id,status,created_at,updated_at,revoked_at").eq("student_user_id", user.id)),
    rows(supabase.from("guardian_student_links").select("id,school_id,guardian_user_id,student_user_id,status,created_at,updated_at,revoked_at").eq("guardian_user_id", user.id)),
    rows(supabase.from("guardian_student_links").select("id,school_id,guardian_user_id,student_user_id,status,created_at,updated_at,revoked_at").eq("student_user_id", user.id)),
    rows(supabase.from("student_consents").select("student_user_id,school_id,age_band,consent_basis,policy_version,status,student_assented_at,guardian_consented_at,withdrawn_at,created_at,updated_at").eq("student_user_id", user.id), ["student_user_id"]),
    rows(supabase.from("student_consent_events").select("id,student_user_id,school_id,event_type,age_band,consent_basis,policy_version,created_at").eq("student_user_id", user.id).order("created_at")),
    rows(supabase.from("user_permissions").select("id,owner_user_id,grantee_email,permission_type,status,created_at,revoked_at").eq("owner_user_id", user.id)),
    rows(supabase.from("wechat_identities").select("id,user_id,openid,unionid,created_at,updated_at").eq("user_id", user.id)),
    rows(supabase.from("student_messages").select("id,school_id,sender_user_id,recipient_type,recipient_user_id,anonymous_to_recipient,body,moderation_status,read_at,created_at").eq("sender_user_id", user.id).order("created_at")),
    receivedMessagesForExport(supabase, user.id, purpose),
    rows(supabase.from("community_posts").select("id,author_user_id,author_role,title,body,viewer_roles,commenter_roles,moderation_status,created_at,updated_at").eq("author_user_id", user.id).order("created_at")),
    rows(supabase.from("community_comments").select("id,post_id,author_user_id,author_role,body,moderation_status,created_at").eq("author_user_id", user.id).order("created_at")),
    rows(supabase.from("community_reports").select("id,post_id,comment_id,reason,category,priority,status,created_at,target_review_at,resolved_at").eq("reporter_user_id", user.id).order("created_at")),
    rows(supabase.from("community_blocks").select("blocker_user_id,blocked_user_id,created_at").eq("blocker_user_id", user.id), ["blocker_user_id", "blocked_user_id"]),
    rows(supabase.from("community_restrictions").select("id,user_id,restriction_type,reason,starts_at,ends_at,status,revoked_at,revoked_reason,created_at").eq("user_id", user.id)),
    rows(supabase.from("professional_verifications").select("user_id,status,created_at,updated_at,revoked_at").eq("user_id", user.id), ["user_id"]),
    email ? rows(supabase.from("school_invites").select("id,school_id,display_name,assignment_role,status,created_at,updated_at,applied_at,revoked_at").eq("email", email)) : Promise.resolve([]),
    rows(supabase.from("pilot_feedback").select("id,role,form_version,overall_experience,clarity,safety,most_helpful,hard_to_use,suggestion,may_contact,created_at,updated_at").eq("user_id", user.id).order("created_at")),
    rows(supabase.from("tempo_check_ins").select("id,feeling,created_at").eq("user_id", user.id).order("created_at")),
    rows(supabase.from("tempo_reminder_preferences").select("mode,updated_at").eq("user_id", user.id), ["user_id"]),
    rows(supabase.from("tempo_garden_care_events").select("id,care_date,action,created_at").eq("user_id", user.id).order("care_date")),
    rows(supabase.from("tempo_garden_layout_items").select("slot,item_key,updated_at").eq("user_id", user.id).order("slot"), ["user_id", "slot"]),
    rows(supabase.from("tempo_garden_keepsakes").select("id,keepsake_date,keepsake_type,created_at").eq("user_id", user.id).order("keepsake_date")),
    rows(supabase.from("peer_space_messages").select("id,room_id,body,moderation_status,created_at,deleted_at").eq("author_user_id", user.id).order("created_at")),
    rows(supabase.from("peer_space_message_reports").select("id,message_id,room_id,reason_code,status,created_at").eq("reporter_user_id", user.id).order("created_at")),
    rows(supabase.from("peer_space_user_controls").select("id,room_id,control_type,created_at").eq("actor_user_id", user.id).order("created_at")),
    rows(supabase.from("pilot_experience_feedback").select("id,age_band,feature,outcome,helpful,would_return,wants_human_support,comment,created_at").eq("user_id", user.id).order("created_at")),
    rows(supabase.from("support_staff_applications").select("category,status,legal_name,credential_type,credential_number,evidence_path,service_languages,age_scopes,service_scope,availability,institution_name,submitted_at,reviewed_at").eq("user_id", user.id), ["user_id"]),
    rows(supabase.from("support_staff_training_records").select("training_title,completed_at,created_at").eq("staff_user_id", user.id)),
    rows(supabase.from("support_cases").select("id,case_type,status,need_summary,availability,appointment_at,appointment_status,referral_type,created_at,updated_at,closed_at").eq("student_user_id", user.id).order("created_at")),
  ]);
  const supportCaseIds = supportCases.map((item) => item.id);
  const supportCaseEvents: Array<{ case_id: string; action: string; previous_status: string | null; next_status: string; note: string | null; created_at: string }> = [];
  const supportCaseFeedback: Array<{ case_id: string; felt_heard: boolean | null; found_help: boolean | null; boundaries_respected: boolean | null; would_choose_again: boolean | null; complaint: boolean; comment: string | null }> = [];
  // Keep large case sets within ordinary GET URL limits as well as row limits.
  for (let offset = 0; offset < supportCaseIds.length; offset += 100) {
    const ids = supportCaseIds.slice(offset, offset + 100);
    const [events, feedback] = await Promise.all([
      rows(supabase.from("support_case_events").select("case_id,action,previous_status,next_status,note,created_at").in("case_id", ids).order("created_at")),
      rows(supabase.from("support_case_feedback").select("case_id,felt_heard,found_help,boundaries_respected,would_choose_again,complaint,comment,created_at").in("case_id", ids), ["case_id"]),
    ]);
    supportCaseEvents.push(...events);
    supportCaseFeedback.push(...feedback);
  }
  supportCaseEvents.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.case_id.localeCompare(right.case_id));

  let visibleReceivedMessages = receivedMessages;
  if (purpose === "download" && receivedMessages.some((message) => message.recipient_type === "teacher")) {
    // Fresh complete scope after all export reads, immediately before synchronous serialization.
    // Raw sender IDs remain private until this check; anonymous masking happens below.
    const currentScope = await loadTeacherMessageScope(supabase, user.id);
    visibleReceivedMessages = receivedMessages.filter((message) => message.recipient_type !== "teacher"
      || canAccessTeacherMessage(currentScope, message));
  }

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
      guardianLinks: profile[0]?.role === "家长" ? [] : guardianLinks,
      studentGuardianLinks,
      studentConsents,
      consentEvents,
      permissionsGranted,
      wechatIdentities,
      messages: profile[0]?.role === "家长" ? [] : [
        ...sentMessages,
        ...visibleReceivedMessages.map((message) => message.anonymous_to_recipient
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
      tempoCheckIns,
      tempoReminderPreferences,
      tempoGardenCareEvents,
      tempoGardenLayoutItems,
      tempoGardenKeepsakes,
      peerSpaceMessages,
      peerSpaceReports,
      peerSpaceControls,
      pilotExperienceFeedback,
      supportStaffApplications,
      supportStaffTraining,
      supportCases,
      supportCaseEvents,
      supportCaseFeedback,
    },
  };
}

function exportCounts(accountExport: Awaited<ReturnType<typeof buildAccountExport>>) {
  return Object.fromEntries(
    Object.entries(accountExport.data).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]),
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestStartedAt = new Date().toISOString();
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const t = getServerTranslator(getRequestLocale(req));
  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.email) return res.status(401).json({ error: "请先登录。" });
    const accountExport = await buildAccountExport(user, req.method === "GET" ? "download" : "deletionAudit");

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
    const receipt = req.body?.receipt === undefined ? null : parseDeletionReceipt(req.body.receipt);
    if (req.body?.receipt !== undefined && !receipt) {
      return res.status(400).json({ error: t("account.errors.deletionReceiptInvalid") });
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

    const audit = await prepareDeletionAudit(supabase, { userId: user.id, email, role, counts: exportCounts(accountExport), receipt });

    // Capture immutable IDs and row versions before Auth deletion. A delayed
    // attempt must not delete invitations/grants created for a later account
    // that happens to reuse this email address.
    const [cleanupInvites, cleanupPermissions, cleanupAdminRoles] = await Promise.all([
      snapshotRows(() => supabase.from("school_invites").select("id,email,created_at,updated_at").eq("email", email).lte("created_at", requestStartedAt)),
      snapshotRows(() => supabase.from("user_permissions").select("id,owner_user_id,grantee_email,permission_type,status,created_at,revoked_at").eq("grantee_email", email).lte("created_at", requestStartedAt)),
      snapshotRows(() => supabase.from("admin_roles").select("id,email,status,created_at,revoked_at").eq("email", email).lte("created_at", requestStartedAt)),
    ]);

    // Guardian-backed consent is withdrawn by its FK SET NULL trigger inside
    // the Auth hard-delete transaction. A rejected deletion leaves it unchanged.

    // A supporter closing their account immediately loses case access; pause
    // active assignments before the auth cascade so a human can reassign them.
    const staffAssignments = await rows(supabase.from("support_case_assignments")
      .select("case_id").eq("staff_user_id", user.id).in("status", ["offered", "accepted"]));
    const assignedCaseIds = [...new Set((staffAssignments || []).map((item) => item.case_id))];
    if (assignedCaseIds.length) {
      for (let offset = 0; offset < assignedCaseIds.length; offset += 100) {
      const assignedCases = await rows(supabase.from("support_cases")
        .select("id,status,appointment_at,appointment_status,referral_type,student_authorization_active")
        .in("id", assignedCaseIds.slice(offset, offset + 100)).in("status", ["assigned", "active"]));
      for (const item of assignedCases) {
        await transitionSupportCase(supabase, item, {
          actorId: user.id, actorRole: "staff", action: "supporter_account_closing",
          nextStatus: "paused",
        });
      }
      }
    }

    // Do not revoke the user's ability to retry before the deletion succeeds.
    // GoTrue removes the user's sessions together with a successful hard delete.
    let deleteError: unknown;
    try { ({ error: deleteError } = await supabase.auth.admin.deleteUser(user.id, false)); }
    catch (error) { deleteError = error; }
    if (deleteError) {
      const actual = await authAccountState(supabase, user.id);
      if (actual !== "absent") {
        await reportOperationalError({ req, area: "save", operation: "account_delete", error: deleteError, statusCode: 503 });
        return res.status(503).json({ error: t(actual === "present" ? "account.errors.deletionNotCompleted" : "account.errors.deletionOutcomeUnknown"),
          deletionState: actual === "present" ? "not_deleted" : "unknown" });
      }
    }

    try {
      const allEvidencePaths = accountExport.data.supportStaffApplications
        .map((item) => item.evidence_path).filter((value): value is string => typeof value === "string" && Boolean(value));
      const privateEvidencePaths = allEvidencePaths.filter((value) => value.startsWith(`${user.id}/`));
      const { error: evidenceCleanupError } = privateEvidencePaths.length
        ? await supabase.storage.from("support-staff-evidence").remove(privateEvidencePaths)
        : { error: null };

      const inviteCleanupFailed = await cleanupInBatches(cleanupInvites, (item) => supabase.from("school_invites").delete().eq("id", item.id).eq("email", email).eq("updated_at", item.updated_at));
      const permissionCleanupFailed = await cleanupInBatches(cleanupPermissions, (item) => {
          let query = supabase.from("user_permissions").delete().eq("id", item.id).eq("owner_user_id", item.owner_user_id)
            .eq("grantee_email", email).eq("permission_type", item.permission_type).eq("status", item.status).eq("created_at", item.created_at);
          query = item.revoked_at === null ? query.is("revoked_at", null) : query.eq("revoked_at", item.revoked_at);
          return query;
        });
      const adminCleanupFailed = await cleanupInBatches(cleanupAdminRoles, (item) => {
          let query = supabase.from("admin_roles").delete().eq("id", item.id).eq("email", email).eq("status", item.status).eq("created_at", item.created_at);
          query = item.revoked_at === null ? query.is("revoked_at", null) : query.eq("revoked_at", item.revoked_at);
          return query;
        });
      if (inviteCleanupFailed || permissionCleanupFailed || adminCleanupFailed || evidenceCleanupError || privateEvidencePaths.length !== allEvidencePaths.length) {
        console.error("Account deleted but reference or private-file cleanup needs attention");
        return res.status(200).json({ deleted: true, cleanupPending: true });
      }

      if (!await completeDeletionAudit(supabase, audit)) {
        return res.status(200).json({ deleted: true, cleanupPending: true });
      }

      return res.status(200).json({ deleted: true });
    } catch (error) {
      await reportOperationalError({ req, area: "save", operation: "account_delete_cleanup", error, statusCode: 500 });
      return res.status(200).json({ deleted: true, cleanupPending: true });
    }
  } catch (error) {
    if (error instanceof DeletionAttemptBusy) {
      res.setHeader("Retry-After", error.retryAfter);
      return res.status(409).json({ error: t("account.errors.deletionOutcomeUnknown"), deletionState: "unknown", retryAfter: error.retryAfter });
    }
    if (error instanceof DeletionReceiptConflict) return res.status(409).json({ error: t("account.errors.deletionReceiptConflict") });
    await reportOperationalError({ req, area: "save", operation: "account_data", error, statusCode: 500 });
    return res.status(500).json({ error: "账户数据暂时无法处理，请稍后再试。" });
  }
}
