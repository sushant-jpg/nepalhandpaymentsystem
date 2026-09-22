# API overview

Base URL: `/api/v1`. Success responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "code", "message", "details?" }, "requestId" }`. Production errors never return stack traces.

Bearer access tokens protect private routes. Refresh tokens are HttpOnly cookies scoped to `/api/v1/auth`.

## Main routes

| Method | Route | Role | Purpose |
|---|---|---|---|
| POST | `/auth/register`, `/auth/login` | Public | Create/sign in account |
| POST | `/auth/refresh`, `/auth/logout` | Session | Rotate or revoke session |
| GET/PATCH | `/users/profile` | Any signed-in | Read/update own profile |
| POST | `/users/payment-pin` | Customer | Replace hashed payment PIN |
| POST/GET/DELETE | `/palm/enroll`, `/palm/status`, `/palm` | Customer | Biometric lifecycle |
| POST | `/payments/requests` | Merchant | Create payment; idempotency required |
| POST | `/payments/requests/:id/identify` | Merchant | Match palm and assess risk |
| POST | `/payments/requests/:id/confirm` | Merchant | Step-up and process; idempotency required |
| GET | `/payments/requests/:id` | Merchant owner | Poll authoritative state |
| GET | `/transactions` | Scoped by role | Paginated/filterable history; opaque `cursor` supported |
| GET | `/transactions/:id/receipt.pdf` | Scoped by role | Sanitized mock receipt |
| POST | `/transactions/:id/report` | Customer owner | Report suspicious payment |
| POST | `/merchants/refunds` | Merchant owner | Atomic refund; idempotency required |
| GET | `/admin/dashboard` | Admin | Operational metrics |
| POST | `/admin/demo-funds` | Admin | Idempotent simulated wallet credit |
| GET | `/security/audit` | Admin/Auditor | Read-only audit trail |

## Idempotency

Send a unique stable header for each logical operation:

```http
Idempotency-Key: checkout-device-7-01JABC...
```

Retry the exact same request with the same key after timeouts. Reusing a key for different request data returns `IDEMPOTENCY_KEY_REUSED`. Creation, confirmation, and refunds have database uniqueness/claim protections in addition to Redis locks. Administrative demo credits use a reusable TTL-backed idempotency record storing actor, endpoint, request hash, response, status code, state, and expiry.

For large histories, request `?limit=50`, then pass the returned opaque `pagination.nextCursor`. Offset `page` remains available for the current UI, but cursor iteration avoids increasingly expensive large skips.

## Health

- `GET /health/live` — process liveness.
- `GET /health/ready` — MongoDB/Redis readiness.
- `GET /health` — aggregate API, MongoDB, Redis, and palm-service health.
