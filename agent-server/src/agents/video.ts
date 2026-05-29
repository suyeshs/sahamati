import { readPrompt } from "./read-prompt.js";

const prompt = readPrompt("video.md");

export const videoAgent = {
  description: "Generates marketing videos for the Sahamati Account Aggregator ecosystem using Veo 3.1",
  prompt,
  tools: ["Read", "Write", "Glob", "Bash", "WebSearch"] as string[],
  model: "sonnet" as const,
  maxTurns: 30,
};
