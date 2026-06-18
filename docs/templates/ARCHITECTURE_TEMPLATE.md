# System Architecture Document

**Document Version:** 1.0
**Date:** [YYYY-MM-DD]
**Project:** [Project Name]
**Prepared By:** [Architect Name]
**Reviewed By:** [Engineering Lead, Security Lead, Compliance]

**Audience Tier:** [ Internal | Ecosystem (AAs/FIPs/FIUs/partners) | Regulator (RBI/ReBIT) ]
**Data Classification:** [ Public | Internal | Confidential | Regulated (consent artefacts, FI payloads, PII) ]

> This template is for systems built for, or integrating with, India's Account
> Aggregator (AA) ecosystem under RBI Master Direction (NBFC-AA) and the ReBIT
> technical specifications. Sections 3, 8–12, and 16–17 are AA/ReBIT-specific and
> are not optional for any participant or supporting system. Use synthetic data
> only in every diagram and example (e.g. `customer-test-001`, `XXXXX1234X`).
>
> **Confidence convention:** mark any regulatory or spec claim as **[Verified
> against <source, date>]** or **[Not verified]**. Spec version numbers and
> endpoint shapes drift — cite the exact ReBIT publication you relied on.

---

## 1. Executive Summary

[High-level overview of the system, its role in the AA ecosystem, the key
architectural decisions, and the regulatory posture. State plainly whether this
system handles regulated data (consent artefacts, FI payloads, PII) and, if so,
whether it ever holds that data in plaintext.]

---

## 2. AA Ecosystem Role & Regulatory Posture

### 2.1 Ecosystem Role
[Identify precisely which role(s) this system plays. A system may be more than
one, but the obligations differ sharply per role.]

| Role | Plays this role? | Notes |
|------|------------------|-------|
| Account Aggregator (AA) | [Yes/No] | Consent manager; **data-blind** — must never read FI payloads in plaintext |
| Financial Information Provider (FIP) | [Yes/No] | Source of FI; encrypts FI for the FIU |
| Financial Information User (FIU) | [Yes/No] | Consumer of FI; decrypts FI it requested |
| Technical Service Provider (TSP) | [Yes/No] | Operates on behalf of an AA/FIP/FIU; inherits their obligations |
| Supporting / internal tool | [Yes/No] | Does not touch live ecosystem traffic |

### 2.2 Applicable Specifications & Regulations
| Framework | Version / Reference | Status |
|-----------|---------------------|--------|
| RBI Master Direction — Non-Banking Financial Company - Account Aggregator | [ref + date] | [Not verified] |
| ReBIT Account Aggregator API specification | [e.g. 2.0.0 — confirm current] | [Not verified] |
| Digital Personal Data Protection (DPDP) Act | [2023] | [Not verified] |
| RBI data-localisation / data-residency directions | [ref] | [Not verified] |
| CERT-In directions (incident reporting, log retention) | [ref] | [Not verified] |
| Sahamati participation / onboarding guidelines | [ref] | [Not verified] |

### 2.3 Conformance & Certification
- **Conformance status:** [Self-certified / Sahamati-certified / In progress]
- **Test harness used:** [Sahamati conformance suite / sandbox — version]
- **Sandbox vs production environment separation:** [Describe]

---

## 3. Architectural Goals & Principles

### 3.1 Goals
- [Goal 1: e.g., conformant ReBIT API surface with <Xms p95 for consent/FI calls]
- [Goal 2: e.g., end-to-end confidentiality of FI payloads — AA never sees plaintext]
- [Goal 3: e.g., non-repudiable, tamper-evident audit of every consent and FI event]
- [Goal 4: e.g., data residency entirely within India]

### 3.2 Design Principles
- **Consent-first.** No FI request, fetch, or processing occurs without a valid,
  unexpired, non-revoked consent artefact whose scope covers the operation.
- **Data minimisation & purpose limitation.** Request and retain only the FI
  types the stated purpose requires, for only as long as the consent permits.
- **Data-blind intermediary (AA).** The AA orchestrates consent and routing but
  is never in possession of FI plaintext or the decryption keys.
- **Privacy by design / by default** (DPDP). PII and FI are encrypted, access-
  logged, and never logged in cleartext.
- **Non-repudiation.** Every inter-participant request and consent artefact is
  digitally signed; signatures are verified, retained, and auditable.
- **No raw model/LLM output executed against real systems** (see CLAUDE.md hard rules).
- [Add system-specific principles.]

---

## 4. System Context (C4 Level 1)

### 4.1 System Overview
[What the system does and where it sits among AA ecosystem actors.]

### 4.2 Context Diagram
```
[Insert C4 L1 diagram. Show this system and its interactions with:
 - Data principals / customers (consent grant, FI consumers)
 - AA(s), FIP(s), FIU(s) as relevant
 - Sahamati Central Registry (entity discovery, public keys/certs)
 - Sahamati Token Service (inter-participant auth tokens)
 - Notification/webhook endpoints
 Use synthetic identifiers only.]
```

### 4.3 Ecosystem Actors & External Systems
| Actor / System | Role | Integration | Auth | SLA / Notes |
|----------------|------|-------------|------|-------------|
| Customer / Data Principal | Grants & manages consent | UI / redirect | [App / OTP] | — |
| [AA name] | Consent manager | ReBIT API | [Token + JWS] | [99.x%] |
| [FIP name] | FI source | ReBIT API | [Token + JWS] | [99.x%] |
| [FIU name] | FI consumer | ReBIT API | [Token + JWS] | [99.x%] |
| Sahamati Central Registry | Entity & key discovery | REST | [Token] | [Not verified] |
| Sahamati Token Service | Inter-participant tokens | REST | [Client creds] | [Not verified] |

---

## 5. Container Architecture (C4 Level 2)

### 5.1 Container Diagram
```
[Insert C4 L2 diagram: applications, data stores, signing/crypto service,
 message queues, and trust boundaries (which containers may hold FI plaintext,
 which may hold keys, which are data-blind).]
```

### 5.2 Containers
#### 5.2.1 [Container: e.g., API edge / ReBIT-facing service]
- **Technology:** [...]
- **Purpose / responsibilities:** [...]
- **Trust boundary:** [Internet-facing / internal]
- **Handles regulated data?** [None / consent metadata / FI plaintext / encrypted FI]
- **Dependencies:** [...]

#### 5.2.2 [Container: e.g., Signing & crypto service]
- **Technology:** [...]
- **Responsibilities:** JWS sign/verify, ECDH key exchange, FI encrypt/decrypt
- **Key custody:** [HSM / KMS / sealed store — see §10]

[Repeat per container.]

---

## 6. Component Architecture (C4 Level 3)

### 6.1 Component Diagram
```
[Insert C4 L3 for the containers that carry the most regulatory weight —
 typically the consent engine, the FI flow engine, and the crypto/signing service.]
```

### 6.2 Key Components
#### 6.2.1 [Component]
- **Responsibility:** [...]
- **Interfaces:** [APIs exposed/consumed]
- **Regulated-data exposure:** [...]
- **Dependencies:** [...]

---

## 7. Technology Stack

### 7.1 Application & Runtime
| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| [Language/runtime] | [...] | [...] | [...] |
| [Framework] | [...] | [...] | [...] |

### 7.2 Data Layer
| Component | Technology | Version | Encryption at rest | Residency |
|-----------|-----------|---------|--------------------|-----------|
| Primary DB | [...] | [...] | [Yes — scheme] | [India region] |
| Cache | [...] | [...] | [Yes/No] | [India region] |
| Object/file store | [...] | [...] | [Yes — scheme] | [India region] |

### 7.3 Cryptography
| Concern | Library / Service | Notes |
|---------|-------------------|-------|
| JWS detached signatures | [e.g. `jose`] | [Verify against ReBIT signing spec] |
| FI payload encryption | [e.g. ECDH + AES-GCM; ReBIT "Rahasya" reference] | [Not verified — confirm scheme] |
| Application secrets, key issuance & rotation | **Sahamati KMS** (`kms-client.ts`) | Org-standard custom KMS service over HTTP + Bearer token; see §10.3 |
| Local at-rest encryption | `libsql` `encryptionKey` (DB); AES-256-GCM (`credentials-crypto.ts`) | Keys from KMS / `data/.db-key` / `$SAHAMATI_DB_KEY` / `$SAHAMATI_CRED_KEY` |

### 7.4 Infrastructure
| Component | Technology | Justification | Residency |
|-----------|-----------|---------------|-----------|
| Cloud / hosting | [...] | [...] | **Must be India** |
| Orchestration | [...] | [...] | [...] |
| CI/CD | [...] | [...] | [...] |
| Observability | [...] | [...] | [...] |

> **Stack discipline:** if a task wants a different framework/DB/deployment than
> the pinned stack, stop and confirm with a tradeoff analysis (CLAUDE.md).

---

## 8. Consent Architecture

### 8.1 Consent Lifecycle
```
[Diagram the lifecycle: requested -> pending -> active -> (paused) ->
 revoked / expired, including who can trigger each transition.]
```

### 8.2 Consent Artefact
- **Structure & fields:** [purpose code, FI types, FI data range, fetch type
  (ONETIME/PERIODIC), frequency, data life, consent expiry, signature]
- **Signing:** [Which party signs; algorithm; where the signature is stored]
- **Storage:** [What is stored, where, encrypted how, for how long]
- **Verification points:** [Every place the artefact is re-validated before use]

### 8.3 Consent Flow (ReBIT)
| Step | API (verify against current ReBIT spec) | Direction | Notes |
|------|-----------------------------------------|-----------|-------|
| Request consent | [POST /Consent] | [FIU→AA] | [Not verified] |
| Consent handle / status | [GET /Consent/handle/{id}] | [FIU→AA] | [Not verified] |
| Fetch signed artefact | [GET /Consent/{id}] | [FIU→AA] | [Not verified] |
| Consent notification | [POST /Consent/Notification] | [AA→FIU/FIP] | [Not verified] |

### 8.4 Consent Enforcement
- [How scope (FI types, date range, purpose, frequency) is enforced at FI request time]
- [How revocation/expiry propagates and how in-flight sessions are stopped]
- [How periodic-consent frequency limits are enforced]

---

## 9. Financial Information (FI) Data Flow Architecture

### 9.1 FI Flow (ReBIT)
| Step | API (verify against current ReBIT spec) | Direction | Notes |
|------|-----------------------------------------|-----------|-------|
| FI request (initiate session) | [POST /FI/request] | [FIU→AA→FIP] | carries consent + key material |
| FI fetch | [POST /FI/fetch] | [FIU→AA→FIP] | returns encrypted FI |
| FI notification | [POST /FI/Notification] | [FIP→AA→FIU] | data-ready signal |

### 9.2 End-to-End Encryption (data-blind property)
```
[Diagram the ECDH key exchange and FI encryption path. Show that the FIP
 encrypts FI for the FIU using a shared secret derived from exchanged ephemeral
 public keys, and that the AA routes ciphertext only — it holds no decryption key.]
```
- **Key exchange:** [ECDH curve, ephemeral key generation, nonce handling]
- **Symmetric encryption:** [e.g. AES-GCM — confirm against ReBIT/Rahasya]
- **Where keys live and die:** [FIU/FIP key custody; AA holds none]
- **Plaintext boundary:** [Exactly which component first decrypts FI, and when]

### 9.3 FI Retention & Deletion
- [If FIU: how long decrypted FI is retained vs the consent's `dataLife`; deletion mechanism]
- [If AA: confirm NO FI persistence — only routing metadata]
- [Purge jobs, verification of deletion, and audit of deletion]

---

## 10. Cryptography, Signing & Key Management

### 10.1 Request Signing (non-repudiation)
- **Scheme:** [Detached JWS in `x-jws-signature` header — verify per ReBIT]
- **Signing key per request type:** [Which key signs what]
- **Verification:** [How peer public keys/certs are sourced from the Central Registry and cached]
- **Clock skew / replay protection:** [timestamp, nonce, txnid handling]

### 10.2 Key Management
| Key / Secret | Purpose | Storage | Rotation | Custodian |
|--------------|---------|---------|----------|-----------|
| Signing private key | Sign requests/artefacts | **Sahamati KMS** | KMS `rotateKey` w/ grace period | [...] |
| Application secrets (API keys, OAuth secrets) | Service operation | **Sahamati KMS**, injected at startup | KMS `rotateKey` | [...] |
| Inter-participant service tokens | Authn between participants | **Sahamati KMS** (`createServiceToken`) | KMS re-mint | [...] |
| FI encryption keys | ECDH ephemeral | in-memory / ephemeral | per session | [...] |
| DB encryption key | At-rest DB encryption | KMS / `data/.db-key` / `$SAHAMATI_DB_KEY` | [policy] | [...] |
| Credential encryption key | Encrypt stored bearer tokens (AES-256-GCM) | derived from `$SAHAMATI_CRED_KEY` (scrypt) | [policy] | [...] |

- **Rotation procedure:** prefer Sahamati KMS `rotateKey` (returns new secret once, with a grace window so consumers can roll over). Treat as destructive — requires explicit confirmation per security invariants.
- **Compromise / revocation runbook:** [Link]

### 10.3 Sahamati KMS Integration
The org-standard key/secret store is the custom **Sahamati KMS** service, reached
over HTTP with a Bearer token. Reference implementation:
[`agent-server/src/services/kms-client.ts`](../../agent-server/src/services/kms-client.ts).

- **Configuration:** `KMS_URL`, `KMS_AUTH_TOKEN`, `KMS_APP_NAME` (app scope is
  mandatory — the client refuses to bootstrap without it). Absent config is a
  no-op so local dev stays frictionless; locally-set env vars override KMS.
- **Startup bootstrap:** [`secrets-bootstrap.ts`](../../agent-server/src/services/secrets-bootstrap.ts)
  pulls the active secret per `key_type` and injects it into the environment
  before routes mount; per-secret failures warn and continue, never crashing boot.
- **Operations:** `getActiveSecret`, `getSecret`, `listKeys`, `generateKey`,
  `rotateKey` (grace period), `listServiceTokens`, `createServiceToken`. Generated
  keys and minted tokens return plaintext **once only**.
- **Exposure surfaces:** admin-gated HTTP routes
  ([`routes/secrets.ts`](../../agent-server/src/routes/secrets.ts), `requireAdmin`)
  and admin-gated agent tools ([`tools/secrets.ts`](../../agent-server/src/tools/secrets.ts)).
- **Invariant:** plaintext secrets are never persisted server-side, never logged,
  and never echoed in agent chat — surfaced only via the structured response.
- **Not** AWS/GCP KMS or HashiCorp Vault. If a future migration to a cloud KMS
  (CMEK) is intended, record it as an ADR with a tradeoff analysis (§21).

---

## 11. ReBIT API Conformance

### 11.1 Implemented Endpoints
| Endpoint (verify per spec) | Implemented | Conformance-tested | Notes |
|----------------------------|-------------|--------------------|-------|
| [Account discovery — /Accounts/discover] | [Y/N] | [Y/N] | [Not verified] |
| [Account linking — /Accounts/link, /link/verify] | [Y/N] | [Y/N] | [Not verified] |
| [Consent suite — §8.3] | [Y/N] | [Y/N] | [Not verified] |
| [FI suite — §9.1] | [Y/N] | [Y/N] | [Not verified] |
| [Heartbeat — /Heartbeat] | [Y/N] | [Y/N] | [Not verified] |

### 11.2 Notifications / Webhooks
- **Inbound webhooks:** [endpoints, signature verification, idempotency]
- **Outbound notifications:** [retry/backoff, ordering, delivery guarantees]

### 11.3 Error Handling & Spec Compliance
- [Error code mapping to ReBIT-defined errors; version negotiation; backward compatibility]

---

## 12. Ecosystem Integration

### 12.1 Sahamati Central Registry
- **Purpose:** entity discovery, public keys/certificates, participant status
- **Usage:** [When queried, what is cached and for how long, staleness handling]

### 12.2 Sahamati Token Service
- **Purpose:** inter-participant API authentication tokens
- **Usage:** [token acquisition, caching, refresh, scope]
- **Auth domain:** authentication uses `@sahamati.org.in` where applicable; never bypassed

### 12.3 Onboarding / Environment Promotion
- [Sandbox → production promotion gates; credential issuance; certification dependency]

---

## 13. Data Architecture

### 13.1 Data Flow Diagram
```
[Insert data flow. Annotate each store/edge with: classification (regulated/PII/
 metadata), encryption state (plaintext/ciphertext), and residency.]
```

### 13.2 Key Entities
- **[Entity]:** [Description, classification, retention basis]

> Diagrams and examples must use synthetic data only — no real consent IDs,
> account numbers, PAN, mobile, or VPAs.

### 13.3 Data Residency & Localisation
- **All regulated data and PII stored within India.** [State regions/zones.]
- [Cross-border processing prohibitions; backup/DR residency.]

### 13.4 Retention, Purpose Limitation & Deletion
| Data Type | Retention Basis | Period | Deletion / Archival |
|-----------|-----------------|--------|---------------------|
| Consent artefacts | [Regulatory / consent] | [...] | [...] |
| FI payloads (if FIU) | Consent `dataLife` | [per consent] | [purge + audit] |
| FI payloads (if AA) | **Not retained** | n/a | n/a |
| Audit logs | [CERT-In / RBI] | [e.g. 180 days+ — verify] | [archival] |
| PII | [Minimised] | [...] | [...] |

---

## 14. Security Architecture

### 14.1 Security Layers
```
[Network, application, data, and key-management layers; trust boundaries.]
```

### 14.2 Authentication & Authorization
- **Inter-participant:** [Token Service token + detached JWS verification]
- **Human/operator access:** [`@sahamati.org.in` auth; MFA; RBAC; least privilege]
- **Session management:** [scheme, expiry]

### 14.3 Data Security
- **Encryption at rest:** [scheme; DB encrypted at rest per CLAUDE.md hard rules]
- **Encryption in transit:** [TLS 1.2+/1.3; mTLS where required]
- **PII / FI handling:** [never logged in cleartext; access-logged; tokenised where possible]
- **Secrets management:** [`.env` gitignored; no secrets in repo/prompts/logs]

### 14.4 Network Security
- [Segmentation, WAF, DDoS protection, egress controls]

### 14.5 Secure Development & Supply Chain
- [SAST/DAST/dependency scanning; no LLM output executed against real systems; review gates]

---

## 15. Privacy & Data Protection (DPDP Act)

- **Lawful basis:** consent-driven; bound to ReBIT consent artefact scope and purpose.
- **Data principal rights:** [access, correction, erasure, grievance — how supported]
- **Consent withdrawal:** [propagation, effect on stored FI, confirmation to principal]
- **Data Protection / grievance contacts:** [roles]
- **Breach notification:** [DPDP + CERT-In timelines and process — verify]
- **Children's / special-category data:** [if applicable]

---

## 16. Scalability & Performance

### 16.1 Scaling Strategy
- [Horizontal/vertical; DB read replicas/sharding; statelessness of signing path]

### 16.2 Performance Targets
| Metric | Target | Notes |
|--------|--------|-------|
| Consent API latency | [<Xms p95] | [Align to any ReBIT/Sahamati SLA] |
| FI fetch latency | [<Xms p95] | [...] |
| Throughput | [N req/s] | [...] |
| Notification delivery | [<Xs] | [...] |

### 16.3 Caching
| Layer | Technology | TTL | Caveat |
|-------|-----------|-----|--------|
| Registry/keys | [...] | [...] | [Respect key rotation / revocation] |
| [Other] | [...] | [...] | **Never cache FI plaintext or PII** |

---

## 17. Reliability & Resilience

### 17.1 High Availability
- **Target uptime:** [99.x%] — [align to participant SLA expectations]
- **Multi-AZ / multi-region:** [within India only]

### 17.2 Disaster Recovery
- **RTO / RPO:** [...] / [...]
- **Backup strategy:** [encrypted, India-resident, tested restores]
- **DR runbook:** [Link]

### 17.3 Fault Tolerance
- [Circuit breakers for peer calls, retry/backoff for notifications, idempotency
  keys for FI/consent operations, graceful degradation]

---

## 18. Deployment Architecture

### 18.1 Environments
| Environment | Purpose | Data | Residency |
|-------------|---------|------|-----------|
| Development | Dev | Synthetic only | [...] |
| Sandbox | ReBIT/Sahamati conformance | Synthetic only | India |
| Production | Live ecosystem traffic | Regulated | India |

### 18.2 Infrastructure Diagram
```
[Insert deployment diagram — India regions/zones, trust boundaries, key stores.]
```

### 18.3 CI/CD
```
[Commit] → [Build] → [Test] → [SAST/Dependency Scan] → [Secrets Scan]
        → [Deploy Sandbox] → [Conformance Tests] → [Deploy Prod]
```
- **Release controls:** [no `--no-verify`; no force-push to `main`; build before PR]
- **Rollback:** [strategy]

---

## 19. Observability & Audit

### 19.1 Monitoring Stack
| Component | Tool | Purpose |
|-----------|------|---------|
| Metrics | [...] | infra & app |
| Logs | [...] | centralized (no PII/FI cleartext) |
| Traces | [...] | distributed tracing (redacted) |
| Alerts | [...] | incident alerting |

### 19.2 Regulatory Audit Trail
- **Tamper-evidence:** [append-only / signed log strategy]
- **What is logged:** consent grant/revoke, FI request/fetch, signature verify
  results, access to regulated stores — **with identifiers redacted/tokenised**
- **Retention:** [per CERT-In / RBI — verify]
- **Non-repudiation:** [retained signatures map to logged events]

### 19.3 Alerting
| Alert | Threshold | Severity | Action |
|-------|-----------|----------|--------|
| Signature verification failures | [>N/min] | Critical | Page on-call |
| Consent enforcement bypass attempts | [>0] | Critical | Page + investigate |
| FI fetch error rate | [>X%] | Warning | Ticket |

---

## 20. Compliance & Regulatory Mapping

| Requirement | Source | Where addressed (this doc / control) | Status |
|-------------|--------|--------------------------------------|--------|
| Data-blind AA (no FI plaintext) | RBI MD NBFC-AA | §2.1, §9.2 | [...] |
| Consent-bound FI access | ReBIT spec | §8, §9 | [...] |
| Request signing / non-repudiation | ReBIT spec | §10.1, §19.2 | [...] |
| End-to-end FI encryption | ReBIT spec | §9.2 | [...] |
| Data localisation (India) | RBI directions | §13.3, §18 | [...] |
| Purpose limitation & retention | DPDP / consent | §13.4, §15 | [...] |
| Breach / incident reporting | CERT-In / DPDP | §15, §19 | [...] |
| Encryption at rest | Internal hard rule | §14.3 | [...] |

> Mark each status as **[Verified against <source, date>]** or **[Not verified]**.
> For regulator-tier documents, no row may remain unverified.

---

## 21. Architecture Decision Records (ADRs)
| ID | Decision | Date | Status |
|----|----------|------|--------|
| [ADR-001] | [...] | [YYYY-MM-DD] | [Accepted] |

[See `docs/architecture/adr/` for detailed ADRs.]

---

## 22. Migration Strategy
[If migrating from a legacy system or changing crypto/DB drivers. Note: libsql
at-rest encryption is not cipher-compatible with SQLCipher/plaintext — a
driver/cipher change needs a one-time re-encrypt migration (see
`agent-server/scripts/migrate-db-to-libsql.ts`).]

### 22.1 Phases
1. [Parallel run]
2. [Gradual cutover]
3. [Legacy decommission]

### 22.2 Data Migration
- **Strategy / validation:** [ETL, integrity checks, residency preserved]

---

## 23. Risks & Open Questions
| Risk / Question | Impact | Likelihood | Mitigation / Owner |
|-----------------|--------|------------|--------------------|
| [Spec version drift] | [...] | [...] | [Track ReBIT releases] |
| [Key compromise] | [...] | [...] | [Rotation runbook] |

---

## 24. References
- ReBIT Account Aggregator API specification — [link, version, date]
- RBI Master Direction (NBFC-AA) — [link]
- DPDP Act — [link]
- CERT-In directions — [link]
- Sahamati participation / conformance guidelines — [link]
- ADR repository / API docs / runbooks — [links]

---

## 25. Appendices

### Appendix A: Glossary
| Term | Definition |
|------|-----------|
| AA | Account Aggregator — RBI-licensed consent manager; data-blind intermediary |
| FIP | Financial Information Provider — source of financial information |
| FIU | Financial Information User — consumer of financial information |
| TSP | Technical Service Provider — operates on behalf of an ecosystem participant |
| Consent artefact | Signed, structured record defining purpose, FI types, scope, and duration of data sharing |
| FI | Financial Information — the regulated payload shared under consent |
| Consent handle / consent ID | Identifiers in the consent flow |
| FI session / session ID | Identifiers for an FI fetch session |
| Detached JWS | Signature scheme used to sign inter-participant requests |
| ECDH | Elliptic-curve Diffie-Hellman key exchange used to derive FI encryption keys |
| Central Registry | Sahamati registry of ecosystem entities, keys, and status |
| Data Principal | The individual to whom the personal data / FI relates (DPDP) |

### Appendix B: Diagrams
[Additional detailed diagrams — synthetic data only.]

### Appendix C: Conformance Evidence
[Links to conformance test runs, certificates, sandbox results.]
