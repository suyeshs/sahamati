# CLAUDE.md — Sahamati

Guidance for Claude (and any AI assistant) working in this repository. Shared across the Sahamati team — treat it as load-bearing.

---

## What this repo is

**Sahamati Development Process Framework** — a Tauri desktop application that helps teams generate, review, and maintain software-development-process artefacts (BRDs, FRDs, user stories, architecture docs, security assessments, runbooks) using Claude-driven agents.

It is not the SaaNs analytics platform itself. `BRD.md` in the root describes SaaNs v2 as a worked example of the kind of artefact this tool produces.

Two cooperating pieces:

1. **Desktop shell** — Tauri 2 + React 19 + TypeScript + Vite. UI for orchestrating agents, browsing generated docs, managing settings.
2. **Agent server** — Hono on Bun/Node, embedded as a Tauri sidecar binary. Runs Claude Agent SDK agents (`discovery`, `requirements`, `knowledge`, `process-docs`, `security`, `video`, `evernote`, `read-prompt`), exposes HTTP/SSE, persists to an encrypted SQLite database.

The agent server can also run standalone via the `sahamati` CLI for headless/cloud use.

---

## Organizational context (load-bearing)

Sahamati operates India's Account Aggregator (AA) ecosystem under RBI / ReBIT oversight. Anything this tool produces may be read by regulators, AAs, FIPs, or compliance officers. That shapes a few hard rules below — don't relax them without an explicit team decision.

- Treat consent artefacts, FI payloads, and AA↔FIP traffic as regulated data. Never embed real samples in code, fixtures, prompts, logs, or generated docs. Use synthetic data.
- DPDP Act applies. PII does not belong in prompts, logs, or git history.
- External-facing artefacts (regulators, AAs, FIPs) have a higher review bar than internal ones — flag when generated output is destined for an external audience.

---

## Hard rules

These override convenience. Don't bypass them without raising it explicitly.

1. **No raw LLM-generated database queries or shell commands executed against real systems.** LLM output goes through a deterministic, templated layer (validation, allow-listed operations, parameterised). This is the principle SaaNs v2 was rewritten around — apply it everywhere we run model output.
2. **Secrets stay out of the repo.** `.env` files are gitignored; never paste keys into prompts, commits, or generated docs. The agent server reads its env from `agent-server/.env`.
3. **The SQLite database is encrypted** (`better-sqlite3-multiple-ciphers`). Never delete `data/` or migration files to "fix" a schema issue — write a migration in `agent-server/src/db/migrations/`.
4. **Don't commit generated artefacts as if hand-authored.** Files under `docs/generated/` are agent output; treat them as build artefacts, not source.
5. **No new top-level docs or summary files** unless asked. Work product goes in the code or in `docs/generated/` via the agents.

---

## Stack & versions

Pin to these unless there's a deliberate reason to change them:

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19, React Router 7, Vite 6, TypeScript 5.6 (strict) |
| Markdown rendering | `react-markdown` + `remark-gfm` |
| Agent server runtime | Bun (production build, compiled sidecar) / `tsx` (dev) |
| HTTP framework | Hono 4 |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` |
| Validation | Zod 4 |
| DB | Encrypted SQLite via `better-sqlite3-multiple-ciphers` |
| Auth | Session cookies + JWT (`jose`) + TOTP 2FA (`otpauth`) + GitHub OAuth (PKCE) |
| Other model providers | `@google/genai` (kept narrow — Claude is primary) |
| Docs portal | MkDocs (see `docs/portal/`) |

If a task seems to want a different framework (Flask, Express, raw `fetch` in the browser, Postgres), stop and confirm — drift across the stack is more costly than a slightly awkward fit.

---

## Project layout

```
.
├── src/                      # React frontend (Tauri webview)
│   ├── components/           # UI components
│   ├── pages/                # Routed pages (Settings, AgentRunner, etc.)
│   ├── context/              # React contexts (Auth)
│   ├── hooks/                # Custom hooks
│   └── lib/                  # Frontend API clients (agent-api.ts)
│
├── src-tauri/                # Tauri Rust shell
│   ├── src/                  # Rust commands & sidecar wiring
│   ├── binaries/             # Built agent-server sidecar lives here
│   └── tauri.conf.json       # Bundle + sidecar config
│
├── agent-server/             # Hono/Bun backend
│   └── src/
│       ├── index.ts          # Entrypoint (env + project-root resolution)
│       ├── server.ts         # Hono app, routes, SSE
│       ├── orchestrator.ts   # Agent run orchestration
│       ├── runner-config.ts  # Switch between local/cloud runner
│       ├── cli.ts            # Standalone CLI entry
│       ├── agents/           # Per-agent definitions (one file each)
│       ├── prompts/          # Markdown prompts loaded by agents
│       ├── routes/           # HTTP routes (projects, users, sync, 2fa, ...)
│       ├── services/         # Cross-cutting services (templates, tts, ...)
│       ├── auth/             # Sessions, JWT, TOTP, GitHub OAuth
│       ├── db/               # SQLite client + migrations + repositories
│       ├── claudecode/       # Claude Code-specific integrations
│       ├── openclaw/         # OpenClaw agent runner integration
│       ├── sync/             # Cloud sync
│       ├── tools/            # Tool implementations exposed to agents
│       ├── middleware/       # Hono middleware
│       └── types/, types.ts  # Shared types
│
├── docs/
│   ├── templates/            # Source templates (BRD, FRD, USER_STORY, ARCH, SECURITY)
│   ├── generated/            # Agent output — DO NOT hand-edit
│   └── portal/               # MkDocs site
│
├── cloud/                    # Cloud runner pieces
├── data/                     # Local encrypted SQLite + state (gitignored)
└── *.md (root)               # Process framework docs (see "Process" below)
```

---

## Commands

From the repo root:

| Task | Command |
|---|---|
| Frontend dev server (Vite, no Tauri shell) | `bun run dev` |
| Full desktop dev (Tauri + Vite + sidecar) | `bun run tauri dev` |
| Frontend production build | `bun run build` |
| Build agent-server sidecar binary | `bun run build:agent-server` |
| Package desktop app | `bun run tauri build` |

From `agent-server/`:

| Task | Command |
|---|---|
| Dev (hot reload, loads `.env`) | `bun run dev` |
| Build (tsc) | `bun run build` |
| Start built server | `bun run start` |
| CLI | `bun run cli` |
| Tests | `bun run test` (vitest) |

---

## Working norms

- **TypeScript strict.** Don't add `any` to silence the compiler — model the type or narrow at the boundary.
- **Validate at boundaries with Zod.** HTTP requests, agent inputs, sync payloads. Internal calls trust internal types.
- **One agent per file** under `agent-server/src/agents/`. Prompts live as `.md` under `agent-server/src/prompts/` and are loaded by `read-prompt`.
- **Don't fan out abstractions for hypothetical reuse.** This repo has two real callers max for most code paths — keep it concrete until duplication actually hurts.
- **Edit existing files.** Don't drop new scaffolding (`utils/`, `helpers/`, `common/`) unless there's a real home missing.
- **Comments:** explain *why*, not *what*. The code says what. Skip comments that restate the obvious or reference a current ticket.
- **No emojis in code or generated docs** unless the user asks. `QUICK_REFERENCE.md` is a marketing-style document and is the exception, not the pattern.
- **UI changes need a manual check.** If you change something in `src/`, run `bun run tauri dev` and exercise the flow before claiming done — type checks don't catch broken UX.

---

## Process framework (the work product)

The framework docs that this tool helps teams adopt and produce:

- [SOFTWARE_DEVELOPMENT_PROCESS.md](SOFTWARE_DEVELOPMENT_PROCESS.md) — Traditional / Hybrid (Agile) SDLC.
- [AI_NATIVE_DEVELOPMENT_PROCESS.md](AI_NATIVE_DEVELOPMENT_PROCESS.md) — Intent-driven, agent-orchestrated process.
- [AGENTIC_DOCUMENTATION_FRAMEWORK.md](AGENTIC_DOCUMENTATION_FRAMEWORK.md) — How documentation agents are structured.
- [PROCESS_COMPARISON_GUIDE.md](PROCESS_COMPARISON_GUIDE.md) — When to choose which.
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) — 30-second decision aid.
- [docs/templates/](docs/templates/) — Canonical templates: BRD, FRD, user story, architecture, security assessment.

When generating any artefact, start from the template in `docs/templates/` rather than free-styling structure. If a template feels wrong, update the template — don't fork it inline.

---

## Working with the agents

- Each agent's behaviour is defined by its TS module in `agent-server/src/agents/` **and** its prompt in `agent-server/src/prompts/`. Edit both together; an agent and its prompt are one unit.
- Orchestration goes through [`agent-server/src/orchestrator.ts`](agent-server/src/orchestrator.ts). Direct-agent runs go through `runDirectAgent`.
- The runner has two modes (local Claude Agent SDK, cloud); see [`agent-server/src/runner-config.ts`](agent-server/src/runner-config.ts). Don't hardcode a mode in agent code.
- Generated documents are written under `docs/generated/<category>/` and indexed via the frontend.
- The OpenClaw runner is a separate code path in [`agent-server/src/openclaw/`](agent-server/src/openclaw/) — don't merge it into the orchestrator without discussion.

---

## Auth & data

- Sessions are HTTP-only cookies; tokens are JWTs signed with `jose`. Don't add a parallel auth scheme.
- 2FA is TOTP via `otpauth`. The 2FA route is `/two-factor`.
- GitHub OAuth uses PKCE; the flow lives in [`agent-server/src/auth/github-routes.ts`](agent-server/src/auth/github-routes.ts) and [`pkce.ts`](agent-server/src/auth/pkce.ts).
- SQLite is encrypted — passphrase comes from env. If you need a new table, write a migration in `agent-server/src/db/migrations/` and a repository in `agent-server/src/db/repositories/`. Don't run raw SQL from route handlers.

---

## Git & PR conventions

- Branch from `main`. Keep PRs scoped — one concern per PR.
- Don't commit `dist/`, `data/`, `node_modules/`, `.env`, agent-server binaries (`src-tauri/binaries/agent-server-*`), or `docs/generated/` output unless explicitly part of a release.
- Commit messages: short imperative subject, body explains *why* if non-obvious. Follow the existing log style.
- Never `--no-verify`, never force-push `main`, never amend a pushed commit without coordination.
- Run the appropriate dev server and at least a build (`bun run build` or `cd agent-server && bun run build`) before opening a PR.

---

## When in doubt

- Match the surrounding code's style before inventing a new one.
- Prefer fewer, smaller diffs over one sweeping change.
- If a task pushes against any rule in **Hard rules** or **Organizational context**, stop and raise it — those exist because we've been bitten before.
