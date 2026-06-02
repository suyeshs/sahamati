# Intent Document: Sahamati Development Process Framework

**Status:** Delivered
**Owner:** Sahamati Engineering Team
**Created:** 2026-06-02
**Target Delivery:** Q1 2026
**Version:** 1.0

---

## Intent Statement

Replace the slow, expensive, and error-prone manual documentation process used by engineering teams in India's Account Aggregator ecosystem with an AI-native desktop application that uses Claude-driven agents to generate, review, and maintain software development artefacts — BRDs, FRDs, user stories, architecture docs, security assessments, and runbooks — in minutes rather than weeks. This matters because Sahamati operates under RBI/ReBIT regulatory oversight where documentation quality directly affects compliance posture, and because traditional documentation workflows consume disproportionate engineering time (20+ weeks and ~$950K per feature) while producing artefacts that become stale almost immediately. By automating 75-80% of documentation through purpose-built agents, the team reclaims engineering capacity for higher-value work while maintaining the rigour that regulated industries demand.

---

## Success Metrics

### Primary Metrics (Must Achieve)
| Metric | Current Baseline | Target | Timeline | Measurement Method |
|--------|-----------------|--------|----------|-------------------|
| Documentation generation time per feature | 20 weeks (traditional) | < 1 week (AI-native) | Immediate on adoption | Internal time tracking |
| Documentation cost per feature | ~$950K (traditional team) | ~$50K (AI-augmented) | Q1 2026 | Budget actuals |
| Auto-generation coverage | 0% (all manual) | 75-80% of artefacts | 3 months post-launch | Agent output audit |
| Team size required for documentation | 10-15 people | 2-5 people + AI agents | On adoption | Headcount allocation |

### Secondary Metrics (Success Indicators)
| Metric | Current Baseline | Target | Timeline |
|--------|-----------------|--------|----------|
| Agent-generated artefacts per month | N/A | Steady increase month-over-month | 6 months |
| Documentation staleness (days since last update) | 60+ days average | < 14 days | 3 months |
| Security assessment coverage | Ad-hoc | Every project, every release | 3 months |
| Monthly cost savings from automation | $0 | $3,000+ | 3 months |

### Counter Metrics (Must NOT Degrade)
| Metric | Current Performance | Threshold | Monitor |
|--------|-------------------|-----------|---------|
| Documentation accuracy (human review pass rate) | N/A (new capability) | Must achieve > 90% | Human review flags on generated docs |
| Agent response latency (SSE streaming start) | N/A | Must stay < 5 seconds | Server logs |
| Application uptime (desktop + agent server) | N/A | Must maintain > 99% during use | Local health checks |
| Security posture of generated artefacts | Zero real data leakage | Must remain zero | Automated scanning |

---

## Constraints & Non-Negotiables

### Must Have (Hard Requirements)
- **Regulatory compliance:** All generated artefacts must be safe for RBI/ReBIT/DPDP Act review — no real PII, consent artefacts, or FI payloads in prompts, logs, or outputs
- **Security:** Encrypted SQLite database for all local state; secrets never stored in repo; no raw LLM-generated queries executed against real systems
- **Authentication:** Restricted to `@sahamati.org.in` domain; session cookies + JWT + TOTP 2FA + GitHub OAuth (PKCE)
- **Data integrity:** No destructive database operations without explicit confirmation; migrations only (never delete `data/` or migration files)
- **Auditability:** Generated documents carry frontmatter metadata (confidence level, `requires_review` flag, `generated_by` agent, date)
- **Offline-capable:** Desktop app via Tauri with embedded sidecar agent server

### Should Have (Highly Desirable)
- GitHub repository integration for code-aware documentation generation
- Real-time streaming output via SSE so users see generation progress
- Multiple specialized agents (discovery, requirements, security, knowledge, process-docs)
- Custom agent authoring via OpenClaw format (Agent Studio)
- Video generation capability for ecosystem marketing (Google Veo 3.1)
- Cloud sync for project state

### Could Have (Nice to Have)
- Evernote integration for note management
- MkDocs portal for publishing generated documentation
- CLI mode for headless/cloud operation (`sahamati` CLI)
- ClawHub skill marketplace for community agent skills
- Multiple LLM provider support (Anthropic primary, Google secondary, OpenAI/DeepSeek for custom agents)

### Won't Have (Explicitly Out of Scope)
- This is not the SaaNs analytics platform itself — `BRD.md` describes SaaNs v2 as a worked example only
- No multi-tenant SaaS deployment — this is a desktop tool with optional cloud sync
- No custom authentication system beyond the existing OAuth2/JWT/TOTP stack
- No direct database query execution from LLM output against production systems

---

## Context & Background

### Business Context
**Why now?**
- Sahamati operates India's Account Aggregator ecosystem under RBI/ReBIT oversight, where documentation quality is not optional — it is a compliance requirement
- Traditional documentation processes were consuming 20+ weeks and costing nearly $1M per major feature, with artefacts going stale within weeks
- The emergence of production-grade agent SDKs (Claude Agent SDK) made it feasible to automate structured document generation with high fidelity
- Teams across the AA ecosystem (AAs, FIPs, FIUs) face the same documentation burden; a reusable framework and tool multiplies impact
- DPDP Act compliance adds new documentation requirements that manual processes cannot scale to meet

**Strategic Alignment:**
- Directly supports Sahamati's mandate to strengthen the AA ecosystem through better tooling and process standardisation
- Demonstrates AI-native development practices that Sahamati can advocate across ecosystem participants
- Reduces dependency on large documentation teams, enabling a leaner operating model

### User Context
**Primary Users:**
- **Sahamati engineering team** (primary): Need to produce regulatory-grade documentation efficiently
  - Pain: Weeks spent writing BRDs, FRDs, and security assessments manually
  - Need: Agent-driven generation from prompts, meeting notes, or code
- **Product managers / technical leads** (secondary): Orchestrate documentation workflows across projects
  - Pain: Coordinating document production across multiple teams and phases
  - Need: Project dashboards, workflow automation, phase tracking
- **Security engineers** (tertiary): Systematic security assessment of codebases
  - Pain: Ad-hoc security reviews miss vulnerabilities
  - Need: Automated OWASP Top 10 / CWE scanning with structured reports

### Technical Context
**Design Decisions:**
- **Tauri desktop app** chosen over web-only to support offline use, local encrypted storage, and sidecar process management — critical for handling sensitive regulated-context work
- **Encrypted SQLite** over a networked database to keep sensitive project data local and compliant with data residency expectations
- **Agent-per-concern architecture** (discovery, requirements, security, etc.) rather than a monolithic agent, so each can be tuned independently with appropriate models and token budgets
- **Claude as primary LLM** due to long-context capability and structured output quality required for regulatory-grade documents
- **OpenClaw format** for custom agents to enable extensibility without modifying core orchestration code
- **No raw LLM-generated queries** — all model output goes through a deterministic, templated validation layer (the principle SaaNs v2 was rewritten around)

---

## Assumptions

**User Behaviour:**
- Assumption: Users will provide meaningful prompts or meeting notes as input; agents cannot generate useful artefacts from empty context
- Assumption: Human review of generated documents is always required before external use (enforced via `requires_review` metadata)
- Assumption: The `@sahamati.org.in` domain restriction is acceptable for the initial user base

**Technical:**
- Assumption: Claude Agent SDK provides sufficient reliability and output quality for production documentation generation
- Assumption: Encrypted SQLite with `better-sqlite3-multiple-ciphers` meets data-at-rest security requirements without a dedicated KMS <!-- assumption: no formal security audit of this claim has been referenced -->
- Assumption: Bun runtime is stable enough for production sidecar compilation
- Assumption: SSE streaming provides adequate UX for long-running agent tasks (some generations take 40-50 turns)

**Business:**
- Assumption: 75-80% auto-generation rate is achievable for structured artefacts when following canonical templates
- Assumption: Cost savings of ~95% vs. traditional documentation workflows are realised through reduced headcount allocation, not tool cost alone
- Assumption: Generated artefacts will meet the quality bar for ecosystem-tier and regulator-tier audiences after human review

**Validation Plan:**
- [x] Prototype: Core agent workflows functional (discovery, requirements, security, process-docs)
- [x] Internal dogfooding: Sahamati team using the tool for its own documentation
- [ ] Ecosystem pilot: Offer framework + tooling to select AA ecosystem participants <!-- assumption: planned but not yet executed -->

---

## Risks & Mitigation

| Risk | Probability | Impact | Risk Score | Mitigation Strategy | Owner |
|------|------------|--------|-----------|-------------------|-------|
| LLM hallucination in generated regulatory documents | High | Critical | High | Mandatory human review flag; confidence scoring in frontmatter; template-constrained output | Engineering |
| Real PII/regulated data leaking into prompts or outputs | Medium | Critical | High | Synthetic data enforcement; no real FI payloads in fixtures/prompts; DPDP Act training | Security Lead |
| Agent SDK breaking changes or API instability | Medium | High | Medium | Pin SDK versions; abstraction layer via `runner-config.ts`; fallback to CLI runner mode | Engineering |
| Encrypted SQLite performance at scale | Low | Medium | Low | Migration-based schema management; index tuning; monitored via local health checks | Engineering |
| Generated documents not meeting regulator-tier quality | Medium | High | Medium | Template-first generation; tiered audience awareness (Internal/Ecosystem/Regulator); human review gates | Product |
| Custom agent (OpenClaw) security — untrusted agent code execution | Medium | High | Medium | Sandboxed execution; MCP tool allow-listing; no shell access for secret orchestrator | Security Lead |

---

## Dependencies

### Internal Dependencies
| Team/System | Dependency | Required By | Status |
|------------|-----------|-------------|--------|
| Claude Agent SDK | Agent orchestration runtime | Core functionality | Available (v0.2.72) |
| Tauri 2 | Desktop shell and sidecar management | Core functionality | Available |
| Canonical templates (`docs/templates/`) | Starting point for all generated artefacts | Agent output quality | Available |
| Encrypted SQLite (`better-sqlite3-multiple-ciphers`) | Local data persistence | Core functionality | Available |

### External Dependencies
| Partner/Vendor | Dependency | Impact | Mitigation |
|---------------|-----------|--------|------------|
| Anthropic | Claude API availability and pricing | All agent functionality | Rate limiting; local caching of partial results; CLI fallback runner |
| Google | Veo 3.1 API for video generation | Video feature only | Feature degrades gracefully; non-blocking for core doc generation |
| GitHub | OAuth + API for repo integration | Process-docs agent (code-aware generation) | Manual code pasting as fallback |

---

## Phases & Iterations

### V1: Core Agent Framework (Delivered)
**Goal:** Enable AI-driven generation of the five core artefact types from the Sahamati process framework
**Status:** Delivered

**Scope:**
- Desktop app shell (Tauri 2 + React 19 + Vite)
- Agent server with embedded sidecar architecture
- Five core agents: Discovery (BRD), Requirements (FRD + user stories), Knowledge (gap analysis + FAQs), Process Docs (architecture + runbooks from GitHub repos), Security (OWASP/CWE assessments)
- Encrypted SQLite with migration-based schema management
- Authentication: session cookies + JWT + TOTP 2FA + GitHub OAuth (PKCE)
- Project management with phases, documents, and team members
- SSE streaming for real-time agent output
- Generated document browser with metadata (confidence, review required, agent, date)

### V2: Extensibility & Studio (Delivered)
**Goal:** Allow custom agent creation and ecosystem extensibility

**Scope:**
- OpenClaw agent format support (SOUL.md, TOOLS.md, IDENTITY.md, HEARTBEAT.md)
- Agent Studio visual IDE for building, testing, and managing custom agents
- ClawHub skill marketplace integration
- Multi-provider LLM support for custom agents (Anthropic, OpenAI, DeepSeek)
- Video generation pipeline via Google Veo 3.1
- Evernote integration agent
- Cloud sync engine
- CLI mode for headless operation

### V3: Ecosystem Adoption <!-- assumption: this phase is planned but not yet started -->
**Goal:** Extend the framework and tooling to AA ecosystem participants (AAs, FIPs, FIUs)

**Scope:**
- Ecosystem-tier documentation and onboarding
- Packaging for distribution beyond Sahamati internal team
- Compliance report templates aligned with RBI/ReBIT requirements
- Usage analytics and documentation health dashboards
- Feedback loops from ecosystem participants to improve agent quality

---

## AI-Generated Recommendations

### Proposed Architecture Approach

**Implemented Pattern:** Agent-per-concern with unified orchestration

**Components:**
1. **Agent Server** (Hono on Bun, Tauri sidecar)
   - HTTP/SSE API for all agent interactions
   - Orchestrator dispatches to specialised agents
   - Runner abstraction (local SDK vs. CLI) via `runner-config.ts`
2. **Desktop Shell** (Tauri 2 + React 19)
   - Project management, workflow automation, document browsing
   - Agent Studio for custom agent authoring
3. **Agent Fleet** (Claude Agent SDK)
   - Discovery, Requirements, Knowledge, Process Docs, Security, Video, Evernote
   - Each agent has its own prompt, model selection, and turn budget
4. **OpenClaw Runtime** (custom agent execution)
   - Separate code path for user-authored agents
   - Pluggable LLM providers
5. **Encrypted SQLite** (local persistence)
   - Projects, users, sessions, generated documents, sync state
   - Migration-managed schema

**Diagram:**
```
+------------------+     +-------------------+     +------------------+
|   Tauri Shell    |     |   Agent Server    |     |  Claude API      |
|   (Rust + React) |<--->|   (Hono / Bun)    |<--->|  (Agent SDK)     |
+------------------+     +-------------------+     +------------------+
                               |        |
                          +----+        +----+
                          |                  |
                   +-----------+      +-----------+
                   | Encrypted |      | OpenClaw  |
                   | SQLite    |      | Runtime   |
                   +-----------+      +-----------+
```

---

### Estimated Complexity

**Overall Score:** 7/10 (Moderate-High)

**Justification:**
- Multi-runtime architecture (Tauri + Bun sidecar + Claude SDK + OpenClaw) adds integration complexity
- Encrypted database with migration management requires careful handling
- Multiple authentication flows (session + JWT + TOTP + GitHub OAuth PKCE) increase the auth surface area
- Agent orchestration with model-specific tuning (Sonnet vs. Haiku, varying turn budgets) requires ongoing calibration
- Regulatory constraints (DPDP Act, RBI/ReBIT) impose strict boundaries on what data flows where

**Effort Profile:**
- **Traditional team (10-15 eng):** 20 weeks
- **AI-augmented team (2-5 eng + agents):** 5 weeks
- **Actual (this project):** Delivered by a small team using AI-native practices

---

### Technology Recommendations

| Component | Chosen | Rationale |
|-----------|--------|-----------|
| Desktop runtime | Tauri 2 (Rust) | Lightweight, secure, supports sidecar binaries; avoids Electron overhead |
| Frontend | React 19 + Vite 6 + TypeScript strict | Modern, fast builds, strong type safety |
| Server framework | Hono 4 | Lightweight, async-first, runs on Bun; avoids Express overhead |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` | Native Claude integration; task orchestration; MCP tool support |
| Database | Encrypted SQLite | Local-first, no network dependency, DPDP-compliant data-at-rest |
| Validation | Zod 4 | Runtime type checking at boundaries; pairs with TypeScript |
| Auth | `jose` (JWT) + `otpauth` (TOTP) + PKCE | Standards-based; no custom auth system |

---

## Clarifying Questions for Human Review

1. **Ecosystem rollout:** Is there a timeline for offering this tooling to AA ecosystem participants beyond Sahamati's internal team?
   - [ ] Q3 2026
   - [ ] Q4 2026
   - [ ] No current plan

2. **Security audit:** Has the encrypted SQLite implementation undergone a formal security review for handling regulated AA ecosystem data?
   - [ ] Yes, completed
   - [ ] Planned
   - [ ] Not yet planned

3. **Agent quality benchmarks:** Are there formal accuracy benchmarks for agent-generated artefacts against human-authored baselines?
   - [ ] Yes, with metrics
   - [ ] Informal review only
   - [ ] Not yet established

4. **Regulator readiness:** Have any agent-generated artefacts been submitted to RBI/ReBIT for review?
   - [ ] Yes, accepted
   - [ ] Yes, with feedback
   - [ ] Not yet

5. **OpenClaw agent governance:** What review process exists for custom agents created via Agent Studio before they are used on regulated-context projects?
   - [ ] Formal review gate
   - [ ] Informal peer review
   - [ ] No process yet

---

## Approvals

| Role | Name | Status | Date | Comments |
|------|------|--------|------|----------|
| Product Orchestrator | Sahamati Team | Pending | | |
| Technical Orchestrator | Sahamati Team | Pending | | |
| Security Lead | Sahamati Team | Pending | | |
| Compliance Lead | Sahamati Team | Pending | | |

**Approval Criteria:**
- Intent is clear and measurable
- Success metrics are achievable
- Risks are identified and mitigated
- Regulatory constraints are addressed
- Architecture is sound and delivered

---

## Execution Tracking

### Current Status
**Phase:** V1 and V2 Delivered; V3 Planning
**Overall Progress:** ~80% (core platform delivered, ecosystem rollout pending)
**Health:** Green
**Blockers:** None for delivered phases

### Progress Breakdown
- [x] Intent document created
- [x] Core agent framework (V1) delivered
  - [x] Discovery agent (BRD generation)
  - [x] Requirements agent (FRD + user stories)
  - [x] Knowledge agent (gap analysis, FAQs)
  - [x] Process Docs agent (GitHub-aware)
  - [x] Security agent (OWASP/CWE assessment)
- [x] Desktop app shell (Tauri 2)
- [x] Encrypted SQLite with migrations
- [x] Authentication (JWT + TOTP + GitHub OAuth)
- [x] Agent Studio / OpenClaw (V2)
- [x] Video generation pipeline (V2)
- [x] Cloud sync engine (V2)
- [ ] Ecosystem pilot (V3)
- [ ] Compliance report templates (V3)
- [ ] Usage analytics dashboards (V3)

---

## Change Log

| Date | Version | Changed By | Changes |
|------|---------|-----------|---------|
| 2026-06-02 | 1.0 | Sahamati Team | Initial intent document created (retrospective, based on delivered codebase) |

---

## Attachments & References

### Process Framework
- `SOFTWARE_DEVELOPMENT_PROCESS.md` — Traditional/Hybrid SDLC methodology
- `AI_NATIVE_DEVELOPMENT_PROCESS.md` — Intent-driven, agent-orchestrated process
- `AGENTIC_DOCUMENTATION_FRAMEWORK.md` — Documentation agent architecture
- `PROCESS_COMPARISON_GUIDE.md` — Decision guide across process types
- `QUICK_REFERENCE.md` — 30-second process selection aid

### Technical
- `agent-server/src/agents/` — Agent definitions (one file per agent)
- `agent-server/src/prompts/` — Agent prompt templates (Markdown)
- `agent-server/src/orchestrator.ts` — Orchestration layer
- `agent-server/src/runner-config.ts` — Runner mode configuration
- `docs/templates/` — Canonical artefact templates (BRD, FRD, User Story, Architecture, Security, Intent)

### Worked Example
- `BRD.md` — SaaNs v2 Business Requirements Document (demonstrates tool output quality)
