import type { NextApiRequest, NextApiResponse } from "next";
import { isDeletionSubject, parseDeletionReceipt, readDeletionReceiptState } from "@/lib/accountDeletionReceiptServer";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { enforceAccountDeletionStatusRateLimit } from "@/lib/rateLimit";

// Possession of a short-lived receipt can only query its minimal outcome. It
// cannot authenticate a user, return account data, or retry any mutation.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ state: "unknown" });
  }
  try {
    const supabase = getSupabaseAdmin({ requestTimeoutMs: 8_000 });
    if (!await enforceAccountDeletionStatusRateLimit(req, res, supabase)) return;
    const receipt = parseDeletionReceipt(req.body);
    if (!receipt || !isDeletionSubject(req.body?.subjectUserId)) return res.status(400).json({ state: "unknown" });
    const outcome = await readDeletionReceiptState(supabase, req.body.subjectUserId, receipt);
    return res.status(200).json(outcome);
  } catch {
    // Never include the receipt, request body, identity or provider error in a
    // log or response. Unavailability does not establish account absence.
    return res.status(200).json({ state: "unknown" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "2kb" } } };
