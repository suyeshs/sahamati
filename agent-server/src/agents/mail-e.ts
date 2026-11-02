import { readPrompt } from "./read-prompt.js";
import { gmailMcpServer, gmailCliMcpServers } from "../tools/gmail.js";

const prompt = readPrompt("mail-e.md");

export const mailEAgent = {
  description:
    "Triage the user's incoming Gmail — classify messages as directly addressed, mentioning the user, cc/FYI, or list/broadcast, and surface the ones that need action. Read-only.",
  prompt,
  // Gmail tools only — no Write/Bash. Mailbox content is personal data and
  // must not leave the chat response (see the privacy rules in the prompt).
  tools: [
    "mcp__gmail__get_profile",
    "mcp__gmail__search_messages",
    "mcp__gmail__get_message",
  ] as string[],
  mcpServers: { gmail: gmailMcpServer },
  cliMcpServers: gmailCliMcpServers,
  model: "sonnet" as const,
  maxTurns: 25,
};
