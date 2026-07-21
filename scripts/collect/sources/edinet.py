from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import requests

from common import InboxCandidate, JST, is_allowed_http_url

EDINET_API_BASE_URL = os.getenv("EDINET_API_BASE_URL") or "https://api.edinet-fsa.go.jp/api/v2"
EDINET_VIEWER_URL = os.getenv("EDINET_VIEWER_URL") or "https://disclosure2.edinet-fsa.go.jp/"
DOC_TYPES = ("大量保有報告書", "変更報告書")

class EDINETConfigError(RuntimeError): pass
class EDINETAPIError(RuntimeError): pass

def normalize_sec_code(value: Any) -> str | None:
    code = str(value or "").strip().upper()
    if len(code) == 5 and code.endswith("0"):
        return code[:4]
    return code or None

def public_url(doc_id: Any) -> str:
    # EDINET API download URLs require auth/query params; store a stable public viewer entry instead.
    return EDINET_VIEWER_URL

def parse_documents(payload: dict[str, Any], active_codes: set[str]) -> list[InboxCandidate]:
    status = payload.get("statusCode")
    if status not in (None, 200, "200"):
        raise EDINETAPIError(f"EDINET API metadata statusCode={status}")
    results_raw = payload.get("results")
    if results_raw is None:
        raise EDINETAPIError("EDINET API response missing results")
    if not isinstance(results_raw, list):
        raise EDINETAPIError("EDINET API results is not an array")
    results: list[InboxCandidate] = []
    normalized_active = {c.upper() for c in active_codes}
    for doc in results_raw:
        if not isinstance(doc, dict):
            continue
        title = str(doc.get("docDescription") or "")
        if not any(t in title for t in DOC_TYPES):
            continue
        code = normalize_sec_code(doc.get("secCode"))
        if not code or code not in normalized_active:
            continue
        doc_id = doc.get("docID")
        if not doc_id:
            raise EDINETAPIError("EDINET document missing docID")
        url = public_url(doc_id)
        if not is_allowed_http_url(url):
            raise EDINETAPIError("EDINET public viewer URL is invalid")
        filing_date = str(doc.get("submitDateTime") or "")[:10] or None
        change_type = "new" if "大量保有報告書" in title and "変更" not in title else "increase"
        metadata_draft = {"holder_name": doc.get("filerName"), "ratio": None, "previous_ratio": None, "filing_date": filing_date, "change_type": change_type, "doc_id": doc_id}
        safe_doc = {k: v for k, v in doc.items() if "key" not in k.lower() and "subscription" not in k.lower()}
        results.append(InboxCandidate("edinet", title, url, doc.get("submitDateTime"), code, "large_shareholding_report", (), {"edinet": {**safe_doc, "docID": doc_id}, "metadata_draft": metadata_draft}))
    return results

def collect(active_codes: set[str], *, timeout: int = 20) -> list[InboxCandidate]:
    if not active_codes:
        return []
    api_key = os.getenv("EDINET_API_KEY")
    if not api_key:
        print("[collect] source=edinet skipped: EDINET_API_KEY is not set")
        return []
    base = EDINET_API_BASE_URL.rstrip("/")
    if not is_allowed_http_url(base):
        raise EDINETConfigError("EDINET_API_BASE_URL must be an absolute http/https URL")
    date = datetime.now(JST).date().isoformat()
    params = {"date": date, "type": "2", "Subscription-Key": api_key}
    response = requests.get(f"{base}/documents.json", params=params, timeout=timeout, headers={"User-Agent": "hikokaika-watch/collect"})
    response.raise_for_status()
    return parse_documents(response.json(), active_codes)
