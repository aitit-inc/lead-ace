#!/usr/bin/env python3
"""候補JSON（Phase 1）と連絡先JSON（Phase 2）をマージするスクリプト

Usage:
  merge_prospects.py <candidates_file> <contacts_file>

Phase 1（候補収集）の出力と Phase 2（連絡先取得）の出力を
name + website_url のドメインで突き合わせてマージし、
add_prospects.py に渡せる形式でstdoutに出力する。

ドメインでマッチしない場合は name のみでフォールバックマッチする
（連絡先側に website_url が欠損しているケースへの対策）。
マッチしなかった候補は連絡先なし（email=null等）のまま出力する。

Output (stdout): マージ済みJSON配列
Output (stderr): マージ結果のサマリー
"""

from __future__ import annotations

import json
import sys

from sales_db import PROSPECT_CONTACT_FIELDS, error_exit, extract_domain, normalize_name, print_json  # pyright: ignore[reportMissingModuleSource]


def make_key(entry: dict[str, object]) -> str:
    """name（正規化済み）+ domain でマッチキーを生成する。"""
    name = normalize_name(str(entry.get("name", "")))
    raw_url = entry.get("website_url")
    url = str(raw_url) if isinstance(raw_url, str) else ""
    domain = extract_domain(url) if url else ""
    return f"{name}|{domain}"


def name_only_key(entry: dict[str, object]) -> str:
    """name（正規化済み）のみのフォールバックキーを生成する。"""
    return normalize_name(str(entry.get("name", "")))


# 連絡先フィールド（sales_db.py の Prospect TypedDict から導出）
CONTACT_FIELDS = PROSPECT_CONTACT_FIELDS


def main() -> None:
    if len(sys.argv) < 3:
        error_exit("Usage: merge_prospects.py <candidates_file> <contacts_file>")

    candidates_path = sys.argv[1]
    contacts_path = sys.argv[2]

    try:
        with open(candidates_path, encoding="utf-8") as f:
            candidates: object = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        error_exit(f"候補ファイル読み込みエラー: {e}")

    try:
        with open(contacts_path, encoding="utf-8") as f:
            contacts: object = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        error_exit(f"連絡先ファイル読み込みエラー: {e}")

    if not isinstance(candidates, list) or not isinstance(contacts, list):
        error_exit("両方のファイルがJSON配列である必要があります")

    # 連絡先をキーでインデックス化（主キー: name+domain、フォールバック: name のみ）
    contacts_index: dict[str, dict[str, object]] = {}
    contacts_name_index: dict[str, dict[str, object]] = {}
    for contact in contacts:
        if isinstance(contact, dict):
            key = make_key(contact)
            contacts_index[key] = contact
            nk = name_only_key(contact)
            if nk:
                contacts_name_index[nk] = contact

    merged: list[dict[str, object]] = []
    matched_count = 0
    fallback_matched_count = 0
    unmatched_names: list[str] = []

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        key = make_key(candidate)
        result: dict[str, object] = dict(candidate)

        contact: dict[str, object] | None = contacts_index.get(key)
        fallback = False
        if contact is None:
            # フォールバック: name のみでマッチ（website_url 欠損対策）
            nk = name_only_key(candidate)
            contact = contacts_name_index.get(nk) if nk else None
            if contact is not None:
                fallback = True

        if contact is not None:
            for field in CONTACT_FIELDS:
                if field in contact:
                    result[field] = contact[field]
            matched_count += 1
            if fallback:
                fallback_matched_count += 1
        else:
            for field in CONTACT_FIELDS:
                result.setdefault(field, None)
            unmatched_names.append(str(candidate.get("name", "?")))

        merged.append(result)

    print_json(merged)

    summary = (
        f"マージ結果: 候補 {len(candidates)}件, 連絡先 {len(contacts)}件"
        f" → マッチ {matched_count}件"
    )
    if fallback_matched_count:
        summary += f"（うち社名フォールバック {fallback_matched_count}件）"
    summary += f", 未マッチ {len(unmatched_names)}件"
    print(summary, file=sys.stderr)
    if unmatched_names:
        for name in unmatched_names:
            print(f"  連絡先未マッチ: {name}", file=sys.stderr)


if __name__ == "__main__":
    main()
