# Test matrix

The automated checks listed as passing were run locally on 2026-09-22 using `npm.cmd` because this Windows host blocks `npm.ps1`. Database-backed end-to-end, Newman, Docker runtime, and k6 checks need a live disposable stack and are explicitly not marked as passed until run.

| Area | Test | Expected result | Actual result | Status |
| --- | --- | --- | --- | --- |
| Authentication | Invalid token / protected route | 401 with safe error | API tests passed | Pass |
| Authentication | Wrong role | 403 on protected admin route | API tests passed | Pass |
| Authentication | Malformed registration | Validation rejects before persistence | API tests passed | Pass |
| Payment | Invalid state transitions | Shortcut/terminal transitions rejected | Unit tests passed | Pass |
| Payment | Idempotency hash | Same key with changed payload is rejected | Unit tests passed | Pass |
| Payment | Concurrent wallet debit | Guarded debit never overdraws | Deterministic concurrency tests passed | Pass |
| Refund | Concurrent merchant debit | Guarded debit never overdraws | Deterministic concurrency tests passed | Pass |
| Palm | Enrollment, match, rejection, deletion | Secure prototype flow works | Python tests passed | Pass |
| Palm | Candidate index | Bounded ranked candidates and removal | Python tests added; pending final run | Pending |
| Infrastructure | TypeScript workspaces | No TypeScript errors | Passed before the current changes; rerun required | Pending |
| Infrastructure | Docker Compose runtime | API, Redis, Mongo, palm, web healthy | Requires Docker engine and secrets | Not run |
| API collection | Postman collection format | Collection/environment parse | Passed | Pass |
| API collection | Newman happy-path/negative flow | Stateful requests pass | Requires a live seeded stack | Not run |
| Load | k6 health/login/read/create | Record actual latency and error rate | Requires k6 and live stack | Not run |

The deterministic payment/refund concurrency tests validate the conditional-update boundary. They do not replace database-backed integration tests against a Mongo replica set and Redis.
