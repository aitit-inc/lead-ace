#!/usr/bin/env python3
"""法人番号検索スクリプト（国税庁法人番号公表サイト）

playwright-cli を使ってブラウザ自動操作で検索し、候補一覧を JSON で出力する。
snapshot コマンドの出力をパースするため、JS ファイルは不要。

Usage:
    python3 check_corporate_number.py "SurpassOne株式会社"
    python3 check_corporate_number.py "佐藤"
    python3 check_corporate_number.py --kana "サーパスワンカブシキガイシャ"

Output (stdout): JSON
    {"total": N, "results": [{"number": "...", "name": "...", "reading": "...", "address": "..."}, ...]}
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import unicodedata
from typing import TypedDict

from sales_db import print_json  # pyright: ignore[reportMissingModuleSource]

NTA_URL = "https://www.houjin-bangou.nta.go.jp/"


# ---------------------------------------------------------------------------
# 型定義
# ---------------------------------------------------------------------------


class SearchResult(TypedDict):
    number: str
    name: str
    reading: str
    address: str


class SearchOutput(TypedDict):
    total: int
    results: list[SearchResult]


# ---------------------------------------------------------------------------
# playwright-cli 操作
# ---------------------------------------------------------------------------

def _run_cli(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    """playwright-cli コマンドを実行する。"""
    return subprocess.run(
        ["playwright-cli", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _close_browser() -> None:
    """ブラウザを閉じる（失敗しても無視）。"""
    try:
        _run_cli(["close"], timeout=10)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def _is_katakana(text: str) -> bool:
    """文字列がカタカナのみで構成されているか判定する。"""
    return all(
        unicodedata.name(c, "").startswith("KATAKANA") or c in "ー・"
        for c in text
    )


def search(company_name: str, kana: bool = False) -> SearchOutput:
    """国税庁法人番号公表サイトで法人番号を検索する。

    Args:
        company_name: 検索する法人名
        kana: True の場合、読み仮名（カタカナ）で検索

    Returns:
        検索結果（total + results 配列）
    """
    # ブラウザ起動 → サイトに遷移
    open_result = _run_cli(["open", NTA_URL], timeout=30)
    if open_result.returncode != 0:
        raise RuntimeError(f"playwright-cli open failed: {open_result.stderr.strip()}")

    try:
        # カタカナ検索の場合、チェックボックスをオン
        if kana:
            _run_cli(["check", "getByRole('checkbox', { name: '読み仮名で検索' })"])

        # 会社名を入力して検索
        _run_cli(["fill", "getByRole('textbox', { name: '商号又は名称' })", company_name])
        click_result = _run_cli(["click", "getByRole('button', { name: '検索' })"])
        if click_result.returncode != 0:
            raise RuntimeError(f"検索ボタンのクリックに失敗: {click_result.stderr.strip()}")

        # 結果ページの読み込みを待機
        _wait_for_results()

        # snapshot でページ構造を取得
        snap_result = _run_cli(["snapshot"], timeout=15)
        if snap_result.returncode != 0:
            raise RuntimeError(f"snapshot 取得失敗: {snap_result.stderr.strip()}")

        return _parse_snapshot(snap_result.stdout)

    finally:
        _close_browser()


def _wait_for_results() -> None:
    """検索結果ページが読み込まれるまで待機する。

    playwright-cli の snapshot で URL に kensaku-kekka が含まれるか確認。
    最大5回リトライ（各1秒間隔）。
    """
    import time
    for _ in range(5):
        time.sleep(1)
        snap = _run_cli(["snapshot"], timeout=10)
        if "kensaku-kekka" in snap.stdout:
            return
    # タイムアウトしてもパース試行はする（結果が空なだけ）


def _parse_snapshot(snapshot: str) -> SearchOutput:
    """playwright-cli snapshot の出力から検索結果をパースする。

    snapshot の row 行は以下の形式:
      - row "1011003011668 サーパスワン ＳｕｒｐａｓｓＯｎｅ株式会社 東京都新宿区... 履歴等" [ref=...]:
    各 row 内の rowheader と cell からデータを抽出する。
    """
    results: list[SearchResult] = []
    total = 0

    # 件数を取得: strong [ref=...]: "3" の後に 件 見つかりました
    total_match = re.search(
        r'strong \[ref=\w+\]: "(\d+)"\s*\n\s*- text: 件 見つかりました',
        snapshot,
    )
    if total_match:
        total = int(total_match.group(1))

    # テーブル行をパース
    # rowheader に法人番号、cell に名前(読み+法人名)、cell に所在地
    lines = snapshot.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # rowheader "1011003011668" を見つける（ヘッダ行の "法人番号" は除外）
        rh_match = re.match(r'- rowheader "(\d{13})"', line)
        if rh_match:
            number = rh_match.group(1)
            reading = ""
            name = ""
            address = ""

            # 後続行から cell を探す
            j = i + 1
            cell_count = 0
            while j < len(lines) and cell_count < 2:
                cline = lines[j].strip()

                # 1つ目の cell: 名称（読み + 法人名）
                if cell_count == 0:
                    cell_match = re.match(r'- cell "(.+?)"', cline)
                    if cell_match:
                        cell_count += 1
                        cell_full_text = cell_match.group(1)
                        # cell 内の generic が読み、text が法人名
                        k = j + 1
                        while k < len(lines):
                            inner = lines[k].strip()
                            if inner.startswith("- generic"):
                                g_match = re.search(r": (.+)$", inner)
                                if g_match:
                                    reading = g_match.group(1).strip()
                            elif inner.startswith("- text:"):
                                t_match = re.search(r"- text: (.+)$", inner)
                                if t_match:
                                    name = t_match.group(1).strip()
                                break
                            elif inner.startswith("- cell"):
                                break
                            k += 1
                        # フォールバック: 内部パースで name が取れなかった場合、
                        # cell の引用テキストから reading を除いた部分を name にする
                        if not name and cell_full_text:
                            if reading and cell_full_text.startswith(reading):
                                name = cell_full_text[len(reading):].strip()
                            if not name:
                                name = cell_full_text
                # 2つ目の cell: 所在地
                elif cell_count == 1:
                    cell_match = re.match(r'- cell "(.+?)"', cline)
                    if cell_match:
                        address = cell_match.group(1)
                        # "履歴等" セルは除外
                        if address != "履歴等":
                            cell_count += 1
                        else:
                            address = ""

                j += 1

            if number:
                results.append(SearchResult(
                    number=number,
                    name=name or reading,
                    reading=reading,
                    address=address,
                ))

        i += 1

    return SearchOutput(total=total, results=results)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="国税庁法人番号公表サイトで法人番号を検索する。",
    )
    _ = parser.add_argument("company_name", help="検索する法人名")
    _ = parser.add_argument(
        "--kana",
        action="store_true",
        help="読み仮名（カタカナ）で検索する。省略時、全文字がカタカナなら自動でカナ検索になる",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    company_name: str = args.company_name
    kana: bool = args.kana

    # カタカナ自動判定
    if not kana and _is_katakana(company_name):
        kana = True

    mode = "読み仮名" if kana else "法人名"
    print(f"「{company_name}」を{mode}で検索中...", file=sys.stderr)

    try:
        result = search(company_name, kana=kana)
    except (RuntimeError, subprocess.TimeoutExpired) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    # 結果表示（stderr にサマリー、stdout に JSON）
    total = result["total"]
    results = result["results"]
    shown = len(results)

    if total > shown:
        print(f"{total}件 見つかりました（先頭 {shown}件を表示）", file=sys.stderr)
    else:
        print(f"{total}件 見つかりました", file=sys.stderr)

    if results:
        for i, r in enumerate(results, 1):
            print(f"  [{i}] {r['name']}", file=sys.stderr)
            print(f"      法人番号: {r['number']}", file=sys.stderr)
            print(f"      読み: {r['reading']}", file=sys.stderr)
            print(f"      所在地: {r['address']}", file=sys.stderr)
            print(file=sys.stderr)

    print_json(result)


if __name__ == "__main__":
    main()
