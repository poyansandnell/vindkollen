import { Router, type IRouter } from "express";
import { HealthCheckResponse, GetPublicConfigResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/config", (_req, res) => {
  const data = GetPublicConfigResponse.parse({
    mapboxToken: process.env.MAPBOX_TOKEN ?? null,
  });
  res.json(data);
});

export default router;
