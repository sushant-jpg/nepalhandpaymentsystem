from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class PalmTemplateCandidate:
    template_id: str
    retrieval_score: float


class PalmTemplateIndex(Protocol):
    """Candidate retrieval boundary; implementations must not expose vectors."""

    def add(self, template_id: str, vector: np.ndarray) -> None: ...
    def remove(self, template_id: str) -> bool: ...
    def search(self, vector: np.ndarray, limit: int = 10) -> list[PalmTemplateCandidate]: ...


class LocalLshPalmTemplateIndex:
    """Bounded in-process LSH candidate index for local demo data.

    This is deliberately replaceable. It uses deterministic random projections
    to retrieve a small candidate set, then leaves exact verification to the
    service. It is not an ANN service for production-scale biometric matching.
    """

    def __init__(self, signature_bits: int = 18, fallback_limit: int = 128):
        self.signature_bits = signature_bits
        self.fallback_limit = fallback_limit
        self._projections: np.ndarray | None = None
        self._vectors: dict[str, np.ndarray] = {}
        self._buckets: dict[int, set[str]] = {}
        self._insertion_order: list[str] = []

    def _ensure_projections(self, dimensions: int) -> np.ndarray:
        if self._projections is None:
            # Fixed seed makes test and local behaviour reproducible.
            self._projections = np.random.default_rng(20260922).standard_normal((self.signature_bits, dimensions), dtype=np.float32)
        if self._projections.shape[1] != dimensions:
            raise ValueError("Palm template vector dimension does not match this index")
        return self._projections

    def _signature(self, vector: np.ndarray) -> int:
        projections = self._ensure_projections(vector.size)
        signs = projections @ vector.astype(np.float32, copy=False)
        return sum(1 << bit for bit, value in enumerate(signs) if value >= 0)

    def add(self, template_id: str, vector: np.ndarray) -> None:
        self.remove(template_id)
        copied = vector.astype(np.float32, copy=True)
        signature = self._signature(copied)
        self._vectors[template_id] = copied
        self._buckets.setdefault(signature, set()).add(template_id)
        self._insertion_order.append(template_id)

    def remove(self, template_id: str) -> bool:
        existing = self._vectors.pop(template_id, None)
        if existing is None:
            return False
        signature = self._signature(existing)
        bucket = self._buckets.get(signature)
        if bucket:
            bucket.discard(template_id)
            if not bucket:
                self._buckets.pop(signature, None)
        self._insertion_order = [item for item in self._insertion_order if item != template_id]
        return True

    def _candidate_ids(self, signature: int) -> set[str]:
        candidates = set(self._buckets.get(signature, set()))
        # Probe close hashes without scanning all stored templates.
        for bit in range(self.signature_bits):
            candidates.update(self._buckets.get(signature ^ (1 << bit), set()))
        if not candidates:
            # A bounded cold-start fallback keeps local demos usable while
            # preserving the guarantee that identify never loads every record.
            candidates.update(self._insertion_order[-self.fallback_limit:])
        return candidates

    def search(self, vector: np.ndarray, limit: int = 10) -> list[PalmTemplateCandidate]:
        if limit < 1 or not self._vectors:
            return []
        query = vector.astype(np.float32, copy=False)
        candidate_ids = self._candidate_ids(self._signature(query))
        ranked = sorted(
            (PalmTemplateCandidate(template_id, float(np.dot(query, self._vectors[template_id]))) for template_id in candidate_ids),
            key=lambda candidate: candidate.retrieval_score,
            reverse=True,
        )
        return ranked[:limit]
