import type { NextApiRequest, NextApiResponse } from "next";
import { reportEnrollmentId, requireReportContext, sendReportError, validateReport } from "@/lib/reports/server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const context = await requireReportContext(req, res, "POST", [], ["enrollmentId", "locale", "viewToken"]);
    if (!context) return;
    return res.status(200).json(await validateReport(context, reportEnrollmentId(req.body?.enrollmentId), req.body?.viewToken));
  } catch (error) { return sendReportError(req, res, error, "validate"); }
}

export const config = { api: { bodyParser: false } };
