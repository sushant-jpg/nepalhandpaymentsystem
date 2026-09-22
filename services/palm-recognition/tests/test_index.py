import numpy as np

from app.index import LocalLshPalmTemplateIndex


def unit_vector(values: list[float]) -> np.ndarray:
    vector = np.array(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


def test_index_returns_ranked_bounded_candidates():
    index = LocalLshPalmTemplateIndex(signature_bits=8)
    index.add("customer-a", unit_vector([1, 0, 0, 0]))
    index.add("customer-b", unit_vector([0.9, 0.1, 0, 0]))
    index.add("customer-c", unit_vector([0, 0, 1, 0]))

    candidates = index.search(unit_vector([0.98, 0.02, 0, 0]), limit=2)

    assert [candidate.template_id for candidate in candidates] == ["customer-a", "customer-b"]
    assert len(candidates) == 2


def test_index_removal_excludes_a_template():
    index = LocalLshPalmTemplateIndex(signature_bits=8)
    index.add("customer-a", unit_vector([1, 0, 0, 0]))
    assert index.remove("customer-a") is True
    assert index.search(unit_vector([1, 0, 0, 0])) == []
