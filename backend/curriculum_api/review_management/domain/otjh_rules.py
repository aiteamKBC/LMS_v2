"""Claimable hours per review occurrence, independent of storage."""
from __future__ import annotations


def template_otjh_hours(template_row) -> float:
    """Hours ONE occurrence of this template is worth, or 0.0 if it does not
    count. The ``counts_towards_otjh`` gate is applied here and nowhere else,
    so no caller can accidentally count a template that opted out."""
    if not template_row or not bool(template_row.get('counts_towards_otjh')):
        return 0.0
    try:
        hours = float(template_row.get('expected_otjh') or 0)
    except (TypeError, ValueError):
        return 0.0
    return hours if hours > 0 else 0.0
