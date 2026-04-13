#!/usr/bin/env python3
"""Atomic evaluation recording script

Usage:
  python3 record_evaluation.py <db_path> --project <id> \
    --metrics <json> --improvements <json> \
    [--findings <text> | --findings-file <path>] \
    [--priority-updates <json> | --priority-updates-file <path>]

Executes the following in a single transaction:
1. Add an evaluation record to the evaluations table
2. (If specified) Bulk-update project_prospects priority by industry

priority-updates format: [{"industry": "SaaS", "priority": 2}, ...]

Output: JSON
  {"evaluation_id": N, "priority_updates": [{"industry": "...", "rows_affected": N}, ...]}

Exit code: 0 = success, 1 = validation error, 2 = script error
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from typing import TypedDict

from sales_db import error_exit, get_connection, print_json


# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------

class PriorityUpdate(TypedDict):
    industry: str
    priority: int


class PriorityResult(TypedDict):
    industry: str
    rows_affected: int


class EvaluationResult(TypedDict):
    evaluation_id: int
    priority_updates: list[PriorityResult]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Atomic evaluation recording. evaluations INSERT + bulk priority update.",
    )
    _ = parser.add_argument("db_path", help="Path to the SQLite database")
    _ = parser.add_argument("--project", required=True, help="Project ID")
    _ = parser.add_argument("--metrics", required=True, help="Metrics JSON string")
    findings_group = parser.add_mutually_exclusive_group()
    _ = findings_group.add_argument("--findings", help="Analysis findings text (for short text)")
    _ = findings_group.add_argument("--findings-file", help="Path to findings file (for long text)")
    _ = parser.add_argument("--improvements", required=True, help="Improvement actions JSON string")
    priority_group = parser.add_mutually_exclusive_group()
    _ = priority_group.add_argument("--priority-updates", help="Priority update JSON: [{\"industry\": \"...\", \"priority\": N}, ...]")
    _ = priority_group.add_argument("--priority-updates-file", help="Path to priority updates JSON file")
    return parser


# ---------------------------------------------------------------------------
# Input processing
# ---------------------------------------------------------------------------

def read_text(text: str | None, file_path: str | None) -> str:
    """Read content from text or a file."""
    if text is not None:
        return text
    if file_path is not None:
        with open(file_path, encoding="utf-8") as f:
            return f.read()
    return ""


def parse_json(value: str, label: str) -> object:
    """Parse a JSON string. Exits with error on failure."""
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        error_exit(f"--{label} is not valid JSON: {e}")


def parse_priority_updates(text: str | None, file_path: str | None) -> list[PriorityUpdate]:
    """Parse and validate the priority updates JSON."""
    raw = read_text(text, file_path)
    if not raw:
        return []

    data = parse_json(raw, "priority-updates")
    if not isinstance(data, list):
        error_exit("--priority-updates must be a JSON array")

    updates: list[PriorityUpdate] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            error_exit(f"priority-updates[{i}] must be an object")
        industry = item.get("industry")
        priority = item.get("priority")
        if not isinstance(industry, str) or not industry:
            error_exit(f"priority-updates[{i}].industry must be a non-empty string")
        if not isinstance(priority, int) or priority < 1 or priority > 5:
            error_exit(f"priority-updates[{i}].priority must be an integer between 1 and 5 (got: {priority})")
        updates.append(PriorityUpdate(industry=industry, priority=priority))

    return updates


# ---------------------------------------------------------------------------
# DB operations
# ---------------------------------------------------------------------------

def record(
    conn: sqlite3.Connection,
    project_id: str,
    metrics: str,
    findings: str,
    improvements: str,
    priority_updates: list[PriorityUpdate],
) -> EvaluationResult:
    """Record the evaluation and update priorities."""

    # 1. INSERT evaluations
    cursor = conn.execute(
        "INSERT INTO evaluations (project_id, metrics, findings, improvements)"
        " VALUES (?, ?, ?, ?)",
        (project_id, metrics, findings, improvements),
    )
    evaluation_id = cursor.lastrowid
    if evaluation_id is None:
        raise RuntimeError("Could not get lastrowid after INSERT")

    # 2. UPDATE priority (only if specified)
    priority_results: list[PriorityResult] = []
    for pu in priority_updates:
        cursor_upd = conn.execute(
            "UPDATE project_prospects SET priority = ?, updated_at = datetime('now', 'localtime')"
            " WHERE project_id = ? AND prospect_id IN"
            " (SELECT id FROM prospects WHERE industry = ?)"
            " AND status = 'new'",
            (pu["priority"], project_id, pu["industry"]),
        )
        priority_results.append(PriorityResult(
            industry=pu["industry"],
            rows_affected=cursor_upd.rowcount,
        ))

    conn.commit()

    return EvaluationResult(
        evaluation_id=evaluation_id,
        priority_updates=priority_results,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = build_parser().parse_args()

    project_id: str = args.project
    metrics_raw: str = args.metrics
    findings_text: str | None = args.findings
    findings_file: str | None = args.findings_file
    improvements_raw: str = args.improvements
    priority_updates_raw: str | None = args.priority_updates
    priority_updates_file: str | None = args.priority_updates_file

    # JSON validation
    _ = parse_json(metrics_raw, "metrics")
    _ = parse_json(improvements_raw, "improvements")

    # Read findings
    findings = read_text(findings_text, findings_file)

    # Parse priority updates
    priority_updates = parse_priority_updates(priority_updates_raw, priority_updates_file)

    conn = get_connection(args.db_path)

    try:
        result = record(
            conn, project_id, metrics_raw, findings, improvements_raw, priority_updates,
        )
        print_json(result)
    except SystemExit:
        raise
    except Exception as e:
        conn.rollback()
        error_exit(f"記録中にエラーが発生: {e}", code=2)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
