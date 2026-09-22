# k6 load scenarios

These scripts target a local or isolated development environment. They never execute or refund a payment. `payment-create.js` creates expiring mock requests only.

```bash
k6 run tests/load/health.js
k6 run -e LOGIN_EMAIL=customer@demo.local -e LOGIN_PASSWORD=... tests/load/login.js
k6 run -e ACCESS_TOKEN=... tests/load/transactions.js
k6 run -e MERCHANT_TOKEN=... tests/load/payment-create.js
k6 run -e MERCHANT_TOKEN=... -e PAYMENT_ID=NHPR-... tests/load/payment-read.js
```

Override `BASE_URL` when the API is not at `http://localhost:4000/api/v1`. Default thresholds enforce under 1% request failures, normal API p95 below 500 ms, read-heavy p95 below 300 ms, and health p95 below 100 ms. Save real command output under `docs/benchmarks/` when running on documented hardware; do not infer production capacity from a laptop run.
