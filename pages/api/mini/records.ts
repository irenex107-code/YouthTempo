import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser, getSupabaseAdmin } from "@/lib/supabaseServer";
import { requireActiveStudentConsent } from "@/lib/studentConsent";

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validRecords(value: unknown) {
  if (!Array.isArray(value) || value.length !== 5) return false;
  return value.every((step) => {
    if (!step || typeof step !== "object") return false;
    const item = step as Record<string, unknown>;
    return typeof item.id === "string" && Array.isArray(item.fields) && item.fields.length > 0;
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
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

    if (req.method === "DELETE") {
      const recordId = typeof req.body?.recordId === "string" ? req.body.recordId.trim() : "";
      if (!recordId) return res.status(400).json({ error: "请选择要删除的记录。" });
      const { data, error } = await supabase
        .from("sweet_records")
        .delete()
        .eq("id", recordId)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "这条记录不存在，或不属于当前账号。" });
      return res.status(200).json({ deleted: true });
    }

    if (!validRecords(req.body?.records)) return res.status(400).json({ error: "请完成五个 SWEET 维度后再保存。" });
    await requireActiveStudentConsent(supabase, user.id);
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("school_id,role")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== "学生") return res.status(403).json({ error: "小程序第一版先开放给青少年和青年个人使用。" });

    const { data, error } = await supabase.from("sweet_records").insert({
      user_id: user.id,
      school_id: profile.school_id || null,
      records: req.body.records,
      summary: text(req.body?.summary, 500) || null,
      small_step: text(req.body?.smallStep, 500) || null,
      recommended_next_tool: text(req.body?.recommendedNextTool, 500) || null,
    }).select("id,summary,small_step,recommended_next_tool,created_at").single();
    if (error) throw error;
    return res.status(201).json({ record: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SWEET 记录处理失败。";
    const status = (error as Error & { statusCode?: number })?.statusCode || 500;
    return res.status(status).json({ error: status >= 500 ? "SWEET 记录暂时无法处理，请稍后再试。" : message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };
