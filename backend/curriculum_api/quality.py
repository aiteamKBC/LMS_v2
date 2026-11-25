"""Curriculum Quality reads.

Quality does not own a record store of its own. Everything here is derived from
the canonical authoring tables and revision log, so a number on a Quality page
is the same number the record's own page shows. The audit trail is canonical
only; timestamp-derived reads from legacy schemas are intentionally excluded.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from django.db import connection, transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from . import versioning
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.api.responses import json_error

logger = logging.getLogger(__name__)

# The Audit Trail reads the last 7 days, matching the page activity it sits
# beside -- except Curriculum Studio, whose history is kept and read in full.
# Record History panels are not windowed by this.
from .reporting.domain.history_labels import DEFAULT_WINDOW_DAYS
from .reporting.domain.history_labels import MAX_WINDOW_DAYS
from .reporting.domain.history_labels import UNLIMITED_WORKSPACES
from .reporting.domain.history_labels import UNLIMITED_WINDOW_DAYS


#: The Changes feed reads saved history, not page activity: the revision log
#: and the records' own timestamps are kept, so every workspace may look back
#: further than the seven days page activity survives. Seven stays the default.
from .reporting.domain.history_labels import MAX_CHANGE_WINDOW_DAYS


def window_limit(workspace):
    from .reporting.domain.history_values import window_limit as implementation
    return implementation(
        workspace, MAX_WINDOW_DAYS=MAX_WINDOW_DAYS, UNLIMITED_WINDOW_DAYS=UNLIMITED_WINDOW_DAYS,
        UNLIMITED_WORKSPACES=UNLIMITED_WORKSPACES,
    )


def change_window_limit(workspace):
    from .reporting.domain.history_values import change_window_limit as implementation
    return implementation(
        workspace, MAX_CHANGE_WINDOW_DAYS=MAX_CHANGE_WINDOW_DAYS,
        UNLIMITED_WINDOW_DAYS=UNLIMITED_WINDOW_DAYS, UNLIMITED_WORKSPACES=UNLIMITED_WORKSPACES,
    )
from .reporting.domain.history_labels import DEFAULT_LIMIT
from .reporting.domain.history_labels import MAX_LIMIT

#: One page of the change feed. `DEFAULT_LIMIT` stays what it was for the
#: callers that ask for a bare window and expect the old cap; a page is what the
#: Audit Trail reads at a time.
from .reporting.domain.history_labels import DEFAULT_PAGE_SIZE

ACTIONS = versioning.ACTIONS

# How each record type is named to a person, and where its own page lives.
from .reporting.domain.history_labels import ENTITY_LABELS

# What a reader should see instead of a column name. Anything absent falls back
# to the column with its underscores opened out, which is right far more often
# than it is wrong ("start_date" -> "Start date").
from .reporting.domain.history_labels import FIELD_LABELS

# The sentence a row leads with. The event name is still carried on the event as
# `action`, for anyone who wants it, but nobody should have to read
# "COHORT_EDIT_PARTIAL_UPDATE" to learn that a cohort was edited.
#: Where an event in the Changes feed comes from, in words.
from .reporting.domain.history_labels import PROVENANCE_LABELS

from .reporting.domain.history_labels import ACTION_LABELS

# How a save arrived, in words. The stored value stays the machine-readable one.
from .reporting.domain.history_labels import SOURCE_LABELS

ACTOR_TYPE_LABELS = {
    versioning.ACTOR_USER: 'Person',
    versioning.ACTOR_SYSTEM: 'System',
    versioning.ACTOR_INTEGRATION: 'Integration',
    versioning.ACTOR_JOB: 'Scheduled job',
}

# What the handler code means, as a phrase that completes "... as part of".
#
# `reason` holds the write handler, or the row's own `deleted_by` when the
# handler said nothing (``versioning.build_revision``). Either way it is the only
# column that records WHY a record a person never touched went away: a week
# removed by the orphan sweep and a week removed with its module are both
# "Deleted", and only this tells them apart. Anything absent keeps the code
# itself rather than being given an invented meaning.
from .reporting.domain.history_labels import REASON_LABELS


def source_label(value):
    from .reporting.domain.history_values import source_label as implementation
    return implementation(
        value, SOURCE_LABELS=SOURCE_LABELS, curriculum_views_clean_str=clean_str,
    )


def cause_label(reason):
    from .reporting.domain.history_values import cause_label as implementation
    return implementation(
        reason, REASON_LABELS=REASON_LABELS, curriculum_views_clean_str=clean_str,
    )


def field_label(field):
    from .reporting.domain.history_values import field_label as implementation
    return implementation(
        field, FIELD_LABELS=FIELD_LABELS, curriculum_views_clean_str=clean_str,
    )


def split_reason(reason):
    from .reporting.domain.history_values import split_reason as implementation
    return implementation(
        reason, curriculum_views_clean_str=clean_str,
    )


def revision_attribution(row):
    from .reporting.domain.history_values import revision_attribution as implementation
    return implementation(
        row, curriculum_views_clean_str=clean_str, split_reason=split_reason,
        versioning_ACTOR_TYPES=versioning.ACTOR_TYPES, versioning_ACTOR_USER=versioning.ACTOR_USER,
    )


def parse_bounded_int(value, default, minimum, maximum):
    from .reporting.domain.history_values import parse_bounded_int as implementation
    return implementation(
        value, default, minimum, maximum,
    )


def iso(value):
    from .reporting.domain.history_values import iso as implementation
    return implementation(
        value, curriculum_views_clean_str=clean_str, datetime=datetime,
    )


@require_GET
@never_cache
def curriculum_quality_audit_trail(request):
    from .reporting.api.history import curriculum_quality_audit_trail as implementation
    return implementation(
        request, JsonResponse=JsonResponse, history_off_response=history_off_response, logger=logger,
        revision_trail=revision_trail, versioning_history_available=versioning.history_available,
    )


def revision_trail(request):
    from .reporting.api.history import revision_trail as implementation
    from system_audit import pages as audit_pages, writes as system_writes
    from system_audit import derived
    return implementation(
        request, ACTIONS=ACTIONS, DEFAULT_PAGE_SIZE=DEFAULT_PAGE_SIZE,
        DEFAULT_WINDOW_DAYS=DEFAULT_WINDOW_DAYS, JsonResponse=JsonResponse, MAX_LIMIT=MAX_LIMIT,
        _scope_clause=_scope_clause, audit_pages_workspace_options=audit_pages.workspace_options,
        change_window_limit=change_window_limit, coverage_keys=coverage_keys,
        curriculum_views_clean_str=clean_str, datetime=datetime,
        derived_PROVENANCE_REVISION=derived.PROVENANCE_REVISION,
        derived_PROVENANCE_TIMESTAMPS=derived.PROVENANCE_TIMESTAMPS,
        derived_read_hybrid=derived.read_hybrid, entity_type_options=entity_type_options,
        merge_actors=merge_actors, parse_bounded_int=parse_bounded_int, revision_actors=revision_actors,
        revision_event=revision_event, system_writes_change_workspaces=system_writes.change_workspaces,
        system_writes_revision_workspace_clause=system_writes.revision_workspace_clause,
        timedelta=timedelta, transaction=transaction, versioning_ACTOR_TYPES=versioning.ACTOR_TYPES,
        versioning_ENTITY_TYPES=versioning.ENTITY_TYPES,
        versioning_REVISIONS_TABLE=versioning.REVISIONS_TABLE, versioning_SOURCES=versioning.SOURCES,
        versioning_metadata_columns_available=versioning.metadata_columns_available,
        versioning_qualified=versioning.qualified,
        entity_types_for_workspace=system_writes.entity_types_for_workspace,
        fetch_all=fetch_all, iso=iso,
    )


def merge_actors(logged, recovered):
    from .reporting.domain.history_values import merge_actors as implementation
    return implementation(
        logged, recovered, curriculum_views_clean_str=clean_str,
    )


def entity_type_options(workspace):
    from .reporting.application.history_projection import entity_type_options as implementation
    from system_audit import writes as system_writes
    return implementation(
        workspace, ENTITY_LABELS=ENTITY_LABELS, system_writes_ENTITY_LABELS=system_writes.ENTITY_LABELS,
        system_writes_entity_types_for_workspace=system_writes.entity_types_for_workspace,
    )


def _scope_clause(scope, scope_id):
    from .reporting.infrastructure.history_reads import _scope_clause as implementation
    return implementation(
        scope, scope_id, connection=connection, versioning_CONTEXT_KEY=versioning.CONTEXT_KEY,
    )


def revision_actors(since, workspace='', entity='', action='', source='', actor_type=''):
    from .reporting.infrastructure.history_reads import revision_actors as implementation
    from system_audit import writes as system_writes
    return implementation(
        since, workspace, entity, action, source, actor_type, ACTIONS=ACTIONS,
        curriculum_views_clean_str=clean_str,
        curriculum_views_fetch_all=fetch_all,
        system_writes_revision_workspace_clause=system_writes.revision_workspace_clause,
        versioning_ACTOR_TYPES=versioning.ACTOR_TYPES, versioning_ENTITY_TYPES=versioning.ENTITY_TYPES,
        versioning_REVISIONS_TABLE=versioning.REVISIONS_TABLE, versioning_SOURCES=versioning.SOURCES,
        versioning_metadata_columns_available=versioning.metadata_columns_available,
        versioning_qualified=versioning.qualified,
    )


def revision_event(row):
    from .reporting.application.history_projection import revision_event as implementation
    from system_audit import pages as audit_pages, writes as system_writes
    return implementation(
        row, ACTION_LABELS=ACTION_LABELS, ACTOR_TYPE_LABELS=ACTOR_TYPE_LABELS,
        ENTITY_LABELS=ENTITY_LABELS, PROVENANCE_LABELS=PROVENANCE_LABELS,
        audit_pages_WORKSPACES=audit_pages.WORKSPACES, cause_label=cause_label,
        context_line=context_line, curriculum_views_clean_str=clean_str, iso=iso,
        revision_attribution=revision_attribution, revision_change=revision_change,
        source_label=source_label, system_writes_ENTITY_LABELS=system_writes.ENTITY_LABELS,
        system_writes_record_href=system_writes.record_href,
        system_writes_workspace_for_entity=system_writes.workspace_for_entity,
        versioning_CONTEXT_KEY=versioning.CONTEXT_KEY, versioning_as_dict=versioning.as_dict,
        versioning_as_list=versioning.as_list,
        versioning_audit_display_value=versioning.audit_display_value,
    )


def revision_change(entity_type, change):
    from .reporting.application.history_projection import revision_change as implementation
    return implementation(
        entity_type, change, curriculum_views_clean_str=clean_str,
        field_label=field_label, versioning_audit_display_value=versioning.audit_display_value,
    )


def context_line(entity_type, context):
    from .reporting.domain.history_values import context_line as implementation
    return implementation(
        entity_type, context, curriculum_views_clean_str=clean_str,
        versioning_ENTITY_CONTEXT_FIELDS=versioning.ENTITY_CONTEXT_FIELDS,
    )


def coverage_keys(workspaces, *, revision, derived):
    from .reporting.domain.history_values import coverage_keys as implementation
    return implementation(
        workspaces, revision=revision, derived=derived,
    )


# ---------------------------------------------------------------- versions

def revision_row(row):
    from .reporting.application.history_projection import revision_row as implementation
    return implementation(
        row, curriculum_views_clean_str=clean_str, iso=iso,
        versioning_as_list=versioning.as_list,
    )


def history_off_response():
    from .reporting.api.history import history_off_response as implementation
    return implementation(
        JsonResponse=JsonResponse,
    )


@require_GET
@never_cache
def curriculum_quality_versions(request):
    from .reporting.api.history import curriculum_quality_versions as implementation
    return implementation(
        request, JsonResponse=JsonResponse, curriculum_views_clean_str=clean_str,
        curriculum_views_fetch_all=fetch_all, datetime=datetime,
        history_off_response=history_off_response, iso=iso,
        latest_revision_by_entity=latest_revision_by_entity, logger=logger,
        named_version_counts=named_version_counts, parse_bounded_int=parse_bounded_int,
        versioning_ENTITY_TYPES=versioning.ENTITY_TYPES,
        versioning_REVISIONS_TABLE=versioning.REVISIONS_TABLE,
        versioning_VERSIONS_TABLE=versioning.VERSIONS_TABLE,
        versioning_history_available=versioning.history_available,
        versioning_qualified=versioning.qualified,
    )


def latest_revision_by_entity(keys):
    from .reporting.infrastructure.history_reads import latest_revision_by_entity as implementation
    return implementation(
        keys, connection=connection, curriculum_views_clean_str=clean_str,
        curriculum_views_fetch_all=fetch_all,
        versioning_REVISIONS_TABLE=versioning.REVISIONS_TABLE,
        versioning_qualified=versioning.qualified,
    )


def named_version_counts(keys):
    from .reporting.infrastructure.history_reads import named_version_counts as implementation
    return implementation(
        keys, curriculum_views_clean_str=clean_str,
        curriculum_views_fetch_all=fetch_all,
        versioning_VERSIONS_TABLE=versioning.VERSIONS_TABLE, versioning_qualified=versioning.qualified,
    )


@require_GET
@never_cache
def curriculum_quality_record_history(request, entity_type, entity_id):
    from .reporting.api.history import curriculum_quality_record_history as implementation
    return implementation(
        request, entity_type, entity_id, JsonResponse=JsonResponse,
        curriculum_views_clean_str=clean_str,
        curriculum_views_fetch_all=fetch_all,
        curriculum_views_json_error=json_error,
        history_off_response=history_off_response, iso=iso, logger=logger,
        parse_bounded_int=parse_bounded_int, revision_row=revision_row,
        versioning_ENTITY_TYPES=versioning.ENTITY_TYPES,
        versioning_REVISIONS_TABLE=versioning.REVISIONS_TABLE,
        versioning_VERSIONS_TABLE=versioning.VERSIONS_TABLE, versioning_as_dict=versioning.as_dict,
        versioning_history_available=versioning.history_available,
        versioning_qualified=versioning.qualified,
    )
