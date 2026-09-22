# Troubleshooting

## PowerShell blocks npm.ps1

Use `npm.cmd` instead of changing machine execution policy, for example `npm.cmd run typecheck`.

## `python` opens the Store or cannot execute

Create a local virtual environment with an installed Python interpreter, install the requirements, and use the root npm scripts. They prefer `.venv/Scripts/python.exe` on Windows and `.venv/bin/python` elsewhere.

## Pydantic tries to compile Rust on Python 3.14

Run `pip install -r services/palm-recognition/requirements.txt` again from the current file. It selects Pydantic 2.12.5 on Python 3.14, which has a compatible wheel; Python 3.12 CI retains 2.11.1.

## Transactions report that they require a replica set

Use `docker compose up --build` or configure `MONGODB_URI` for a replica set. Do not bypass transactions for wallet movement.

## Redis is unavailable

Development logs a warning and uses a process-local TTL fallback. This is single-process only. Production and Docker set `REDIS_REQUIRED=true` and fail readiness/startup when Redis is unavailable.

## Palm enrollment returns 422

Capture three distinct, evenly lit frames with the full palm inside the guide. Identical/replayed frames and low-texture/blurred frames are rejected intentionally. Check the palm-service logs without logging image data.

## Payment remains PROCESSING after a client timeout

Do not submit a new logical payment. Poll `GET /api/v1/payments/requests/:id` and retry confirmation only with the same `Idempotency-Key`. The API returns the durable result or an in-progress response.

## Docker reports missing variables

Compose intentionally requires JWT secrets, `PALM_SERVICE_KEY`, and a Fernet `PALM_TEMPLATE_ENCRYPTION_KEY`. Copy `.env.example`, replace placeholders, and run `docker compose config` before building.
