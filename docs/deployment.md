# Deployment

## Local Docker

1. Copy `.env.example` to `.env`.
2. Replace both JWT secrets and `PALM_SERVICE_KEY` with independent random values.
3. Generate `PALM_TEMPLATE_ENCRYPTION_KEY` with Fernet.
4. Run `docker compose config` and then `docker compose up --build`.
5. Run `docker compose exec api node apps/api/dist/seed.js` if demo users are needed.

The compose stack starts a single-node MongoDB replica set (required for wallet transactions), Redis, the Python service, API, and nginx frontend. Health-based dependencies prevent the web tier from starting before the API is ready.

## Production checklist

- Terminate TLS at a trusted ingress and set `COOKIE_SECURE=true`.
- Do not expose MongoDB, Redis, or the palm service publicly.
- Use managed replica-set MongoDB, authenticated TLS Redis, and a secrets manager.
- Set `REDIS_REQUIRED=true`, explicit CORS origins, log retention/redaction, backups, restore drills, alerts, resource limits, and rolling deployment probes.
- Store biometric keys in KMS/HSM, implement key rotation, and avoid shared-key service auth in favor of mTLS/workload identity.
- Replace the mock provider and wallet with regulated payment and double-entry ledger integrations before real-money use.

## Checks

```bash
npm ci
npm run typecheck
npm test
npm run build
python -m pytest services/palm-recognition/tests
docker compose config
```

The GitHub Actions workflow runs Node and Python verification and validates the Compose model on pushes and pull requests.
