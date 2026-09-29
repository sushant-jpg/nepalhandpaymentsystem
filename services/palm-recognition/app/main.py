from __future__ import annotations

import os
import hmac
import time
from statistics import median
from pathlib import Path as FilePath
from threading import Lock, RLock
from typing import Annotated

from cryptography.fernet import Fernet
from fastapi import Depends, FastAPI, Header, HTTPException, Path, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from .index import LocalLshPalmTemplateIndex, PalmTemplateIndex
from .recognition import PalmImageError, aggregate_samples, extract_feature, similarity
from .store import PalmTemplateRepository, TemplateStore

ALGORITHM_VERSION = "prototype-rgb-v2"
REQUIRED_THRESHOLD = float(os.getenv("PALM_MATCH_THRESHOLD", "0.88"))
DUPLICATE_THRESHOLD = float(os.getenv("PALM_DUPLICATE_THRESHOLD", "0.97"))


def required_secret(name: str, minimum_length: int) -> str:
    value = os.getenv(name, "").strip()
    if len(value) < minimum_length:
        raise RuntimeError(f"{name} is required and must contain at least {minimum_length} characters")
    if os.getenv("PALM_ENVIRONMENT") == "production" and any(
        marker in value.lower()
        for marker in ("change-me", "replace-with", "placeholder", "example")
    ):
        raise RuntimeError(f"{name} must not be a placeholder in production")
    return value


SERVICE_KEY = required_secret("PALM_SERVICE_KEY", 16)
ENCRYPTION_KEY = required_secret("PALM_TEMPLATE_ENCRYPTION_KEY", 32)
try:
    Fernet(ENCRYPTION_KEY.encode())
except (TypeError, ValueError) as exc:
    raise RuntimeError("PALM_TEMPLATE_ENCRYPTION_KEY must be a valid Fernet key") from exc
if os.getenv("PALM_ENVIRONMENT") == "production" and len(SERVICE_KEY) < 32:
    raise RuntimeError("PALM_SERVICE_KEY must contain at least 32 characters in production")
if not 0 < REQUIRED_THRESHOLD <= 1 or not REQUIRED_THRESHOLD <= DUPLICATE_THRESHOLD <= 1:
    raise RuntimeError("Palm thresholds must satisfy 0 < MATCH <= DUPLICATE <= 1")

IDENTIFY_CANDIDATE_LIMIT = max(1, min(int(os.getenv("PALM_IDENTIFY_CANDIDATE_LIMIT", "10")), 100))
DUPLICATE_CANDIDATE_LIMIT = max(IDENTIFY_CANDIDATE_LIMIT, min(int(os.getenv("PALM_DUPLICATE_CANDIDATE_LIMIT", "50")), 200))
RATE_LIMIT_PER_MINUTE = max(10, min(int(os.getenv("PALM_RATE_LIMIT_PER_MINUTE", "300")), 10_000))
default_database_path = FilePath(__file__).resolve().parent.parent / "data" / "palm.db"
store: PalmTemplateRepository = TemplateStore(
    os.getenv("PALM_DATABASE_PATH", str(default_database_path)), ENCRYPTION_KEY
)
index: PalmTemplateIndex
enrollment_lock = RLock()
rate_lock = Lock()
rate_windows: dict[str, tuple[float, int]] = {}


def rebuild_index() -> None:
    """Hydrate the replaceable candidate index from encrypted durable records."""
    global index
    local_index = LocalLshPalmTemplateIndex()
    for template in store.list():
        local_index.add(template["user_id"], template["vector"])
    index = local_index


rebuild_index()

app = FastAPI(
    title="Nepal Hand Pay — Prototype Palm Recognition",
    version="1.0.0",
    description="RGB-camera development prototype. Not financial-grade palm-vein recognition.",
)


class BodyLimitMiddleware:
    def __init__(self, application, max_bytes: int):
        self.application = application
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.application(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length and int(content_length) > self.max_bytes:
            await JSONResponse(
                status_code=413,
                content={"success": False, "error": {"code": "PAYLOAD_TOO_LARGE", "message": "Request body is too large"}},
            )(scope, receive, send)
            return
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise ValueError("request body too large")
            return message

        try:
            await self.application(scope, limited_receive, send)
        except ValueError as exc:
            if str(exc) != "request body too large":
                raise
            await JSONResponse(
                status_code=413,
                content={"success": False, "error": {"code": "PAYLOAD_TOO_LARGE", "message": "Request body is too large"}},
            )(scope, receive, send)


app.add_middleware(BodyLimitMiddleware, max_bytes=8_000_000)


@app.middleware("http")
async def service_rate_limit(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with rate_lock:
        started_at, count = rate_windows.get(key, (now, 0))
        if now - started_at >= 60:
            started_at, count = now, 0
        count += 1
        rate_windows[key] = (started_at, count)
    if count > RATE_LIMIT_PER_MINUTE:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(max(1, int(60 - (now - started_at))))},
            content={"success": False, "error": {"code": "RATE_LIMITED", "message": "Too many palm service requests"}},
        )
    return await call_next(request)


def authorize(x_service_key: Annotated[str | None, Header()] = None) -> None:
    if not x_service_key or not hmac.compare_digest(x_service_key, SERVICE_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service credential")


class EnrollRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    user_id: str = Field(alias="userId", min_length=8, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$")
    hand_side: str = Field(alias="handSide", pattern="^(LEFT|RIGHT)$")
    samples: list[str] = Field(min_length=3, max_length=5)


class ImageRequest(BaseModel):
    image: str = Field(min_length=100, max_length=1_500_000)


class QualityRequest(BaseModel):
    samples: list[str] = Field(min_length=3, max_length=3)


class VerifyRequest(ImageRequest):
    model_config = ConfigDict(populate_by_name=True)
    user_id: str = Field(alias="userId", min_length=8, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$")


def response(matched: bool, user_id: str | None = None, score: float | None = None, template_ref: str | None = None, quality: float | None = None) -> dict:
    return {
        "success": True,
        "matched": matched,
        "userId": user_id,
        "similarity": round(score, 5) if score is not None else None,
        "threshold": REQUIRED_THRESHOLD,
        "algorithmVersion": ALGORITHM_VERSION,
        "templateRef": template_ref,
        "qualityScore": round(quality, 5) if quality is not None else None,
        "livenessAssessment": "PASSIVE_RGB_CHECK_ONLY",
    }


@app.exception_handler(PalmImageError)
async def palm_image_error(_request, exc: PalmImageError):
    return JSONResponse(
        status_code=422,
        content={"success": False, "error": {"code": "PALM_IMAGE_INVALID", "message": str(exc)}},
    )


@app.exception_handler(HTTPException)
async def http_error(_request, exc: HTTPException):
    code = {
        401: "SERVICE_AUTH_REQUIRED",
        409: "DUPLICATE_PALM",
        413: "PAYLOAD_TOO_LARGE",
    }.get(exc.status_code, "PALM_REQUEST_FAILED")
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": {"code": code, "message": str(exc.detail)}},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_error(_request, _exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"success": False, "error": {"code": "VALIDATION_ERROR", "message": "Palm request data is invalid"}},
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "algorithmVersion": ALGORITHM_VERSION, "mode": "prototype-rgb"}


@app.post("/palm/enroll", dependencies=[Depends(authorize)])
def enroll(payload: EnrollRequest) -> dict:
    vector, quality = aggregate_samples(payload.samples)
    with enrollment_lock:
        for candidate in index.search(vector, limit=DUPLICATE_CANDIDATE_LIMIT):
            template = store.get(candidate.template_id)
            if template and template["user_id"] != payload.user_id and similarity(vector, template["vector"]) >= DUPLICATE_THRESHOLD:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Palm is already enrolled")
        template_ref = store.save(payload.user_id, payload.hand_side, ALGORITHM_VERSION, vector, quality)
        index.add(payload.user_id, vector)
    return response(True, payload.user_id, 1.0, template_ref, quality)


@app.post("/palm/quality", dependencies=[Depends(authorize)])
def quality(payload: QualityRequest) -> dict:
    """Assess three transient frames without identifying or storing a palm."""
    extracted = [extract_feature(sample) for sample in payload.samples]
    if len({item.image_digest for item in extracted}) != len(extracted):
        raise PalmImageError("Palm stability samples must be separate captures")
    scores = [
        similarity(extracted[left].vector, extracted[right].vector)
        for left in range(len(extracted))
        for right in range(left + 1, len(extracted))
    ]
    stability_score = float(median(scores))
    return {
        "success": True,
        "detected": True,
        "stable": stability_score >= 0.78,
        "stableFrames": len(extracted),
        "stabilityScore": round(stability_score, 5),
        "qualityScore": round(
            sum(item.quality for item in extracted) / len(extracted), 5
        ),
        "algorithmVersion": ALGORITHM_VERSION,
        "livenessAssessment": "PASSIVE_RGB_CHECK_ONLY",
    }


@app.post("/palm/verify", dependencies=[Depends(authorize)])
def verify(payload: VerifyRequest) -> dict:
    template = store.get(payload.user_id)
    if not template:
        return response(False)
    probe = extract_feature(payload.image)
    score = similarity(probe.vector, template["vector"])
    return response(score >= REQUIRED_THRESHOLD, payload.user_id if score >= REQUIRED_THRESHOLD else None, score, quality=probe.quality)


@app.post("/palm/identify", dependencies=[Depends(authorize)])
def identify(payload: ImageRequest) -> dict:
    probe = extract_feature(payload.image)
    best_user, best_score = None, 0.0
    for candidate in index.search(probe.vector, limit=IDENTIFY_CANDIDATE_LIMIT):
        template = store.get(candidate.template_id)
        if template:
            score = similarity(probe.vector, template["vector"])
            if score > best_score:
                best_user, best_score = template["user_id"], score
    matched = best_user is not None and best_score >= REQUIRED_THRESHOLD
    return response(matched, best_user if matched else None, best_score, quality=probe.quality)


@app.delete("/palm/{user_id}", dependencies=[Depends(authorize)])
def remove(user_id: Annotated[str, Path(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$")]) -> dict:
    deleted = store.delete(user_id)
    if deleted:
        index.remove(user_id)
    return {"deleted": deleted}


@app.get("/palm/status/{user_id}", dependencies=[Depends(authorize)])
def palm_status(user_id: Annotated[str, Path(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$")]) -> dict:
    item = store.status(user_id)
    return {"enrolled": bool(item), "algorithmVersion": item["algorithm_version"] if item else None, "enrolledAt": item["enrolled_at"] if item else None}
