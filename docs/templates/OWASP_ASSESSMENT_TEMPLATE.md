---
title: "OWASP Assessment: [Project Name]"
generated_by: owasp-agent
version: "1.0"
date: "[ISO-8601 date]"
requires_review: true
confidence: "[0.0-1.0]"
status: draft
classification: confidential
---

# OWASP Top 10 Assessment Report

## 1. Executive Summary

| Field | Details |
|-------|---------|
| **Project Name** | [Project Name] |
| **Assessment Date** | [Date] |
| **Assessed By** | owasp-agent |
| **In-Scope Target** | [deployment host, e.g. saans-labs.sahamati.org.in] |
| **Source Reviewed** | [repository path] |
| **Standards** | OWASP Top 10:2025 (2021 cross-map), OWASP ASVS 4.0 |
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

## 2. Scope & Methodology

### 2.1 Scope
- **In-scope deployment**: [host] — assessment authorized for this target only.
- **Source path**: [repo path]
- **Out of scope**: production AA/FIP/FIU systems, third-party endpoints, any host not listed above.

### 2.2 Method
Source- and architecture-driven review against the OWASP Top 10:2025 (with a 2021 cross-map), spot-checked against ASVS 4.0. Active verification is performed separately by an operator via the authorized pentest tooling (`InHousePentestTool`); this report supplies the test plan, not live execution.

### 2.3 Application Overview
| Component | Technology |
|-----------|-----------|
| Language | [ ] |
| Framework | [ ] |
| Data store | [ ] |
| Auth | [ ] |
| External integrations | [ ] |

### 2.4 Threat Model (STRIDE)
A brief STRIDE model of the in-scope system — the assets, the threat each faces, the trust boundary crossed,
and the highest-value attack path. This drives which OWASP categories to probe hardest.

| Asset | Threat (S/T/R/I/D/E) | Trust boundary | Highest-value attack path |
|-------|----------------------|----------------|---------------------------|
| | | | |

---

## 3. OWASP Top 10:2025 Coverage

Primary mapping is the **OWASP Top 10:2025** (released Jan 2026); the **2021** column is retained for
cross-reference with CWE tooling and earlier reports. Every row carries a verdict and finding refs;
`N/A` requires a one-line justification.

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

### ASVS Spot-check
| ASVS Section | Verdict | Notes |
|--------------|---------|-------|
| V2 Authentication | | |
| V3 Session Management | | |
| V4 Access Control | | |
| V5 Validation/Encoding | | |
| V7 Error/Logging | | |
| V9 Communications | | |
| V13 API | | |

---

## 4. Test Execution Register (tests run & results)

Every discrete check performed, with its result. Status ∈ PASS / FAIL / PARTIAL / N/A; each FAIL/PARTIAL
links to a finding. Group rows by OWASP category / control area.

| Test ID | OWASP / Control Area | Test / Check | Method | Result | Evidence / Finding |
|---------|----------------------|--------------|--------|--------|--------------------|
| T-01 | [e.g. A07 Auth] | [what was verified] | [Static review / Config inspection / Dynamic — operator] | [PASS/FAIL/PARTIAL/N/A] | [file:line or FINDING-XXX] |

**Register summary:** [N tests run — X pass, Y fail, Z partial, W n/a]. Method "Dynamic — operator" rows are
specified per-finding and were **not** auto-executed.

---

## 5. Findings

<!-- Repeat per finding -->

### 5.1 [FINDING-001]: [Title]

| Field | Details |
|-------|---------|
| **Severity** | [CRITICAL / HIGH / MEDIUM / LOW / INFO] |
| **OWASP** | [A0X:2021 - Category] |
| **CWE** | [CWE-XXX: Name] |
| **CVSS 3.1** | [vector] — [score] |
| **File(s)** | [path] |
| **Line(s)** | [lines] |
| **Status** | Open |

**Description:** [What the weakness is.]

**Evidence:**
```
[Code snippet — redact any real secret/PII]
```

**Impact:** [What an attacker achieves.]

**Recommendation:** [Concrete fix.]

**Remediation Example:**
```
[Fixed code]
```

**Verification (operator test plan):** [Non-destructive, synthetic-input check to run via InHousePentestTool against the in-scope host, with a stop condition.]

---

## 6. Remediation Priority

### Immediate (0–48h)
- [ ]

### Short-term (1–2 weeks)
- [ ]

### Medium-term (1–3 months)
- [ ]

---

## 7. Recommendations Summary
1. [Top action]
2. [Second]
3. [Third]

---

## 8. Regulatory Alignment

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
- OWASP Top 10:2025 (with 2021 cross-map), OWASP ASVS 4.0, CWE, CVSS 3.1.

## Appendix B: Glossary
| Term | Definition |
|------|-----------|
| OWASP | Open Worldwide Application Security Project |
| ASVS | Application Security Verification Standard |
| CWE | Common Weakness Enumeration |
| CVSS | Common Vulnerability Scoring System |
