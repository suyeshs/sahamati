---
title: "VAPT Report: [Project Name]"
generated_by: vapt-agent
version: "1.0"
date: "[ISO-8601 date]"
requires_review: true
confidence: "[0.0-1.0]"
status: draft
classification: confidential
---

# Vulnerability Assessment & Penetration Testing (VAPT) Report

## 1. Executive Summary

| Field | Details |
|-------|---------|
| **Project Name** | [Project Name] |
| **Assessment Date** | [Date] |
| **Assessed By** | vapt-agent |
| **In-Scope Target** | [deployment host, e.g. saans-labs.sahamati.org.in] |
| **Source Reviewed** | [repository path] |
| **Environment** | [labs / staging — never production without written authorization] |
| **Overall Risk Rating** | [CRITICAL / HIGH / MEDIUM / LOW] |
| **Total Findings** | [Count] |

### Risk Summary
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Informational | 0 |

---

## 2. Scope & Rules of Engagement

- **In-scope target**: [host] — testing authorized for this target only.
- **Source path**: [repo path]
- **Out of scope**: production AA/FIP/FIU systems, third-party/dependency endpoints, any host not listed.
- **Execution model**: All offensive steps are operator-driven via the authorized pentest tooling (`InHousePentestTool`). This report plans and analyses; it does not auto-execute against any host.
- **Constraints**: Non-destructive only. No DoS, no account-lockout storms, no detection evasion, no data-destroying payloads. Synthetic inputs only. Anything risking labs availability is flagged "requires owner sign-off".
- **Testing window**: [assumption / TBD by operator].

---

## 3. Reconnaissance (from source)

| Aspect | Detail |
|--------|--------|
| Stack | |
| Entry points / routes | |
| Auth surfaces | |
| Data stores | |
| External integrations | [KMS, OAuth, DB, LLM, …] |
| Attack surface summary | |

---

## 4. Threat Model (STRIDE)

| Asset | Threat (S/T/R/I/D/E) | Trust boundary | Highest-value attack path |
|-------|----------------------|----------------|---------------------------|
| | | | |

---

## 5. Vulnerability Assessment Coverage

### 5.1 OWASP Top 10:2025 (with 2021 cross-map)
| # (2025) | Category | 2021 cross-map | Verdict | Finding Refs |
|----------|----------|----------------|---------|-------------|
| A01:2025 | Broken Access Control (SSRF now folded in) | A01 + A10 (SSRF) | [PASS/FAIL/PARTIAL/N/A] | |
| A02:2025 | Security Misconfiguration | A05 | [PASS/FAIL/PARTIAL/N/A] | |
| A03:2025 | Software Supply Chain Failures | A06 (broadened) | [PASS/FAIL/PARTIAL/N/A] | |
| A04:2025 | Cryptographic Failures | A02 | [PASS/FAIL/PARTIAL/N/A] | |
| A05:2025 | Injection | A03 | [PASS/FAIL/PARTIAL/N/A] | |
| A06:2025 | Insecure Design | A04 | [PASS/FAIL/PARTIAL/N/A] | |
| A07:2025 | Authentication Failures | A07 | [PASS/FAIL/PARTIAL/N/A] | |
| A08:2025 | Data Integrity and Confidentiality Failures | A08 (+ parts of A02) | [PASS/FAIL/PARTIAL/N/A] | |
| A09:2025 | Security Logging and Monitoring Failures | A09 | [PASS/FAIL/PARTIAL/N/A] | |
| A10:2025 | Mishandling of Exceptional Conditions | (new in 2025) | [PASS/FAIL/PARTIAL/N/A] | |

### 5.2 AA-ecosystem controls
| Control | Verdict | Notes |
|---------|---------|-------|
| Consent-artefact handling | | |
| Token verification (JWT/session) | | |
| FIP/FIU authorization isolation | | |
| KMS / key handling | | |
| Regulated-data logging hygiene | | |

---

## 6. Test Execution Register (tests run & results)

Every discrete check performed during this assessment, with its result. This is the authoritative
"what was tested and what happened" record. Status ∈ PASS / FAIL / PARTIAL / N/A. Each FAIL/PARTIAL
links to a finding. Group rows by control area.

| Test ID | Control Area | Test / Check | Method | Result | Evidence / Finding |
|---------|--------------|--------------|--------|--------|--------------------|
| T-A01 | [e.g. Authentication] | [what was verified] | [Static review / Config inspection / Dynamic — operator] | [PASS/FAIL/PARTIAL/N/A] | [file:line or FINDING-XXX] |

**Register summary:** [N tests run — X pass, Y fail, Z partial, W n/a]. Tests marked method "Dynamic — operator"
are specified in §7 and were **not** auto-executed.

---

## 7. Penetration-Test Plan (operator run-book)

Each case is **executable by an operator, not auto-run**. Non-destructive, synthetic inputs, explicit stop condition.

### TC-001 — [Title]
| Field | Detail |
|-------|--------|
| Linked finding | [FINDING-XXX] |
| Hypothesis | |
| In-scope endpoint | |
| Tool/steps (`InHousePentestTool`) | |
| Synthetic input | [e.g. customer-test-001] |
| Expected (secure) result | |
| Vulnerable result | |
| Stop condition | |

---

## 8. Findings

### 8.1 [FINDING-001]: [Title]
| Field | Details |
|-------|---------|
| **Severity** | [CRITICAL / HIGH / MEDIUM / LOW / INFO] |
| **OWASP** | [A0X:2021] |
| **CWE** | [CWE-XXX] |
| **CVSS 3.1** | [vector] — [score] |
| **Likelihood × Impact** | [rating] |
| **File(s) / Line(s)** | |
| **Linked test case** | [TC-XXX] |
| **Status** | [Open / Requires live verification] |

**Description:** 

**Evidence:**
```
[snippet — redact real secrets/PII]
```

**Impact:** 

**Remediation:** 

**Remediation Example:**
```
[fixed code]
```

---

## 9. CWE/SANS Top 25 (2023) Coverage

Every row a verdict; `N/A` justified in one line.

| # | CWE | Weakness | Verdict | Finding Refs |
|---|-----|----------|---------|-------------|
| 1 | CWE-787 | Out-of-bounds Write | | |
| 2 | CWE-79 | Cross-site Scripting | | |
| 3 | CWE-89 | SQL Injection | | |
| 4 | CWE-416 | Use After Free | | |
| 5 | CWE-78 | OS Command Injection | | |
| 6 | CWE-20 | Improper Input Validation | | |
| 7 | CWE-125 | Out-of-bounds Read | | |
| 8 | CWE-22 | Path Traversal | | |
| 9 | CWE-352 | CSRF | | |
| 10 | CWE-434 | Unrestricted File Upload | | |
| 11 | CWE-862 | Missing Authorization | | |
| 12 | CWE-476 | NULL Pointer Dereference | | |
| 13 | CWE-287 | Improper Authentication | | |
| 14 | CWE-190 | Integer Overflow | | |
| 15 | CWE-502 | Deserialization of Untrusted Data | | |
| 16 | CWE-77 | Command Injection | | |
| 17 | CWE-119 | Improper Memory Buffer Restriction | | |
| 18 | CWE-798 | Hard-coded Credentials | | |
| 19 | CWE-918 | SSRF | | |
| 20 | CWE-306 | Missing Authentication for Critical Function | | |
| 21 | CWE-362 | Race Condition | | |
| 22 | CWE-269 | Improper Privilege Management | | |
| 23 | CWE-94 | Code Injection | | |
| 24 | CWE-863 | Incorrect Authorization | | |
| 25 | CWE-276 | Incorrect Default Permissions | | |

---

## 10. Remediation & Retest

### Priority
- **Immediate (0–48h)**: [ ]
- **Short-term (1–2 weeks)**: [ ]
- **Medium-term (1–3 months)**: [ ]

### Retest Checklist
- [ ] [Per-finding retest item]

### Residual Risk
[Statement of risk remaining after planned remediation.]

---

## 11. Regulatory Alignment

Maps the assessment to the Indian open-finance / Account Aggregator regulatory baseline. Mark each
Aligned / Gap / N/A with finding refs — do not leave blank.

| Framework | Relevant requirement | Assessment coverage | Status |
|-----------|----------------------|---------------------|--------|
| DPDP Act 2023 | Security safeguards (S.8(5)); purpose limitation & data minimisation; personal-data breach notification | [finding refs] | [Aligned/Gap/N/A] |
| RBI AA Master Directions (NBFC-AA, 2016 as amended) | Consent architecture; data-blind AA (no FI-data storage); access control | | |
| ReBIT AA Technical Specification | Consent-artefact integrity & signing; FI-data encryption (ECDH key exchange); signed/authenticated API calls | | |
| IT Act 2000 + SPDI Rules 2011 / ISO 27001 | Reasonable security practices & procedures | | |
| CERT-In Directions (Apr 2022) | Incident reporting within 6 hours; 180-day log retention; synchronised clocks (NTP) | | |

> Scope the rows honestly: a component that handles only pre-aggregated/derived metrics (not consent
> artefacts or raw FI payloads) should mark those rows **N/A** with a one-line justification rather than
> claim coverage it does not have.

---

## Appendix A: References
- OWASP Top 10:2025 (with 2021 cross-map), OWASP Testing Guide, CWE/SANS Top 25 (2023), CVSS 3.1, STRIDE.

## Appendix B: Glossary
| Term | Definition |
|------|-----------|
| VAPT | Vulnerability Assessment & Penetration Testing |
| RoE | Rules of Engagement |
| STRIDE | Spoofing, Tampering, Repudiation, Information disclosure, DoS, Elevation of privilege |
| CVSS | Common Vulnerability Scoring System |
