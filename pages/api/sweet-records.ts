import type { NextApiRequest, NextApiResponse } from "next";
import { handleSweetPersistence } from "@/lib/sweetPersistenceServer";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handleSweetPersistence(req, res);
}

export const config = { api: { bodyParser: { sizeLimit: "128kb" } } };
