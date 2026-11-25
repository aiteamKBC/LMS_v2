"""Concrete instance, answer, signature and audit SQL persistence."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.instance_relations import LEARNER_REVIEW_ADDITIONS_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import OVERRIDES_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCES_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_ANSWERS_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_REOPENS_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_SIGNATURES_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_TEMPLATES_TABLE
from curriculum_api.review_management.domain.instance_rules import STATUS_COMPLETED
from curriculum_api.review_management.domain.instance_rules import STATUS_IN_PROGRESS
from django.db import connection
from datetime import datetime
from curriculum_api.review_management.infrastructure.instance_schema import ensure_learner_review_additions_table
from curriculum_api.review_management.infrastructure.instance_schema import ensure_review_instance_manual_overrides_table
from curriculum_api.review_management.infrastructure.instance_schema import ensure_review_instance_reopens_table
from curriculum_api.review_management.infrastructure.instance_schema import ensure_review_instance_tables
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.review_management.infrastructure.type_rows import get_review_type_by_code
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows


def find_active_learner_review_addition(review_template_id, learner_id, target_date):
    ensure_learner_review_additions_table()
    rows = fetch_all(
        f'select * from {table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} '
        f'where review_template_id = %s and learner_id = %s and target_date = %s and deleted_at is null',
        [review_template_id, learner_id, target_date],
    )
    return rows[0] if rows else None


def get_learner_review_addition(addition_id):
    ensure_learner_review_additions_table()
    rows = fetch_all(
        f'select * from {table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} where id = %s',
        [addition_id],
    )
    return rows[0] if rows else None


def list_active_learner_review_additions(programme_id, learner_id):
    ensure_learner_review_additions_table()
    return fetch_all(
        f'select * from {table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} '
        f'where programme_id = %s and learner_id = %s and deleted_at is null',
        [programme_id, learner_id],
    )


def _fetch_learner_scoped_overrides(review_id, learner_id):
    """Active overrides for one Review, either programme-wide (learner_id is
    null) or scoped to this learner specifically -- keyed by occurrence date
    so a learner-specific skip never touches another learner's schedule."""
    rows = fetch_all(
        f'select * from {table_name(OVERRIDES_TABLE)} '
        f'where review_id = %s and deleted_at is null '
        f'and (learner_id is null or learner_id = %s)',
        [review_id, learner_id],
    )
    return {format_date(row.get('occurrence_date')): row for row in rows}


def _fetch_learner_scoped_overrides_for_reviews(review_ids, learner_id):
    """All active programme/learner overrides, grouped by Review template."""
    wanted = sorted({str(review_id).strip() for review_id in review_ids if str(review_id or '').strip()})
    if not wanted:
        return {}
    rows = fetch_all(
        f'select * from {table_name(OVERRIDES_TABLE)} '
        f"where review_id in ({', '.join(['%s'] * len(wanted))}) and deleted_at is null "
        f'and (learner_id is null or learner_id = %s)',
        [*wanted, learner_id],
    )
    grouped = {review_id: {} for review_id in wanted}
    for row in rows:
        review_id = str(row.get('review_id') or '').strip()
        if review_id in grouped:
            grouped[review_id][format_date(row.get('occurrence_date'))] = row
    return grouped


def existing_review_instance_ids():
    rows = fetch_all(
        f'select id from {table_name(REVIEW_INSTANCES_TABLE)}', [],
    )
    return [row.get('id') for row in rows]


def get_review_instance(instance_id, *, for_update=False):
    # Booking callers hold a transaction while checking the linked lifecycle.
    lock = ' for update' if for_update and connection.vendor == 'postgresql' else ''
    rows = fetch_all(
        f'select * from {table_name(REVIEW_INSTANCES_TABLE)} where id = %s{lock}',
        [instance_id],
    )
    return rows[0] if rows else None


def find_review_instance(review_template_id, learner_id, occurrence_number):
    rows = fetch_all(
        f'select * from {table_name(REVIEW_INSTANCES_TABLE)} '
        f'where review_template_id = %s and learner_id = %s and occurrence_number = %s',
        [review_template_id, learner_id, occurrence_number],
    )
    return rows[0] if rows else None


def find_review_instance_by_ref(review_template_id, learner_id, occurrence_ref):
    """Identity lookup for a MANUAL (learner-specific addition) occurrence --
    the generated-occurrence identity (find_review_instance, by
    occurrence_number) is untouched and remains the lookup generated rows
    use. See review_instances_occurrence_ref_uniq in
    sql/2026-09-15_curriculum_learner_review_additions.sql."""
    rows = fetch_all(
        f'select * from {table_name(REVIEW_INSTANCES_TABLE)} '
        f'where review_template_id = %s and learner_id = %s and occurrence_ref = %s',
        [review_template_id, learner_id, occurrence_ref],
    )
    return rows[0] if rows else None


def list_review_instances_for_learner(learner_id, *, window_start=None, window_end=None):
    conditions = ['learner_id = %s']
    params = [learner_id]
    if window_start:
        conditions.append('target_date >= %s')
        params.append(window_start)
    if window_end:
        conditions.append('target_date <= %s')
        params.append(window_end)
    where = ' and '.join(conditions)
    return fetch_all(
        f'select * from {table_name(REVIEW_INSTANCES_TABLE)} where {where} order by target_date',
        params,
    )


def force_review_instance_status_for_tests(instance_id, status, *, actor='system', extra=None):
    """TEST FIXTURES ONLY -- an UNGUARDED status write. NEVER call from runtime code.

    This is the one writer in this module with no compare-and-swap and no
    transition rules: ``where id = %s`` and nothing else. It exists purely so a
    test can arrange an instance into a starting lifecycle state in one step.

    It had exactly one runtime caller (signature completion). That caller now
    performs a guarded ``awaiting-signature -> completed`` CAS inside the same
    transaction as its Calendar mirror -- see
    ``record_review_instance_signature`` -- so nothing in the application calls
    this any more, and nothing should. The deliberately alarming name is the
    isolation: every legitimate runtime transition already has a guarded writer
    (``mark_review_instance_scheduled``, ``mark_review_instance_not_scheduled``,
    ``mark_review_instance_in_progress_from_attendance``,
    ``mark_review_instance_in_progress_manually``, ``complete_review_instance``,
    ``record_review_instance_signature``). If you need a new transition, add a
    guarded writer beside those -- do not reach for this.
    """
    payload = {'status': status, 'updated_by': actor, 'updated_at': datetime.utcnow(), **(extra or {})}
    rows = update_rows(REVIEW_INSTANCES_TABLE, 'id = %s', [instance_id], payload)
    return rows[0] if rows else None


def record_review_instance_manual_override(
    *, review_instance_id, calendar_event_id, previous_status, new_status,
    reason_code, note, changed_by, manual_started_at,
):
    """Persist ONE row in curriculum.review_instance_manual_overrides.

    Append-only, and ONLY ever called for a manual scheduled -> in-progress
    override that has already succeeded (see
    mark_review_instance_in_progress_manually, its sole caller). Never called
    for a Teams-attendance transition, a completion, a signature, or any
    other lifecycle event -- those are not manual overrides and must never
    appear in this table.
    """
    ensure_review_instance_manual_overrides_table()
    return insert_row(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE, {
        'id': unique_prefixed_id('REVIOV'),
        'review_instance_id': review_instance_id,
        'calendar_event_id': calendar_event_id,
        'previous_status': previous_status,
        'new_status': new_status,
        'reason_code': reason_code,
        'note': note,
        'changed_by': changed_by,
        'changed_at': datetime.utcnow(),
        'manual_started_at': manual_started_at,
    })


def list_review_instance_manual_overrides(review_instance_id):
    """This instance's manual-override history, most recent first. Empty for
    every instance that has never had a manual override (i.e. almost all of
    them) -- this table has no rows for a normal Teams-attendance-driven
    lifecycle."""
    ensure_review_instance_manual_overrides_table()
    return fetch_all(
        f'select * from {table_name(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)} '
        f'where review_instance_id = %s order by changed_at desc',
        [review_instance_id],
    )


def latest_review_instance_manual_override(review_instance_id):
    """The most recent manual override for this instance, or None. Cheap
    convenience for a UI that only ever wants to show the latest one."""
    rows = list_review_instance_manual_overrides(review_instance_id)
    return rows[0] if rows else None


def get_review_instance_answers(instance_id):
    rows = fetch_all(
        f'select * from {table_name(REVIEW_INSTANCE_ANSWERS_TABLE)} where review_instance_id = %s',
        [instance_id],
    )
    return {row.get('field_id'): row for row in rows}


def get_review_instance_signatures(instance_id):
    rows = fetch_all(
        f'select * from {table_name(REVIEW_INSTANCE_SIGNATURES_TABLE)} where review_instance_id = %s',
        [instance_id],
    )
    return {row.get('role'): row for row in rows}


def _fetch_rows_in(table, column, values, *, where='', order_by=''):
    """`select * ... where column in (values)` -- one query for many keys."""
    values = list(dict.fromkeys(values))
    if not values:
        return []
    placeholders = ', '.join(['%s'] * len(values))
    extra = f' and {where}' if where else ''
    order = f' order by {order_by}' if order_by else ''
    return fetch_all(
        f'select * from {table_name(table)} where {column} in ({placeholders}){extra}{order}',
        values,
    )


def list_review_instances_for_learners(learner_ids):
    """{str(learner_id): [instance rows by target_date]} in one query --
    list_review_instances_for_learner for many learners at once."""
    grouped = {}
    for row in _fetch_rows_in(REVIEW_INSTANCES_TABLE, 'learner_id', learner_ids, order_by='target_date'):
        grouped.setdefault(str(row.get('learner_id')), []).append(row)
    return grouped


def _rows_by_instance(table, instance_ids, key):
    grouped = {}
    for row in _fetch_rows_in(table, 'review_instance_id', instance_ids):
        grouped.setdefault(row.get('review_instance_id'), {})[row.get(key)] = row
    return grouped


def list_learner_review_instances(learner_id, review_type_code, *, statuses=(STATUS_COMPLETED,)):
    """This learner's own instances of one Review Type, newest target date
    first. Scoped by the Review Type's stable code -- never by template name --
    so a Progress Review history can never pick up a Monthly Coaching Meeting
    or any other Review the programme happens to run."""
    ensure_review_instance_tables()
    type_row = get_review_type_by_code(review_type_code)
    if not type_row or not learner_id:
        return []
    placeholders = ', '.join(['%s'] * len(statuses)) if statuses else ''
    status_clause = f' and i.status in ({placeholders})' if statuses else ''
    return fetch_all(
        f'select i.* from {table_name(REVIEW_INSTANCES_TABLE)} i '
        f'join {table_name(REVIEW_TEMPLATES_TABLE)} t '
        f'on t.id = i.review_template_id '
        f'where i.learner_id = %s and t.review_type_id = %s{status_clause} '
        f'order by i.target_date desc, i.occurrence_number desc',
        [learner_id, type_row.get('id'), *statuses],
    )


def record_review_instance_reopen(
    *, review_instance_id, calendar_event_id, previous_status, reason_code, note,
    changed_by, previous_state_snapshot,
):
    """Persist ONE row in curriculum.review_instance_reopens.

    Append-only, and ONLY ever called for a reopen that has already succeeded
    (see reopen_review_instance_for_editing, its sole caller). Never called for
    a manual scheduled -> in-progress override -- that is a different event
    with its own table (record_review_instance_manual_override), whose
    documented contract this deliberately leaves untouched.
    """
    ensure_review_instance_reopens_table()
    return insert_row(REVIEW_INSTANCE_REOPENS_TABLE, {
        'id': unique_prefixed_id('REVIRO'),
        'review_instance_id': review_instance_id,
        'calendar_event_id': calendar_event_id,
        'previous_status': previous_status,
        'new_status': STATUS_IN_PROGRESS,
        'reason_code': reason_code,
        'note': note,
        'changed_by': changed_by,
        'changed_at': datetime.utcnow(),
        'previous_state_snapshot': json_db_value(previous_state_snapshot),
    })


def list_review_instance_reopens(review_instance_id):
    """This instance's reopen history, most recent first. Empty for every
    instance that has never been reopened (i.e. almost all of them)."""
    ensure_review_instance_reopens_table()
    return fetch_all(
        f'select * from {table_name(REVIEW_INSTANCE_REOPENS_TABLE)} '
        f'where review_instance_id = %s order by changed_at desc',
        [review_instance_id],
    )


def _clear_review_instance_signatures(instance_id):
    """Blank every signature row for this instance back to its unsigned shape.

    Rows are blanked, never deleted: signed_by/signed_name/signature to '' and
    signed_at to NULL is exactly what record_review_instance_signature writes
    for an unsigned submission, and _all_required_signatures_present tests
    ``signed_at`` truthiness -- so a blanked row correctly reads as "not yet
    signed" everywhere, with no row churn and no new primary keys.

    The values discarded here are preserved in the reopen's
    previous_state_snapshot (see _reopen_state_snapshot), written in the same
    transaction. Returns the number of rows blanked.
    """
    rows = fetch_all(
        f'select id from {table_name(REVIEW_INSTANCE_SIGNATURES_TABLE)} '
        f'where review_instance_id = %s',
        [instance_id],
    )
    for row in rows:
        update_rows(
            REVIEW_INSTANCE_SIGNATURES_TABLE, 'id = %s', [row.get('id')],
            {
                'signed_by': '', 'signed_name': '', 'signature': '',
                'signed_at': None, 'updated_at': datetime.utcnow(),
            },
            # Without this, filtered_payload drops the None and signed_at keeps
            # its old value -- the row would still read as signed.
            allow_null_columns=['signed_at'],
        )
    return len(rows)


def find_review_instance_answer_rows(instance_id, field_id):
    """The existing exact row lookup used by the guarded writer."""
    return fetch_all(
            f'select * from {table_name(REVIEW_INSTANCE_ANSWERS_TABLE)} '
            f'where review_instance_id = %s and field_id = %s',
            [instance_id, field_id],
        )


def find_review_instance_signature_rows(instance_id, role):
    """The existing exact row lookup used by the guarded writer."""
    return fetch_all(
            f'select * from {table_name(REVIEW_INSTANCE_SIGNATURES_TABLE)} '
            f'where review_instance_id = %s and role = %s',
            [instance_id, role],
        )
