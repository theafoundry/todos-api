from __future__ import annotations

import os
import threading
import time
from urllib.parse import urlparse
from uuid import uuid4

import pytest

from storage.audit_store import _CREATE_TABLE_SQL as AUDIT_SCHEMA
from storage.audit_store import AuditStore
from storage.state_store import _CREATE_TABLE_SQL as JOB_SCHEMA
from storage.state_store import JobRunState


class FakeCursor:
    def __init__(self, owner: bool) -> None:
        self.owner = owner
        self.queries: list[tuple[str, object]] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params=None):
        self.queries.append((query, params))

    def fetchone(self):
        return ("owner",) if self.owner else None


class FakeConnection:
    def __init__(self, owner: bool) -> None:
        self.cur = FakeCursor(owner)
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.commit()

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


@pytest.mark.parametrize("owner", [True, False])
def test_claim_requires_locked_live_owner(monkeypatch, owner):
    conn = FakeConnection(owner)
    store = JobRunState("configured")
    monkeypatch.setattr(store, "_connect", lambda: conn)
    assert store.try_claim("privacy", "period", "owner") is owner
    assert "FOR KEY SHARE" in conn.cur.queries[0][0]
    assert conn.cur.queries[0][1] == ("owner",)
    assert any("INSERT INTO" in query for query, _ in conn.cur.queries) is owner
    assert conn.closed
    assert not store._memory


def test_configured_database_outage_does_not_fall_back_to_unverified_memory(monkeypatch):
    store = JobRunState("configured")
    monkeypatch.setattr(store, "_connect", lambda: None)
    assert store.try_claim("privacy", "period", "owner") is False
    assert not store._memory


@pytest.mark.parametrize("owner", [True, False])
def test_audit_insert_requires_locked_live_owner(monkeypatch, owner):
    conn = FakeConnection(owner)
    store = AuditStore("configured")
    monkeypatch.setattr(store, "_connect", lambda: conn)
    store.record("privacy", "period", "create_task", "applied", user_id="owner")
    assert "FOR KEY SHARE" in conn.cur.queries[0][0]
    assert any("INSERT INTO" in query for query, _ in conn.cur.queries) is owner
    assert conn.closed


def test_global_compatibility_and_local_completion_helper(monkeypatch):
    conn = FakeConnection(False)
    store = JobRunState("configured")
    monkeypatch.setattr(store, "_connect", lambda: conn)
    assert store.try_claim("privacy", "period") is True
    assert not any("FROM users" in query for query, _ in conn.cur.queries)
    local = JobRunState()
    assert local.try_claim("privacy", "period", "owner")
    local.mark_completed("privacy", "period", "owner")
    assert local.is_completed("privacy", "period", "owner")
    assert local._memory["privacy:period:owner"]["summary"] == {}


def test_completion_helper_never_recreates_deleted_runner_rows(monkeypatch):
    conn = FakeConnection(False)
    store = JobRunState("configured")
    monkeypatch.setattr(store, "_connect", lambda: conn)
    store.mark_completed("privacy", "period", "owner")
    assert len(conn.cur.queries) == 1
    assert "UPDATE agent_runner_job_runs" in conn.cur.queries[0][0]
    assert not any("INSERT INTO" in query for query, _ in conn.cur.queries)


def test_retention_job_completes_and_skips_its_next_run_for_the_same_actor():
    from jobs.retention import run_retention_for_user

    class Client:
        def __init__(self):
            self.calls = []

        def write(self, action, payload):
            self.calls.append((action, payload))
            return {"data": {"purged": {"activityEvents": 1, "insights": 0, "metricEvents": 0}}}

    client = Client()
    state = JobRunState()
    assert run_retention_for_user(client, "owner", "UTC", state) == "success"
    assert [action for action, _ in client.calls] == ["claim_job_run", "run_data_retention", "complete_job_run"]
    assert run_retention_for_user(client, "owner", "UTC", state) == "skipped"
    assert len(client.calls) == 3


@pytest.fixture
def privacy_database():
    url = os.environ.get("PLANWREN_PRIVACY_TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("Explicit disposable PostgreSQL URL not supplied")
    parsed = urlparse(url)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or "test" not in parsed.path:
        raise ValueError("Runner privacy tests require an explicit local test database")
    import psycopg2

    owner = str(uuid4())
    other = str(uuid4())
    conn = psycopg2.connect(url)
    with conn:
        with conn.cursor() as cur:
            cur.execute(JOB_SCHEMA)
            cur.execute(AUDIT_SCHEMA)
            for user_id in [owner, other]:
                cur.execute("INSERT INTO users (id,email,updated_at) VALUES (%s,%s,NOW())", (user_id, f"{user_id}@runner-privacy.example.test"))
            cur.execute("INSERT INTO agent_runner_job_runs (job_name,period_key,user_id) VALUES ('privacy','other',%s)", (other,))
            cur.execute("INSERT INTO agent_runner_audit_log (job_name,period_key,user_id,action_type,outcome) VALUES ('privacy','other',%s,'fixture','applied')", (other,))
    yield url, conn, owner, other
    with conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id IN (%s,%s)", (owner, other))
            cur.execute("DELETE FROM agent_runner_job_runs WHERE user_id IN (%s,%s)", (owner, other))
            cur.execute("DELETE FROM agent_runner_audit_log WHERE user_id IN (%s,%s)", (owner, other))
    conn.close()


def write_owned_row(url, owner, writer):
    if writer == "claim":
        return JobRunState(url).try_claim("privacy", "period", owner)
    AuditStore(url).record("privacy", "period", "fixture", "applied", user_id=owner)
    return None


def assert_owner_removed(conn, owner, other):
    with conn.cursor() as cur:
        for table in ["agent_runner_job_runs", "agent_runner_audit_log"]:
            cur.execute(f"SELECT user_id FROM {table} WHERE user_id IN (%s,%s)", (owner, other))
            assert cur.fetchall() == [(other,)]


@pytest.mark.parametrize("writer", ["claim", "audit"])
def test_claim_or_audit_after_committed_account_deletion_cannot_recreate_rows(privacy_database, writer):
    url, conn, owner, other = privacy_database
    with conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = %s", (owner,))
            cur.execute("DELETE FROM agent_runner_job_runs WHERE user_id = %s", (owner,))
            cur.execute("DELETE FROM agent_runner_audit_log WHERE user_id = %s", (owner,))
    result = write_owned_row(url, owner, writer)
    if writer == "claim":
        assert result is False
    assert_owner_removed(conn, owner, other)


@pytest.mark.parametrize("writer", ["claim", "audit"])
def test_account_deletion_waits_for_prior_locked_write_then_cleans_it(privacy_database, monkeypatch, writer):
    import psycopg2

    url, conn, owner, other = privacy_database
    held = threading.Event()
    release = threading.Event()
    errors = []
    raw_writer = psycopg2.connect(url)
    original_cursor = raw_writer.cursor

    class PausingCursor:
        def __init__(self):
            self.cur = original_cursor()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.cur.close()

        def execute(self, query, params=None):
            self.cur.execute(query, params)
            if "FOR KEY SHARE" in query:
                held.set()
                if not release.wait(5):
                    raise TimeoutError("Fixture writer was not released")

        def fetchone(self):
            return self.cur.fetchone()

    class PausingConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            raw_writer.commit() if not args[0] else raw_writer.rollback()

        def cursor(self):
            return PausingCursor()

        def commit(self):
            raw_writer.commit()

        def rollback(self):
            raw_writer.rollback()

        def close(self):
            raw_writer.close()

    store = JobRunState(url) if writer == "claim" else AuditStore(url)
    monkeypatch.setattr(store, "_connect", lambda: PausingConnection())

    def guarded_write():
        try:
            if writer == "claim":
                assert store.try_claim("privacy", "period", owner)
            else:
                store.record("privacy", "period", "fixture", "applied", user_id=owner)
        except Exception as exc:
            errors.append(exc)

    def delete_account():
        delete_conn = psycopg2.connect(url, application_name="planwren_privacy_delete_test")
        try:
            with delete_conn:
                with delete_conn.cursor() as cur:
                    cur.execute("DELETE FROM users WHERE id = %s", (owner,))
                    cur.execute("DELETE FROM agent_runner_job_runs WHERE user_id = %s", (owner,))
                    cur.execute("DELETE FROM agent_runner_audit_log WHERE user_id = %s", (owner,))
        except Exception as exc:
            errors.append(exc)
        finally:
            delete_conn.close()

    write_thread = threading.Thread(target=guarded_write)
    delete_thread = threading.Thread(target=delete_account)
    write_thread.start()
    assert held.wait(5)
    delete_thread.start()
    try:
        deadline = time.monotonic() + 5
        blocked = False
        while time.monotonic() < deadline:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM pg_stat_activity WHERE application_name = 'planwren_privacy_delete_test' AND wait_event_type = 'Lock'")
                blocked = cur.fetchone()[0] == 1
            conn.commit()
            if blocked:
                break
            time.sleep(0.02)
        assert blocked, "User deletion must wait for the runner's live-owner lock"
    finally:
        release.set()
        write_thread.join(5)
        delete_thread.join(5)
    assert not write_thread.is_alive() and not delete_thread.is_alive()
    assert not errors
    assert_owner_removed(conn, owner, other)
