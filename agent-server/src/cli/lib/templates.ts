// Template bodies are inlined by scripts/embed-assets.mjs (see embedded.ts)
// so they work identically in the Node-built server and the Bun-compiled
// CLI binary. Source of truth: src/cli/templates/*.md.
import { TEMPLATES } from "./embedded.js";

export type DocType = "brd" | "intent" | "architecture" | "security" | "story";

export const DOC_TYPES: DocType[] = ["brd", "intent", "architecture", "security", "story"];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  brd: "Business Requirements Document",
  intent: "Intent Document",
  architecture: "Architecture Document",
  security: "Security Assessment",
  story: "User Story",
};

export function isDocType(s: string): s is DocType {
  return (DOC_TYPES as string[]).includes(s);
}

export function loadTemplate(type: DocType): string {
  return TEMPLATES[type];
}
