import type { NextApiRequest, NextApiResponse } from "next";
import {
  isFailureKind,
  isMonitoredArea,
  isMonitoredClientOperation,
} from "@/lib/monitoringTypes";
import { anonymousRequestHash, reportOperationalError } from "@/lib/operationalMonitoring";

const windows = new Map<string, { count: number; resetAt: number }>();
const windowMs = 60_000;
const limit = 30;

function withinLimit(req: NextApiRequest) {
  const now = Date.now();
  if (windows.size >= 5_000) {
    for (const [storedKey, value] of windows) {
      if (value.resetAt <= now) windows.delete(storedKey);
    }
    if (windows.size >= 5_000) windows.delete(windows.keys().next().value as string);
  }
  const key = anonymousRequestHash(req);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!withinLimit(req)) return res.status(204).end();

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const keys = Object.keys(body);
  const hasOnlyExpectedKeys = keys.length === 3
    && keys.every((key) => ["area", "operation", "failureKind"].includes(key));
  const { area, operation, failureKind } = body;
  if (
    !hasOnlyExpectedKeys
    || !isMonitoredArea(area)
    || !isMonitoredClientOperation(operation)
    || !isFailureKind(failureKind)
  ) {
    return res.status(400).json({ error: "Invalid monitoring event" });
  }

  await reportOperationalError({
    req,
    area,
    operation: `client_${operation}`,
    statusCode: 0,
    failureKind,
  });
  return res.status(202).json({ accepted: true });
}

export const config = {
  api: { bodyParser: { sizeLimit: "2kb" } },
};
