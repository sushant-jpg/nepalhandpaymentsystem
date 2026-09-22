import base64
import cv2
import numpy as np
import pytest

from app.recognition import PalmImageError, aggregate_samples, extract_feature, similarity


def palm_image(offset: int = 0) -> str:
    image = np.full((320, 320, 3), 30, dtype=np.uint8)
    color = (95, 145, 195)
    cv2.ellipse(image, (160 + offset, 190), (78, 95), 0, 0, 360, color, -1)
    for x in [105, 135, 165, 195, 220]:
        cv2.rectangle(image, (x + offset, 55), (x + 18 + offset, 185), color, -1)
    for y in range(135, 235, 15):
        cv2.line(image, (110 + offset, y), (215 + offset, y + 8), (55, 90, 130), 2)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return "data:image/jpeg;base64," + base64.b64encode(encoded).decode()


def test_same_palm_has_high_similarity():
    template, quality = aggregate_samples([palm_image(-2), palm_image(), palm_image(2)])
    probe = extract_feature(palm_image(1))
    assert quality > 0
    assert similarity(template, probe.vector) > 0.9


def test_feature_is_normalized():
    feature = extract_feature(palm_image())
    assert np.isclose(np.linalg.norm(feature.vector), 1.0)


def test_invalid_image_is_rejected():
    with pytest.raises(PalmImageError):
        extract_feature("data:image/jpeg;base64,not-base64")


def test_low_quality_image_is_rejected():
    image = np.full((320, 320, 3), 128, dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    value = "data:image/jpeg;base64," + base64.b64encode(encoded).decode()
    with pytest.raises(PalmImageError):
        extract_feature(value)


def test_replayed_enrollment_frame_is_rejected():
    sample = palm_image()
    with pytest.raises(PalmImageError, match="separate live captures"):
        aggregate_samples([sample, sample, sample])
