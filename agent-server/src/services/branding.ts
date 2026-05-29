// Branding & FFmpeg service — adapted from sahamati-video for Node.js

import { spawn } from "child_process";
import { writeFileSync, renameSync, existsSync, readFileSync } from "fs";
import type { BrandingOptions, TransitionConfig, TransitionType } from "../types/video.js";
import { getVideoFilePath, getFfmpegPath, getFfprobePath } from "./video-files.js";

// CPU encoding (GPU detection not needed in Tauri desktop context)
function getEncoderArgs(): string[] {
  return ["-c:v", "libx264", "-preset", "medium", "-crf", "23"];
}

function runFfmpeg(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const ffmpeg = getFfmpegPath();
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stderr });
    });
  });
}

export async function applyBranding(
  videoId: string,
  options: BrandingOptions
): Promise<string> {
  const inputPath = getVideoFilePath(videoId);
  const outputPath = getVideoFilePath(`${videoId}_branded`);

  const ffmpegArgs: string[] = ["-i", inputPath];
  const filters: string[] = [];
  let inputCount = 1;

  if (options.logoPath) {
    ffmpegArgs.push("-i", options.logoPath);
    const scale = options.logoScale || 0.15;
    const position = getLogoPosition(options.logoPosition || "bottom-right");
    filters.push(
      `[1:v]scale=iw*${scale}:ih*${scale}[logo]`,
      `[0:v][logo]overlay=${position}[vout]`
    );
    inputCount++;
  }

  if (options.backgroundMusicPath) {
    ffmpegArgs.push("-i", options.backgroundMusicPath);
    const volume = options.backgroundMusicVolume || 0.3;
    filters.push(
      `[0:a]volume=1[orig]`,
      `[${inputCount}:a]volume=${volume}[music]`,
      `[orig][music]amix=inputs=2:duration=first[aout]`
    );
  }

  if (filters.length > 0) {
    ffmpegArgs.push("-filter_complex", filters.join(";"));
    if (options.logoPath) ffmpegArgs.push("-map", "[vout]");
    else ffmpegArgs.push("-map", "0:v");
    if (options.backgroundMusicPath) ffmpegArgs.push("-map", "[aout]");
    else ffmpegArgs.push("-map", "0:a?");
  }

  ffmpegArgs.push(...getEncoderArgs(), "-c:a", "aac", "-b:a", "192k", "-y", outputPath);

  console.log(`Applying branding to video ${videoId}...`);
  const { exitCode, stderr } = await runFfmpeg(ffmpegArgs);

  if (exitCode !== 0) {
    throw new Error(`FFmpeg failed: ${stderr}`);
  }

  console.log(`Branding applied successfully: ${outputPath}`);
  return outputPath;
}

function getLogoPosition(position: "top-left" | "top-right" | "bottom-left" | "bottom-right"): string {
  const padding = 20;
  switch (position) {
    case "top-left": return `${padding}:${padding}`;
    case "top-right": return `W-w-${padding}:${padding}`;
    case "bottom-left": return `${padding}:H-h-${padding}`;
    case "bottom-right":
    default: return `W-w-${padding}:H-h-${padding}`;
  }
}

export async function concatenateVideos(videoIds: string[], outputId: string): Promise<string> {
  const outputPath = getVideoFilePath(outputId);
  const concatList = videoIds.map((id) => `file '${getVideoFilePath(id)}'`).join("\n");
  const concatFile = `/tmp/concat_${outputId}.txt`;
  writeFileSync(concatFile, concatList);

  const { exitCode, stderr } = await runFfmpeg([
    "-f", "concat", "-safe", "0", "-i", concatFile,
    "-c", "copy", "-y", outputPath,
  ]);

  if (exitCode !== 0) {
    throw new Error(`FFmpeg concat failed: ${stderr}`);
  }

  console.log(`Videos concatenated successfully: ${outputPath}`);
  return outputPath;
}

function getXfadeTransition(type: TransitionType): string {
  switch (type) {
    case "crossfade":
    case "dissolve": return "fade";
    case "fade-black": return "fadeblack";
    case "wipe-left": return "wipeleft";
    case "wipe-right": return "wiperight";
    case "cut":
    default: return "";
  }
}

export async function concatenateVideosWithTransitions(
  videoIds: string[],
  outputId: string,
  transition: TransitionConfig = { type: "crossfade", duration: 0.5 }
): Promise<string> {
  if (videoIds.length === 0) throw new Error("No videos to concatenate");

  if (videoIds.length === 1) {
    const inputPath = getVideoFilePath(videoIds[0]);
    const outputPath = getVideoFilePath(outputId);
    const { copyFileSync } = await import("fs");
    copyFileSync(inputPath, outputPath);
    return outputPath;
  }

  if (transition.type === "cut") {
    return concatenateVideos(videoIds, outputId);
  }

  const outputPath = getVideoFilePath(outputId);
  const transitionName = getXfadeTransition(transition.type);
  const transitionDuration = Math.max(0.3, Math.min(2.0, transition.duration));

  const videoPaths = videoIds.map((id) => getVideoFilePath(id));
  const durations: number[] = [];

  for (const path of videoPaths) {
    const duration = await getVideoDuration(path);
    durations.push(duration);
  }

  const ffmpegArgs: string[] = [];
  for (const path of videoPaths) ffmpegArgs.push("-i", path);

  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  let cumulativeOffset = 0;
  let lastVideoLabel = "[0:v]";
  let lastAudioLabel = "[0:a]";

  for (let i = 1; i < videoIds.length; i++) {
    const offset = cumulativeOffset + durations[i - 1] - transitionDuration;
    const nextVideoLabel = `[${i}:v]`;
    const nextAudioLabel = `[${i}:a]`;
    const outVideoLabel = i === videoIds.length - 1 ? "[outv]" : `[v${i}]`;
    const outAudioLabel = i === videoIds.length - 1 ? "[outa]" : `[a${i}]`;

    videoFilters.push(
      `${lastVideoLabel}${nextVideoLabel}xfade=transition=${transitionName}:duration=${transitionDuration}:offset=${offset.toFixed(3)}${outVideoLabel}`
    );
    audioFilters.push(
      `${lastAudioLabel}${nextAudioLabel}acrossfade=d=${transitionDuration}:c1=tri:c2=tri${outAudioLabel}`
    );

    lastVideoLabel = outVideoLabel;
    lastAudioLabel = outAudioLabel;
    cumulativeOffset = offset;
  }

  const filterComplex = [...videoFilters, ...audioFilters].join(";");
  ffmpegArgs.push("-filter_complex", filterComplex);
  ffmpegArgs.push("-map", "[outv]", "-map", "[outa]");
  ffmpegArgs.push(...getEncoderArgs(), "-c:a", "aac", "-b:a", "192k", "-y", outputPath);

  const { exitCode, stderr } = await runFfmpeg(ffmpegArgs);

  if (exitCode !== 0) {
    console.error("FFmpeg transition failed, falling back to simple concat:", stderr);
    return concatenateVideos(videoIds, outputId);
  }

  console.log(`Videos concatenated with transitions: ${outputPath}`);
  return outputPath;
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = getFfprobePath();
    const proc = spawn(ffprobe, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
    ]);
    let output = "";
    proc.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    proc.on("close", () => {
      const duration = parseFloat(output.trim());
      resolve(isNaN(duration) ? 8 : duration);
    });
  });
}
