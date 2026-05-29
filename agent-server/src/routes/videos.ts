// Video API routes — adapted from sahamati-video for Hono + better-sqlite3

import { Hono } from "hono";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { getDb } from "../db/index.js";
import { ensureVideoDirectories, getVideoFilePath } from "../services/video-files.js";
import {
  generateVideo,
  generateMultiSceneVideo,
  extendVideo,
  getVideoById,
  getVideos,
  getJobProgress,
} from "../services/video-generator.js";
import { applyBranding } from "../services/branding.js";
import { getGenerationLogs } from "../services/generation-logger.js";
import { marketingTemplates, getTemplateById, fillTemplate } from "../services/templates.js";
import { runScriptwriterAgent, convertToVideoRequest } from "../services/scriptwriter-agent.js";
import type {
  EnhancedVideoOptions,
  GenerateVideoRequest,
  GenerateVideoResponse,
  ExtendVideoRequest,
  VideoStatusResponse,
  CharacterProfile,
  CreateCharacterRequest,
  UpdateCharacterRequest,
} from "../types/video.js";
import { PRESET_PERSONAS, getPresetByName } from "../types/video.js";

const videos = new Hono();

// Ensure video directories exist on first request
let dirsInitialized = false;
videos.use("*", async (c, next) => {
  if (!dirsInitialized) {
    ensureVideoDirectories();
    dirsInitialized = true;
  }
  await next();
});

// ---- Video CRUD ----

// List all videos
videos.get("/api/videos", (c) => {
  const db = getDb();
  const limit = Number(c.req.query("limit")) || 50;
  const offset = Number(c.req.query("offset")) || 0;
  const { videos: videoList, total } = getVideos(db, limit, offset);
  return c.json({ videos: videoList, total, limit, offset });
});

// Generate a new video (single or multi-scene)
videos.post("/api/videos/generate", async (c) => {
  const db = getDb();
  try {
    const body = await c.req.json<GenerateVideoRequest>();

    // Multi-scene request
    if (body.scenes && body.scenes.length > 0) {
      const enhancedOptions: EnhancedVideoOptions = {
        scenes: body.scenes,
        model: body.options?.model || "veo-3.1-generate-001",
        includeAudio: body.options?.includeAudio ?? true,
        outputPreset: body.outputPreset || "youtube",
        aspectRatio: body.options?.aspectRatio,
        resolution: body.options?.resolution,
        branding: body.branding as any,
        transition: body.transition,
        characterId: body.characterId,
      };

      const { videoId, jobId } = await generateMultiSceneVideo(db, enhancedOptions);

      const response: GenerateVideoResponse = {
        videoId,
        status: "pending",
        message: `Multi-scene video generation started (${body.scenes.length} scenes)`,
      };
      return c.json(response, 202);
    }

    // Single video generation
    if (!body.prompt && !body.templateId) {
      return c.json({ code: "VALIDATION_ERROR", message: "prompt or templateId required" }, 400);
    }

    let prompt = body.prompt || "";
    if (body.templateId) {
      const template = getTemplateById(body.templateId);
      if (!template) return c.json({ code: "NOT_FOUND", message: `Template ${body.templateId} not found` }, 404);
      prompt = fillTemplate(template, body.templateVariables || {});
    }

    const { videoId, jobId } = await generateVideo(db, {
      prompt,
      aspectRatio: body.options.aspectRatio || "16:9",
      resolution: body.options.resolution || "1080p",
      duration: body.options.duration || 8,
      model: body.options.model || "veo-3.1-generate-001",
      negativePrompt: body.options.negativePrompt,
      includeAudio: body.options.includeAudio ?? true,
    });

    const response: GenerateVideoResponse = {
      videoId,
      status: "pending",
      message: "Video generation started",
    };
    return c.json(response, 202);
  } catch (error) {
    console.error("Generate video error:", error);
    return c.json({
      code: "GENERATION_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

// Get video details
videos.get("/api/videos/:id", (c) => {
  const db = getDb();
  const video = getVideoById(db, c.req.param("id"));
  if (!video) return c.json({ code: "NOT_FOUND", message: "Video not found" }, 404);
  return c.json({ video });
});

// Get video generation status
videos.get("/api/videos/:id/status", (c) => {
  const db = getDb();
  const video = getVideoById(db, c.req.param("id"));
  if (!video) return c.json({ code: "NOT_FOUND", message: "Video not found" }, 404);

  const job = getJobProgress(db, c.req.param("id"));
  const response: VideoStatusResponse = {
    video,
    progress: job?.progress,
    estimatedTimeRemaining:
      job?.status === "processing"
        ? Math.max(0, ((100 - (job.progress || 0)) / 10) * 10)
        : undefined,
  };
  return c.json(response);
});

// Get generation logs
videos.get("/api/videos/:id/logs", (c) => {
  const db = getDb();
  const videoId = c.req.param("id");
  const video = getVideoById(db, videoId);
  if (!video) return c.json({ code: "NOT_FOUND", message: "Video not found" }, 404);

  const sinceParam = c.req.query("since");
  const since = sinceParam ? parseInt(sinceParam, 10) : undefined;
  const logs = getGenerationLogs(db, videoId, since);

  return c.json({
    logs,
    lastId: logs.length > 0 ? logs[logs.length - 1].id : since || 0,
  });
});

// Download video
videos.get("/api/videos/:id/download", (c) => {
  const db = getDb();
  const video = getVideoById(db, c.req.param("id"));
  if (!video) return c.json({ code: "NOT_FOUND", message: "Video not found" }, 404);
  if (video.status !== "completed" || !video.filePath) {
    return c.json({ code: "NOT_READY", message: "Video is not ready" }, 400);
  }
  if (!existsSync(video.filePath)) {
    return c.json({ code: "FILE_NOT_FOUND", message: "Video file not found" }, 404);
  }

  const fileBuffer = readFileSync(video.filePath);
  return new Response(fileBuffer, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${c.req.param("id")}.mp4"`,
    },
  });
});

// Get thumbnail
videos.get("/api/videos/:id/thumbnail", (c) => {
  const db = getDb();
  const video = getVideoById(db, c.req.param("id"));
  if (!video || !video.thumbnailPath) return c.json({ code: "NOT_FOUND", message: "Thumbnail not found" }, 404);
  if (!existsSync(video.thumbnailPath)) return c.json({ code: "FILE_NOT_FOUND", message: "Thumbnail file not found" }, 404);

  const fileBuffer = readFileSync(video.thumbnailPath);
  return new Response(fileBuffer, {
    headers: { "Content-Type": "image/jpeg" },
  });
});

// Extend a video
videos.post("/api/videos/:id/extend", async (c) => {
  const db = getDb();
  try {
    const body = await c.req.json<ExtendVideoRequest>();
    if (!body.prompt) return c.json({ code: "VALIDATION_ERROR", message: "prompt is required" }, 400);

    const { videoId: newVideoId } = await extendVideo(db, {
      videoId: c.req.param("id"),
      prompt: body.prompt,
      duration: body.duration || 8,
    });

    return c.json({ videoId: newVideoId, status: "pending", message: "Video extension started" }, 202);
  } catch (error) {
    return c.json({
      code: "EXTENSION_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

// Delete a video
videos.delete("/api/videos/:id", (c) => {
  const db = getDb();
  const video = getVideoById(db, c.req.param("id"));
  if (!video) return c.json({ code: "NOT_FOUND", message: "Video not found" }, 404);

  if (video.filePath) {
    try { unlinkSync(video.filePath); } catch { /* ignore */ }
  }
  if (video.thumbnailPath) {
    try { unlinkSync(video.thumbnailPath); } catch { /* ignore */ }
  }

  db.prepare(`DELETE FROM generation_logs WHERE video_id = ?`).run(c.req.param("id"));
  db.prepare(`DELETE FROM jobs WHERE video_id = ?`).run(c.req.param("id"));
  db.prepare(`DELETE FROM videos WHERE id = ?`).run(c.req.param("id"));

  return c.json({ message: "Video deleted successfully" });
});

// ---- Templates ----

videos.get("/api/templates", (c) => {
  const category = c.req.query("category");
  const templates = category
    ? marketingTemplates.filter((t) => t.category === category)
    : marketingTemplates;
  return c.json({ templates });
});

// ---- Scriptwriter ----

videos.post("/api/scriptwriter/generate", async (c) => {
  try {
    const body = await c.req.json<{ brief: string; customizations?: any }>();
    if (!body.brief) return c.json({ code: "VALIDATION_ERROR", message: "brief is required" }, 400);

    const result = await runScriptwriterAgent({ brief: body.brief, customizations: body.customizations });
    return c.json({ result });
  } catch (error) {
    return c.json({
      code: "SCRIPTWRITER_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

// ---- Character Profiles ----

videos.get("/api/characters/presets", (c) => {
  return c.json({ presets: PRESET_PERSONAS });
});

videos.get("/api/characters", (c) => {
  const db = getDb();
  const limit = Number(c.req.query("limit")) || 50;
  const offset = Number(c.req.query("offset")) || 0;

  const rows = db.prepare(
    `SELECT * FROM character_profiles ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset) as any[];

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM character_profiles`).get() as { count: number };

  const characters = rows.map(rowToCharacter);
  return c.json({ characters, total: totalRow.count, limit, offset });
});

videos.post("/api/characters", async (c) => {
  const db = getDb();
  const body = await c.req.json<CreateCharacterRequest>();
  if (!body.name || !body.description) {
    return c.json({ code: "VALIDATION_ERROR", message: "name and description are required" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO character_profiles (id, name, description, gender, age_range, ethnicity, clothing, hair, distinguishing_features, series_id, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, body.name, body.description, body.gender || null,
    body.ageRange || null, body.ethnicity || null, body.clothing || null,
    body.hair || null, body.distinguishingFeatures || null,
    body.seriesId || null, body.tags ? JSON.stringify(body.tags) : null,
    now, now
  );

  const row = db.prepare(`SELECT * FROM character_profiles WHERE id = ?`).get(id) as any;
  return c.json({ character: rowToCharacter(row) }, 201);
});

videos.post("/api/characters/from-preset", async (c) => {
  const db = getDb();
  const body = await c.req.json<{ presetName: string; customizations?: Partial<CreateCharacterRequest> }>();
  const preset = getPresetByName(body.presetName);
  if (!preset) return c.json({ code: "NOT_FOUND", message: `Preset "${body.presetName}" not found` }, 404);

  const data = { ...preset, ...body.customizations };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO character_profiles (id, name, description, gender, age_range, ethnicity, clothing, hair, distinguishing_features, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, data.name, data.description, data.gender || null, data.ageRange || null, data.ethnicity || null, data.clothing || null, data.hair || null, data.distinguishingFeatures || null, now, now);

  const row = db.prepare(`SELECT * FROM character_profiles WHERE id = ?`).get(id) as any;
  return c.json({ character: rowToCharacter(row) }, 201);
});

videos.get("/api/characters/:id", (c) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM character_profiles WHERE id = ?`).get(c.req.param("id")) as any;
  if (!row) return c.json({ code: "NOT_FOUND", message: "Character not found" }, 404);
  return c.json({ character: rowToCharacter(row) });
});

videos.delete("/api/characters/:id", (c) => {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM character_profiles WHERE id = ?`).get(c.req.param("id"));
  if (!existing) return c.json({ code: "NOT_FOUND", message: "Character not found" }, 404);
  db.prepare(`DELETE FROM character_profiles WHERE id = ?`).run(c.req.param("id"));
  return c.json({ message: "Character deleted" });
});

// Helper to convert DB row to CharacterProfile
function rowToCharacter(row: any): CharacterProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    gender: row.gender,
    ageRange: row.age_range || undefined,
    ethnicity: row.ethnicity || undefined,
    clothing: row.clothing || undefined,
    hair: row.hair || undefined,
    distinguishingFeatures: row.distinguishing_features || undefined,
    seriesId: row.series_id || undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default videos;
