"""Safe text handling for populating a fixed-layout PPTX template.

The template's cards were designed around specific text lengths. Dynamic
content varies, so every value placed on a slide is capped rather than left to
overflow its card, and lists are capped rather than left to overrun a fixed
number of rows — see review_pack.NOT_AVAILABLE for the sibling rule on
*missing* data. This module is the rule for *oversized* data.
"""
from __future__ import annotations

NOT_AVAILABLE = "Not available"


def clamp(text, limit: int, *, fallback: str = NOT_AVAILABLE) -> str:
    """Truncate on a word boundary with an ellipsis, never mid-word and never
    silently blank — a value too long to summarise further still shows as much
    of itself as fits, which is more honest than hiding it."""
    text = str(text if text is not None else fallback).strip()
    if not text:
        return fallback
    if len(text) <= limit:
        return text
    truncated = text[: max(0, limit - 1)]
    if " " in truncated:
        truncated = truncated.rsplit(" ", 1)[0]
    return truncated.rstrip(",.;: ") + "…"


def cap_list(items: list, limit: int) -> tuple[list, int]:
    """(kept_items, overflow_count) — never drop the fact that more exist."""
    items = list(items)
    return items[:limit], max(0, len(items) - limit)


def bullet_line(text, limit: int = 140) -> str:
    return clamp(text, limit)
