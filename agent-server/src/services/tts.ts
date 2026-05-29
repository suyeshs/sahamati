// Google Cloud Text-to-Speech service — adapted from sahamati-video for Node.js

import { writeFileSync } from "fs";
import { spawn } from "child_process";
import type { TTSOptions } from "../types/video.js";
import { getFfmpegPath } from "./video-files.js";

const GOOGLE_TTS_KEY = process.env.GOOGLE_CLOUD_TTS_KEY;

export async function generateSpeech(
  options: TTSOptions,
  outputPath: string
): Promise<string> {
  if (!GOOGLE_TTS_KEY) {
    throw new Error("Google Cloud TTS API key not configured");
  }

  const requestBody = {
    input: { text: options.text },
    voice: {
      languageCode: "en-IN",
      name: options.voice || "en-IN-Wavenet-D",
      ssmlGender: "NEUTRAL",
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: options.speed || 1.0,
      pitch: options.pitch || 0,
    },
  };

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`TTS API error: ${error}`);
  }

  const data = (await response.json()) as { audioContent: string };
  const audioBuffer = Buffer.from(data.audioContent, "base64");
  writeFileSync(outputPath, audioBuffer);

  console.log(`TTS audio saved to ${outputPath}`);
  return outputPath;
}

export async function addVoiceoverToVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  options: { duckOriginalAudio?: boolean; voiceoverVolume?: number } = {}
): Promise<string> {
  const voiceoverVolume = options.voiceoverVolume || 1.0;
  const duckVolume = options.duckOriginalAudio ? 0.3 : 1.0;
  const ffmpeg = getFfmpegPath();

  const ffmpegArgs = [
    "-i", videoPath,
    "-i", audioPath,
    "-filter_complex",
    `[0:a]volume=${duckVolume}[orig];[1:a]volume=${voiceoverVolume}[vo];[orig][vo]amix=inputs=2:duration=first[aout]`,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-y", outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`FFmpeg voiceover failed: ${stderr}`));
      else resolve(outputPath);
    });
  });
}
