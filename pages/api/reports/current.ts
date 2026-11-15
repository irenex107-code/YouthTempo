import type { NextApiRequest, NextApiResponse } from "next";
import { readCurrentReport, reportEnrollmentId, requireReportContext, sendReportError } from "@/lib/reports/server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const context = await requireReportContext(req, res, "GET", ["enrollmentId", "locale"]);
    if (!context) return;
    return res.status(200).json(await readCurrentReport(context, reportEnrollmentId(req.query.enrollmentId)));
  } catch (error) { return sendReportError(req, res, error, "current"); }
}

export const config = { api: { bodyParser: false } };
