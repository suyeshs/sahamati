// Prompt Enhancement Service — ported from sahamati-video
// Optimizes prompts for Veo 3.1 using Google's best practices

import type { CharacterProfile } from "../types/video.js";

const DEFAULT_NEGATIVE_PROMPTS = [
  "text", "writing", "letters", "words", "signs with text",
  "subtitles", "captions", "watermarks", "logos",
  "blurry", "distorted", "low quality", "pixelated", "grainy",
  "oversaturated", "underexposed", "overexposed",
];

const CINEMATOGRAPHY_TERMS = [
  "shot", "close-up", "closeup", "medium", "wide", "establishing",
  "tracking", "dolly", "pan", "tilt", "crane", "aerial", "handheld",
  "static", "pov", "point of view", "bird's eye", "low angle",
  "high angle", "eye level",
];

const STYLE_TERMS = [
  "lighting", "lit", "cinematic", "documentary", "dramatic", "soft",
  "warm", "cool", "golden hour", "natural light", "ambient", "mood",
  "atmosphere", "aesthetic",
];

export interface PromptEnhancementOptions {
  characterProfile?: CharacterProfile;
  customNegativePrompts?: string[];
  indianContext?: boolean;
}

export interface EnhancedPrompt {
  prompt: string;
  negativePrompt: string;
  metadata: {
    originalLength: number;
    enhancedLength: number;
    enhancements: string[];
  };
}

function hasCinematographyTerms(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  return CINEMATOGRAPHY_TERMS.some((term) => lowerPrompt.includes(term));
}

function hasStyleTerms(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  return STYLE_TERMS.some((term) => lowerPrompt.includes(term));
}

function addDefaultCinematography(prompt: string): string {
  return `Medium shot, ${prompt}`;
}

function addDefaultStyle(prompt: string, indianContext: boolean = true): string {
  const styleAddition = indianContext
    ? "Warm natural lighting, cinematic quality, authentic Indian setting."
    : "Natural lighting, cinematic quality.";
  return `${prompt} ${styleAddition}`;
}

export function buildIdentityAnchor(profile: CharacterProfile): string {
  const parts: string[] = [];

  if (profile.ageRange && profile.gender) {
    parts.push(`a ${profile.ageRange} ${profile.gender}`);
  } else if (profile.ageRange) {
    parts.push(`a ${profile.ageRange} person`);
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

function injectCharacterIntoPrompt(prompt: string, profile: CharacterProfile): string {
  const identityAnchor = buildIdentityAnchor(profile);
  if (!identityAnchor) return prompt;

  const subjectPatterns = [
    /\ba person\b/gi, /\ba man\b/gi, /\ba woman\b/gi,
    /\bsomeone\b/gi, /\bthe protagonist\b/gi, /\bthe character\b/gi,
  ];

  for (const pattern of subjectPatterns) {
    if (pattern.test(prompt)) {
      return prompt.replace(pattern, identityAnchor);
    }
  }

  if (hasCinematographyTerms(prompt)) {
    const commaIndex = prompt.indexOf(",");
    if (commaIndex !== -1 && commaIndex < 30) {
      const cinematography = prompt.slice(0, commaIndex + 1);
      const rest = prompt.slice(commaIndex + 1).trim();
      return `${cinematography} ${identityAnchor}, ${rest}`;
    }
  }

  return `${identityAnchor}, ${prompt}`;
}

export function buildNegativePrompt(customPrompts?: string[]): string {
  const allNegatives = [...DEFAULT_NEGATIVE_PROMPTS];
  if (customPrompts && customPrompts.length > 0) {
    allNegatives.push(...customPrompts);
  }
  const unique = [...new Set(allNegatives)];
  return unique.join(", ");
}

export function enhancePrompt(
  originalPrompt: string,
  options: PromptEnhancementOptions = {}
): EnhancedPrompt {
  const enhancements: string[] = [];
  let prompt = originalPrompt.trim();

  if (options.characterProfile) {
    const beforeLength = prompt.length;
    prompt = injectCharacterIntoPrompt(prompt, options.characterProfile);
    if (prompt.length !== beforeLength) enhancements.push("character_identity");
  }

  if (!hasCinematographyTerms(prompt)) {
    prompt = addDefaultCinematography(prompt);
    enhancements.push("cinematography");
  }

  if (!hasStyleTerms(prompt)) {
    prompt = addDefaultStyle(prompt, options.indianContext ?? true);
    enhancements.push("style_lighting");
  }

  const negativePrompt = buildNegativePrompt(options.customNegativePrompts);

  return {
    prompt,
    negativePrompt,
    metadata: {
      originalLength: originalPrompt.length,
      enhancedLength: prompt.length,
      enhancements,
    },
  };
}
