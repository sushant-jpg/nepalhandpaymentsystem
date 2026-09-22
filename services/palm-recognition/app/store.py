from __future__ import annotations

import base64
import hashlib
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from cryptography.fernet import Fernet, InvalidToken


class TemplateStore:
    def __init__(self, path: str, encryption_key: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        if os.getenv("PALM_ENVIRONMENT", "development") == "production" and not encryption_key:
            raise RuntimeError("PALM_TEMPLATE_ENCRYPTION_KEY is required in production")
        key = encryption_key.encode() if encryption_key else base64.urlsafe_b64encode(hashlib.sha256(os.getenv("PALM_SERVICE_KEY", "local-service-key-change-me").encode()).digest())
        self.cipher = Fernet(key)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS palm_templates (
                    user_id TEXT PRIMARY KEY,
                    hand_side TEXT NOT NULL,
                    algorithm_version TEXT NOT NULL,
                    encrypted_vector BLOB NOT NULL,
                    quality REAL NOT NULL,
                    enrolled_at TEXT NOT NULL
                )
            """)

    def save(self, user_id: str, hand_side: str, algorithm_version: str, vector: np.ndarray, quality: float) -> str:
        encrypted = self.cipher.encrypt(vector.astype(np.float32).tobytes())
        enrolled_at = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO palm_templates VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET hand_side=excluded.hand_side, algorithm_version=excluded.algorithm_version, encrypted_vector=excluded.encrypted_vector, quality=excluded.quality, enrolled_at=excluded.enrolled_at",
                (user_id, hand_side, algorithm_version, encrypted, quality, enrolled_at),
            )
        return f"tpl:{hashlib.sha256(user_id.encode()).hexdigest()[:16]}"

    def get(self, user_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM palm_templates WHERE user_id = ?", (user_id,)).fetchone()
        return self._decode(row) if row else None

    def all(self) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM palm_templates").fetchall()
        templates: list[dict] = []
        for row in rows:
            try:
                templates.append(self._decode(row))
            except InvalidToken:
                continue
        return templates

    def delete(self, user_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM palm_templates WHERE user_id = ?", (user_id,))
            return cursor.rowcount > 0

    def status(self, user_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute("SELECT algorithm_version, enrolled_at FROM palm_templates WHERE user_id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    def _decode(self, row: sqlite3.Row) -> dict:
        raw = self.cipher.decrypt(row["encrypted_vector"])
        return {"user_id": row["user_id"], "vector": np.frombuffer(raw, dtype=np.float32).copy(), "algorithm_version": row["algorithm_version"], "enrolled_at": row["enrolled_at"]}
