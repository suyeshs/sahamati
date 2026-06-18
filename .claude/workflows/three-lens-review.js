export const meta = {
  name: 'three-lens-review',
  description: 'Three reviewers examine real code in THIS repo in parallel (one lens each: correctness, security, readability), then one agent synthesizes their findings into a single ranked report. Reviews the uncommitted diff by default, or any path passed as args. Demonstrates fan-out + synthesize.',
  whenToUse: 'Review the current changes (or a given file/dir) in this repo across three lenses at once. Good live demo of multi-agent workflows on real code.',
  phases: [
    { title: 'Review', detail: 'three lenses run at the same time over real repo code' },
    { title: 'Synthesize', detail: 'one agent merges all findings into one ranked report' },
  ],
}

// What to review. No args -> the uncommitted working-tree diff ("review my changes").
// args = a path or glob (e.g. "agent-server/src/db/index.ts") -> review that instead.
const TARGET = typeof args === 'string' && args.trim() ? args.trim() : 'DIFF'

const howToGetCode =
  TARGET === 'DIFF'
    ? `Review the UNCOMMITTED changes in this repository. Run \`git diff HEAD\` (and \`git status\` if useful) to see them. Focus ONLY on source code (.ts, .tsx, .rs); IGNORE Cargo.lock, package-lock, generated files, pure CSS, and markdown. Judge the changed/added lines, not the whole file.`
    : `Review the code at \`${TARGET}\` in this repository. Use Read/Grep to open it (if it is a directory, list it and read the relevant source files).`

// One lens per reviewer — each agent holds one job and ignores the others,
// so findings stay focused instead of blurring together.
const LENSES = [
  { key: 'correctness', brief: 'Logic bugs only: wrong operators, off-by-one, bad conditionals, unhandled async/errors, edge cases. Ignore style and security.' },
  { key: 'security',    brief: 'Security only: injection, unsafe input handling, secrets/PII exposure, auth gaps, unsafe IPC/FS. Ignore style and ordinary bugs.' },
  { key: 'readability', brief: 'Readability/maintainability only: naming, dead code, magic values, mixed responsibilities, missing types. Ignore bugs and security.' },
]

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'string' },
          detail: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'title', 'detail'],
      },
    },
  },
  required: ['lens', 'findings'],
}

const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['ship', 'fix-first', 'reject'] },
    summary: { type: 'string' },
    ranked: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          rank: { type: 'number' },
          lens: { type: 'string' },
          severity: { type: 'string' },
          title: { type: 'string' },
          file: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['rank', 'lens', 'severity', 'title'],
      },
    },
  },
  required: ['verdict', 'summary', 'ranked'],
}

const repoContext =
  'This is the Sahamati framework repo. Honor its CLAUDE.md hard rules: no raw LLM-generated SQL/shell against real systems, secrets/PII stay out of repo and logs, the SQLite DB is encrypted, validate at boundaries with Zod, TypeScript strict (no `any`).'

// PHASE 1 — fan out. parallel() runs all three at once and waits for all of them
// (a barrier), because the synthesizer genuinely needs every lens's findings together.
phase('Review')
const reviews = await parallel(
  LENSES.map((lens) => () =>
    agent(
      `You are a code reviewer with ONE job: the "${lens.key}" lens.\n${lens.brief}\n\n${howToGetCode}\n\n${repoContext}\n\nUse your tools to read the actual code, then report only ${lens.key} findings. Give the file path and line for each. An empty list is a valid result if the changes are clean on your lens. Be concrete and cite real lines — do not invent issues.`,
      { schema: FINDINGS_SCHEMA, label: `review:${lens.key}` }
    )
  )
)

const allFindings = reviews.filter(Boolean).flatMap((r) => (r.findings || []).map((f) => ({ ...f, lens: r.lens })))
log(`${allFindings.length} findings across ${LENSES.length} lenses on target: ${TARGET}`)

// PHASE 2 — merge. One agent turns three separate lists into one prioritized report.
phase('Synthesize')
const report = await agent(
  `You are the lead reviewer for the Sahamati repo. Three reviewers each examined ${TARGET === 'DIFF' ? 'the current uncommitted changes' : `\`${TARGET}\``} through one lens. Merge their findings into ONE prioritized report: rank by real-world impact, drop duplicates and non-issues, give a one-line fix for each, and a verdict (ship / fix-first / reject). Weight anything touching the CLAUDE.md hard rules (injection, secrets/PII, DB encryption, unvalidated boundaries) at the top.\n\nFINDINGS:\n${JSON.stringify(allFindings, null, 2)}`,
  { schema: REPORT_SCHEMA, label: 'synthesize' }
)

return { target: TARGET, findingsByLens: reviews.filter(Boolean), report }
