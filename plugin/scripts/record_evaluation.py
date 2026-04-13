#!/usr/bin/env python3
"""評価記録のアトミック実行スクリプト

Usage:
  python3 record_evaluation.py <db_path> --project <id> \
    --metrics <json> --improvements <json> \
    [--findings <text> | --findings-file <path>] \
    [--priority-updates <json> | --priority-updates-file <path>]

1トランザクションで以下を実行:
1. evaluations テーブルに評価記録を追加
2. (指定時) project_prospects の priority を業種別に一括更新

priority-updates の形式: [{"industry": "SaaS", "priority": 2}, ...]

Output: JSON
  {"evaluation_id": N, "priority_updates": [{"industry": "...", "rows_affected": N}, ...]}

Exit code: 0 = 成功, 1 = バリデーションエラー, 2 = スクリプトエラー
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from typing import TypedDict

from sales_db import error_exit, get_connection, print_json


# ---------------------------------------------------------------------------
# 型定義
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
        description="評価記録のアトミック実行。evaluations INSERT + 優先度一括更新。",
    )
    _ = parser.add_argument("db_path", help="SQLite データベースのパス")
    _ = parser.add_argument("--project", required=True, help="プロジェクトID")
    _ = parser.add_argument("--metrics", required=True, help="メトリクスJSON文字列")
    findings_group = parser.add_mutually_exclusive_group()
    _ = findings_group.add_argument("--findings", help="分析結果テキスト（短い場合）")
    _ = findings_group.add_argument("--findings-file", help="分析結果ファイルパス（長い場合）")
    _ = parser.add_argument("--improvements", required=True, help="改善アクションJSON文字列")
    priority_group = parser.add_mutually_exclusive_group()
    _ = priority_group.add_argument("--priority-updates", help="優先度更新JSON: [{\"industry\": \"...\", \"priority\": N}, ...]")
    _ = priority_group.add_argument("--priority-updates-file", help="優先度更新JSONファイルパス")
    return parser


# ---------------------------------------------------------------------------
# 入力処理
# ---------------------------------------------------------------------------

def read_text(text: str | None, file_path: str | None) -> str:
    """テキストまたはファイルから内容を読み取る。"""
    if text is not None:
        return text
    if file_path is not None:
        with open(file_path, encoding="utf-8") as f:
            return f.read()
    return ""


def parse_json(value: str, label: str) -> object:
    """JSON文字列をパースする。失敗時はエラー終了。"""
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        error_exit(f"--{label} が不正なJSONです: {e}")


def parse_priority_updates(text: str | None, file_path: str | None) -> list[PriorityUpdate]:
    """優先度更新のJSONをパースしてバリデーションする。"""
    raw = read_text(text, file_path)
    if not raw:
        return []

    data = parse_json(raw, "priority-updates")
    if not isinstance(data, list):
        error_exit("--priority-updates はJSON配列である必要があります")

    updates: list[PriorityUpdate] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            error_exit(f"priority-updates[{i}] はオブジェクトである必要があります")
        industry = item.get("industry")
        priority = item.get("priority")
        if not isinstance(industry, str) or not industry:
            error_exit(f"priority-updates[{i}].industry は空でない文字列である必要があります")
        if not isinstance(priority, int) or priority < 1 or priority > 5:
            error_exit(f"priority-updates[{i}].priority は 1-5 の整数である必要があります (got: {priority})")
        updates.append(PriorityUpdate(industry=industry, priority=priority))

    return updates


# ---------------------------------------------------------------------------
# DB操作
# ---------------------------------------------------------------------------

def record(
    conn: sqlite3.Connection,
    project_id: str,
    metrics: str,
    findings: str,
    improvements: str,
    priority_updates: list[PriorityUpdate],
) -> EvaluationResult:
    """評価を記録し、優先度を更新する。"""

    # 1. INSERT evaluations
    cursor = conn.execute(
        "INSERT INTO evaluations (project_id, metrics, findings, improvements)"
        " VALUES (?, ?, ?, ?)",
        (project_id, metrics, findings, improvements),
    )
    evaluation_id = cursor.lastrowid
    if evaluation_id is None:
        raise RuntimeError("INSERT後にlastrowidが取得できませんでした")

    # 2. UPDATE priority（指定時のみ）
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
# メイン
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

    # JSON バリデーション
    _ = parse_json(metrics_raw, "metrics")
    _ = parse_json(improvements_raw, "improvements")

    # findings 読み取り
    findings = read_text(findings_text, findings_file)

    # 優先度更新パース
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
