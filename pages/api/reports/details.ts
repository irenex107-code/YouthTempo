import type { NextApiRequest, NextApiResponse } from "next";
import { readReportDetails, reportEnrollmentId, requireReportContext, sendReportError } from "@/lib/reports/server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const context = await requireReportContext(req, res, "POST", [], ["enrollmentId", "locale", "viewToken", "cursor"]);
    if (!context) return;
    return res.status(200).json(await readReportDetails(context, reportEnrollmentId(req.body?.enrollmentId), req.body?.viewToken, req.body?.cursor));
  } catch (error) { return sendReportError(req, res, error, "details"); }
}

export const config = { api: { bodyParser: false } };
