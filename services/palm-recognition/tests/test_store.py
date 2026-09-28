import pytest

from app.store import TemplateStore


def test_template_store_requires_an_explicit_encryption_key(tmp_path):
    with pytest.raises(RuntimeError, match="PALM_TEMPLATE_ENCRYPTION_KEY is required"):
        TemplateStore(str(tmp_path / "palm.db"), "")


def test_template_store_rejects_an_invalid_encryption_key(tmp_path):
    with pytest.raises(RuntimeError, match="valid Fernet key"):
        TemplateStore(str(tmp_path / "palm.db"), "not-a-fernet-key")
