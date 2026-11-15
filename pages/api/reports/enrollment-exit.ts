import type { NextApiRequest, NextApiResponse } from "next";
import { exitReportEnrollment, requireReportContext, sendReportError } from "@/lib/reports/server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const context = await requireReportContext(req, res, "POST", [], ["enrollmentId", "locale", "requestId", "confirmed"]);
    if (!context) return;
    return res.status(200).json(await exitReportEnrollment(context, req.body));
  } catch (error) { return sendReportError(req, res, error, "enrollment-exit"); }
}

export const config = { api: { bodyParser: false } };
