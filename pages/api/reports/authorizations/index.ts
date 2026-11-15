import type { NextApiRequest, NextApiResponse } from "next";
import { requireReportContext, sendReportError } from "@/lib/reports/server";
import { ReportApiError } from "@/lib/reports/http";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const context = await requireReportContext(req, res, "POST", [], []);
    if (!context) return;
    throw new ReportApiError(403, "access_denied");
  } catch (error) { return sendReportError(req, res, error, "authorizations_index"); }
}

export const config = { api: { bodyParser: false } };
