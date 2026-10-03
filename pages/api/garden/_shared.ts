import type { NextApiRequest, NextApiResponse } from "next";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getServerTranslator } from "@/lib/i18n/server";
import { normalizeLocale, type Locale } from "@/lib/i18n/config";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { requireActiveStudentConsent } from "@/lib/studentConsent";
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

export async function loadGardenParticipation(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
) {
  const [quick, sweet] = await Promise.all([
    supabase.from("tempo_check_ins").select("created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1000),
    supabase.from("sweet_records").select("created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1000),
  ]);
  if (quick.error) throw quick.error;
  if (sweet.error) throw sweet.error;

  const quickRows = quick.data || [];
  const sweetRows = sweet.data || [];
  return {
    quickRows,
    sweetRows,
    dateKeys: participationDateKeys(quickRows, sweetRows, now),
    summary: gardenSummary(quickRows, sweetRows, now),
  };
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
