import type { NextApiRequest, NextApiResponse } from "next";
import { getAdminContext } from "@/lib/adminAccess";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const t = getServerTranslator(typeof req.body?.locale === "string" ? req.body.locale : req.cookies?.NEXT_LOCALE);
  try {
    await getAdminContext(req);
    // A general admin/assignment relationship is not an independent safety-case
    // authorization. Do not look up arbitrary SWEET IDs or mutate old followups.
    return res.status(403).json({ error: t("adminPrivateRecords.followupUnavailable"), privateRecordsRestricted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "请先登录管理员账号。" ? 401 : message === "当前账号没有学校工作台权限。" ? 403 : 500;
    return res.status(status).json({ error: t(status === 401 ? "adminPrivateRecords.signIn" : status === 403 ? "adminPrivateRecords.noAdminAccess" : "adminPrivateRecords.unavailable") });
  }
}
