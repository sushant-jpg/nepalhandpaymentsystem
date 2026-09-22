# Development guide

## Fast start

1. Copy `.env.example` to `.env` and replace development secrets.
2. Run `npm install`.
3. Create `.venv` and install `services/palm-recognition/requirements.txt`.
4. Start MongoDB as a replica set and Redis, or use Docker Compose.
5. Run `npm run seed`, then `npm run dev`.

Individual services are available through `npm run dev:web`, `npm run dev:api`, and `npm run dev:palm`. The web app defaults to port 5173, API to 4000, and palm service to 8001.

## Useful commands

| Command | Purpose |
|---|---|
| `npm run typecheck` | Strict shared/API/web TypeScript |
| `npm run lint` | Current zero-warning TypeScript lint gate |
| `npm run test:api` | API unit/security/concurrency tests |
| `npm run test:web` | Frontend unit tests |
| `npm run test:palm` | FastAPI/OpenCV tests through local Python |
| `npm run build` | Production builds for all TypeScript workspaces |
| `npm run docker:up` | Build and start the full dependency stack |
| `npm run docker:down` | Stop the stack without deleting volumes |
| `npm run validate:postman` | Parse checked-in Postman JSON |
| `npm run test:postman` | Newman health smoke test against a live stack |

The API intentionally fails production startup for default secrets or unavailable required Redis. MongoDB transactions require a replica set; a standalone `mongod` cannot verify payments, refunds, registration, or demo credits correctly.
