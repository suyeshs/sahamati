#!/usr/bin/env bun
/**
 * Evernote API helper script for Claude Code skill.
 * Uses the Evernote Thrift API via the evernote SDK.
 *
 * Usage: bun run evernote-api.ts <command> [args...]
 *
 * Environment:
 *   EVERNOTE_DEV_TOKEN - Evernote developer token
 *   EVERNOTE_NOTESTORE_URL - NoteStore URL (optional, auto-detected from token)
 *   EVERNOTE_SANDBOX - Set to "true" for sandbox environment
 */

import Evernote from "evernote";

const token = process.env.EVERNOTE_DEV_TOKEN;
if (!token) {
  console.error("Error: EVERNOTE_DEV_TOKEN environment variable is required");
  console.error("Get one at: https://www.evernote.com/api/DeveloperToken.action");
  process.exit(1);
}

const sandbox = process.env.EVERNOTE_SANDBOX === "true";

const client = new Evernote.Client({
  token,
  sandbox,
});

const noteStore = client.getNoteStore();

// --- Helpers ---

function toEnml(plainText: string): string {
  // Escape XML entities and convert newlines to <br/>
  const escaped = plainText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">',
    `<en-note>${escaped}</en-note>`,
  ].join("");
}

function stripEnml(enml: string): string {
  // Simple ENML to plain text: strip tags, decode entities
  return enml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// --- Commands ---

async function listNotebooks() {
  const notebooks = await noteStore.listNotebooks();
  console.log(`Found ${notebooks.length} notebooks:\n`);
  for (const nb of notebooks) {
    console.log(`  [${nb.guid}] ${nb.name}${nb.stack ? ` (stack: ${nb.stack})` : ""}`);
  }
}

async function searchNotes(query: string) {
  const filter = new Evernote.NoteStore.NoteFilter({ words: query });
  const spec = new Evernote.NoteStore.NotesMetadataResultSpec({
    includeTitle: true,
    includeCreated: true,
    includeUpdated: true,
    includeNotebookGuid: true,
  });
  const results = await noteStore.findNotesMetadata(filter, 0, 50, spec);
  console.log(`Found ${results.totalNotes} notes (showing up to 50):\n`);
  for (const note of results.notes || []) {
    const created = note.created ? new Date(note.created).toISOString().split("T")[0] : "unknown";
    const updated = note.updated ? new Date(note.updated).toISOString().split("T")[0] : "unknown";
    console.log(`  [${note.guid}] ${note.title}`);
    console.log(`    Created: ${created} | Updated: ${updated} | Notebook: ${note.notebookGuid}`);
  }
}

async function getNote(guid: string) {
  const note = await noteStore.getNote(guid, true, false, false, false);
  console.log(`Title: ${note.title}`);
  console.log(`GUID: ${note.guid}`);
  console.log(`Created: ${note.created ? new Date(note.created).toISOString() : "unknown"}`);
  console.log(`Updated: ${note.updated ? new Date(note.updated).toISOString() : "unknown"}`);
  console.log(`Notebook: ${note.notebookGuid}`);
  console.log(`\n--- Content ---\n`);
  console.log(stripEnml(note.content || ""));
}

async function createNote(title: string, notebookGuid: string, content: string) {
  const note = new Evernote.Types.Note();
  note.title = title;
  note.notebookGuid = notebookGuid || undefined;
  note.content = toEnml(content);

  const created = await noteStore.createNote(note);
  console.log(`Note created successfully!`);
  console.log(`  GUID: ${created.guid}`);
  console.log(`  Title: ${created.title}`);
}

async function updateNote(guid: string, title: string, content: string) {
  const note = new Evernote.Types.Note();
  note.guid = guid;
  note.title = title;
  note.content = toEnml(content);

  const updated = await noteStore.updateNote(note);
  console.log(`Note updated successfully!`);
  console.log(`  GUID: ${updated.guid}`);
  console.log(`  Title: ${updated.title}`);
}

// --- CLI Router ---

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "list-notebooks":
      await listNotebooks();
      break;

    case "search":
      if (args.length === 0) {
        console.error("Usage: evernote-api.ts search <query>");
        process.exit(1);
      }
      await searchNotes(args.join(" "));
      break;

    case "get-note":
      if (!args[0]) {
        console.error("Usage: evernote-api.ts get-note <guid>");
        process.exit(1);
      }
      await getNote(args[0]);
      break;

    case "create-note":
      if (args.length < 3) {
        console.error("Usage: evernote-api.ts create-note <title> <notebook-guid> <content>");
        process.exit(1);
      }
      await createNote(args[0], args[1], args.slice(2).join(" "));
      break;

    case "update-note":
      if (args.length < 3) {
        console.error("Usage: evernote-api.ts update-note <guid> <title> <content>");
        process.exit(1);
      }
      await updateNote(args[0], args[1], args.slice(2).join(" "));
      break;

    default:
      console.error("Evernote API Helper");
      console.error("");
      console.error("Commands:");
      console.error("  list-notebooks              List all notebooks");
      console.error("  search <query>              Search notes");
      console.error("  get-note <guid>             Get note content");
      console.error("  create-note <t> <nb> <c>    Create a note");
      console.error("  update-note <g> <t> <c>     Update a note");
      process.exit(1);
  }
} catch (err: any) {
  console.error(`Evernote API error: ${err.message || err}`);
  if (err.rateLimitDuration) {
    console.error(`Rate limited. Retry after ${err.rateLimitDuration} seconds.`);
  }
  process.exit(1);
}
