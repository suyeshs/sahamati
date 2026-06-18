// Video Generator Service — adapted from sahamati-video for Node.js + better-sqlite3

import { writeFileSync, renameSync, copyFileSync } from "fs";
import { spawn } from "child_process";
import type { DB as Database } from "../db/index.js";
import type {
  VideoGenerationOptions,
  VideoExtendOptions,
  Video,
  VideoMetadata,
  VideoScene,
  EnhancedVideoOptions,
  AspectRatio,
  VideoResolution,
  TransitionConfig,
  CharacterProfile,
} from "../types/video.js";
import { OUTPUT_PRESETS, DEFAULT_TRANSITION } from "../types/video.js";
import { getVideoFilePath, getThumbnailPath, getFfmpegPath } from "./video-files.js";
import { concatenateVideos, concatenateVideosWithTransitions, applyBranding } from "./branding.js";
import { GenerationLogger } from "./generation-logger.js";
import { enhancePrompt, type PromptEnhancementOptions } from "./prompt-enhancer.js";
import { getGoogleAI } from "./google-ai-client.js";

const getAI = getGoogleAI;

const POLL_INTERVAL = 10000;

function generateId(): string {
  return crypto.randomUUID();
}

// ---- Single video generation ----

export async function generateVideo(
  db: Database,
  options: VideoGenerationOptions
): Promise<{ videoId: string; jobId: string }> {
  const _ai = getAI();

  const videoId = generateId();
  const jobId = generateId();

  db.prepare(
    `INSERT INTO videos (id, prompt, status, aspect_ratio, resolution, duration, metadata)
     VALUES (?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    videoId, options.prompt, options.aspectRatio, options.resolution, options.duration,
    JSON.stringify({ model: options.model, hasAudio: options.includeAudio ?? true, hasBranding: false, hasVoiceover: false } satisfies VideoMetadata)
  );

  db.prepare(`INSERT INTO jobs (id, video_id, type, status) VALUES (?, ?, 'generate', 'pending')`).run(jobId, videoId);

  // Start in background (fire-and-forget)
  startVideoGeneration(db, videoId, jobId, options);

  return { videoId, jobId };
}

async function startVideoGeneration(
  db: Database, videoId: string, jobId: string, options: VideoGenerationOptions
): Promise<void> {
  const logger = new GenerationLogger(db, videoId);

  try {
    db.prepare(`UPDATE videos SET status = 'processing', updated_at = datetime('now') WHERE id = ?`).run(videoId);
    db.prepare(`UPDATE jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?`).run(jobId);

    logger.info("initializing", "Starting video generation process");
    logger.thinking("analyzing_prompt", `Analyzing prompt: "${options.prompt.substring(0, 100)}${options.prompt.length > 100 ? '...' : ''}"`);
    logger.action("calling_api", "Sending generation request to Veo 3.1...");

    const operation = await getAI().models.generateVideos({
      model: options.model,
      prompt: options.prompt,
      config: {
        aspectRatio: options.aspectRatio,
        numberOfVideos: 1,
        durationSeconds: options.duration,
        negativePrompt: options.negativePrompt,
      },
    });

    logger.success("calling_api", "Request accepted by Veo 3.1 API");
    db.prepare(`UPDATE jobs SET operation_name = ? WHERE id = ?`).run(operation.name ?? null, jobId);

    await pollVideoGeneration(db, videoId, jobId, operation, logger);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("failed", `Generation failed: ${errorMessage}`);
    db.prepare(`UPDATE videos SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).run(errorMessage, videoId);
    db.prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).run(errorMessage, jobId);
  }
}

async function pollVideoGeneration(
  db: Database, videoId: string, jobId: string, operation: any, logger: GenerationLogger
): Promise<void> {
  let currentOperation = operation;
  let progress = 0;
  let pollCount = 0;

  const thinkingMessages = [
    "Veo is analyzing the scene composition...",
    "Generating visual elements and textures...",
    "Applying cinematic lighting and effects...",
    "Rendering motion and transitions...",
    "Synthesizing audio elements...",
    "Fine-tuning video quality...",
    "Almost there, finalizing frames...",
  ];

  while (!currentOperation.done) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    progress = Math.min(progress + 10, 90);
    db.prepare(`UPDATE jobs SET progress = ?, updated_at = datetime('now') WHERE id = ?`).run(progress, jobId);

    const thinkingIdx = Math.min(pollCount, thinkingMessages.length - 1);
    logger.thinking("polling_status", thinkingMessages[thinkingIdx], { progress });

    currentOperation = await getAI().operations.getVideosOperation({ operation: currentOperation });
    pollCount++;
  }

  logger.success("polling_status", "Video generation completed by Veo 3.1");

  if (currentOperation.error) {
    throw new Error(`Veo API error: ${currentOperation.error.message || JSON.stringify(currentOperation.error)}`);
  }

  if (currentOperation.response?.generatedVideos?.[0]) {
    const generatedVideo = currentOperation.response.generatedVideos[0];
    const video = generatedVideo.video;
    const filePath = getVideoFilePath(videoId);

    if (video?.videoBytes) {
      logger.action("downloading", "Decoding video data from API response...");
      const videoBuffer = Buffer.from(video.videoBytes, "base64");
      writeFileSync(filePath, videoBuffer);
      logger.success("downloading", `Video saved (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
    } else if (video?.uri) {
      logger.action("downloading", "Downloading video from cloud storage...");
      await downloadVideo(video, filePath);
      logger.success("downloading", "Video downloaded successfully");
    } else {
      throw new Error("No video data (bytes or URI) in response");
    }

    logger.action("generating_thumbnail", "Extracting thumbnail from video...");
    const thumbnailPath = getThumbnailPath(videoId);
    await generateThumbnail(filePath, thumbnailPath);
    logger.success("generating_thumbnail", "Thumbnail generated");

    db.prepare(
      `UPDATE videos SET status = 'completed', file_path = ?, thumbnail_path = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(filePath, thumbnailPath, videoId);
    db.prepare(`UPDATE jobs SET status = 'completed', progress = 100, updated_at = datetime('now') WHERE id = ?`).run(jobId);

    logger.success("completed", "Video generation completed successfully!");
  } else {
    throw new Error("No generated video in response");
  }
}

async function downloadVideo(video: any, filePath: string): Promise<void> {
  // Vertex AI returns video URIs (often gs://) that require ADC-authenticated
  // access. ai.files.download handles auth via the same credentials used to
  // construct the client, so we don't manage tokens ourselves.
  await getAI().files.download({ file: video, downloadPath: filePath });
}

async function generateThumbnail(videoPath: string, thumbnailPath: string): Promise<void> {
  const ffmpeg = getFfmpegPath();
  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, [
      "-i", videoPath, "-vf", "select=eq(n\\,0)", "-q:v", "3", "-y", thumbnailPath,
    ]);
    proc.on("close", () => resolve());
  });
}

// ---- Multi-scene video generation ----

export async function generateMultiSceneVideo(
  db: Database,
  options: EnhancedVideoOptions
): Promise<{ videoId: string; jobId: string }> {
  const _ai = getAI();
  if (!options.scenes || options.scenes.length === 0) {
    throw new Error("At least one scene is required");
  }

  const finalVideoId = generateId();
  const jobId = generateId();
  const totalDuration = options.scenes.reduce((sum, s) => sum + s.duration, 0);

  const preset = OUTPUT_PRESETS[options.outputPreset];
  const aspectRatio: AspectRatio = options.aspectRatio || preset.aspectRatio;
  const resolution: VideoResolution = options.resolution || preset.resolution;

  db.prepare(
    `INSERT INTO videos (id, prompt, status, aspect_ratio, resolution, duration, metadata)
     VALUES (?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    finalVideoId,
    `Multi-scene video (${options.scenes.length} scenes)`,
    aspectRatio, resolution, totalDuration,
    JSON.stringify({
      model: options.model, hasAudio: options.includeAudio ?? true,
      hasBranding: !!options.branding?.addLogo, hasVoiceover: !!options.voiceover,
      sceneCount: options.scenes.length,
    } satisfies VideoMetadata)
  );

  db.prepare(`INSERT INTO jobs (id, video_id, type, status) VALUES (?, ?, 'multi-scene', 'pending')`).run(jobId, finalVideoId);

  startMultiSceneGeneration(db, finalVideoId, jobId, options, aspectRatio, resolution);

  return { videoId: finalVideoId, jobId };
}

async function startMultiSceneGeneration(
  db: Database, finalVideoId: string, jobId: string,
  options: EnhancedVideoOptions, aspectRatio: AspectRatio, _resolution: VideoResolution
): Promise<void> {
  const logger = new GenerationLogger(db, finalVideoId);

  try {
    db.prepare(`UPDATE videos SET status = 'processing', updated_at = datetime('now') WHERE id = ?`).run(finalVideoId);
    db.prepare(`UPDATE jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?`).run(jobId);

    const totalScenes = options.scenes.length;
    const totalDuration = options.scenes.reduce((sum, s) => sum + s.duration, 0);

    // Load character profile if specified
    let characterProfile: CharacterProfile | undefined = options.character;
    if (!characterProfile && options.characterId) {
      const row = db.prepare(`SELECT * FROM character_profiles WHERE id = ?`).get(options.characterId) as any;
      if (row) {
        characterProfile = {
          id: row.id, name: row.name, description: row.description,
          gender: row.gender, ageRange: row.age_range, ethnicity: row.ethnicity,
          clothing: row.clothing, hair: row.hair,
          distinguishingFeatures: row.distinguishing_features,
        };
        logger.info("initializing", `Using character profile: ${characterProfile.name}`);
      }
    }

    logger.info("initializing", `Starting multi-scene video generation (${totalScenes} scenes, ${totalDuration}s total)`);

    const sceneVideoIds: string[] = [];

    for (let i = 0; i < options.scenes.length; i++) {
      const scene = options.scenes[i];
      const sceneProgress = Math.round(((i) / totalScenes) * 80);
      db.prepare(`UPDATE jobs SET progress = ?, updated_at = datetime('now') WHERE id = ?`).run(sceneProgress, jobId);

      logger.action("calling_api", `Starting Scene ${i + 1}/${totalScenes} generation...`);

      const sceneVideoId = await generateSingleScene(
        scene, aspectRatio, options.model, logger, i + 1, totalScenes,
        characterProfile ? { characterProfile } : undefined
      );
      sceneVideoIds.push(sceneVideoId);
      logger.success("processing_video", `Scene ${i + 1}/${totalScenes} completed`);
    }

    // Concatenation phase
    db.prepare(`UPDATE jobs SET progress = 85, updated_at = datetime('now') WHERE id = ?`).run(jobId);
    const transition: TransitionConfig = options.transition || DEFAULT_TRANSITION;
    logger.action("concatenating", `Stitching ${sceneVideoIds.length} scenes with ${transition.type} transitions...`);

    const concatenatedPath = await concatenateVideosWithTransitions(sceneVideoIds, finalVideoId, transition);
    logger.success("concatenating", "All scenes combined into single video");

    let finalPath = concatenatedPath;

    // Apply branding if requested
    if (options.branding?.addLogo) {
      db.prepare(`UPDATE jobs SET progress = 90, updated_at = datetime('now') WHERE id = ?`).run(jobId);
      logger.action("applying_branding", "Adding Sahamati logo watermark...");

      const logoPos = options.branding.logoPosition === "center"
        ? "bottom-right"
        : (options.branding.logoPosition || "bottom-right");

      finalPath = await applyBranding(finalVideoId, {
        logoPosition: logoPos as "top-left" | "top-right" | "bottom-left" | "bottom-right",
        logoScale: options.branding.logoScale || 0.15,
      });

      renameSync(finalPath, getVideoFilePath(finalVideoId));
      finalPath = getVideoFilePath(finalVideoId);
      logger.success("applying_branding", "Branding applied successfully");
    }

    // Generate thumbnail
    db.prepare(`UPDATE jobs SET progress = 95, updated_at = datetime('now') WHERE id = ?`).run(jobId);
    logger.action("generating_thumbnail", "Extracting thumbnail from first frame...");
    const thumbnailPath = getThumbnailPath(finalVideoId);
    await generateThumbnail(finalPath, thumbnailPath);
    logger.success("generating_thumbnail", "Thumbnail generated");

    // Finalize
    db.prepare(
      `UPDATE videos SET status = 'completed', file_path = ?, thumbnail_path = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(finalPath, thumbnailPath, finalVideoId);
    db.prepare(`UPDATE jobs SET status = 'completed', progress = 100, updated_at = datetime('now') WHERE id = ?`).run(jobId);

    logger.success("completed", `Multi-scene video completed! (${totalScenes} scenes, ${totalDuration}s)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("failed", `Multi-scene generation failed: ${errorMessage}`);
    db.prepare(`UPDATE videos SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).run(errorMessage, finalVideoId);
    db.prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).run(errorMessage, jobId);
  }
}

async function generateSingleScene(
  scene: VideoScene, aspectRatio: AspectRatio, model: string,
  logger: GenerationLogger, sceneNum: number, _totalScenes: number,
  promptEnhancementOptions?: PromptEnhancementOptions
): Promise<string> {
  const sceneVideoId = generateId();

  const enhanced = enhancePrompt(scene.prompt, {
    ...promptEnhancementOptions,
    customNegativePrompts: scene.negativePrompt
      ? [scene.negativePrompt]
      : promptEnhancementOptions?.customNegativePrompts,
  });

  logger.thinking("polling_status", `Scene ${sceneNum}: Veo is analyzing the visual elements...`);

  const operation = await getAI().models.generateVideos({
    model,
    prompt: enhanced.prompt,
    config: {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: scene.duration,
      negativePrompt: enhanced.negativePrompt,
    },
  });

  logger.info("polling_status", `Scene ${sceneNum}: Request accepted, waiting for Veo...`);

  let currentOperation = operation;
  let pollCount = 0;
  const sceneThinkingMessages = [
    "Composing the visual narrative...",
    "Rendering textures and lighting...",
    "Adding motion dynamics...",
    "Synthesizing scene elements...",
    "Finalizing frame details...",
  ];

  while (!currentOperation.done) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    if (pollCount % 2 === 0) {
      const msgIdx = Math.min(Math.floor(pollCount / 2), sceneThinkingMessages.length - 1);
      logger.thinking("polling_status", `Scene ${sceneNum}: ${sceneThinkingMessages[msgIdx]}`);
    }
    currentOperation = await getAI().operations.getVideosOperation({ operation: currentOperation });
    pollCount++;
  }

  if (currentOperation.error) {
    throw new Error(`Veo API error for scene ${sceneNum}: ${currentOperation.error.message || JSON.stringify(currentOperation.error)}`);
  }

  if (currentOperation.response?.generatedVideos?.[0]) {
    const generatedVideo = currentOperation.response.generatedVideos[0];
    const video = generatedVideo.video;
    const filePath = getVideoFilePath(sceneVideoId);

    if (video?.videoBytes) {
      const videoBuffer = Buffer.from(video.videoBytes, "base64");
      writeFileSync(filePath, videoBuffer);
    } else if (video?.uri) {
      await downloadVideo(video, filePath);
    } else {
      throw new Error(`No video data for scene ${sceneNum}`);
    }

    return sceneVideoId;
  } else {
    throw new Error(`No generated video for scene ${sceneNum}`);
  }
}

// ---- Video extension ----

export async function extendVideo(
  db: Database,
  options: VideoExtendOptions
): Promise<{ videoId: string; jobId: string }> {
  const _ai = getAI();

  const parentVideo = getVideoById(db, options.videoId);
  if (!parentVideo) throw new Error("Parent video not found");
  if (parentVideo.status !== "completed") throw new Error("Parent video is not completed");

  const newVideoId = generateId();
  const jobId = generateId();

  db.prepare(
    `INSERT INTO videos (id, prompt, status, aspect_ratio, resolution, duration, parent_video_id, metadata)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`
  ).run(
    newVideoId, options.prompt, parentVideo.aspectRatio, parentVideo.resolution, options.duration, options.videoId,
    JSON.stringify({ model: "veo-3.1-generate-001", hasAudio: true, hasBranding: false, hasVoiceover: false } satisfies VideoMetadata)
  );

  db.prepare(`INSERT INTO jobs (id, video_id, type, status) VALUES (?, ?, 'extend', 'pending')`).run(jobId, newVideoId);

  // Start extension in background (simplified — full implementation would use image context)
  startVideoGeneration(db, newVideoId, jobId, {
    prompt: options.prompt,
    aspectRatio: parentVideo.aspectRatio as any,
    resolution: parentVideo.resolution as any,
    duration: options.duration,
    model: "veo-3.1-generate-001",
    includeAudio: true,
  });

  return { videoId: newVideoId, jobId };
}

// ---- Query helpers ----

export function getVideoById(db: Database, videoId: string): Video | null {
  const row = db.prepare(
    `SELECT id, prompt, status, aspect_ratio as aspectRatio, resolution,
            duration, file_path as filePath, thumbnail_path as thumbnailPath,
            created_at as createdAt, updated_at as updatedAt, error,
            parent_video_id as parentVideoId, metadata
     FROM videos WHERE id = ?`
  ).get(videoId) as any;

  if (!row) return null;
  return { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : undefined };
}

export function getVideos(
  db: Database, limit = 50, offset = 0
): { videos: Video[]; total: number } {
  const videos = (db.prepare(
    `SELECT id, prompt, status, aspect_ratio as aspectRatio, resolution,
            duration, file_path as filePath, thumbnail_path as thumbnailPath,
            created_at as createdAt, updated_at as updatedAt, error,
            parent_video_id as parentVideoId, metadata
     FROM videos ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset) as any[]).map((row) => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM videos`).get() as { count: number };

  return { videos, total: totalRow.count };
}

export function getJobProgress(
  db: Database, videoId: string
): { progress: number; status: string } | null {
  return db.prepare(
    `SELECT progress, status FROM jobs WHERE video_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(videoId) as { progress: number; status: string } | null;
}
