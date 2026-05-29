// Video generation types — ported from sahamati-video/packages/shared/src/types.ts

export type AspectRatio = "16:9" | "9:16" | "1:1";
export type VideoResolution = "720p" | "1080p";
export type VideoStatus = "pending" | "processing" | "completed" | "failed";
export type ModelType =
  | "veo-3.1-generate-001"
  | "veo-3.1-fast-generate-001"
  | "veo-3.1-lite-generate-001";
export type VideoDuration = 4 | 5 | 6 | 7 | 8;

export interface VideoGenerationOptions {
  prompt: string;
  aspectRatio: AspectRatio;
  resolution: VideoResolution;
  duration: VideoDuration;
  model: ModelType;
  negativePrompt?: string;
  includeAudio?: boolean;
}

export interface VideoExtendOptions {
  videoId: string;
  prompt: string;
  duration: VideoDuration;
}

export interface VideoScene {
  id: string;
  prompt: string;
  duration: VideoDuration;
  negativePrompt?: string;
}

export type OutputPreset = "social-reel" | "youtube" | "tv-ad" | "web" | "custom";

export interface OutputPresetConfig {
  name: string;
  description: string;
  aspectRatio: AspectRatio;
  resolution: VideoResolution;
  maxDuration?: number;
}

export const OUTPUT_PRESETS: Record<OutputPreset, OutputPresetConfig> = {
  "social-reel": {
    name: "Social Media Reel",
    description: "9:16 vertical, optimized for Instagram/TikTok",
    aspectRatio: "9:16",
    resolution: "1080p",
    maxDuration: 60,
  },
  youtube: {
    name: "YouTube",
    description: "16:9 landscape, standard YouTube format",
    aspectRatio: "16:9",
    resolution: "1080p",
  },
  "tv-ad": {
    name: "TV Advertisement",
    description: "16:9 landscape, broadcast quality",
    aspectRatio: "16:9",
    resolution: "1080p",
    maxDuration: 30,
  },
  web: {
    name: "Website Banner",
    description: "16:9 landscape, web optimized",
    aspectRatio: "16:9",
    resolution: "1080p",
  },
  custom: {
    name: "Custom",
    description: "Choose your own settings",
    aspectRatio: "16:9",
    resolution: "1080p",
  },
};

export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
export type TransitionType = "cut" | "crossfade" | "fade-black" | "dissolve" | "wipe-left" | "wipe-right";

export interface TransitionConfig {
  type: TransitionType;
  duration: number;
}

export const DEFAULT_TRANSITION: TransitionConfig = {
  type: "crossfade",
  duration: 0.5,
};

export interface EnhancedBrandingOptions {
  addLogo?: boolean;
  logoPosition?: LogoPosition;
  logoScale?: number;
  logoOpacity?: number;
  watermarkText?: string;
}

export interface EnhancedVideoOptions {
  scenes: VideoScene[];
  model: ModelType;
  includeAudio?: boolean;
  outputPreset: OutputPreset;
  aspectRatio?: AspectRatio;
  resolution?: VideoResolution;
  musicTrackId?: string;
  musicVolume?: number;
  voiceover?: TTSOptions;
  branding?: EnhancedBrandingOptions;
  transition?: TransitionConfig;
  characterId?: string;
  character?: CharacterProfile;
}

export interface BrandingOptions {
  logoPath?: string;
  logoPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  logoScale?: number;
  backgroundMusicPath?: string;
  backgroundMusicVolume?: number;
}

export interface TTSOptions {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
}

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
  metadata?: VideoMetadata;
}

export interface VideoMetadata {
  model: ModelType;
  hasAudio: boolean;
  hasBranding: boolean;
  hasVoiceover: boolean;
  fileSize?: number;
  actualDuration?: number;
  sceneCount?: number;
}

// Marketing templates

export type TemplateCategory =
  | "aa-explainer"
  | "data-empowerment"
  | "financial-inclusion"
  | "msme-success"
  | "partner-showcase"
  | "multi-scene";

export interface MarketingTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  promptTemplate: string;
  suggestedAspectRatio: AspectRatio;
  suggestedDuration: VideoDuration;
  variables: TemplateVariable[];
  isMultiScene?: boolean;
  scenes?: SceneTemplate[];
}

export interface SceneTemplate {
  prompt: string;
  duration: VideoDuration;
  description: string;
}

export interface TemplateVariable {
  name: string;
  label: string;
  type: "text" | "select" | "number";
  required: boolean;
  placeholder?: string;
  options?: string[];
  defaultValue?: string | number;
}

// API request/response types

export interface GenerateVideoRequest {
  prompt: string;
  templateId?: string;
  templateVariables?: Record<string, string | number>;
  options: Omit<VideoGenerationOptions, "prompt">;
  branding?: BrandingOptions;
  voiceover?: TTSOptions;
  scenes?: VideoScene[];
  outputPreset?: OutputPreset;
  transition?: TransitionConfig;
  characterId?: string;
}

export interface GenerateVideoResponse {
  videoId: string;
  status: VideoStatus;
  message: string;
}

export interface VideoStatusResponse {
  video: Video;
  progress?: number;
  estimatedTimeRemaining?: number;
}

export interface ExtendVideoRequest {
  prompt: string;
  duration: VideoDuration;
}

// Character Profile types

export type CharacterGender = "male" | "female" | "non-binary";

export interface CharacterProfile {
  id: string;
  name: string;
  description: string;
  gender?: CharacterGender;
  ageRange?: string;
  ethnicity?: string;
  clothing?: string;
  hair?: string;
  distinguishingFeatures?: string;
  seriesId?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type CharacterPreset = Omit<CharacterProfile, "id" | "createdAt" | "updatedAt" | "seriesId" | "tags">;
export type CreateCharacterRequest = Omit<CharacterProfile, "id" | "createdAt" | "updatedAt">;
export type UpdateCharacterRequest = Partial<Omit<CharacterProfile, "id" | "createdAt" | "updatedAt">>;

export const PRESET_PERSONAS: CharacterPreset[] = [
  {
    name: "Young Professional",
    description: "A young Indian professional navigating modern financial services",
    gender: "male",
    ageRange: "28-35",
    ethnicity: "South Asian Indian",
    clothing: "smart casual shirt and trousers",
    hair: "short black hair, neatly styled",
    distinguishingFeatures: "confident posture, friendly expression",
  },
  {
    name: "Young Professional (Female)",
    description: "A young Indian professional woman embracing digital finance",
    gender: "female",
    ageRange: "25-32",
    ethnicity: "South Asian Indian",
    clothing: "professional kurti or western business casual",
    hair: "shoulder-length black hair",
    distinguishingFeatures: "warm smile, professional demeanor",
  },
  {
    name: "Small Business Owner",
    description: "An Indian MSME owner building their business",
    gender: "male",
    ageRange: "35-50",
    ethnicity: "South Asian Indian",
    clothing: "traditional kurta or business casual shirt",
    hair: "short black hair with some grey",
    distinguishingFeatures: "determined expression, hands showing work experience",
  },
  {
    name: "Small Business Owner (Female)",
    description: "An Indian woman entrepreneur running her business",
    gender: "female",
    ageRange: "30-45",
    ethnicity: "South Asian Indian",
    clothing: "colorful cotton saree or salwar kameez",
    hair: "black hair tied back or in a braid",
    distinguishingFeatures: "confident stance, busy hands",
  },
  {
    name: "Rural Farmer",
    description: "An Indian farmer from rural India",
    gender: "male",
    ageRange: "40-55",
    ethnicity: "South Asian Indian",
    clothing: "simple white kurta and dhoti",
    hair: "greying hair, weathered appearance",
    distinguishingFeatures: "sun-tanned skin, wise eyes, calloused hands",
  },
  {
    name: "Rural Woman",
    description: "An Indian woman from rural India",
    gender: "female",
    ageRange: "35-50",
    ethnicity: "South Asian Indian",
    clothing: "simple cotton saree with modest jewelry",
    hair: "black hair in a bun with some grey",
    distinguishingFeatures: "gentle expression, traditional bindi",
  },
  {
    name: "Tech Professional",
    description: "An Indian tech professional working in fintech",
    gender: "male",
    ageRange: "25-35",
    ethnicity: "South Asian Indian",
    clothing: "casual t-shirt or polo, modern style",
    hair: "short black hair, contemporary cut",
    distinguishingFeatures: "glasses, focused expression, laptop nearby",
  },
  {
    name: "Tech Professional (Female)",
    description: "An Indian woman in the technology sector",
    gender: "female",
    ageRange: "25-35",
    ethnicity: "South Asian Indian",
    clothing: "modern business casual, stylish",
    hair: "black hair, modern style",
    distinguishingFeatures: "confident smile, professional accessories",
  },
  {
    name: "Elderly Parent",
    description: "An elderly Indian parent learning about digital finance",
    gender: "male",
    ageRange: "60-70",
    ethnicity: "South Asian Indian",
    clothing: "traditional white kurta pajama",
    hair: "grey hair, balding slightly",
    distinguishingFeatures: "reading glasses, gentle expression, traditional",
  },
  {
    name: "Elderly Mother",
    description: "An elderly Indian mother adapting to modern technology",
    gender: "female",
    ageRange: "55-65",
    ethnicity: "South Asian Indian",
    clothing: "traditional saree in muted colors",
    hair: "grey hair in a bun",
    distinguishingFeatures: "warm maternal expression, traditional jewelry",
  },
];

// Video Series types
export interface VideoSeries {
  id: string;
  name: string;
  description: string;
  characterId?: string;
  totalVideos?: number;
  brandingDefaults?: EnhancedBrandingOptions;
  transitionDefaults?: TransitionConfig;
  createdAt?: string;
  updatedAt?: string;
}

export type CreateSeriesRequest = Omit<VideoSeries, "id" | "createdAt" | "updatedAt">;

// Video Settings Templates (used by scriptwriter agent)

export type VideoGoal =
  | "awareness"
  | "education"
  | "testimonial"
  | "product-demo"
  | "social-reel"
  | "explainer"
  | "announcement";

export type CinematographyStyle =
  | "cinematic"
  | "documentary"
  | "corporate"
  | "casual"
  | "dynamic"
  | "intimate";

export interface DefaultPersona {
  demographic: string;
  attire: string;
  setting: string;
}

export interface VideoSettingsTemplate {
  id: string;
  name: string;
  description: string;
  goal: VideoGoal;
  suggestedAspectRatio: AspectRatio;
  suggestedDuration: number;
  sceneDuration: number;
  cinematographyStyle: CinematographyStyle;
  colorPalette: string;
  defaultPersona: DefaultPersona;
  includeDialogue: boolean;
  musicStyle?: string;
  audioNotes?: string;
  styleKeywords: string[];
  lightingKeywords: string[];
  negativePrompts: string[];
  suggestedSceneCount: number;
  sceneStructure?: string[];
}

// Helper functions

export function buildCharacterIdentityAnchor(profile: CharacterProfile): string {
  const parts: string[] = [];

  if (profile.ageRange && profile.gender) {
    parts.push(`a ${profile.ageRange} year old ${profile.gender}`);
  } else if (profile.ageRange) {
    parts.push(`a ${profile.ageRange} year old person`);
  } else if (profile.gender) {
    parts.push(`a ${profile.gender}`);
  }

  if (profile.ethnicity) {
    if (parts.length > 0) {
      parts[0] = `${parts[0]} ${profile.ethnicity}`;
    } else {
      parts.push(`${profile.ethnicity} person`);
    }
  }

  if (profile.clothing) parts.push(`wearing ${profile.clothing}`);
  if (profile.hair) parts.push(`with ${profile.hair}`);
  if (profile.distinguishingFeatures) parts.push(profile.distinguishingFeatures);

  return parts.join(", ");
}

export function getPresetByName(name: string): CharacterPreset | undefined {
  return PRESET_PERSONAS.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
}
