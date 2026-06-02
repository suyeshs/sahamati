// Generation logger — adapted from sahamati-video for better-sqlite3

import type { Database } from "better-sqlite3-multiple-ciphers";

export type LogLevel = "info" | "thinking" | "action" | "success" | "error" | "warning";

export type GenerationStage =
  | "initializing"
  | "analyzing_prompt"
  | "preparing_request"
  | "calling_api"
  | "polling_status"
  | "processing_video"
  | "downloading"
  | "concatenating"
  | "applying_branding"
  | "generating_thumbnail"
  | "finalizing"
  | "completed"
  | "failed";

export interface GenerationLog {
  id: number;
  videoId: string;
  timestamp: string;
  level: LogLevel;
  stage: GenerationStage;
  message: string;
  details?: string;
}

export class GenerationLogger {
  private db: Database;
  private videoId: string;

  constructor(db: Database, videoId: string) {
    this.db = db;
    this.videoId = videoId;
  }

  private log(level: LogLevel, stage: GenerationStage, message: string, details?: Record<string, unknown>) {
    const detailsJson = details ? JSON.stringify(details) : null;

    this.db.prepare(
      `INSERT INTO generation_logs (video_id, level, stage, message, details)
       VALUES (?, ?, ?, ?, ?)`
    ).run(this.videoId, level, stage, message, detailsJson);

    const emoji = this.getEmoji(level);
    console.log(`${emoji} [${this.videoId.slice(0, 8)}] ${message}`);
  }

  private getEmoji(level: LogLevel): string {
    switch (level) {
      case "thinking": return "?";
      case "action": return "!";
      case "success": return "+";
      case "error": return "x";
      case "warning": return "!";
      default: return "i";
    }
  }

  thinking(stage: GenerationStage, message: string, details?: Record<string, unknown>) {
    this.log("thinking", stage, message, details);
  }

  action(stage: GenerationStage, message: string, details?: Record<string, unknown>) {
    this.log("action", stage, message, details);
  }

  info(stage: GenerationStage, message: string, details?: Record<string, unknown>) {
    this.log("info", stage, message, details);
  }

  success(stage: GenerationStage, message: string, details?: Record<string, unknown>) {
    this.log("success", stage, message, details);
  }

  error(stage: GenerationStage, message: string, details?: Record<string, unknown>) {
    this.log("error", stage, message, details);
  }

  warning(stage: GenerationStage, message: string, details?: Record<string, unknown>) {
    this.log("warning", stage, message, details);
  }
}

export function getGenerationLogs(db: Database, videoId: string, since?: number): GenerationLog[] {
  if (since) {
    return db.prepare(
      `SELECT * FROM generation_logs WHERE video_id = ? AND id > ? ORDER BY id ASC`
    ).all(videoId, since) as GenerationLog[];
  }
  return db.prepare(
    `SELECT * FROM generation_logs WHERE video_id = ? ORDER BY id ASC`
  ).all(videoId) as GenerationLog[];
}
