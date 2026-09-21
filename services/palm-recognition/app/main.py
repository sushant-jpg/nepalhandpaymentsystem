from __future__ import annotations

import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from .recognition import PalmImageError, aggregate_samples, extract_feature, similarity
from .store import TemplateStore

ALGORITHM_VERSION = "prototype-v1"
REQUIRED_THRESHOLD = float(os.getenv("PALM_MATCH_THRESHOLD", "0.88"))
SERVICE_KEY = os.getenv("PALM_SERVICE_KEY", "local-service-key-change-me")
store = TemplateStore(os.getenv("PALM_DATABASE_PATH", "data/palm.db"), os.getenv("PALM_TEMPLATE_ENCRYPTION_KEY", ""))

app = FastAPI(
    title="Nepal Hand Pay — Prototype Palm Recognition",
    version="1.0.0",
    description="RGB-camera development prototype. Not financial-grade palm-vein recognition.",
)


def authorize(x_service_key: Annotated[str | None, Header()] = None) -> None:
    if not x_service_key or x_service_key != SERVICE_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service credential")


class EnrollRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    user_id: str = Field(alias="userId", min_length=8, max_length=100)
    hand_side: str = Field(alias="handSide", pattern="^(LEFT|RIGHT)$")
    samples: list[str] = Field(min_length=3, max_length=5)


class ImageRequest(BaseModel):
    image: str = Field(min_length=100, max_length=5_000_000)


class VerifyRequest(ImageRequest):
    model_config = ConfigDict(populate_by_name=True)
    user_id: str = Field(alias="userId", min_length=8, max_length=100)


def response(matched: bool, user_id: str | None = None, score: float | None = None, template_ref: str | None = None) -> dict:
    return {"success": True, "matched": matched, "userId": user_id, "similarity": round(score, 5) if score is not None else None, "threshold": REQUIRED_THRESHOLD, "algorithmVersion": ALGORITHM_VERSION, "templateRef": template_ref}


@app.exception_handler(PalmImageError)
async def palm_image_error(_request, exc: PalmImageError):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "algorithmVersion": ALGORITHM_VERSION, "mode": "prototype-rgb"}


@app.post("/palm/enroll", dependencies=[Depends(authorize)])
def enroll(payload: EnrollRequest) -> dict:
    vector, quality = aggregate_samples(payload.samples)
    template_ref = store.save(payload.user_id, payload.hand_side, ALGORITHM_VERSION, vector, quality)
    return response(True, payload.user_id, 1.0, template_ref)


@app.post("/palm/verify", dependencies=[Depends(authorize)])
def verify(payload: VerifyRequest) -> dict:
    template = store.get(payload.user_id)
    if not template:
        return response(False)
    probe = extract_feature(payload.image)
    score = similarity(probe.vector, template["vector"])
    return response(score >= REQUIRED_THRESHOLD, payload.user_id if score >= REQUIRED_THRESHOLD else None, score)


@app.post("/palm/identify", dependencies=[Depends(authorize)])
def identify(payload: ImageRequest) -> dict:
    probe = extract_feature(payload.image)
    best_user, best_score = None, 0.0
    for template in store.all():
        score = similarity(probe.vector, template["vector"])
        if score > best_score:
            best_user, best_score = template["user_id"], score
    matched = best_user is not None and best_score >= REQUIRED_THRESHOLD
    return response(matched, best_user if matched else None, best_score)


@app.delete("/palm/{user_id}", dependencies=[Depends(authorize)])
def remove(user_id: str) -> dict:
    return {"deleted": store.delete(user_id)}


@app.get("/palm/status/{user_id}", dependencies=[Depends(authorize)])
def palm_status(user_id: str) -> dict:
    item = store.status(user_id)
    return {"enrolled": bool(item), "algorithmVersion": item["algorithm_version"] if item else None, "enrolledAt": item["enrolled_at"] if item else None}
