import type { NextApiRequest, NextApiResponse } from "next";
import { reportDetailCommand, requireReportContext, sendReportError, setReportDetails } from "@/lib/reports/server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const context = await requireReportContext(req, res, "POST", [], ["enrollmentId", "locale", "requestId", "enabled", "expectedDetailRevision", "expectedRecipientEpoch", "policyVersion", "confirmed"]);
    if (!context) return;
    return res.status(200).json(await setReportDetails(context, reportDetailCommand(req.body)));
  } catch (error) { return sendReportError(req, res, error, "details-setting"); }
}

export const config = { api: { bodyParser: false } };
