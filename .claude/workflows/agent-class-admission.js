export const meta = {
  name: 'agent-class-admission',
  description: 'Section 6.4 custom-code admission: fan out conformance-corpus reviewers over a submitted agent-class manifest, adversarially verify each finding, synthesize an admission decision bound to the image measurement',
  whenToUse: 'When an FIU/TSP submits or revises an agent class for admission into the shared TEE and the ACR must decide admit / conditional / reject',
  phases: [
    { title: 'Intake', detail: 'validate manifest, extract measurement set + allow-list + redactor' },
    { title: 'Conformance corpus', detail: 'parallel reviewers, one per corpus category' },
    { title: 'Verify', detail: 'adversarially verify each finding before it counts' },
    { title: 'Admission decision', detail: 'synthesize admit/conditional/reject + receipts + validity window' },
  ],
}

// --- Synthetic submissions under review (TEST DATA — no real participant) ---
// For a live demo, run with no args to get the REJECT case, args:'clean' for the ADMIT case,
// or pass a full manifest object as args to review your own (still synthetic) submission.
//
// FLAWED sample — three planted defects so the gate has something to catch:
//  1. `web.fetch` in the allow-list = an ambient-network egress surface that bypasses the redactor.
//  2. deployment is platform-operator shared TEE serving multiple FIUs, but the sandbox measurement
//     is a WASM runtime hash, not a per-tenant nested confidential-VM image hash.
//  3. redactorHash is declared in the manifest but NOT bound into the launch measurement set.
const FLAWED_MANIFEST = {
  agentClassId: 'fiu.creditco-test.underwriting',
  version: '3.2.0',
  participant: { type: 'FIU', name: 'CreditCo (TEST)', domain: 'creditco-test.example' },
  measurements: {
    imageMeasurement: 'sha256:1111aaaa...TEST-participant-binary',
    sandboxModuleHash: 'sha256:2222bbbb...TEST-wasm-runtime',
    modelWeightsHashes: [],
  },
  modelExecution: {
    pattern: 'C',
    externalModelEndpoint: 'models.creditco-test.example/underwrite-llm',
    redactorHash: 'sha256:3333cccc...TEST-redactor',
  },
  mcpToolAllowList: ['consent.read', 'fi.fetch-statement', 'scoring.compute', 'web.fetch'],
  supplyChain: {
    signer: 'creditco-release@creditco-test.example',
    slsaLevel: 2,
    buildEvidenceUri: 'rekor-test.example/log/abc123',
    transparencyLogEntry: 'rekor-test.example/entries/abc123',
  },
  deployment: 'platform-operator-shared-tee',
  servedPrincipals: ['fiu.creditco-test', 'fiu.lendpro-test'],
}

// CLEAN sample — single-tenant deployment that should clear admission (ADMIT).
//  - WASM sandbox hash is correct here (single tenant, default sandbox).
//  - redactorHash is bound into the launch measurement set.
//  - allow-list is least-privilege; no ambient-network tool; only egress is the redactor-gated model wire.
const CLEAN_MANIFEST = {
  agentClassId: 'fiu.lendpro-test.affordability',
  version: '1.0.0',
  participant: { type: 'FIU', name: 'LendPro (TEST)', domain: 'lendpro-test.example' },
  measurements: {
    imageMeasurement: 'sha256:aaaa1111...TEST-participant-binary',
    sandboxModuleHash: 'sha256:bbbb2222...TEST-wasm-runtime',
    launchMeasurementSet: [
      'sha256:aaaa1111...TEST-participant-binary',
      'sha256:bbbb2222...TEST-wasm-runtime',
      'sha256:cccc3333...TEST-redactor',
    ],
    modelWeightsHashes: [],
  },
  modelExecution: {
    pattern: 'C',
    externalModelEndpoint: 'models.lendpro-test.example/affordability-llm',
    redactorHash: 'sha256:cccc3333...TEST-redactor',
  },
  mcpToolAllowList: ['consent.read', 'fi.fetch-statement', 'scoring.compute'],
  supplyChain: {
    signer: 'lendpro-release@lendpro-test.example',
    slsaLevel: 3,
    buildEvidenceUri: 'rekor-test.example/log/def456',
    transparencyLogEntry: 'rekor-test.example/entries/def456',
  },
  deployment: 'single-tenant',
  servedPrincipals: ['fiu.lendpro-test'],
}

// args: undefined/'flawed' -> FLAWED; 'clean' -> CLEAN; a manifest object -> that manifest.
const MANIFEST =
  args && typeof args === 'object'
    ? args
    : args === 'clean'
    ? CLEAN_MANIFEST
    : FLAWED_MANIFEST

const SPEC = `
Sahamati AA framework, Section 6.4 (custom code admission). Admission binds to a MEASUREMENT of
the running code, not to the signer's identity. Hard rules the manifest must satisfy:
- Measurement set required: image measurement of the participant binary, sandbox-module hash, and
  hashes of any model weights declared for in-enclave attested execution.
- Code signing is supply-chain provenance only (SLSA-grade build evidence + transparency-log entry);
  a valid signature is NOT sufficient to admit. The runtime binds to the measurement.
- Per-tenant inner sandbox. Default = WebAssembly with a pinned runtime whose hash is in the launch
  measurement. A platform operator serving multiple mutually-distrusting FIUs MUST run each tenant
  in its own nested confidential VM with its own enclave-bound key and attestation chain — and the
  sandbox-module measurement for that deployment is the nested-CVM image hash, not a WASM hash.
- NO ambient network or filesystem inside the sandbox. The only IO surface is the set of Unix-socket
  MCP imports the manifest declared; the host-side wire observer enforces the allow-list on every call.
- For an agent that calls a model OUTSIDE the TEE (Pattern C/D), the prompt MUST traverse a declared
  deterministic redactor whose hash is in the launch measurement. Without it the MCP wire is a legal
  cleartext exfiltration path. An external-model call that skips the redactor produces a refusal receipt.
- Out-of-allow-list calls and missing-redactor egress produce refusal receipts naming the agent
  measurement, the attempted tool, and the consent artefact.
`.trim()

const INTAKE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    manifestValid: { type: 'boolean' },
    imageMeasurement: { type: 'string' },
    sandboxModuleHash: { type: 'string' },
    modelWeightsHashes: { type: 'array', items: { type: 'string' } },
    toolAllowList: { type: 'array', items: { type: 'string' } },
    redactorHash: { type: ['string', 'null'] },
    modelPattern: { type: 'string' },
    deployment: { type: 'string' },
    missingFields: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['manifestValid', 'missingFields', 'notes'],
}

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    category: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          manifestField: { type: 'string' },
          producesRefusalReceipt: { type: 'boolean' },
        },
        required: ['id', 'severity', 'title', 'detail'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['category', 'findings', 'summary'],
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    findingId: { type: 'string' },
    upheld: { type: 'boolean' },
    adjustedSeverity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info', 'dismissed'] },
    reasoning: { type: 'string' },
  },
  required: ['findingId', 'upheld', 'reasoning'],
}

const DECISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['ADMIT', 'CONDITIONAL', 'REJECT'] },
    rationale: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    validityWindowDays: { type: 'number' },
    boundMeasurement: { type: 'string' },
    receiptsEmitted: { type: 'array', items: { type: 'string' } },
    transparencyLogEntry: {
      type: 'object', additionalProperties: false,
      properties: {
        imageMeasurement: { type: 'string' },
        manifestVersion: { type: 'string' },
        admitted: { type: 'boolean' },
      },
    },
  },
  required: ['decision', 'rationale', 'blockers', 'conditions'],
}

const M = JSON.stringify(MANIFEST, null, 2)

phase('Intake')
const intake = await agent(
  `You are the ACR intake validator for agent-class admission. SYNTHETIC TEST manifest below.

${SPEC}

MANIFEST:
${M}

Validate structure and extract the measurement set, the MCP tool allow-list, the redactor hash, the
declared model pattern, and the deployment type. List any required field that is missing or internally
inconsistent (e.g. a measurement field absent, a Pattern C manifest with no redactor hash). Do not yet
judge security posture — just intake.`,
  { schema: INTAKE_SCHEMA, label: 'intake' }
)

phase('Conformance corpus')
const CATEGORIES = [
  { key: 'schema', focus: 'Schema & completeness: every required measurement field present and well-formed (image measurement, sandbox-module hash, model-weights hashes), manifest version, participant identity, supply-chain block. Flag missing/malformed fields.' },
  { key: 'behavioural', focus: 'Behavioural conformance: does the declared behaviour match framework expectations — redactor traversal on external-model egress, receipt emission, consent-bound action. Flag declared behaviour that violates the framework contract.' },
  { key: 'adversarial', focus: 'Adversarial robustness: prompt-injection / jailbreak resistance posture as it can be inferred from the declared model pattern and egress surface. Flag patterns that widen the adversarial surface.' },
  { key: 'tool-surface', focus: 'Tool-call pattern compliance & least privilege: review the MCP allow-list. Any tool that grants ambient network/filesystem reach, or that is broader than the underwriting purpose needs, is a finding. Recall: the ONLY legal external egress is via the declared redactor to the declared model wire.' },
  { key: 'refusal-receipt', focus: 'Refusal-receipt expectations: confirm that out-of-allow-list calls and missing-redactor egress would generate refusal receipts at the wire observer. Flag anything the manifest implies could escape refusal.' },
  { key: 'covert-channel', focus: 'Covert-channel probes: enumerate exfiltration paths. Is there any IO surface besides the declared MCP imports + redactor-gated model wire? An allow-listed generic fetch/HTTP tool is a cleartext exfiltration path that bypasses the redactor — treat as a blocker.' },
  { key: 'measurement-binding', focus: 'Measurement binding & multi-tenant isolation: the sandbox-module measurement must match the deployment. A platform-operator shared-TEE serving multiple mutually-distrusting FIUs MUST be per-tenant nested confidential VMs, and the sandbox measurement must be the nested-CVM image hash — NOT a shared WASM runtime hash. Also: signing alone never admits; check SLSA grade + transparency-log entry as provenance only.' },
]

const reviewed = await pipeline(
  CATEGORIES,
  (c) => agent(
    `You are a conformance-corpus reviewer for the "${c.key}" category of the Sahamati agent-class
admission gate. SYNTHETIC TEST manifest.

${SPEC}

YOUR CATEGORY FOCUS:
${c.focus}

MANIFEST:
${M}

Return findings for THIS category only. Be precise about the manifest field at fault and whether the
condition should produce a refusal receipt at runtime. Empty findings array is a valid result if clean.`,
    { schema: FINDINGS_SCHEMA, label: `review:${c.key}`, phase: 'Conformance corpus' }
  ),
  (review) => parallel((review.findings || []).map((f) => () =>
    agent(
      `Adversarially verify this admission finding against the Section 6.4 spec. Try to REFUTE it.
Default to upheld=false if the finding misreads the manifest or the spec, or overstates severity.

${SPEC}

MANIFEST:
${M}

FINDING (category "${review.category}"):
${JSON.stringify(f, null, 2)}

Is this a real, spec-grounded admission defect? If real, confirm or adjust its severity. If not, dismiss it.`,
      { schema: VERDICT_SCHEMA, label: `verify:${f.id}`, phase: 'Verify' }
    ).then((v) => ({ ...f, category: review.category, verdict: v }))
  ))
)

const allVerified = reviewed.flat().filter(Boolean)
const upheld = allVerified.filter((f) => f.verdict && f.verdict.upheld && f.verdict.adjustedSeverity !== 'dismissed')
log(`${upheld.length} findings upheld of ${allVerified.length} raised across ${CATEGORIES.length} corpus categories`)

phase('Admission decision')
const decision = await agent(
  `You are the ACR admission authority. Decide ADMIT / CONDITIONAL / REJECT for this agent class,
binding the decision to the IMAGE MEASUREMENT, not the signer. SYNTHETIC TEST run.

${SPEC}

INTAKE:
${JSON.stringify(intake, null, 2)}

UPHELD FINDINGS (post adversarial verification):
${JSON.stringify(upheld, null, 2)}

Rules for the verdict:
- Any upheld 'blocker' => REJECT (or CONDITIONAL only if the operator can remediate without re-measuring
  the binary; a covert-channel / isolation blocker is never conditional).
- Upheld 'major' with no blocker => CONDITIONAL with explicit, checkable conditions.
- Otherwise ADMIT.
State which receipts the runtime would emit (load receipt on admit; refusal receipts for the flagged
egress paths), the validity window in days, the measurement the admission binds to, and the transparency-log entry.`,
  { schema: DECISION_SCHEMA, label: 'admission-decision' }
)

return { intake, manifest: MANIFEST, upheldFindings: upheld, decision }
