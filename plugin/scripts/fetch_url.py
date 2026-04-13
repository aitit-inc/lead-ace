#!/usr/bin/env python3
"""URLからコンテンツを取得し、Claude Haiku で情報抽出して返す。

通常モード: Jina Reader（APIキー不要、20 RPM）でWebページをMarkdown化し、Haiku で抽出。
rawモード: playwright で生HTML（JS実行済み）を取得し、Haiku で抽出。
           フォームの entry ID やデータ属性など、Jina Reader が除去する情報が必要な場合に使う。

Usage:
    python3 fetch_url.py --url "https://example.com" --prompt "代表者名と住所を抽出"
    python3 fetch_url.py --url "https://example.com" --prompt "entry IDを抽出" --raw
    python3 fetch_url.py --url "https://example.com" --prompt "メールアドレスを探して" --timeout 20
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

import requests


JINA_BASE_URL = "https://r.jina.ai/"
HAIKU_TIMEOUT_SEC = 60


def fetch_via_jina(url: str, timeout: int) -> str:
    """Jina Reader 経由で URL の Markdown を取得する。"""
    jina_url = f"{JINA_BASE_URL}{url}"
    headers = {
        "Accept": "text/markdown",
        "X-Timeout": str(timeout),
        "x-remove-all-images": "true",
    }
    resp = requests.get(jina_url, headers=headers, timeout=timeout + 5)
    resp.raise_for_status()
    return resp.text


def fetch_raw_html(url: str, timeout: int) -> str:
    """playwright-cli で JS レンダリング済み生 HTML を取得する。

    playwright-cli open → eval document.documentElement.outerHTML → close の流れ。
    playwright-cli が使えない場合は requests にフォールバックする。
    """
    try:
        # ブラウザを開いてページに遷移
        open_result = subprocess.run(
            ["playwright-cli", "open", url],
            capture_output=True,
            text=True,
            timeout=timeout + 15,
        )
        if open_result.returncode != 0:
            raise RuntimeError(open_result.stderr.strip())

        # JS レンダリング済み HTML を取得
        eval_result = subprocess.run(
            ["playwright-cli", "eval", "document.documentElement.outerHTML"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        # ブラウザを閉じる（失敗しても無視）
        subprocess.run(
            ["playwright-cli", "close"],
            capture_output=True,
            timeout=10,
        )

        if eval_result.returncode == 0 and eval_result.stdout.strip():
            # playwright-cli の出力からマークダウンヘッダー等を除去し、HTML 部分のみ抽出
            html = _extract_html_from_cli_output(eval_result.stdout)
            return html

        raise RuntimeError(eval_result.stderr.strip() or "eval returned empty")

    except (subprocess.TimeoutExpired, FileNotFoundError, RuntimeError) as e:
        print(f"WARNING: playwright-cli 利用不可 ({e}), requests にフォールバック", file=sys.stderr)

    resp = requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": "Mozilla/5.0 (compatible; LeadAce/1.0)"},
    )
    resp.raise_for_status()
    return resp.text


def _extract_html_from_cli_output(output: str) -> str:
    """playwright-cli eval の出力から HTML 部分を抽出する。

    出力には ### Result ヘッダーや JSON 文字列ラッパーが含まれる場合がある。
    """
    # "### Result" 以降を探す
    result_marker = "### Result"
    idx = output.find(result_marker)
    if idx != -1:
        output = output[idx + len(result_marker):].strip()

    # JSON 文字列としてラップされている場合（"<html>..." 形式）、先頭・末尾の引用符を除去
    if output.startswith('"') and output.endswith('"'):
        try:
            parsed: object = json.loads(output)
            if isinstance(parsed, str):
                output = parsed
        except json.JSONDecodeError:
            output = output[1:-1]

    return output


def extract_with_haiku(content: str, prompt: str) -> str:
    """Claude Haiku CLI で情報を抽出する。"""
    full_prompt = (
        "Webページから情報を抽出してください。"
        "見つからない項目は「記載なし」としてください。"
        "抽出結果のみを返してください。\n\n"
        f"## 抽出対象\n{prompt}\n\n"
        f"## Webページコンテンツ\n{content}"
    )
    result = subprocess.run(
        ["claude", "--model", "haiku", "-p", full_prompt],
        capture_output=True,
        text=True,
        timeout=HAIKU_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        print(f"ERROR: Claude CLI failed: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="URL取得 + Claude Haiku 情報抽出")
    parser.add_argument("--url", required=True, help="取得先URL")
    parser.add_argument("--prompt", required=True, help="Haikuへの抽出指示")
    parser.add_argument(
        "--timeout",
        type=int,
        default=15,
        help="タイムアウト秒数（デフォルト: 15）",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="生HTMLを取得する（playwright使用）。フォームのentry ID等が必要な場合に指定",
    )
    args = parser.parse_args()

    try:
        if args.raw:
            content = fetch_raw_html(args.url, args.timeout)
        else:
            content = fetch_via_jina(args.url, args.timeout)
    except requests.Timeout:
        print(
            f"TIMEOUT: {args.url} は {args.timeout}秒以内に応答しませんでした",
            file=sys.stderr,
        )
        sys.exit(1)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else "unknown"
        print(f"HTTP_ERROR: {args.url} → {status}", file=sys.stderr)
        sys.exit(1)
    except requests.RequestException as e:
        print(f"FETCH_ERROR: {args.url} → {e}", file=sys.stderr)
        sys.exit(1)

    result = extract_with_haiku(content, args.prompt)
    print(result)


if __name__ == "__main__":
    main()
