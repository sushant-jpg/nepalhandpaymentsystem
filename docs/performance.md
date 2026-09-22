# Performance and scale verification

The target is horizontal growth toward roughly one million registered users, not one million concurrent requests on a single server. API instances are stateless apart from explicitly documented local development fallbacks. Production requires a Redis cluster, a managed MongoDB replica set/sharded design selected from measured query volume, multiple API replicas, and independently scaled palm workers.

Engineering acceptance targets for an isolated development benchmark are:

- health p95 below 100 ms;
- read-heavy endpoint p95 below 300 ms where realistic;
- normal API p95 below 500 ms and p99 below 1 second;
- request error rate below 1%;
- no duplicate transaction for an idempotent retry;
- no negative wallet balance under concurrent spending;
- no refund above the original transaction amount.

No benchmark result is checked in yet because this repository session has not run k6 against a stable, instrumented stack. Record the date, commit, hardware, dataset size, MongoDB/Redis topology, scenario, p50/p95/p99, throughput, errors, CPU, memory, connections, and Redis usage for every future result. A development result is not a production capacity claim.
