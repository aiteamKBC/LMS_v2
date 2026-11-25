"""Stable public Free Week identity, independent of storage and HTTP."""
def week_api_identity(row):
    """Add canonical identity and explicit legacy compatibility fields."""
    canonical = str((row or {}).get("id") or "").strip()
    provenance = str((row or {}).get("legacy_copied_from_week_id") or "").strip()
    return {
        "freeCourseWeekId": canonical,
        # Backward compatibility only: this retains the old source-week role;
        # it is never the canonical Free Course week identity.
        "weekId": provenance,
        "legacyCopiedFromWeekId": provenance or None,
    }
