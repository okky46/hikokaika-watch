from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from typing import Any

import requests

from common import InboxCandidate, JST

EDINET_API_BASE_URL = os.getenv("EDINET_API_BASE_URL", "https://disclosure.edinet-fsa.go.jp/api/v2")
DOC_TYPES = ("大量保有報告書", "変更報告書")
RATIO_RE = re.compile(r"(保有割合|株券等保有割合)[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)")

def parse_documents(payload: dict[str, Any], active_codes: set[str]) -> list[InboxCandidate]:
    results: list[InboxCandidate] = []
    for doc in payload.get("results", []):
        title = str(doc.get("docDescription") or "")
        if not any(t in title for t in DOC_TYPES):
            continue
        code = str(doc.get("secCode") or "").strip().upper()
        if code.endswith("0") and len(code) == 5:
            code = code[:4]
        if code not in active_codes:
            continue
        doc_id = doc.get("docID")
        url = f"{EDINET_API_BASE_URL}/documents/{doc_id}" if doc_id else "https://disclosure.edinet-fsa.go.jp/"
        holder = doc.get("filerName")
        filing_date = doc.get("submitDateTime", "")[:10] or None
        change_type = "new" if "大量保有報告書" in title and "変更" not in title else "increase"
        metadata_draft = {"holder_name": holder, "ratio": None, "previous_ratio": None, "filing_date": filing_date, "change_type": change_type}
        results.append(InboxCandidate("edinet", title, url, doc.get("submitDateTime"), code, "large_shareholding_report", (), {"edinet": doc, "metadata_draft": metadata_draft}))
    return results

def collect(active_codes: set[str], *, timeout: int = 20) -> list[InboxCandidate]:
    if not active_codes:
        return []
    date = datetime.now(JST).date().isoformat()
    params = {"date": date, "type": "2"}
    api_key = os.getenv("EDINET_API_KEY")
    if api_key:
        params["Subscription-Key"] = api_key
    response = requests.get(f"{EDINET_API_BASE_URL}/documents.json", params=params, timeout=timeout, headers={"User-Agent": "hikokaika-watch/collect"})
    response.raise_for_status()
    return parse_documents(response.json(), active_codes)
