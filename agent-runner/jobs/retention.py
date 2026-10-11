"""
Data retention job — weekly purge of old activity events, insights, and metrics.

Runs weekly for each eligible account through its authenticated agent action.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import pytz

from mcp_client import AgentApiError, AgentClient
from storage.state_store import JobRunState

logger = logging.getLogger(__name__)

JOB_NAME = "data_retention"


def run_retention_for_user(
    client: AgentClient,
    user_id: str,
    timezone: str,
    state_store: JobRunState,
    *args: Any,
    **kwargs: Any,
) -> str:
    """
    Run this account's data retention purge at most once per week.
    Returns outcome: 'success' | 'skipped' | 'error'
    """
    tz = pytz.timezone(timezone)
    now = datetime.now(tz)
    # Use ISO week as period key so it runs at most once per week
    period_key = f"{now.year}-W{now.isocalendar()[1]:02d}"

    if state_store.is_completed(JOB_NAME, period_key, user_id):
        return "skipped"

    if not state_store.try_claim(JOB_NAME, period_key, user_id):
        return "skipped"

    try:
        client.write(
            "claim_job_run",
            {"jobName": JOB_NAME, "periodKey": period_key},
        )

        # Call retention purge via the agent write action
        result = client.write("run_data_retention", {})
        purge_data = result.get("data", {})

        client.write(
            "complete_job_run",
            {
                "jobName": JOB_NAME,
                "periodKey": period_key,
                "metadata": purge_data,
            },
        )
        state_store.mark_completed(JOB_NAME, period_key, user_id)
        logger.info(
            "retention user=%s period=%s purged=%s",
            user_id[:8],
            period_key,
            purge_data,
        )
        return "success"

    except Exception as exc:
        logger.exception("retention failed user=%s: %s", user_id[:8], exc)
        try:
            client.write(
                "fail_job_run",
                {
                    "jobName": JOB_NAME,
                    "periodKey": period_key,
                    "errorMessage": str(exc)[:500],
                },
            )
        except AgentApiError:
            pass
        return "error"
