#!/usr/bin/env python3
"""候補JSONからDB既存分を除外するフィルタスクリプト

Usage:
  echo '<json_array>' | filter_duplicates.py <db_path> <project_id>

stdin から候補のJSON配列を受け取り、DBに登録済みの営業先を除外して
新規候補のみをstdoutに出力する。

判定基準（高速な順）:
  1. organizations.corporate_number 一致
  2. organizations.domain 一致
  3. prospects.name の正規化一致

Output (stdout): フィルタ済みJSON配列
Output (stderr): フィルタ結果のサマリー
"""

from __future__ import annotations

import json
import sys

from sales_db import error_exit, extract_domain, get_connection, normalize_name, print_json  # pyright: ignore[reportMissingModuleSource]


def main() -> None:
    if len(sys.argv) < 3:
        error_exit("Usage: filter_duplicates.py <db_path> <project_id>")

    db_path = sys.argv[1]
    project_id = sys.argv[2]

    try:
        candidates: object = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        error_exit(f"JSON parse error: {e}")

    if not isinstance(candidates, list):
        error_exit("入力はJSON配列である必要があります")

    conn = get_connection(db_path)
    try:
        # organizations から corporate_number と domain を取得（高速チェック用）
        org_corp_nums: set[str] = set()
        org_domains: set[str] = set()
        for row in conn.execute("SELECT corporate_number, domain FROM organizations"):
            org_corp_nums.add(row["corporate_number"])
            if row["domain"]:
                org_domains.add(row["domain"])

        # prospects から name を取得（フォールバック用）
        cursor = conn.execute(
            "SELECT p.name, p.website_url"
            " FROM prospects p"
            " JOIN project_prospects pp ON p.id = pp.prospect_id"
            " WHERE pp.project_id = ?",
            (project_id,),
        )
        existing_names: set[str] = set()
        existing_domains: set[str] = set()
        for row in cursor:
            if row["name"]:
                existing_names.add(normalize_name(str(row["name"])))
            if row["website_url"]:
                existing_domains.add(extract_domain(str(row["website_url"])))
    finally:
        conn.close()

    new_candidates: list[object] = []
    duplicates: list[dict[str, str]] = []

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        raw_name = candidate.get("name", "")
        corp_num = candidate.get("corporate_number", "")
        url = candidate.get("website_url", "")
        domain = extract_domain(url) if url else ""

        # 1. 法人番号チェック（O(1) set lookup）
        if corp_num and corp_num in org_corp_nums:
            duplicates.append({"name": raw_name, "reason": f"法人番号一致: {corp_num}"})
        # 2. ドメインチェック（organizations 優先）
        elif domain and domain in org_domains:
            duplicates.append({"name": raw_name, "reason": f"ドメイン一致(org): {domain}"})
        elif domain and domain in existing_domains:
            duplicates.append({"name": raw_name, "reason": f"ドメイン一致: {domain}"})
        # 3. 名称チェック
        elif normalize_name(raw_name) in existing_names:
            duplicates.append({"name": raw_name, "reason": "名称一致"})
        else:
            new_candidates.append(candidate)

    print_json(new_candidates)

    print(
        f"フィルタ結果: 入力 {len(candidates)}件 → 新規 {len(new_candidates)}件, 重複除外 {len(duplicates)}件",
        file=sys.stderr,
    )
    if duplicates:
        for d in duplicates:
            print(f"  除外: {d['name']} ({d['reason']})", file=sys.stderr)


if __name__ == "__main__":
    main()
