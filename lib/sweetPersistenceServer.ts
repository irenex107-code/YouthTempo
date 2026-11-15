import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "./supabaseServer";
import { parseSweetCommand, parseSweetReply, sweetHttpStatus, isSweetDay } from "./sweetPersistenceProtocol";
import { getRequestLocale, getServerTranslator } from "./i18n/server";
import { reportOperationalError } from "./operationalMonitoring";

/** The only application bridge to the service-only RPCs. No client actor/role is forwarded. */
export async function handleSweetPersistence(req: NextApiRequest, res: NextApiResponse, mini = false, deleteRecordCutoff = false) {
  // Keep the original IncomingMessage for auth: headers may be a prototype
  // accessor and are not preserved by spreading a real Node request.
  const method = deleteRecordCutoff && req.method === "DELETE" ? "POST" : req.method;
  res.setHeader("Cache-Control", "no-store");
  const t = getServerTranslator(getRequestLocale(req));
  if (method !== "GET" && method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: t("checkIn.messages.persistenceUnavailable"), status: "invalid_request" });
  }
  let mutationDispatched = false;
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("checkIn.messages.signInToSave"), status: "denied" });
    const supabase = getSupabaseAdmin();
    let rpc: string;
    let args: Record<string, unknown>;
    if (method === "GET") {
      const day = req.query.targetDay;
      if (day !== undefined && !isSweetDay(day)) return res.status(400).json({ status: "invalid_request" });
      rpc = "sweet_scope_read";
      args = { p_actor_user_id: user.id, p_target_day: day ?? null };
    } else {
      const command = parseSweetCommand(deleteRecordCutoff ? { ...req.body, intent: "delete_record_cutoff" } : req.body);
      if (!command) return res.status(400).json({ status: "invalid_request", error: t("checkIn.messages.persistenceUnavailable") });
      rpc = "sweet_scope_write";
      args = {
        p_actor_user_id: user.id, p_operation_day: command.operationDay, p_target_day: command.targetDay,
        p_expected_head: command.expectedHead, p_intent: command.intent, p_records: command.record?.records ?? null,
        p_summary: command.record?.summary || null, p_small_step: command.record?.smallStep || null,
        p_recommended_next_tool: command.record?.recommendedNextTool || null, p_record_id: command.recordId ?? null,
        p_student_only: mini,
      };
    }
    mutationDispatched = method === "POST";
    const { data, error } = await supabase.rpc(rpc, args);
    if (error) {
      // Only the trusted RPC's explicit CHECK violation is a known rollback
      // here. SQLSTATE shape/PGRST prefixes do not prove transaction outcome
      // (08007/40003 explicitly describe unknown completion). Unlisted errors
      // after possible dispatch stay unknown; read failures are unavailable.
      const rejected = mutationDispatched && data === null && error.code === "23514";
      if (rejected) {
        reportOperationalError({ req, area: "save", operation: "sweet_scope_rejected", error, statusCode: 503 });
        return res.status(503).json({ status: "write_rejected", writeOutcome: "not_committed", error: t("checkIn.messages.saveFailed") });
      }
      throw error;
    }
    const status = data && typeof data === "object" && typeof data.status === "string" ? data.status : "";
    if (!["ready", "accepted", "noop", "conflict", "scope_expired", "protocol_unavailable", "denied", "not_found", "invalid_request"].includes(status)) {
      throw new Error("sweet_protocol_response_invalid");
    }
    const http = sweetHttpStatus(status);
    if (http < 300) {
      const reply = parseSweetReply(data, user.id);
      if (!reply || (method === "GET" ? reply.status !== "ready" : reply.status === "ready")) throw new Error("sweet_protocol_response_invalid");
      return res.status(http).json(reply);
    }
    const key = status === "conflict" ? "checkIn.messages.persistenceConflict"
      : status === "scope_expired" ? "checkIn.messages.persistenceScopeExpired"
        : status === "denied" ? "inlineConsent.consentNeeded" : "checkIn.messages.persistenceUnavailable";
    // Do not leak actual rows/head through a rejected operation or arbitrary RPC payload.
    return res.status(http).json({ status, writeOutcome: "not_committed", error: t(key) });
  } catch (error) {
    reportOperationalError({ req, area: "save", operation: "sweet_scope_protocol", error, statusCode: 503 });
    return res.status(503).json({ status: mutationDispatched ? "outcome_unknown" : "protocol_unavailable",
      ...(!mutationDispatched ? { writeOutcome: "not_committed" } : {}),
      error: t(mutationDispatched ? "checkIn.messages.persistenceUnknown" : "checkIn.messages.persistenceUnavailable") });
  }
}
