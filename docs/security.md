# Security design

## Controls implemented

- bcrypt password and payment-PIN hashing; OTPs, reset tokens, refresh tokens, and biometric vectors are never stored in plaintext.
- Short-lived JWT access tokens, rotating database-backed refresh tokens, Redis access-token revocation, secure cookie flags, login/PIN/palm lockouts, and role middleware.
- Helmet headers, production CORS allowlist, JSON/image size limits, Zod validation, safe errors, request IDs, and sensitive log redaction.
- Header-based idempotency with request hashing, unique indexes, atomic state claims, MongoDB transactions, guarded balance updates, and distributed operation locks.
- Explainable risk indicators and persisted risk decisions. The system does not call these rules an AI model.
- Audit records contain actor, role, action, target, request ID, IP, user agent, timestamp, and metadata. Normal APIs expose read-only access; model middleware rejects updates/deletes.
- Authenticated and ownership-checked Socket.IO payment rooms.
- Biometric templates are encrypted and isolated; raw captures are not persisted.

## Trust boundaries

The browser is untrusted. Amounts, identity, risk, wallet balances, refund totals, and final state are always decided by the API. The palm service accepts only its shared service credential and should be private in a production network.

## Secrets

Production startup rejects known development secrets. Docker requires explicit JWT, palm-service, and Fernet keys. Do not commit `.env`, seed credentials, database dumps, palm databases, or TLS private keys.

## Remaining production work

Use a secrets manager and HSM/KMS envelope encryption, rotate keys, apply CSRF protection if cookie-authenticated mutation endpoints are added, introduce SIEM alerting, SAST/DAST/dependency scanning, penetration testing, privacy impact assessment, Nepal regulatory counsel, certified biometric hardware, and a regulated payment/ledger provider.
