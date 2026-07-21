from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any
import requests

from common import InboxCandidate, JST, is_allowed_http_url

TDNET_API_BASE_URL = os.getenv("TDNET_API_BASE_URL") or "https://webapi.yanoshin.jp/webapi/tdnet/list"
TDNET_API_FORMAT = os.getenv("TDNET_API_FORMAT") or "json2"
TDNET_API_LIMIT = int(os.getenv("TDNET_API_LIMIT") or "300")
TITLE_RE = re.compile(r"一部報道|本日の(一部)?報道|報道に関する|非公開化|マネジメント・バイアウト|ＭＢＯ|MBO|公開買付|株式併合|株式の非公開化|買収提案")
TAG_RULES = {
    "no_decision": ("決定した事実はありません", "決定している事実はありません", "決定事実はありません"),
    "not_company_announcement": ("当社が発表したものではありません", "当社から発表したものではありません"),
    "not_under_consideration": ("検討しておりません", "検討していません"),
    "report_denied": ("事実ではありません", "報道内容は事実と異なります"),
    "comment_declined": ("コメントを差し控え",),
    "consideration_acknowledged": ("検討しております", "検討しています"),
    "strategic_options_under_review": ("戦略的選択肢", "企業価値向上"),
    "proposal_received": ("提案を受領", "提案を受け"),
    "discussions_ongoing": ("協議", "交渉"),
    "other": (),
}

class TDnetParseError(ValueError):
    pass

def tdnet_fetch_url(base_url: str | None = None) -> str:
    configured = (base_url or TDNET_API_BASE_URL).strip()
    if re.search(r"\.(json|json2)(\?|$)", configured):
        return configured
    today = datetime.now(JST).strftime("%Y%m%d")
    return f"{configured.rstrip('/')}/{today}.{TDNET_API_FORMAT}?limit={TDNET_API_LIMIT}"

def infer_event_type(title: str) -> str:
    if "一部報道" in title or "報道に関する" in title:
        return "company_comment"
    if "公開買付けの開始" in title or "公開買付開始" in title:
        return "formal_announcement"
    if "公開買付けの結果" in title:
        return "tender_offer_result"
    if "買付条件" in title and "変更" in title:
        return "price_revision"
    return "timely_disclosure"

def infer_comment_tags(text: str) -> list[str]:
    return [tag for tag, needles in TAG_RULES.items() if needles and any(n in text for n in needles)]

def parse_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("items", "results", "data", "rows"):
            value = payload.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
        tdnet = payload.get("TDnet")
        if isinstance(tdnet, dict) and isinstance(tdnet.get("items"), list):
            return [x for x in tdnet["items"] if isinstance(x, dict)]
    raise TDnetParseError(f"unknown TDnet JSON structure: {type(payload).__name__}")

def row_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if row.get(key) is not None:
            return row[key]
    return None

def normalize_tdnet_code(code: Any) -> str | None:
    if code is None:
        return None
    match = re.search(r"[0-9]{3}[0-9A-Z]", str(code).strip().upper())
    return match.group(0) if match else None

def parse_payload(payload: Any) -> list[InboxCandidate]:
    candidates: list[InboxCandidate] = []
    rows = parse_rows(payload)
    for row in rows:
        title = str(row_value(row, "title", "Title", "disclosureTitle", "title_jp") or "").strip()
        if not title or not TITLE_RE.search(title):
            continue
        url = str(row_value(row, "url", "pdf_url", "document_url", "link", "DocumentUrl") or "").strip()
        if not is_allowed_http_url(url):
            continue
        code = normalize_tdnet_code(row_value(row, "code", "security_code", "company_code", "Code", "companyCode"))
        body = str(row_value(row, "body", "summary", "description") or "")
        published = row_value(row, "published_at", "datetime", "date", "pubdate", "disclosed_at")
        event_type = infer_event_type(title)
        candidates.append(InboxCandidate("tdnet", title, url, str(published) if published else None, code, event_type, tuple(infer_comment_tags(f"{title} {body}") if event_type == "company_comment" else []), {"tdnet": row}))
    return candidates

def response_json(response: requests.Response) -> Any:
    ctype = response.headers.get("content-type", "")
    text = response.text[:120].lstrip()
    if text.startswith("<") or (ctype and "json" not in ctype.lower() and "javascript" not in ctype.lower()):
        raise TDnetParseError(f"TDnet response is not JSON (content-type={ctype or 'unknown'}, head={text[:40]!r})")
    try:
        return response.json()
    except json.JSONDecodeError as error:
        raise TDnetParseError(f"TDnet invalid JSON: {error.msg}") from error

def collect(*, timeout: int = 20) -> list[InboxCandidate]:
    url = tdnet_fetch_url()
    if not is_allowed_http_url(url):
        raise ValueError("TDNET_API_BASE_URL must resolve to an absolute http/https URL")
    response = requests.get(url, timeout=timeout, headers={"User-Agent": "hikokaika-watch/collect"})
    response.raise_for_status()
    return parse_payload(response_json(response))
