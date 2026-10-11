"""
Job-run state store.

Prevents duplicate daily/weekly executions by persisting a (job_name, period_key)
lock row in Postgres before each run. Falls back to an in-memory dict when no
DATABASE_URL is configured (useful in local dev / tests).

Schema (auto-created on first use):

    agent_runner_job_runs(
        id            SERIAL PRIMARY KEY,
        job_name      TEXT NOT NULL,
        period_key    TEXT NOT NULL,
        started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at  TIMESTAMPTZ,
        status        TEXT NOT NULL DEFAULT 'running',   -- running | completed | failed
        result_summary JSONB,
        error_message TEXT,
        UNIQUE (job_name, period_key)
    )

The UNIQUE constraint provides atomic idempotency: only the first INSERT for a
(job_name, period_key) pair succeeds. All concurrent retries get a duplicate-key
error and exit cleanly.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS agent_runner_job_runs (
    id             SERIAL PRIMARY KEY,
    job_name       TEXT         NOT NULL,
    period_key     TEXT         NOT NULL,
    user_id        TEXT         NOT NULL DEFAULT 'global',
    started_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at   TIMESTAMPTZ,
    status         TEXT         NOT NULL DEFAULT 'running',
    result_summary JSONB,
    error_message  TEXT,
    CONSTRAINT agent_runner_job_runs_unique UNIQUE (job_name, period_key, user_id)
);
"""


class JobRunState:
    """Persist job-run lifecycle rows so concurrent runners agree on ownership."""

    def __init__(self, database_url: Optional[str] = None) -> None:
        self._database_url = database_url or ""
        # In-memory fallback: {"{job_name}:{period_key}:{user_id}": {status, ...}}
        self._memory: dict[str, dict[str, Any]] = {}

    # ── Schema ────────────────────────────────────────────────────────────────

    def ensure_schema(self) -> None:
        """Create the job_runs table if it does not yet exist."""
        conn = self._connect()
        if conn is None:
            return
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(_CREATE_TABLE_SQL)
        finally:
            conn.close()

    # ── Core operations ───────────────────────────────────────────────────────

    def try_claim(self, job_name: str, period_key: str, user_id: str = "global") -> bool:
        """
        Atomically claim a job run for (job_name, period_key, user_id).

        Returns True if this process is now the owner, False if another
        process already claimed this period.
        """
        conn = self._connect()
        if conn is None:
            if self._database_url:
                # Configured durable state must fail closed during a DB outage.
                return False
            return self._memory_claim(job_name, period_key, user_id)

        try:
            with conn.cursor() as cur:
                try:
                    if user_id != "global":
                        # Keep this lock until INSERT commits. Account deletion
                        # waits for prior writes, then removes runner rows in the
                        # same transaction; later claims see no live owner.
                        cur.execute(
                            "SELECT id FROM users WHERE id = %s FOR KEY SHARE",
                            (user_id,),
                        )
                        if cur.fetchone() is None:
                            conn.rollback()
                            return False
                    cur.execute(
                        """
                        INSERT INTO agent_runner_job_runs (job_name, period_key, user_id, status)
                        VALUES (%s, %s, %s, 'running')
                        """,
                        (job_name, period_key, user_id),
                    )
                    conn.commit()
                    logger.debug("Claimed job run %s/%s user=%s", job_name, period_key, user_id)
                    return True
                except Exception as exc:
                    conn.rollback()
                    if "23505" in str(exc) or "unique" in str(exc).lower():
                        logger.info(
                            "Job run %s/%s user=%s already claimed, skipping",
                            job_name, period_key, user_id,
                        )
                        return False
                    raise
        finally:
            conn.close()

    def complete(self, job_name: str, period_key: str, summary: dict[str, Any], user_id: str = "global") -> None:
        """Mark a job run as successfully completed."""
        conn = self._connect()
        if conn is None:
            key = f"{job_name}:{period_key}:{user_id}"
            if key in self._memory:
                self._memory[key].update(
                    {"status": "completed", "summary": summary, "completed_at": _now_iso()}
                )
            return

        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE agent_runner_job_runs
                           SET status = 'completed',
                               completed_at = NOW(),
                               result_summary = %s
                         WHERE job_name = %s AND period_key = %s AND user_id = %s
                        """,
                        (json.dumps(summary), job_name, period_key, user_id),
                    )
        finally:
            conn.close()

    def mark_completed(self, job_name: str, period_key: str, user_id: str = "global") -> None:
        """Compatibility helper for jobs that do not persist a result summary."""
        self.complete(job_name, period_key, {}, user_id)

    def fail(self, job_name: str, period_key: str, error_message: str, user_id: str = "global") -> None:
        """Mark a job run as failed."""
        conn = self._connect()
        if conn is None:
            key = f"{job_name}:{period_key}:{user_id}"
            if key in self._memory:
                self._memory[key].update(
                    {"status": "failed", "error": error_message, "completed_at": _now_iso()}
                )
            return

        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE agent_runner_job_runs
                           SET status = 'failed',
                               completed_at = NOW(),
                               error_message = %s
                         WHERE job_name = %s AND period_key = %s AND user_id = %s
                        """,
                        (error_message, job_name, period_key, user_id),
                    )
        finally:
            conn.close()

    def is_completed(self, job_name: str, period_key: str, user_id: str = "global") -> bool:
        """Return True if a previous run already completed successfully."""
        conn = self._connect()
        if conn is None:
            key = f"{job_name}:{period_key}:{user_id}"
            return self._memory.get(key, {}).get("status") == "completed"

        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT status FROM agent_runner_job_runs
                     WHERE job_name = %s AND period_key = %s AND user_id = %s
                    """,
                    (job_name, period_key, user_id),
                )
                row = cur.fetchone()
                return row is not None and row[0] == "completed"
        finally:
            conn.close()

    # ── Private ───────────────────────────────────────────────────────────────

    def _connect(self):
        if not self._database_url:
            return None
        try:
            import psycopg2  # lazy import so tests without psycopg2 still work

            return psycopg2.connect(self._database_url)
        except Exception as exc:
            logger.warning("Could not connect to Postgres for job state: %s", exc)
            return None

    def _memory_claim(self, job_name: str, period_key: str, user_id: str = "global") -> bool:
        key = f"{job_name}:{period_key}:{user_id}"
        if key in self._memory:
            return False
        self._memory[key] = {"status": "running", "started_at": _now_iso()}
        return True


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
