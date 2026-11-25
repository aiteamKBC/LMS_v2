"""Bind legacy command signatures to application use cases and catalogue cache invalidation."""
from __future__ import annotations

from curriculum_api.review_management.application.template_commands import archive_review as _archive_review
from curriculum_api.review_management.application.classification import archive_review_type as _archive_review_type
from curriculum_api.review_management.application.template_commands import create_review as _create_review
from curriculum_api.review_management.application.classification import create_review_type as _create_review_type
from curriculum_api.review_management.application.classification import rename_review_type as _rename_review_type
from curriculum_api.review_management.application.scheduling import resolve_clash_decision as _resolve_clash_decision
from curriculum_api.review_management.application.template_commands import update_review as _update_review
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache


def create_review(programme_id, payload, *, actor='system'):
    return _create_review(programme_id, payload, actor=actor, invalidate_curriculum_cache=invalidate_curriculum_cache)


def update_review(review_id, payload, *, actor='system'):
    return _update_review(review_id, payload, actor=actor, invalidate_curriculum_cache=invalidate_curriculum_cache)


def archive_review(review_id, *, actor='review-delete'):
    return _archive_review(review_id, actor=actor, invalidate_curriculum_cache=invalidate_curriculum_cache)


def create_review_type(name, *, actor='staff'):
    return _create_review_type(name, actor=actor, invalidate_curriculum_cache=invalidate_curriculum_cache)


def rename_review_type(type_id, name, *, actor='staff'):
    return _rename_review_type(type_id, name, actor=actor, invalidate_curriculum_cache=invalidate_curriculum_cache)


def archive_review_type(type_id, *, actor='staff'):
    return _archive_review_type(type_id, actor=actor, invalidate_curriculum_cache=invalidate_curriculum_cache)


def resolve_clash_decision(programme_id, month, items, *, actor='staff'):
    return _resolve_clash_decision(programme_id, month, items, actor=actor, invalidate_curriculum_cache=invalidate_curriculum_cache)
