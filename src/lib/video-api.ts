// Video API client for the frontend

const AGENT_SERVER_URL =
  import.meta.env.VITE_AGENT_SERVER_URL ?? "http://localhost:3001";

// Types matching the server-side video types

export type AspectRatio = "16:9" | "9:16" | "1:1";
export type VideoResolution = "720p" | "1080p";
export type VideoStatus = "pending" | "processing" | "completed" | "failed";
export type ModelType =
  | "veo-3.1-generate-001"
  | "veo-3.1-fast-generate-001"
  | "veo-3.1-lite-generate-001";
export type VideoDuration = 4 | 5 | 6 | 7 | 8;
export type OutputPreset = "social-reel" | "youtube" | "tv-ad" | "web" | "custom";
export type TransitionType = "cut" | "crossfade" | "fade-black" | "dissolve" | "wipe-left" | "wipe-right";

export interface Video {
  id: string;
  prompt: string;
  status: VideoStatus;
  aspectRatio: AspectRatio;
  resolution: VideoResolution;
  duration: number;
  filePath?: string;
  thumbnailPath?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  parentVideoId?: string;
  metadata?: {
    model: ModelType;
    hasAudio: boolean;
    hasBranding: boolean;
    hasVoiceover: boolean;
    sceneCount?: number;
  };
}

export interface VideoScene {
  id: string;
  prompt: string;
  duration: VideoDuration;
  negativePrompt?: string;
}

export interface MarketingTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  promptTemplate: string;
  suggestedAspectRatio: AspectRatio;
  suggestedDuration: VideoDuration;
  variables: Array<{
    name: string;
    label: string;
    type: "text" | "select" | "number";
    required: boolean;
    placeholder?: string;
    options?: string[];
    defaultValue?: string | number;
  }>;
  isMultiScene?: boolean;
  scenes?: Array<{
    prompt: string;
    duration: VideoDuration;
    description: string;
  }>;
}

export interface CharacterProfile {
  id: string;
  name: string;
  description: string;
  gender?: string;
  ageRange?: string;
  ethnicity?: string;
  clothing?: string;
  hair?: string;
  distinguishingFeatures?: string;
}

export interface GenerationLog {
  id: number;
  videoId: string;
  timestamp: string;
  level: string;
  stage: string;
  message: string;
  details?: string;
}

// ---- Video API ----

export async function listVideos(limit = 50, offset = 0): Promise<{ videos: Video[]; total: number }> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/videos?limit=${limit}&offset=${offset}`);
  return res.json();
}

export async function getVideo(id: string): Promise<Video> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/videos/${id}`);
  const data = await res.json();
  return data.video;
}

export async function getVideoStatus(id: string): Promise<{
  video: Video;
  progress?: number;
  estimatedTimeRemaining?: number;
}> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/videos/${id}/status`);
  return res.json();
}

export async function getVideoLogs(id: string, since?: number): Promise<{
  logs: GenerationLog[];
  lastId: number;
}> {
  const url = since
    ? `${AGENT_SERVER_URL}/api/videos/${id}/logs?since=${since}`
    : `${AGENT_SERVER_URL}/api/videos/${id}/logs`;
  const res = await fetch(url);
  return res.json();
}

export function getVideoDownloadUrl(id: string): string {
  return `${AGENT_SERVER_URL}/api/videos/${id}/download`;
}

export function getVideoThumbnailUrl(id: string): string {
  return `${AGENT_SERVER_URL}/api/videos/${id}/thumbnail`;
}

export async function generateVideo(options: {
  prompt?: string;
  templateId?: string;
  templateVariables?: Record<string, string | number>;
  scenes?: VideoScene[];
  aspectRatio?: AspectRatio;
  resolution?: VideoResolution;
  duration?: VideoDuration;
  model?: ModelType;
  includeAudio?: boolean;
  outputPreset?: OutputPreset;
  transition?: { type: TransitionType; duration: number };
  characterId?: string;
}): Promise<{ videoId: string; status: string; message: string }> {
  const body: any = {
    prompt: options.prompt,
    templateId: options.templateId,
    templateVariables: options.templateVariables,
    scenes: options.scenes,
    outputPreset: options.outputPreset,
    transition: options.transition,
    characterId: options.characterId,
    options: {
      aspectRatio: options.aspectRatio || "16:9",
      resolution: options.resolution || "1080p",
      duration: options.duration || 8,
      model: options.model || "veo-3.1-generate-001",
      includeAudio: options.includeAudio ?? true,
    },
  };

  const res = await fetch(`${AGENT_SERVER_URL}/api/videos/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || "Video generation failed");
  }
  return res.json();
}

export async function extendVideo(id: string, prompt: string, duration: VideoDuration = 8): Promise<{
  videoId: string;
  status: string;
  message: string;
}> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/videos/${id}/extend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, duration }),
  });
  if (!res.ok) throw new Error("Failed to extend video");
  return res.json();
}

export async function deleteVideo(id: string): Promise<void> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/videos/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete video");
}

// ---- Templates API ----

export async function listTemplates(category?: string): Promise<MarketingTemplate[]> {
  const url = category
    ? `${AGENT_SERVER_URL}/api/templates?category=${encodeURIComponent(category)}`
    : `${AGENT_SERVER_URL}/api/templates`;
  const res = await fetch(url);
  const data = await res.json();
  return data.templates;
}

// ---- Scriptwriter API ----

export async function generateScript(brief: string, customizations?: any): Promise<any> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/scriptwriter/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief, customizations }),
  });
  if (!res.ok) throw new Error("Scriptwriter failed");
  const data = await res.json();
  return data.result;
}

// ---- Characters API ----

export async function listCharacters(): Promise<CharacterProfile[]> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/characters`);
  const data = await res.json();
  return data.characters;
}

export async function getCharacterPresets(): Promise<any[]> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/characters/presets`);
  const data = await res.json();
  return data.presets;
}

export async function createCharacterFromPreset(presetName: string): Promise<CharacterProfile> {
  const res = await fetch(`${AGENT_SERVER_URL}/api/characters/from-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presetName }),
  });
  if (!res.ok) throw new Error("Failed to create character");
  const data = await res.json();
  return data.character;
}
