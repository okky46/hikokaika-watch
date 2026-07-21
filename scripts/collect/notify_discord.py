from __future__ import annotations

import os
from typing import Any

import requests

COLORS = {"matched": 0xE74C3C, "new": 0x3498DB, "large": 0xF1C40F}

def color_for(item: dict[str, Any]) -> int:
    if item.get("suggested_event_type") == "large_shareholding_report":
        return COLORS["large"]
    return COLORS["matched"] if item.get("matched_case_id") else COLORS["new"]

def notify(items: list[dict[str, Any]], *, dry_run: bool = False) -> None:
    webhook = os.getenv("DISCORD_WEBHOOK_URL")
    if dry_run:
        print(f"[collect] dry-run: Discord notification skipped ({len(items)} items)")
        return
    if not webhook or not items:
        print("[collect] Discord notification skipped")
        return
    embeds = []
    admin_url = os.getenv("ADMIN_URL", "")
    for item in items[:10]:
        embeds.append({
            "title": item.get("title", "収集候補"),
            "url": item.get("url"),
            "color": color_for(item),
            "fields": [
                {"name": "ソース", "value": str(item.get("source_kind") or "—"), "inline": True},
                {"name": "証券コード", "value": str(item.get("security_code") or "—"), "inline": True},
                {"name": "既存案件", "value": "あり" if item.get("matched_case_id") else "なし", "inline": True},
                {"name": "管理画面", "value": admin_url or "/admin/", "inline": False},
            ],
        })
    try:
        response = requests.post(webhook, json={"embeds": embeds}, timeout=20)
        response.raise_for_status()
        print(f"[collect] Discord notified items={len(embeds)}")
    except requests.RequestException as error:
        print(f"[collect] Discord notification failed ({type(error).__name__}); ignored")
