"""
Durable audit store for automated agent actions.

Every write the agent runner makes (or attempts) is recorded here so failures
can be inspected without reading application logs.

Schema (auto-created on first use):

    agent_runner_audit_log(
        id               SERIAL PRIMARY KEY,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        job_name         TEXT NOT NULL,
        period_key       TEXT NOT NULL,
        action_type      TEXT NOT NULL,
        entity_type      TEXT,          -- 'project' | 'task' | etc.
        entity_id        TEXT,
        idempotency_key  TEXT,
        payload          JSONB,         -- what we sent
        result           JSONB,         -- what the server returned
        outcome          TEXT NOT NULL, -- 'applied' | 'skipped' | 'error'
        skip_reason      TEXT,
        error_message    TEXT
    )
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS agent_runner_audit_log (
    id              SERIAL       PRIMARY KEY,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    job_name        TEXT         NOT NULL,
    period_key      TEXT         NOT NULL,
    user_id         TEXT         NOT NULL DEFAULT 'global',
    action_type     TEXT         NOT NULL,
    entity_type     TEXT,
    entity_id       TEXT,
    idempotency_key TEXT,
    payload         JSONB,
    result          JSONB,
    outcome         TEXT         NOT NULL,
    skip_reason     TEXT,
    error_message   TEXT
);
CREATE INDEX IF NOT EXISTS agent_runner_audit_log_job_idx
    ON agent_runner_audit_log (job_name, period_key);
CREATE INDEX IF NOT EXISTS agent_runner_audit_log_user_idx
    ON agent_runner_audit_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS agent_runner_audit_log_ts_idx
    ON agent_runner_audit_log (created_at);
"""


class AuditStore:
    """Append-only log of every action the agent runner attempted."""

    def __init__(self, database_url: Optional[str] = None) -> None:
        self._database_url = database_url or ""

    def ensure_schema(self) -> None:
        conn = self._connect()
        if conn is None:
            return
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(_CREATE_TABLE_SQL)
        finally:
            conn.close()

    def record(
        self,
        job_name: str,
        period_key: str,
        action_type: str,
        outcome: str,  # applied | skipped | error
        *,
        user_id: str = "global",
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        payload: Optional[dict[str, Any]] = None,
        result: Optional[dict[str, Any]] = None,
        skip_reason: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        """Append one audit entry. Never raises — failures are logged only."""
        # Always emit a structured log line so the entry is visible in Railway
        # even if the DB insert fails.
        entry = {
            "job": job_name,
            "period": period_key,
            "user_id": user_id,
            "action": action_type,
            "outcome": outcome,
            **({"entity": f"{entity_type}/{entity_id}"} if entity_type and entity_id else {}),
            **({"idempotency_key": idempotency_key} if idempotency_key else {}),
            **({"skip_reason": skip_reason} if skip_reason else {}),
            **({"error": error_message} if error_message else {}),
        }
        logger.info("audit %s", json.dumps(entry))

        conn = self._connect()
        if conn is None:
            return

        try:
            with conn:
                with conn.cursor() as cur:
                    if user_id != "global":
                        # Serialize with account deletion before inserting any
                        # user-owned payload into the runner's optional table.
                        cur.execute(
                            "SELECT id FROM users WHERE id = %s FOR KEY SHARE",
                            (user_id,),
                        )
                        if cur.fetchone() is None:
                            return
                    cur.execute(
                        """
                        INSERT INTO agent_runner_audit_log
                            (job_name, period_key, user_id, action_type, entity_type,
                             entity_id, idempotency_key, payload, result, outcome,
                             skip_reason, error_message)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            job_name,
                            period_key,
                            user_id,
                            action_type,
                            entity_type,
                            entity_id,
                            idempotency_key,
                            json.dumps(payload) if payload is not None else None,
                            json.dumps(result) if result is not None else None,
                            outcome,
                            skip_reason,
                            error_message,
                        ),
                    )
        except Exception as exc:
            # Audit failures must never crash the runner.
            logger.error("Failed to persist audit entry: %s", exc)
        finally:
            conn.close()

    # ── Private ───────────────────────────────────────────────────────────────

    def _connect(self):
        if not self._database_url:
            return None
        try:
            import psycopg2

            return psycopg2.connect(self._database_url)
        except Exception as exc:
            logger.warning("Could not connect to Postgres for audit log: %s", exc)
            return None
