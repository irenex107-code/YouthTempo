import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeLocale } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server";
import { reportOperationalError } from "@/lib/operationalMonitoring";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";

const allowedTypes: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
const maxBytes = 5 * 1024 * 1024;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const locale = normalizeLocale(req.cookies.NEXT_LOCALE);
  const t = getServerTranslator(locale);
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: t("supportFlow.errors.signIn") });
    const contentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const extension = allowedTypes[contentType];
    const declaredLength = Number(req.headers["content-length"] || 0);
    if (!extension || declaredLength > maxBytes) {
      return res.status(400).json({ error: t("supportFlow.errors.evidence") });
    }
    const supabase = getSupabaseAdmin();
    const { data: application, error: applicationError } = await supabase.from("support_staff_applications")
      .select("status,evidence_path").eq("user_id", user.id).maybeSingle();
    if (applicationError) throw applicationError;
    if (!application || !["pending", "rejected"].includes(application.status)) {
      return res.status(403).json({ error: t("supportFlow.errors.evidence") });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) return res.status(413).json({ error: t("supportFlow.errors.evidence") });
      chunks.push(bytes);
    }
    if (!size) return res.status(400).json({ error: t("supportFlow.errors.evidence") });
    const file = Buffer.concat(chunks);
    const signatureValid = contentType === "application/pdf"
      ? file.subarray(0, 4).toString("ascii") === "%PDF"
      : contentType === "image/jpeg"
        ? file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
        : file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!signatureValid) return res.status(400).json({ error: t("supportFlow.errors.evidence") });
    const path = `${user.id}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("support-staff-evidence")
      .upload(path, file, { contentType, upsert: false });
    if (uploadError) throw uploadError;
    const { data: updated, error: updateError } = await supabase.from("support_staff_applications")
      .update({ evidence_path: path, updated_at: new Date().toISOString() })
      .eq("user_id", user.id).in("status", ["pending", "rejected"])
      .select("user_id").maybeSingle();
    if (updateError || !updated) {
      await supabase.storage.from("support-staff-evidence").remove([path]);
      if (updateError) throw updateError;
      return res.status(409).json({ error: t("supportFlow.errors.evidence") });
    }
    if (application.evidence_path) {
      await supabase.storage.from("support-staff-evidence").remove([application.evidence_path]);
    }
    return res.status(200).json({ uploaded: true });
  } catch (error) {
    await reportOperationalError({ req, area: "save", operation: "support_staff_evidence_upload", error, statusCode: 503 });
    return res.status(503).json({ error: t("supportFlow.errors.unavailable") });
  }
}

export const config = { api: { bodyParser: false } };
