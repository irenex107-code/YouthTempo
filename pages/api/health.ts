import type { NextApiRequest, NextApiResponse } from "next";

type HealthResponse = {
  service: "youthtempo";
  status: "ok";
};

export default function handler(
  _req: NextApiRequest,
  res: NextApiResponse<HealthResponse>,
) {
  res.status(200).json({
    service: "youthtempo",
    status: "ok",
  });
}
