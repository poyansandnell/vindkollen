import { Router, type IRouter, type Request, type Response } from "express";
import { db, userProjectsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";

const router: IRouter = Router();

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200).default("Mitt projekt"),
  location: z.string().nullable().optional(),
  municipality: z.string().nullable().optional(),
  turbines: z.array(z.unknown()).default([]),
  analysisResult: z.unknown().nullable().optional(),
  centerLat: z.string().nullable().optional(),
  centerLng: z.string().nullable().optional(),
  turbineCount: z.string().default("0"),
  totalScore: z.string().nullable().optional(),
});

const UpdateProjectSchema = CreateProjectSchema.partial();

router.get("/projects", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Inte inloggad" });
    return;
  }
  const userId = req.user.id;

  try {
    const projects = await db
      .select()
      .from(userProjectsTable)
      .where(eq(userProjectsTable.userId, userId))
      .orderBy(desc(userProjectsTable.updatedAt));

    res.json(projects);
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Serverfel" });
  }
});

router.post("/projects", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Inte inloggad" });
    return;
  }
  const userId = req.user.id;

  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ogiltiga fält", details: parsed.error.issues });
    return;
  }

  try {
    const [project] = await db
      .insert(userProjectsTable)
      .values({
        userId,
        name: parsed.data.name,
        location: parsed.data.location ?? null,
        municipality: parsed.data.municipality ?? null,
        turbines: parsed.data.turbines as object[],
        analysisResult: (parsed.data.analysisResult ?? null) as Record<string, unknown> | null,
        centerLat: parsed.data.centerLat ?? null,
        centerLng: parsed.data.centerLng ?? null,
        turbineCount: parsed.data.turbineCount,
        totalScore: parsed.data.totalScore ?? null,
      })
      .returning();

    res.status(201).json(project);
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Serverfel" });
  }
});

router.get("/projects/:id", async (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const shareToken = typeof req.query.shareToken === "string" ? req.query.shareToken : null;

  try {
    const [project] = await db
      .select()
      .from(userProjectsTable)
      .where(eq(userProjectsTable.id, projectId));

    if (!project) {
      res.status(404).json({ error: "Hittades inte" });
      return;
    }

    const isOwner = req.isAuthenticated() && project.userId === req.user.id;
    const hasShareToken = shareToken !== null && project.shareToken === shareToken;

    if (!isOwner && !hasShareToken) {
      res.status(404).json({ error: "Hittades inte" });
      return;
    }

    res.json(project);
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Serverfel" });
  }
});

router.put("/projects/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Inte inloggad" });
    return;
  }
  const userId = req.user.id;
  const projectId = String(req.params.id);

  const parsed = UpdateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ogiltiga fält", details: parsed.error.issues });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(userProjectsTable)
      .where(and(eq(userProjectsTable.id, projectId), eq(userProjectsTable.userId, userId)));

    if (!existing) {
      res.status(404).json({ error: "Hittades inte" });
      return;
    }

    const data = parsed.data;
    const [updated] = await db
      .update(userProjectsTable)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.municipality !== undefined && { municipality: data.municipality }),
        ...(data.turbines !== undefined && { turbines: data.turbines as object[] }),
        ...(data.analysisResult !== undefined && { analysisResult: data.analysisResult as Record<string, unknown> | null }),
        ...(data.centerLat !== undefined && { centerLat: data.centerLat }),
        ...(data.centerLng !== undefined && { centerLng: data.centerLng }),
        ...(data.turbineCount !== undefined && { turbineCount: data.turbineCount }),
        ...(data.totalScore !== undefined && { totalScore: data.totalScore }),
      })
      .where(and(eq(userProjectsTable.id, projectId), eq(userProjectsTable.userId, userId)))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ error: "Serverfel" });
  }
});

router.delete("/projects/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Inte inloggad" });
    return;
  }
  const userId = req.user.id;
  const projectId = String(req.params.id);

  try {
    const result = await db
      .delete(userProjectsTable)
      .where(and(eq(userProjectsTable.id, projectId), eq(userProjectsTable.userId, userId)))
      .returning();

    if (result.length === 0) {
      res.status(404).json({ error: "Hittades inte" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Serverfel" });
  }
});

router.post("/projects/:id/share", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Inte inloggad" });
    return;
  }
  const userId = req.user.id;
  const projectId = String(req.params.id);

  try {
    const [existing] = await db
      .select()
      .from(userProjectsTable)
      .where(and(eq(userProjectsTable.id, projectId), eq(userProjectsTable.userId, userId)));

    if (!existing) {
      res.status(404).json({ error: "Hittades inte" });
      return;
    }

    let { shareToken } = existing;
    if (!shareToken) {
      const token = crypto.randomUUID();
      const [updated] = await db
        .update(userProjectsTable)
        .set({ shareToken: token })
        .where(eq(userProjectsTable.id, projectId))
        .returning();
      shareToken = updated.shareToken;
    }

    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost";
    const shareUrl = `${proto}://${host}/placera?shareToken=${shareToken}&projectId=${projectId}`;

    res.json({ shareToken, shareUrl });
  } catch (err) {
    req.log.error({ err }, "Failed to generate share link");
    res.status(500).json({ error: "Serverfel" });
  }
});

export default router;
