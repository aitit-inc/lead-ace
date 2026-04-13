#!/usr/bin/env python3
"""prospects の org_lookup_status を一括設定するスクリプト

法人番号が見つからなかった・存在しない prospects にステータスを設定し、
以降の lookup_corporate_numbers.py で再検索されないようにする。

Usage:
  echo '<json_array>' | python3 mark_org_lookup_status.py <db_path>

JSON配列の各オブジェクト:
  prospect_id (必須): 対象の prospect ID
  status (必須): "not_applicable" | "unresolvable"
  reason (省略可): スキップ理由（notes に追記される）

Output: JSON
  {"updated": N, "errors": N, "details": [...]}
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Literal, TypedDict

from sales_db import error_exit, get_connection, print_json  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# 型定義
# ---------------------------------------------------------------------------

OrgLookupStatus = Literal["not_applicable", "unresolvable"]
VALID_STATUSES: frozenset[str] = frozenset({"not_applicable", "unresolvable"})


class MarkEntry(TypedDict):
    """入力JSON配列の各エントリ"""
    prospect_id: int
    status: OrgLookupStatus


class _MarkEntryOptional(TypedDict, total=False):
    reason: str


class MarkEntryFull(MarkEntry, _MarkEntryOptional):
    """reason を含む入力エントリ"""
    pass


class EntryDetail(TypedDict, total=False):
    """各エントリの処理結果"""
    index: int
    prospect_id: int
    result: str  # "updated" | "error"
    message: str


class ResultSummary(TypedDict):
    """全体の処理結果"""
    updated: int
    errors: int
    details: list[EntryDetail]


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="prospects の org_lookup_status を一括設定する。JSON を stdin から読む。",
    )
    _ = parser.add_argument("db_path", help="SQLite データベースのパス")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    db_path: str = args.db_path

    raw = sys.stdin.read().strip()
    if not raw:
        error_exit("stdin が空です。JSON 配列を入力してください。")

    try:
        data: list[MarkEntryFull] = json.loads(raw)
    except json.JSONDecodeError as e:
        error_exit(f"JSON パースエラー: {e}")

    if not isinstance(data, list):  # type: ignore[reportUnnecessaryIsinstance]
        error_exit("入力は JSON 配列である必要があります。")

    conn = get_connection(db_path)
    result = ResultSummary(updated=0, errors=0, details=[])

    try:
        for i, entry in enumerate(data):
            detail = EntryDetail(index=i, prospect_id=entry.get("prospect_id", 0))

            # バリデーション
            prospect_id = entry.get("prospect_id")
            status = entry.get("status")
            if not prospect_id or not status:
                detail["result"] = "error"
                detail["message"] = "prospect_id と status は必須です"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            if status not in VALID_STATUSES:
                detail["result"] = "error"
                detail["message"] = f"status は {VALID_STATUSES} のいずれかである必要があります: {status}"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            # prospect 存在確認
            row = conn.execute(
                "SELECT id, org_lookup_status FROM prospects WHERE id = ?",
                (prospect_id,),
            ).fetchone()
            if row is None:
                detail["result"] = "error"
                detail["message"] = f"prospect_id={prospect_id} が見つかりません"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            # 更新
            reason = entry.get("reason")
            if reason:
                conn.execute(
                    "UPDATE prospects SET org_lookup_status = ?,"
                    " notes = CASE WHEN notes IS NULL THEN ? ELSE notes || char(10) || ? END,"
                    " updated_at = datetime('now', 'localtime')"
                    " WHERE id = ?",
                    (status, reason, reason, prospect_id),
                )
            else:
                conn.execute(
                    "UPDATE prospects SET org_lookup_status = ?,"
                    " updated_at = datetime('now', 'localtime')"
                    " WHERE id = ?",
                    (status, prospect_id),
                )
            conn.commit()

            detail["result"] = "updated"
            detail["prospect_id"] = prospect_id
            detail["message"] = f"org_lookup_status={status}"
            result["updated"] += 1
            result["details"].append(detail)

    except Exception as e:
        error_exit(f"予期しないエラー: {e}")
    finally:
        conn.close()

    print_json(result)


if __name__ == "__main__":
    main()
