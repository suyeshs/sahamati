---
name: evernote
description: Search, read, create, and update Evernote notes using a developer token. Use when the user wants to interact with their Evernote account.
user-invocable: true
allowed-tools: Bash, Read, Write
---

# Evernote Integration

You have access to Evernote via the helper script at `${CLAUDE_SKILL_DIR}/evernote-api.ts`.

## Environment

The Evernote developer token must be set as `EVERNOTE_DEV_TOKEN` in the environment.
The Evernote notestore URL must be set as `EVERNOTE_NOTESTORE_URL` (e.g., `https://www.evernote.com/shard/s1/notestore`).

## Available Operations

Run the helper script with Bash using `bun run`:

```bash
bun run ${CLAUDE_SKILL_DIR}/evernote-api.ts <command> [args...]
```

### Commands

- `list-notebooks` — List all notebooks
- `search <query>` — Search notes using Evernote search grammar (supports `notebook:`, `tag:`, `intitle:`, `created:` operators)
- `get-note <guid>` — Get full note content by GUID
- `create-note <title> <notebook-guid> <content>` — Create a new note (content in plain text, will be wrapped in ENML)
- `update-note <guid> <title> <content>` — Update an existing note

### Arguments

If the user says: `/evernote search meeting notes from last week`
Then $ARGUMENTS = `search meeting notes from last week`

Parse $ARGUMENTS to determine the command and pass it to the script.

## Important Notes

- Note content is in ENML (Evernote Markup Language), a subset of XHTML
- When creating/updating notes, convert user's plain text or markdown to simple ENML
- Search supports Evernote search grammar: `notebook:Work tag:important created:20260101`
- Always show note titles and GUIDs so the user can reference them later
