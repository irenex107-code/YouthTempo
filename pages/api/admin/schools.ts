import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdmin } from "@/lib/adminAccess";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { supabase } = await requireAdmin(req);

    if (req.method === "POST") {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) return res.status(400).json({ error: "请输入学校名称。" });

      const { data, error } = await supabase
        .from("schools")
        .insert({ name, status: "active" })
        .select("id,name,status,created_at")
        .single();
      if (error) throw error;
      return res.status(201).json({ school: data });
    }

    const { data, error } = await supabase
      .from("schools")
      .select("id,name,status,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    return res.status(200).json({ schools: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "学校空间操作失败。";
    const status = message.includes("没有管理员权限") ? 403 : message.includes("请先登录") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
