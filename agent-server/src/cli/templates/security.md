---
title: "Security Assessment: [Project Name]"
generated_by: security-agent
version: "1.0"
date: "[ISO-8601 date]"
requires_review: true
confidence: "[0.0-1.0]"
status: draft
classification: confidential
---

# Security Assessment Report

## 1. Executive Summary

| Field | Details |
|-------|---------|
| **Project Name** | [Project Name] |
| **Assessment Date** | [Date] |
| **Assessed By** | security-agent |
| **Scope** | [Repository / Application path] |
| **Overall Risk Rating** | [CRITICAL / HIGH / MEDIUM / LOW] |
| **Total Findings** | [Count] |

### Risk Summary

| Severity | Count | Resolved | Outstanding |
|----------|-------|----------|-------------|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 0 | 0 | 0 |
| Low | 0 | 0 | 0 |
| Informational | 0 | 0 | 0 |

---

## 2. Assessment Scope & Methodology

### 2.1 Scope
- **Repository**: [repo path or URL]
- **Languages**: [detected languages]
- **Frameworks**: [detected frameworks]
- **Infrastructure**: [cloud providers, databases, etc.]

### 2.2 Areas Assessed
- [ ] Authentication & Authorization
- [ ] Secrets & Credential Management
- [ ] Input Validation & Injection
- [ ] API Security
- [ ] Database Security
- [ ] Session Management
- [ ] CORS & Cross-Origin Policies
- [ ] Dependency Vulnerabilities
- [ ] Infrastructure & Deployment Security
- [ ] Logging & Monitoring
- [ ] Error Handling & Information Disclosure
- [ ] File Handling & Upload Security
- [ ] Security Headers
- [ ] Rate Limiting & DoS Protection
- [ ] Data Protection & Privacy

### 2.3 Methodology
Static code analysis of the repository covering OWASP Top 10, CWE/SANS Top 25, and cloud-specific security best practices.

---

## 3. Application Overview

### 3.1 Architecture
[Describe the application architecture, entry points, data flows]

### 3.2 Technology Stack
| Component | Technology |
|-----------|-----------|
| Language | [e.g., Python 3.x] |
| Framework | [e.g., FastAPI, Flask] |
| Database | [e.g., MongoDB, PostgreSQL] |
| Cloud | [e.g., GCP, AWS, Azure] |
| Auth | [e.g., OAuth2, JWT] |

### 3.3 Data Flow Diagram
[Describe how data flows through the application — input sources, processing, storage, output]

---

## 4. Findings

<!-- Repeat this section for each finding -->

### 4.1 [FINDING-001]: [Finding Title]

| Field | Details |
|-------|---------|
| **Severity** | [CRITICAL / HIGH / MEDIUM / LOW / INFO] |
| **Category** | [e.g., Secrets Management, Authentication, Injection] |
| **CWE** | [CWE-XXX: Name] |
| **OWASP** | [e.g., A01:2021 - Broken Access Control] |
| **File(s)** | [file path(s)] |
| **Line(s)** | [line numbers] |
| **Status** | Open |

**Description:**
[Detailed description of the vulnerability]

**Evidence:**
```
[Code snippet or configuration showing the vulnerability]
```

**Impact:**
[What could an attacker do if this is exploited?]

**Recommendation:**
[Specific remediation steps]

**Remediation Example:**
```
[Code snippet showing the fix]
```

---

## 5. Hardcoded Secrets Inventory

| # | Secret Type | File | Line | Status |
|---|-------------|------|------|--------|
| 1 | [e.g., API Key] | [file] | [line] | [Active/Rotated/Unknown] |

**Immediate Action Required:** All identified secrets must be rotated and moved to a secrets manager.

---

## 6. Dependency Analysis

### 6.1 Dependency File
- **File**: [e.g., requirements.txt, package.json]
- **Total Dependencies**: [count]
- **Pinned Versions**: [count / total]

### 6.2 Known Vulnerabilities
| Package | Version | CVE | Severity | Fix Version |
|---------|---------|-----|----------|-------------|
| [pkg] | [ver] | [CVE-XXXX-XXXXX] | [severity] | [fix ver] |

### 6.3 Recommendations
- [Pin all dependency versions]
- [Update vulnerable packages]
- [Remove unused dependencies]

---

## 7. Infrastructure & Deployment Security

### 7.1 Cloud Configuration
[GCP/AWS/Azure configuration findings]

### 7.2 Network Security
[Network exposure, IP whitelisting, firewall rules]

### 7.3 Container/Deployment
[Dockerfile, docker-compose, deployment config findings]

---

## 8. Compliance Checklist

### OWASP Top 10 (2021) Coverage

| # | Category | Status | Finding Refs |
|---|----------|--------|-------------|
| A01 | Broken Access Control | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A02 | Cryptographic Failures | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A03 | Injection | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A04 | Insecure Design | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A05 | Security Misconfiguration | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A06 | Vulnerable Components | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A07 | Auth Failures | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A08 | Software & Data Integrity | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A09 | Logging & Monitoring Failures | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |
| A10 | SSRF | [PASS/FAIL/PARTIAL] | [FINDING-XXX] |

### CWE/SANS Top 25 (2023) Coverage

Every row must carry a verdict. N/A is allowed (e.g. memory-safety weaknesses in a memory-safe language) but requires a one-line justification — no row left blank.

| # | CWE | Weakness | Status | Finding Refs |
|---|-----|----------|--------|-------------|
| 1 | CWE-787 | Out-of-bounds Write | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 2 | CWE-79 | Cross-site Scripting | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 3 | CWE-89 | SQL Injection | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 4 | CWE-416 | Use After Free | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 5 | CWE-78 | OS Command Injection | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 6 | CWE-20 | Improper Input Validation | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 7 | CWE-125 | Out-of-bounds Read | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 8 | CWE-22 | Path Traversal | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 9 | CWE-352 | Cross-Site Request Forgery | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 10 | CWE-434 | Unrestricted Upload of Dangerous File Type | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 11 | CWE-862 | Missing Authorization | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 12 | CWE-476 | NULL Pointer Dereference | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 13 | CWE-287 | Improper Authentication | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 14 | CWE-190 | Integer Overflow or Wraparound | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 15 | CWE-502 | Deserialization of Untrusted Data | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 16 | CWE-77 | Command Injection | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 17 | CWE-119 | Improper Restriction of Memory Buffer Operations | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 18 | CWE-798 | Use of Hard-coded Credentials | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 19 | CWE-918 | Server-Side Request Forgery (SSRF) | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 20 | CWE-306 | Missing Authentication for Critical Function | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 21 | CWE-362 | Race Condition | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 22 | CWE-269 | Improper Privilege Management | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 23 | CWE-94 | Code Injection | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 24 | CWE-863 | Incorrect Authorization | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |
| 25 | CWE-276 | Incorrect Default Permissions | [PASS/FAIL/PARTIAL/N/A] | [FINDING-XXX] |

---

## 9. Remediation Priority Matrix

### Immediate (0-48 hours)
- [ ] [Critical findings requiring immediate action]

### Short-term (1-2 weeks)
- [ ] [High-severity findings]

### Medium-term (1-3 months)
- [ ] [Medium-severity findings]

### Long-term (Ongoing)
- [ ] [Low-severity improvements and best practices]

---

## 10. Recommendations Summary

### Top Priority Actions
1. [Most critical action item]
2. [Second most critical]
3. [Third most critical]

### Security Architecture Improvements
- [Architectural recommendations]

### Process Improvements
- [Development process security improvements]

---

## Appendix A: Tools & References
- Static Analysis: Manual code review
- Standards: OWASP Top 10 (2021), CWE/SANS Top 25
- References: [relevant security guidelines]

## Appendix B: Glossary
| Term | Definition |
|------|-----------|
| CWE | Common Weakness Enumeration |
| OWASP | Open Web Application Security Project |
| CVSS | Common Vulnerability Scoring System |
