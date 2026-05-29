// Video file path utilities

import { existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isBunBinary = __dirname.startsWith("/$bunfs");

function projectRoot(): string {
  return process.env.__SAHAMATI_ROOT || resolve(__dirname, "../../..");
}

const VIDEOS_PATH = resolve(projectRoot(), "data/videos");

export function ensureVideoDirectories(): void {
  const dirs = [VIDEOS_PATH, `${VIDEOS_PATH}/thumbnails`];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`Created video directory: ${dir}`);
    }
  }
}

export function getVideosPath(): string {
  return VIDEOS_PATH;
}

export function getVideoFilePath(videoId: string, extension = "mp4"): string {
  return `${VIDEOS_PATH}/${videoId}.${extension}`;
}

export function getThumbnailPath(videoId: string): string {
  return `${VIDEOS_PATH}/thumbnails/${videoId}.jpg`;
}

export function getFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (isBunBinary) {
    const sidecarPath = resolve(dirname(process.execPath), "ffmpeg");
    if (existsSync(sidecarPath)) return sidecarPath;
  }
  return "ffmpeg";
}

export function getFfprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  if (isBunBinary) {
    const sidecarPath = resolve(dirname(process.execPath), "ffprobe");
    if (existsSync(sidecarPath)) return sidecarPath;
  }
  return "ffprobe";
}
