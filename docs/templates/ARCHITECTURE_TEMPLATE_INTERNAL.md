# System Architecture Document — Internal Application

**Document Version:** 1.0
**Date:** [YYYY-MM-DD]
**Project:** [Project Name — e.g. Sahamati Core]
**Prepared By:** [Architect Name]
**Reviewed By:** [Engineering Lead, Security Lead]

**Audience Tier:** Internal *(default for this template)*
**Data Classification:** [ Public | Internal | Confidential | Regulated (PII) ]

> Use this template for **internal Sahamati applications and platform/back-office
> tools that do NOT participate in the AA ecosystem** — i.e. systems that never
> act as an AA, FIP, FIU, or TSP and never handle consent artefacts or FI
> payloads in live traffic. If the system touches AA/FIU/FIP traffic, consent
> artefacts, or FI payloads, use `ARCHITECTURE_TEMPLATE.md` instead.
>
> Even though there is no ecosystem role, the org's security invariants still
> apply: encryption at rest, secrets via the Sahamati KMS, `@sahamati.org.in`
> authentication, India data residency, DPDP for any PII, and no raw LLM/model
> output executed against real systems. Use synthetic data in all examples
> (e.g. `customer-test-001`, `XXXXX1234X`).
>
> **Confidence convention:** mark compliance/technical claims as
> **[Verified against <source, date>]** or **[Not verified]**.

---

## 1. Executive Summary

[High-level overview of what the system does, who uses it, the key architectural
decisions, and its data sensitivity. State plainly whether it holds any PII or
Confidential data, and confirm it does **not** process AA consent artefacts or
FI payloads.]

---

## 2. Scope & Non-Goals

### 2.1 In Scope
- [What this system is responsible for]

### 2.2 Explicit Non-Goals
- **No AA ecosystem participation.** This system is not an AA/FIP/FIU/TSP and
  does not implement ReBIT APIs, consent flows, or FI data flows.
- [Other non-goals]

### 2.3 Data Sensitivity Declaration
| Data category | Present? | Classification | Notes |
|---------------|----------|----------------|-------|
| PII (employee/customer identifiers) | [Y/N] | [Confidential] | DPDP applies if Yes |
| Secrets / credentials | [Y/N] | [Confidential] | via Sahamati KMS |
| Regulated AA data (consent/FI) | **No** | n/a | If this is Yes, use the AA template |
| Business / operational data | [Y/N] | [Internal] | — |

---

## 3. Architectural Goals & Principles

### 3.1 Goals
- [Goal 1: e.g., scalability to N internal users]
- [Goal 2: e.g., 99.x% availability during business hours]
- [Goal 3: e.g., sub-Xms response times]

### 3.2 Design Principles
- **Least privilege.** Internal access is role-scoped; no shared admin accounts.
- **Secrets via KMS.** No secrets in repo, prompts, logs, or env files committed
  to git (`.env*` gitignored). See §9.3.
- **Encryption by default.** PII and Confidential data encrypted at rest and in transit.
- **No raw model/LLM output executed against real systems** (CLAUDE.md hard rules):
  model output goes through a deterministic, validated, allow-listed layer.
- **Stack discipline.** Follow the pinned stack (§6); deviations need an ADR with
  tradeoff analysis.
- [Add system-specific principles.]

---

## 4. System Context (C4 Level 1)

### 4.1 System Overview
[What the system does and where it sits among internal systems and users.]

### 4.2 Context Diagram
```
[Insert C4 L1 diagram: this system, its users, and the internal/external
 systems it integrates with. Synthetic identifiers only.]
```

### 4.3 Users & Personas
- **Primary users:** [e.g. Sahamati internal team]
- **Secondary users:** [...]
- **System users:** [other internal services, APIs]

### 4.4 External / Internal Integrations
| System | Purpose | Integration | Auth | Notes |
|--------|---------|-------------|------|-------|
| [Identity provider] | SSO / login | [OIDC] | `@sahamati.org.in` | — |
| Sahamati KMS | Secrets & keys | REST | Bearer token | §9.3 |
| [System B] | [Purpose] | [REST / queue] | [...] | [...] |

---

## 5. Container & Component Architecture (C4 Levels 2–3)

### 5.1 Container Diagram (C4 L2)
```
[Insert C4 L2 diagram: applications, data stores, queues, trust boundaries.]
```

### 5.2 Containers
#### 5.2.1 [Container: e.g., Web/API service]
- **Technology:** [...]
- **Purpose / responsibilities:** [...]
- **Trust boundary:** [Internet-facing / internal-only]
- **Handles PII/Confidential data?** [Y/N — what]
- **Dependencies:** [...]

[Repeat per container.]

### 5.3 Key Components (C4 L3)
#### 5.3.1 [Component]
- **Responsibility / interfaces / dependencies:** [...]

---

## 6. Technology Stack

> Pin to the org stack unless there's a deliberate, ADR-recorded reason to change.

### 6.1 Application & Runtime
| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| [Language/runtime] | [...] | [...] | [...] |
| [Framework] | [...] | [...] | [...] |
| [Validation] | [Zod] | [...] | Validate at boundaries |

### 6.2 Data Layer
| Component | Technology | Version | Encryption at rest | Residency |
|-----------|-----------|---------|--------------------|-----------|
| Primary DB | [...] | [...] | [Yes — scheme] | India |
| Cache | [...] | [...] | [Y/N] | India |
| Object/file store | [...] | [...] | [Yes — scheme] | India |

### 6.3 Infrastructure
| Component | Technology | Justification | Residency |
|-----------|-----------|---------------|-----------|
| Cloud / hosting | [...] | [...] | India |
| Orchestration | [...] | [...] | [...] |
| CI/CD | [...] | [...] | [...] |
| Observability | [...] | [...] | [...] |

---

## 7. Data Architecture

### 7.1 Data Flow Diagram
```
[Insert data flow. Annotate stores/edges with classification (PII/Confidential/
 Internal), encryption state, and residency. Synthetic data only.]
```

### 7.2 Key Entities
- **[Entity]:** [Description, classification, retention basis]

### 7.3 Data Residency
- **PII and Confidential data stored within India.** [Regions/zones.]
- [Backup/DR residency; cross-border processing prohibitions if any.]

### 7.4 Retention & Deletion
| Data Type | Retention Basis | Period | Deletion / Archival |
|-----------|-----------------|--------|---------------------|
| PII | DPDP — minimised | [...] | [purge + audit] |
| Operational data | [Business] | [...] | [...] |
| Audit logs | [CERT-In / policy — verify] | [...] | [archival] |

---

## 8. API Architecture *(if applicable)*

### 8.1 Design Principles
- [REST / RPC]; versioning: [/v1]; authn: [OIDC / session]; rate limiting: [...]
- Validate all inbound requests at the boundary (Zod or equivalent).

### 8.2 Endpoints (high-level)
| Endpoint | Method | Purpose | Auth | Role |
|----------|--------|---------|------|------|
| [/v1/...] | [GET] | [...] | [Yes] | [role] |

### 8.3 API Documentation
- **Spec format / location:** [OpenAPI 3.x — link]

---

## 9. Security Architecture

### 9.1 Authentication & Authorization
- **Authentication:** `@sahamati.org.in` via [SSO/OIDC] — never bypassed.
- **Authorization:** [RBAC]; least privilege; no shared admin accounts.
- **Session management:** [scheme, expiry; MFA for privileged access].

### 9.2 Data Security
- **Encryption at rest:** [scheme — e.g. `libsql` `encryptionKey`, or DB-native].
- **Encryption in transit:** TLS 1.2+/1.3.
- **PII handling:** access-logged; never logged in cleartext; minimised.

### 9.3 Secrets & Key Management (Sahamati KMS)
Use the org-standard **Sahamati KMS** for application secrets, keys, and service
tokens. Reference client:
[`agent-server/src/services/kms-client.ts`](../../agent-server/src/services/kms-client.ts).

- **Configuration:** `KMS_URL`, `KMS_AUTH_TOKEN`, `KMS_APP_NAME` (app scope is
  mandatory). Absent config is a no-op for local dev; locally-set env vars override.
- **Startup bootstrap:** secrets are pulled and injected into the environment
  before routes mount (see
  [`secrets-bootstrap.ts`](../../agent-server/src/services/secrets-bootstrap.ts));
  per-secret failures warn and continue.
- **Operations:** `getActiveSecret`, `generateKey`, `rotateKey` (grace period),
  `createServiceToken`. Generated keys/tokens return plaintext **once only**.
- **Invariant:** plaintext secrets are never persisted server-side, logged, or
  echoed in chat — surfaced only via structured responses. Admin-gated surfaces:
  [`routes/secrets.ts`](../../agent-server/src/routes/secrets.ts),
  [`tools/secrets.ts`](../../agent-server/src/tools/secrets.ts).
- `.env*` is gitignored; no keys in repo, prompts, commits, or generated docs.

### 9.4 Network Security
- [Segmentation, internal-only exposure where possible, WAF/DDoS if internet-facing.]

### 9.5 Secure Development & Supply Chain
- [SAST/DAST/dependency + secrets scanning in CI; review gates; no `--no-verify`.]
- No raw LLM/model output executed against real systems — deterministic,
  validated, allow-listed layer only.

### 9.6 Destructive-Action Controls
- [DB drop, key rotation, bulk delete require explicit confirmation; auditable.]

---

## 10. Privacy & Data Protection (DPDP) *(if PII present)*

- **Lawful basis / purpose:** [...]
- **Data principal rights:** [access, correction, erasure, grievance — how supported]
- **Breach notification:** [DPDP + CERT-In timelines — verify]
- **Data protection / grievance contacts:** [roles]

> If no PII is processed, state that explicitly and mark this section N/A.

---

## 11. Scalability & Performance

### 11.1 Scaling Strategy
- [Horizontal/vertical; DB replicas; statelessness where possible.]

### 11.2 Performance Targets
| Metric | Target | Notes |
|--------|--------|-------|
| API latency | [<Xms p95] | [...] |
| Throughput | [N req/s] | [...] |

### 11.3 Caching
| Layer | Technology | TTL | Caveat |
|-------|-----------|-----|--------|
| [...] | [...] | [...] | Never cache PII/secrets in cleartext |

---

## 12. Reliability & Resilience

### 12.1 High Availability
- **Target uptime:** [99.x%]; **Multi-AZ:** [within India].

### 12.2 Disaster Recovery
- **RTO / RPO:** [...] / [...]
- **Backup strategy:** [encrypted, India-resident, tested restores].
- **DR runbook:** [Link]

### 12.3 Fault Tolerance
- [Retries with backoff, circuit breakers, idempotency, graceful degradation.]

---

## 13. Deployment Architecture

### 13.1 Environments
| Environment | Purpose | Data | Residency |
|-------------|---------|------|-----------|
| Development | Dev | Synthetic only | [...] |
| Staging | QA / UAT | Synthetic / masked | India |
| Production | Live internal use | [Internal/PII] | India |

### 13.2 Infrastructure Diagram
```
[Insert deployment diagram — India regions/zones, trust boundaries, KMS.]
```

### 13.3 CI/CD
```
[Commit] → [Build] → [Test] → [SAST/Dependency Scan] → [Secrets Scan]
        → [Deploy Staging] → [E2E Tests] → [Deploy Prod]
```
- **Release controls:** no `--no-verify`; no force-push to `main`; build before PR.
- **Rollback:** [strategy].

---

## 14. Observability & Audit

### 14.1 Monitoring Stack
| Component | Tool | Purpose |
|-----------|------|---------|
| Metrics | [...] | infra & app |
| Logs | [...] | centralized (no PII/secrets in cleartext) |
| Traces | [...] | distributed tracing (redacted) |
| Alerts | [...] | incident alerting |

### 14.2 Audit Trail
- **What is logged:** privileged access, secret access via KMS, destructive
  actions, authn events — with identifiers redacted/tokenised.
- **Retention:** [per policy / CERT-In — verify].

### 14.3 Alerting
| Alert | Threshold | Severity | Action |
|-------|-----------|----------|--------|
| Error rate | [>X%] | [...] | [...] |
| Auth failures | [>N/min] | Warning | [...] |
| Unauthorized access attempt | [>0] | Critical | Page + investigate |

---

## 15. Compliance & Internal Controls

| Requirement | Source | Where addressed | Status |
|-------------|--------|-----------------|--------|
| Encryption at rest | Internal hard rule | §9.2 | [...] |
| Secrets via KMS / out of repo | Security invariants | §9.3 | [...] |
| `@sahamati.org.in` authentication | Org identity rules | §9.1 | [...] |
| Data localisation (India) | RBI directions | §7.3, §13 | [Not verified] |
| PII purpose limitation & retention | DPDP | §7.4, §10 | [...] |
| No LLM output executed on real systems | CLAUDE.md hard rules | §3.2, §9.5 | [...] |

---

## 16. Architecture Decision Records (ADRs)
| ID | Decision | Date | Status |
|----|----------|------|--------|
| [ADR-001] | [...] | [YYYY-MM-DD] | [Accepted] |

[See `docs/architecture/adr/` for detailed ADRs.]

---

## 17. Risks & Open Questions
| Risk / Question | Impact | Likelihood | Mitigation / Owner |
|-----------------|--------|------------|--------------------|
| [...] | [...] | [...] | [...] |

---

## 18. References
- CLAUDE.md (repo hard rules & stack) — [link]
- SOFTWARE_DEVELOPMENT_PROCESS.md / AI_NATIVE_DEVELOPMENT_PROCESS.md — [links]
- Sahamati KMS client — `agent-server/src/services/kms-client.ts`
- DPDP Act — [link]
- ADR repository / API docs / runbooks — [links]

---

## 19. Appendices

### Appendix A: Glossary
| Term | Definition |
|------|-----------|
| KMS | Key Management Service — Sahamati's custom secrets/key service (§9.3) |
| PII | Personally Identifiable Information (DPDP scope) |
| RBAC | Role-Based Access Control |
| [Term] | [Definition] |

### Appendix B: Diagrams
[Additional detailed diagrams — synthetic data only.]
