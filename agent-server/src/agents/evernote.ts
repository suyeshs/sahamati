import { readPrompt } from "./read-prompt.js";
import { evernoteMcpServer } from "../tools/evernote.js";

const prompt = readPrompt("evernote.md");

export const evernoteAgent = {
  description:
    "Manages Evernote notes and notebooks — search, read, create, and update notes. Use when the user wants to interact with their Evernote knowledge base.",
  prompt,
  tools: [
    "Read",
    "Write",
    "Glob",
    "Grep",
    "mcp__evernote__list_notebooks",
    "mcp__evernote__search",
    "mcp__evernote__get_note",
    "mcp__evernote__create_note",
    "mcp__evernote__update_note",
  ] as string[],
  mcpServers: { evernote: evernoteMcpServer },
  model: "sonnet" as const,
  maxTurns: 20,
};
