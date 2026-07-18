from __future__ import annotations

import os
import re
from typing import Any

import requests

from common import InboxCandidate

TDNET_API_BASE_URL = os.getenv("TDNET_API_BASE_URL", "https://webapi.yanoshin.jp/webapi/tdnet/list")
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
    tags = [tag for tag, needles in TAG_RULES.items() if needles and any(n in text for n in needles)]
    return tags

def parse_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("items", "results", "data", "rows"):
            if isinstance(payload.get(key), list):
                return [x for x in payload[key] if isinstance(x, dict)]
    return []

def row_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if row.get(key) is not None:
            return row[key]
    return None

def parse_payload(payload: Any) -> list[InboxCandidate]:
    candidates: list[InboxCandidate] = []
    for row in parse_rows(payload):
        title = str(row_value(row, "title", "Title", "disclosureTitle") or "")
        if not TITLE_RE.search(title):
            continue
        url = str(row_value(row, "url", "pdf_url", "document_url", "link") or "")
        code = row_value(row, "code", "security_code", "company_code", "Code")
        body = str(row_value(row, "body", "summary", "description") or "")
        event_type = infer_event_type(title)
        candidates.append(InboxCandidate(
            source_kind="tdnet", title=title, url=url, published_at=row_value(row, "published_at", "datetime", "date"),
            security_code=str(code).upper() if code else None, suggested_event_type=event_type,
            suggested_comment_tags=tuple(infer_comment_tags(f"{title} {body}") if event_type == "company_comment" else []), raw={"tdnet": row},
        ))
    return candidates

def collect(*, timeout: int = 20) -> list[InboxCandidate]:
    response = requests.get(TDNET_API_BASE_URL, timeout=timeout, headers={"User-Agent": "hikokaika-watch/collect"})
    response.raise_for_status()
    return parse_payload(response.json())
