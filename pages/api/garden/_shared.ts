import type { NextApiRequest, NextApiResponse } from "next";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getServerTranslator } from "@/lib/i18n/server";
import { normalizeLocale, type Locale } from "@/lib/i18n/config";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { isActiveStudentConsent, requireActiveStudentConsent } from "@/lib/studentConsent";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { gardenSummary, participationDateKeys } from "@/lib/tempoGarden";

export type GardenTranslator = ReturnType<typeof getServerTranslator>;

export type GardenApiContext = {
  locale: Locale;
  t: GardenTranslator;
  user: User;
  supabase: SupabaseClient;
};

export function gardenLocale(req: NextApiRequest) {
  return normalizeLocale(
    typeof req.body?.locale === "string" ? req.body.locale
      : typeof req.query.locale === "string" ? req.query.locale : req.cookies.NEXT_LOCALE,
  );
}

export async function requireGardenContext(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<GardenApiContext | null> {
  const locale = gardenLocale(req);
  const t = getServerTranslator(locale);
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: t("garden.errors.signIn") });
    return null;
  }

  const supabase = getSupabaseAdmin();
  const consent = await requireActiveStudentConsent(supabase, user.id);
  if (!consent || !["14_17", "18_plus"].includes(consent.age_band)) {
    res.status(403).json({ error: t("garden.errors.notAvailable") });
    return null;
  }

  return { locale, t, user, supabase };
}

/** Existing-data management only. New use must retain requireGardenContext. */
export async function requireGardenManagementContext(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<GardenApiContext | null> {
  const locale = gardenLocale(req);
  const t = getServerTranslator(locale);
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: t("garden.errors.signIn") });
    return null;
  }
  const supabase = getSupabaseAdmin({ requestTimeoutMs: 10_000 });
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (profile?.role !== "学生") {
    res.status(403).json({ error: t("garden.errors.notAvailable") });
    return null;
  }
  // Every caller must also filter each data read/delete by this server user.id.
  return { locale, t, user, supabase };
}

export async function gardenUseAccess({ supabase, user }: GardenApiContext) {
  try {
    const { data, error } = await supabase.from("student_consents")
      .select("age_band,consent_basis,status,policy_version,student_assented_at,guardian_user_id,guardian_consented_at")
      .eq("student_user_id", user.id).maybeSingle();
    if (error) throw error;
    const canUseGarden = isActiveStudentConsent(data);
    return { canUseGarden, managementReason: canUseGarden ? null
      : data?.status === "withdrawn" ? "withdrawn" as const : "consent_required" as const };
  } catch {
    // Consent availability must not grant new use or block independently verified management.
    return { canUseGarden: false, managementReason: "consent_unavailable" as const };
  }
}

const participationPageSize = 500;
const participationMaxPages = 200;
const participationTimeoutMs = 10_000;
const participationIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

async function loadParticipationHistory(
  supabase: SupabaseClient,
  table: "tempo_check_ins" | "sweet_records",
  userId: string,
  signal: AbortSignal,
) {
  const rows: { created_at: string }[] = [];
  let cursor = "";
  for (let page = 0; page < participationMaxPages; page += 1) {
    if (signal.aborted) throw new Error("Garden participation unavailable.");
    // Both tables already have a UUID primary key. Its total order avoids
    // timestamp ties/precision loss and offset shifts between requests.
    let query = supabase.from(table).select("id,created_at").eq("user_id", userId)
      .order("id", { ascending: true }).limit(participationPageSize).abortSignal(signal);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (signal.aborted || !Array.isArray(data) || data.length > participationPageSize) {
      throw new Error("Garden participation unavailable.");
    }
    // A server row cap can make a nonterminal page short. Only an empty
    // successful page confirms the end; missing/malformed data is not empty.
    if (data.length === 0) return rows;
    for (const row of data as unknown[]) {
      if (!row || typeof row !== "object" || !("id" in row) || !("created_at" in row)
        || typeof row.id !== "string" || !participationIdPattern.test(row.id) || row.id <= cursor
        || typeof row.created_at !== "string" || !Number.isFinite(new Date(row.created_at).getTime())) {
        throw new Error("Garden participation unavailable.");
      }
      cursor = row.id;
      rows.push({ created_at: row.created_at });
    }
  }
  // Reaching the protection limit never turns a partial history into success.
  throw new Error("Garden participation unavailable.");
}

export async function loadGardenParticipation(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Garden participation unavailable."));
    }, participationTimeoutMs);
  });
  try {
    const [quickRows, sweetRows] = await Promise.race([
      Promise.all([
        loadParticipationHistory(supabase, "tempo_check_ins", userId, controller.signal),
        loadParticipationHistory(supabase, "sweet_records", userId, controller.signal),
      ]),
      deadline,
    ]);
    return {
      quickRows,
      sweetRows,
      dateKeys: participationDateKeys(quickRows, sweetRows, now),
      summary: gardenSummary(quickRows, sweetRows, now),
    };
  } finally {
    clearTimeout(timer);
    // Stop the sibling reader after a failure, too. These reads are not a
    // transaction snapshot; concurrent inserts/deletes still need real DB QA.
    controller.abort();
  }
}

export function gardenStatusCode(error: unknown) {
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = Number(error.statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) return statusCode;
  }
  return 503;
}

export async function sendGardenError({
  req,
  res,
  error,
  t,
  operation,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
  error: unknown;
  t: GardenTranslator;
  operation: string;
}) {
  const statusCode = gardenStatusCode(error);
  if (statusCode >= 500) {
    await reportOperationalError({ req, area: "save", operation, error, statusCode });
  }
  return res.status(statusCode).json({
    error: statusCode === 403 ? t("garden.errors.notAvailable") : t("garden.errors.unavailable"),
  });
}

export function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export function methodNotAllowed(res: NextApiResponse, methods: string[]) {
  res.setHeader("Allow", methods.join(", "));
  return res.status(405).json({ error: "Method not allowed" });
}
