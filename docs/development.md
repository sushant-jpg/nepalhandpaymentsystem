# Development guide

## Fast start

1. Copy `.env.example` to `.env` and replace development secrets.
2. Run `npm install`.
3. Create `.venv` and install `services/palm-recognition/requirements.txt`.
4. Run `npm run dev`. It starts the project-local MongoDB replica set before the app services. Redis is optional in local development.
5. In another terminal, run `npm run seed` if you want demo accounts.

Individual services are available through `npm run dev:web`, `npm run dev:api`, and `npm run dev:palm`. The web app defaults to port 5173, API to 4000, and palm service to 8001.

Local palm development generates a persistent encryption key under the ignored `.local/` directory when `PALM_TEMPLATE_ENCRYPTION_KEY` is empty. Production still requires an explicit key. Use `npm run mongo:dev:stop` when you want to stop the local database.

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
