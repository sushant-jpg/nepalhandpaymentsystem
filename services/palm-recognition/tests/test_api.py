from fastapi.testclient import TestClient

from app import main
from app.store import TemplateStore
from test_recognition import palm_image


def client_for(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(main, "store", TemplateStore(str(tmp_path / "palm.db"), ""))
    main.rebuild_index()
    return TestClient(main.app)


def headers() -> dict[str, str]:
    return {"x-service-key": main.SERVICE_KEY}


def enrollment(user_id: str) -> dict:
    return {"userId": user_id, "handSide": "RIGHT", "samples": [palm_image(-2), palm_image(), palm_image(2)]}


def test_service_requires_credentials(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)
    response = client.post("/palm/identify", json={"image": palm_image()})
    assert response.status_code == 401


def test_enroll_verify_and_delete(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)
    enrolled = client.post("/palm/enroll", headers=headers(), json=enrollment("customer-0001"))
    assert enrolled.status_code == 200
    assert enrolled.json()["algorithmVersion"] == main.ALGORITHM_VERSION
    assert enrolled.json()["livenessAssessment"] == "PASSIVE_RGB_CHECK_ONLY"

    verified = client.post("/palm/verify", headers=headers(), json={"userId": "customer-0001", "image": palm_image(1)})
    assert verified.status_code == 200
    assert verified.json()["matched"] is True

    deleted = client.delete("/palm/customer-0001", headers=headers())
    assert deleted.json()["deleted"] is True


def test_duplicate_enrollment_is_rejected(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)
    assert client.post("/palm/enroll", headers=headers(), json=enrollment("customer-0001")).status_code == 200
    duplicate = client.post("/palm/enroll", headers=headers(), json=enrollment("customer-0002"))
    assert duplicate.status_code == 409


def test_threshold_controls_identification(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)
    assert client.post("/palm/enroll", headers=headers(), json=enrollment("customer-0001")).status_code == 200
    monkeypatch.setattr(main, "REQUIRED_THRESHOLD", 1.01)
    result = client.post("/palm/identify", headers=headers(), json={"image": palm_image(1)})
    assert result.status_code == 200
    assert result.json()["matched"] is False
