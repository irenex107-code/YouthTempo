import type { NextApiRequest, NextApiResponse } from "next";
import { loadReportAccess, requireReportContext, sendReportError } from "@/lib/reports/server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const method = req.method === "POST" ? "POST" : "GET";
    const context = await requireReportContext(req, res, method, ["locale"], method === "POST" ? ["locale", "cursor"] : []);
    if (!context) return;
    return res.status(200).json(await loadReportAccess(context, method === "POST" ? req.body?.cursor : undefined));
  } catch (error) { return sendReportError(req, res, error, "access"); }
}

export const config = { api: { bodyParser: false } };
