/**
 * Evernote API operations used by the Evernote MCP server (and, optionally, a
 * direct CLI for manual testing).
 *
 * Environment:
 *   EVERNOTE_DEV_TOKEN  — Developer token (required when any operation runs)
 *   EVERNOTE_SANDBOX    — "true" for sandbox environment (optional)
 *
 * Client init is lazy — importing this module is side-effect free. The token
 * is only required when an operation actually runs, so the agent-server can
 * import this module on startup without crashing when Evernote isn't configured.
 */

import Evernote from "evernote";
import { parseArgs } from "util";

let _noteStore: any = null;

function getNoteStore(): any {
  if (_noteStore) return _noteStore;
  const token = process.env.EVERNOTE_DEV_TOKEN;
  if (!token) {
    throw new Error(
      "EVERNOTE_DEV_TOKEN is required. Get one at https://www.evernote.com/api/DeveloperToken.action",
    );
  }
  const client = new Evernote.Client({
    token,
    sandbox: process.env.EVERNOTE_SANDBOX === "true",
  });
  _noteStore = client.getNoteStore();
  return _noteStore;
}

function textToEnml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${escaped}</en-note>`;
}

function enmlToText(enml: string): string {
  return enml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<en-todo[^>]*checked="true"[^>]*\/>/gi, "[x] ")
    .replace(/<en-todo[^>]*\/>/gi, "[ ] ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function formatDate(ts?: number | null): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "—";
}

export interface NotebookSummary {
  guid: string;
  name: string;
  stack: string | null;
  noteCount: number | null;
}

export interface NoteMetadata {
  guid: string;
  title: string;
  created: string;
  updated: string;
  notebookGuid: string;
  tagGuids: string[];
}

export interface NoteSearchResult {
  totalNotes: number;
  notes: NoteMetadata[];
}

export interface NoteContent extends NoteMetadata {
  content: string;
}

export interface NoteMutationResult {
  guid: string;
  title: string;
  status: "created" | "updated";
}

export async function listNotebooks(): Promise<NotebookSummary[]> {
  const noteStore = getNoteStore();
  const notebooks = await noteStore.listNotebooks();
  return notebooks.map((nb: any) => ({
    guid: nb.guid,
    name: nb.name,
    stack: nb.stack || null,
    noteCount: nb.noteCount ?? null,
  }));
}

export async function searchNotes(words: string): Promise<NoteSearchResult> {
  const noteStore = getNoteStore();
  const filter = new Evernote.NoteStore.NoteFilter({ words });
  const spec = new Evernote.NoteStore.NotesMetadataResultSpec({
    includeTitle: true,
    includeCreated: true,
    includeUpdated: true,
    includeNotebookGuid: true,
    includeTagGuids: true,
  });
  const result = await noteStore.findNotesMetadata(filter, 0, 50, spec);
  const notes: NoteMetadata[] = (result.notes || []).map((n: any) => ({
    guid: n.guid,
    title: n.title,
    created: formatDate(n.created),
    updated: formatDate(n.updated),
    notebookGuid: n.notebookGuid,
    tagGuids: n.tagGuids || [],
  }));
  return { totalNotes: result.totalNotes, notes };
}

export async function getNote(guid: string): Promise<NoteContent> {
  const noteStore = getNoteStore();
  const note = await noteStore.getNote(guid, true, false, false, false);
  return {
    guid: note.guid,
    title: note.title,
    created: formatDate(note.created),
    updated: formatDate(note.updated),
    notebookGuid: note.notebookGuid,
    tagGuids: note.tagGuids || [],
    content: enmlToText(note.content || ""),
  };
}

export async function createNote(
  title: string,
  content: string,
  notebookGuid?: string,
): Promise<NoteMutationResult> {
  const noteStore = getNoteStore();
  const note = new Evernote.Types.Note();
  note.title = title;
  if (notebookGuid) note.notebookGuid = notebookGuid;
  note.content = textToEnml(content);
  const created = await noteStore.createNote(note);
  return { guid: created.guid, title: created.title, status: "created" };
}

export async function updateNote(
  guid: string,
  updates: { title?: string; content?: string },
): Promise<NoteMutationResult> {
  const noteStore = getNoteStore();
  const note = new Evernote.Types.Note();
  note.guid = guid;
  if (updates.title) note.title = updates.title;
  if (updates.content) note.content = textToEnml(updates.content);
  const updated = await noteStore.updateNote(note);
  return { guid: updated.guid, title: updated.title, status: "updated" };
}

// --- CLI entrypoint (only runs when invoked directly: `bun run evernote-client.ts ...`) ---
// Use import.meta.main rather than comparing import.meta.url to argv[1]:
// the latter misfires inside a Bun --compile binary (every bundled module's
// import.meta.url collapses to the binary path), which would make this CLI
// hijack the agent-server startup. import.meta.main is true only for the
// real entrypoint (src/index.ts in the server build).

const invokedDirectly = typeof process !== "undefined" && import.meta.main === true;

if (invokedDirectly) {
  const command = process.argv[2];
  const rest = process.argv.slice(3);

  try {
    switch (command) {
      case "list-notebooks":
        console.log(JSON.stringify(await listNotebooks(), null, 2));
        break;

      case "search":
        if (!rest.length) throw new Error("Usage: search <query>");
        console.log(JSON.stringify(await searchNotes(rest.join(" ")), null, 2));
        break;

      case "get-note":
        if (!rest[0]) throw new Error("Usage: get-note <guid>");
        console.log(JSON.stringify(await getNote(rest[0]), null, 2));
        break;

      case "create-note": {
        const { values } = parseArgs({
          args: rest,
          options: {
            title: { type: "string" },
            notebook: { type: "string" },
            content: { type: "string" },
          },
        });
        if (!values.title || !values.content) throw new Error("--title and --content are required");
        console.log(JSON.stringify(await createNote(values.title, values.content, values.notebook)));
        break;
      }

      case "update-note": {
        const { values } = parseArgs({
          args: rest,
          options: {
            guid: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
          },
        });
        if (!values.guid) throw new Error("--guid is required");
        console.log(
          JSON.stringify(await updateNote(values.guid, { title: values.title, content: values.content })),
        );
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error("Commands: list-notebooks, search, get-note, create-note, update-note");
        process.exit(1);
    }
  } catch (err: any) {
    console.error(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}
