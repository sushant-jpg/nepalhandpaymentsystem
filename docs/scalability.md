# Scalability path

The target is an architecture that can evolve toward approximately one million **registered** users and high transaction volume. It is not a claim that one API process or one webcam recognition worker handles one million simultaneous users.

## Phase 1 — local portfolio deployment

One API process coordinates an Express modular monolith, a MongoDB replica set, Redis, and the isolated palm-recognition service. Financial writes use MongoDB transactions and guarded integer-paisa updates. Redis holds short-lived, namespaced state such as `payment:session:`, `payment:otp:`, `risk:velocity:`, `lock:payment:`, and `token:revoked:`.

## Phase 2 — stateless API replicas

Put multiple API instances behind a load balancer. JWTs, MongoDB, and Redis keep payment state outside API memory. Configure a Socket.IO Redis adapter before horizontally scaling realtime connections. Use a managed MongoDB replica set and managed Redis with tested failover; retain Mongo transactions for wallet movement.

## Phase 3 — dedicated workers and biometric candidates

Move asynchronous notifications, reports, reconciliation, and analytics to queue-backed workers with retries and dead-letter handling. Replace the in-process local LSH palm index with a durable, measured candidate index such as Qdrant, Milvus, pgvector, or FAISS. Only retrieve top-N candidates before exact biometric verification; do not sequentially load all templates in a request.

## Phase 4 — regional resilience

Add multi-zone deployment, backup/restore drills, observability, capacity testing, and a deliberate database scaling strategy based on measured access patterns. Any real biometric/payment deployment also needs certified hardware, regulated ledger/provider integration, privacy review, key custody, and independently evaluated presentation-attack resistance.

## Current boundaries and limits

- The API is stateless for durable request data; the local palm index is intentionally process-local and rebuilt from encrypted local storage at startup.
- The LSH index is a development abstraction, not a recall-tested high-scale ANN system.
- MongoDB is configured as a Docker replica set so transactions are available; a standalone deployment is unsafe for financial execution.
- No benchmark values are asserted here. Run the checked-in k6 scenarios against a disposable development stack and record actual p50/p95/p99, throughput, and error rate before making performance claims.
