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
