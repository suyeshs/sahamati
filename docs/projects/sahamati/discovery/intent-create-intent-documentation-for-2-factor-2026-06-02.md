The intent document has been generated at `docs/generated/intent/intent-two-factor-authentication.md`.

Key points reflected in the document:

- **Grounded in existing code** — the document captures that ~75% of the V1 implementation is already done (TOTP library, routes, DB migration, frontend components)
- **Three phases**: V1 (core TOTP, nearly complete), V1.1 (recovery codes + rate limiting), V2 (org-wide enforcement)
- **Complexity rated 4/10** since the heavy lifting is already in place
- **Four clarifying questions** flagged for human review: recovery code priority, enforcement policy, rate limiting approach, and admin reset capability
- **Regulatory context** ties 2FA to RBI/ReBIT expectations and DPDP Act obligations
