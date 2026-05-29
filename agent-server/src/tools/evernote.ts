import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  listNotebooks,
  searchNotes,
  getNote,
  createNote,
  updateNote,
} from "./evernote-client.js";

function asJson(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export const evernoteMcpServer = createSdkMcpServer({
  name: "evernote",
  version: "1.0.0",
  tools: [
    tool(
      "list_notebooks",
      "List Evernote notebooks for the configured user. Returns guid, name, stack, and noteCount for each.",
      {},
      async () => asJson(await listNotebooks()),
    ),
    tool(
      "search",
      "Search Evernote notes by query. Supports Evernote search grammar (notebook:\"X\", tag:Y, intitle:Z, created:YYYYMMDD, updated:YYYYMMDD, any:). Returns up to 50 note metadata records.",
      { query: z.string().min(1).describe("Evernote search query") },
      async ({ query }) => asJson(await searchNotes(query)),
    ),
    tool(
      "get_note",
      "Read a single Evernote note by GUID. Returns metadata and plain-text content.",
      { guid: z.string().describe("Note GUID returned by search or create_note") },
      async ({ guid }) => asJson(await getNote(guid)),
    ),
    tool(
      "create_note",
      "Create a new Evernote note. If notebook_guid is omitted, the note is placed in the user's default notebook.",
      {
        title: z.string().min(1),
        content: z.string().describe("Plain-text content; newlines preserved."),
        notebook_guid: z.string().optional().describe("Target notebook GUID; omit for default notebook."),
      },
      async ({ title, content, notebook_guid }) =>
        asJson(await createNote(title, content, notebook_guid)),
    ),
    tool(
      "update_note",
      "Update an existing Evernote note's title and/or content. Provide at least one of title or content.",
      {
        guid: z.string(),
        title: z.string().optional(),
        content: z.string().optional().describe("Plain-text content; replaces existing content."),
      },
      async ({ guid, title, content }) =>
        asJson(await updateNote(guid, { title, content })),
    ),
  ],
});
