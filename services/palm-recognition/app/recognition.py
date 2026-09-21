from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

import cv2
import numpy as np


class PalmImageError(ValueError):
    pass


@dataclass(frozen=True)
class ExtractedFeature:
    vector: np.ndarray
    quality: float


def decode_data_url(value: str) -> np.ndarray:
    try:
        encoded = value.split(",", 1)[1] if "," in value else value
        raw = base64.b64decode(encoded, validate=True)
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    except (ValueError, binascii.Error) as exc:
        raise PalmImageError("Image is not valid base64 data") from exc
    if image is None or image.shape[0] < 100 or image.shape[1] < 100:
        raise PalmImageError("Image is too small or unreadable")
    return image


def _palm_roi(image: np.ndarray) -> np.ndarray:
    """Find a hand-like foreground region, with a centered fallback for prototype use."""
    height, width = image.shape[:2]
    blurred = cv2.GaussianBlur(image, (7, 7), 0)
    ycrcb = cv2.cvtColor(blurred, cv2.COLOR_BGR2YCrCb)
    lower = np.array([0, 128, 70], dtype=np.uint8)
    upper = np.array([255, 180, 135], dtype=np.uint8)
    mask = cv2.inRange(ycrcb, lower, upper)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    roi: np.ndarray | None = None
    if contours:
        contour = max(contours, key=cv2.contourArea)
        area_ratio = cv2.contourArea(contour) / float(height * width)
        if area_ratio >= 0.08:
            x, y, w, h = cv2.boundingRect(contour)
            pad_x, pad_y = int(w * 0.08), int(h * 0.08)
            roi = image[max(0, y - pad_y): min(height, y + h + pad_y), max(0, x - pad_x): min(width, x + w + pad_x)]
    if roi is None or min(roi.shape[:2]) < 80:
        side = int(min(height, width) * 0.72)
        cy, cx = height // 2, width // 2
        roi = image[cy - side // 2: cy + side // 2, cx - side // 2: cx + side // 2]
    return roi


def extract_feature(data_url: str) -> ExtractedFeature:
    image = decode_data_url(data_url)
    roi = _palm_roi(image)
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (128, 128), interpolation=cv2.INTER_AREA)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast = float(gray.std())
    quality = min(1.0, (sharpness / 180.0) * 0.65 + (contrast / 55.0) * 0.35)
    if contrast < 6:
        raise PalmImageError("Palm image has insufficient contrast")

    normalized = gray.astype(np.float32) / 255.0
    dct = cv2.dct(normalized)[:20, :20].flatten()
    gx = cv2.Sobel(normalized, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(normalized, cv2.CV_32F, 0, 1, ksize=3)
    magnitude, angle = cv2.cartToPolar(gx, gy, angleInDegrees=True)
    hist_parts: list[np.ndarray] = []
    for y in range(0, 128, 32):
        for x in range(0, 128, 32):
            hist, _ = np.histogram(angle[y:y+32, x:x+32], bins=9, range=(0, 360), weights=magnitude[y:y+32, x:x+32])
            hist_parts.append(hist.astype(np.float32))
    vector = np.concatenate([dct, *hist_parts]).astype(np.float32)
    norm = float(np.linalg.norm(vector))
    if norm == 0:
        raise PalmImageError("Palm features could not be extracted")
    return ExtractedFeature(vector=vector / norm, quality=quality)


def aggregate_samples(samples: list[str]) -> tuple[np.ndarray, float]:
    extracted = [extract_feature(sample) for sample in samples]
    vectors = np.vstack([item.vector for item in extracted])
    aggregate = np.median(vectors, axis=0).astype(np.float32)
    aggregate /= max(float(np.linalg.norm(aggregate)), 1e-8)
    return aggregate, float(np.mean([item.quality for item in extracted]))


def similarity(left: np.ndarray, right: np.ndarray) -> float:
    score = float(np.dot(left, right) / (max(np.linalg.norm(left), 1e-8) * max(np.linalg.norm(right), 1e-8)))
    return max(0.0, min(1.0, score))
