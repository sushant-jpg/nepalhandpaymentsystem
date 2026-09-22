# Contributing

Use Node.js 20+, npm 10+, and a supported Python environment. Create feature branches, keep commits focused, and do not commit `.env`, credentials, biometric captures/templates, database files, or benchmark claims without raw results.

Before opening a change:

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run test:palm
npm run validate:postman
```

Financial changes must include an explicit state/authorization review, stable idempotency behavior, integer-paisa handling, concurrency tests, and failure/retry reasoning. Never change wallet balances with read-modify-write application logic. Use conditional atomic updates and a MongoDB transaction for multi-record movement.

API changes should preserve the response envelope, validate all untrusted input, enforce role and ownership, redact secrets, update `docs/api.md`, and extend the Postman collection. Schema indexes need a demonstrated query pattern; avoid speculative indexes.

Palm changes must keep raw frames in memory, preserve explicit prototype labeling, test quality rejection and thresholds, and never market RGB matching as palm-vein authentication.
