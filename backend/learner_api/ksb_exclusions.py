"""Inline canonical exclusions; missing tables never silently enable achievement."""
from .ksb_domain import official_progress_relation


def not_excluded_sql(alias='k', using='default'):
    return (f"{alias}.is_excluded=false AND EXISTS (SELECT 1 FROM "
            f"{official_progress_relation()} eligible_ksb WHERE "
            f"eligible_ksb.progress_id={alias}.progress_id AND eligible_ksb.position={alias}.position "
            f"AND eligible_ksb.ksb_code={alias}.ksb_code)")


def and_not_excluded(alias='k', connection=None):
    return ' AND ' + not_excluded_sql(alias)
