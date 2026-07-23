import type { NextApiRequest, NextApiResponse } from "next";
import { canManageSchool, getAdminContext } from "@/lib/adminAccess";

const allowedStatuses = ["new", "in_progress", "resolved"] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const context = await getAdminContext(req);
    const recordId = String(req.body?.recordId || "").trim();
    const schoolId = String(req.body?.schoolId || "").trim();
    const status = String(req.body?.status || "").trim();
    const note = String(req.body?.note || "").trim().slice(0, 500);

    if (!recordId || !schoolId) return res.status(400).json({ error: "缺少需要跟进的记录。" });
    if (!allowedStatuses.includes(status as (typeof allowedStatuses)[number])) {
      return res.status(400).json({ error: "请选择有效的跟进状态。" });
    }
    if (!canManageSchool(context, schoolId)) {
      return res.status(403).json({ error: "你只能跟进自己学校空间里的记录。" });
    }

    const { data: record, error: recordError } = await context.supabase
      .from("sweet_records")
      .select("id,user_id,school_id")
      .eq("id", recordId)
      .eq("school_id", schoolId)
      .maybeSingle();
    if (recordError) throw recordError;
    if (!record) return res.status(404).json({ error: "找不到这条学校记录。" });

    const now = new Date().toISOString();
    const { data, error } = await context.supabase
      .from("school_followups")
      .upsert(
        {
          school_id: schoolId,
          record_id: recordId,
          student_user_id: record.user_id,
          status,
          note: note || null,
          updated_by: context.user.id,
          updated_at: now,
        },
        { onConflict: "record_id" },
      )
      .select("record_id,status,note,updated_at")
      .single();
    if (error) throw error;

    return res.status(200).json({ followup: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "跟进状态保存失败。";
    const status = message.includes("只能") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
