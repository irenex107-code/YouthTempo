import type { NextApiRequest, NextApiResponse } from "next";
import { readCurrentReport, reportEnrollmentId, requireReportContext, sendReportError } from "@/lib/reports/server";
import { ReportApiError } from "@/lib/reports/http";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const context = await requireReportContext(req, res, "POST", [], ["enrollmentId", "locale", "cursor"]);
    if (!context) return;
    if (typeof req.body?.cursor !== "string") throw new ReportApiError(400, "invalid_request");
    return res.status(200).json(await readCurrentReport(context, reportEnrollmentId(req.body.enrollmentId), req.body.cursor));
  } catch (error) { return sendReportError(req, res, error, "history"); }
}

export const config = { api: { bodyParser: false } };
