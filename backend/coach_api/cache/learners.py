"""Cache identity for Coach Caseload projections."""

import hashlib

from coach_api.auth import normalize_email


CASELOAD_CACHE_VERSION = 3


def coach_caseload_cache_key(owner_email: str, *, summary_only: bool, query_string: str) -> str:
    query_scope = hashlib.sha256(query_string.encode()).hexdigest()[:16]
    return (
        f"coach-caseload:v{CASELOAD_CACHE_VERSION}:"
        f"{normalize_email(owner_email)}:{int(summary_only)}:{query_scope}"
    )


def coach_caseload_lock_key(cache_key: str) -> str:
    return f"{cache_key}:building"
