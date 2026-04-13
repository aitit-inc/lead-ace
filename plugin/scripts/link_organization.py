#!/usr/bin/env python3
"""既存 prospect に organizations レコードを紐づけるスクリプト

organization_id が NULL の既存 prospect に対して、法人番号を確定し
organizations テーブルへの upsert + prospects.organization_id の更新を行う。

Usage:
  echo '<json_array>' | python3 link_organization.py <db_path>

JSON配列の各オブジェクト:
  prospect_id (必須): 紐づけ対象の prospect ID
  corporate_number (必須): 法人番号（13桁）
  organization_name (必須): 正式法人名（国税庁公表サイトの名称）
  address (省略可): 所在地（国税庁公表サイトの所在地）
  name (省略可): prospects.name を更新する場合に指定
  department (省略可): prospects.department を更新する場合に指定

Output: JSON
  {"updated": N, "errors": N, "details": [...]}
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import TypedDict

from sales_db import error_exit, get_connection, print_json, upsert_organization  # pyright: ignore[reportMissingModuleSource]


# ---------------------------------------------------------------------------
# 型定義
# ---------------------------------------------------------------------------

class _LinkEntryOptional(TypedDict, total=False):
    """LinkEntry のオプションフィールド"""
    address: str
    name: str
    department: str


class LinkEntry(_LinkEntryOptional):
    """入力JSON配列の各エントリ"""
    prospect_id: int
    corporate_number: str
    organization_name: str


class EntryDetail(TypedDict, total=False):
    """各エントリの処理結果"""
    index: int
    prospect_id: int
    status: str  # "updated" | "error"
    message: str


class ResultSummary(TypedDict):
    """全体の処理結果"""
    updated: int
    errors: int
    details: list[EntryDetail]


# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = ("prospect_id", "corporate_number", "organization_name")


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="既存 prospect に法人番号を紐づけ、organizations に upsert する。JSON を stdin から読む。",
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
        data: list[LinkEntry] = json.loads(raw)
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
            missing = [f for f in REQUIRED_FIELDS if not entry.get(f)]
            if missing:
                detail["status"] = "error"
                detail["message"] = f"必須フィールド不足: {', '.join(missing)}"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            prospect_id: int = entry["prospect_id"]
            corporate_number: str = entry["corporate_number"]
            organization_name: str = entry["organization_name"]
            address: str | None = entry.get("address")

            # prospect の存在確認
            row = conn.execute(
                "SELECT id, name, website_url, industry, overview, organization_id"
                " FROM prospects WHERE id = ?",
                (prospect_id,),
            ).fetchone()
            if row is None:
                detail["status"] = "error"
                detail["message"] = f"prospect_id={prospect_id} が見つかりません"
                result["errors"] += 1
                result["details"].append(detail)
                continue

            if row["organization_id"] is not None:
                detail["status"] = "error"
                detail["message"] = (
                    f"prospect_id={prospect_id} は既に organization_id="
                    f"{row['organization_id']} が設定されています"
                )
                result["errors"] += 1
                result["details"].append(detail)
                continue

            # organizations に upsert
            upsert_organization(
                conn,
                corporate_number=corporate_number,
                name=organization_name,
                website_url=row["website_url"],
                industry=row["industry"],
                overview=row["overview"],
                address=address,
            )

            # prospects.organization_id を更新
            update_fields: list[str] = ["organization_id = ?"]
            update_params: list[str | int] = [corporate_number]

            new_name = entry.get("name")
            if new_name:
                update_fields.append("name = ?")
                update_params.append(new_name)

            new_dept = entry.get("department")
            if new_dept:
                update_fields.append("department = ?")
                update_params.append(new_dept)

            update_fields.append("updated_at = datetime('now', 'localtime')")
            update_params.append(prospect_id)

            conn.execute(
                f"UPDATE prospects SET {', '.join(update_fields)} WHERE id = ?",
                update_params,
            )
            conn.commit()

            detail["status"] = "updated"
            detail["prospect_id"] = prospect_id
            detail["message"] = (
                f"organization_id={corporate_number}"
                f" (法人名: {organization_name}) を設定しました"
            )
            result["updated"] += 1
            result["details"].append(detail)

    except Exception as e:
        error_exit(f"予期しないエラー: {e}")
    finally:
        conn.close()

    print_json(result)


if __name__ == "__main__":
    main()
