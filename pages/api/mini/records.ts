import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { handleSweetPersistence } from "@/lib/sweetPersistenceServer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (req.method === "POST") {
    if (["delete_day", "delete_record_cutoff"].includes(String(req.body?.intent))) return res.status(400).json({ status: "invalid_request" });
    return handleSweetPersistence(req, res, true);
  }
  if (req.method === "DELETE") {
    // Preserve the mini programme's record/cutoff deletion, never broaden it
    // to the web account's whole-day delete command.
    return handleSweetPersistence(req, res, true, true);
  }
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "请先登录。" });
    const supabase = getSupabaseAdmin();
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("sweet_records")
        .select("id,records,summary,small_step,recommended_next_tool,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return res.status(200).json({ records: data || [] });
    }

  } catch {
    return res.status(503).json({ error: "SWEET 记录暂时无法处理，请稍后再试。" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "128kb" } } };
