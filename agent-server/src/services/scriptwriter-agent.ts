// Scriptwriter Agent Service — adapted from sahamati-video for Node.js
// Uses Gemini (via Vertex AI) to generate multi-scene scripts from plain-English briefs

import type { AspectRatio, VideoDuration, CharacterProfile } from "../types/video.js";
import { getGoogleAI } from "./google-ai-client.js";

const getGenAI = getGoogleAI;

export interface ScriptwriterAgentInput {
  brief: string;
  customizations?: {
    targetAudience?: string;
    tone?: string;
    specificRequirements?: string;
    aspectRatio?: AspectRatio;
    duration?: number;
  };
}

export interface DialogueSpec {
  speaker: string;
  text: string;
  emotion?: string;
}

export interface GeneratedScene {
  sceneNumber: number;
  description: string;
  duration: VideoDuration;
  dialogue?: DialogueSpec | null;
  cinematography: string;
  action: string;
  setting: string;
}

export interface VeoPrompt {
  sceneNumber: number;
  prompt: string;
  negativePrompt: string;
  duration: VideoDuration;
  audioNotes?: string;
}

export interface ScriptwriterAgentOutput {
  analysis: {
    briefSummary: string;
    suggestedImprovements: string[];
    selectedTemplate: string;
    selectedTemplateName: string;
    reasoning: string;
  };
  script: {
    title: string;
    characterProfile: CharacterProfile;
    scenes: GeneratedScene[];
    globalNegativePrompt: string;
    totalDuration: number;
  };
  veoPrompts: VeoPrompt[];
}

const SCRIPTWRITER_SYSTEM_PROMPT = `You are a professional video scriptwriter specializing in marketing videos for Sahamati, the Account Aggregator ecosystem in India.

Your task is to:
1. Analyze the user's brief and suggest improvements
2. Select the most appropriate video style
3. Generate a complete multi-scene script optimized for Google Veo 3.1 video generation

## OUTPUT FORMAT
You MUST respond with valid JSON matching this schema:

{
  "analysis": {
    "briefSummary": "string",
    "suggestedImprovements": ["array of suggestions"],
    "selectedTemplate": "string - template ID",
    "selectedTemplateName": "string",
    "reasoning": "string"
  },
  "script": {
    "title": "string",
    "characterProfile": {
      "id": "generated-id",
      "name": "string - Indian name",
      "description": "string",
      "gender": "male" or "female",
      "ageRange": "string like '28-35'",
      "ethnicity": "South Asian Indian",
      "clothing": "string",
      "hair": "string",
      "distinguishingFeatures": "string"
    },
    "scenes": [
      {
        "sceneNumber": 1,
        "description": "string",
        "duration": 8,
        "dialogue": { "speaker": "Name", "text": "6-12 words", "emotion": "happy" } or null,
        "cinematography": "string - shot type",
        "action": "string",
        "setting": "string"
      }
    ],
    "globalNegativePrompt": "text, writing, letters, subtitles, watermarks, blurry, distorted",
    "totalDuration": number
  },
  "veoPrompts": [
    {
      "sceneNumber": 1,
      "prompt": "string - [Cinematography], [Character], [Action], [Setting], [Lighting]",
      "negativePrompt": "text, writing, letters, subtitles, watermarks, blurry",
      "duration": 8,
      "audioNotes": "string"
    }
  ]
}

## VEO PROMPT FORMULA
Each prompt: [Cinematography], [Full Character Identity], [Action], [Setting/Context], [Lighting/Style]

## CRITICAL RULES
1. Include FULL character description in EVERY scene prompt (age, gender, ethnicity, clothing, hair)
2. Start with cinematography: "Close-up", "Medium shot", "Wide shot", "Establishing shot"
3. Dialogue: "Character says, 'Exact words.'" — keep to 6-12 words
4. Indian context: Indian names, clothing, settings
5. End each prompt with lighting/mood
6. NEVER include visible text in scenes
7. Each scene 5-8 seconds`;

export async function runScriptwriterAgent(
  input: ScriptwriterAgentInput
): Promise<ScriptwriterAgentOutput> {
  const ai = getGenAI();

  const userMessage = JSON.stringify({
    brief: input.brief,
    customizations: input.customizations,
  });

  console.log("[Scriptwriter Agent] Running with brief:", input.brief);

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-001",
    contents: [
      { role: "user", parts: [{ text: SCRIPTWRITER_SYSTEM_PROMPT + "\n\n" + userMessage }] },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  });

  const responseText = response.text ?? "";
  if (!responseText) throw new Error("Empty response from Gemini");
  const result: ScriptwriterAgentOutput = JSON.parse(responseText);

  if (!result.analysis || !result.script || !result.veoPrompts) {
    throw new Error("Invalid response structure from Gemini");
  }

  if (!result.script.characterProfile.id) {
    result.script.characterProfile.id = `char-${Date.now()}`;
  }

  console.log(
    `[Scriptwriter Agent] Generated: "${result.script.title}" with ${result.script.scenes.length} scenes`
  );

  return result;
}

export function convertToVideoRequest(output: ScriptwriterAgentOutput): {
  scenes: Array<{ id: string; prompt: string; duration: VideoDuration; negativePrompt: string }>;
  characterProfile: CharacterProfile;
} {
  return {
    scenes: output.veoPrompts.map((vp, index) => ({
      id: `scene-${index + 1}-${Date.now()}`,
      prompt: vp.prompt,
      duration: vp.duration,
      negativePrompt: vp.negativePrompt,
    })),
    characterProfile: output.script.characterProfile,
  };
}
