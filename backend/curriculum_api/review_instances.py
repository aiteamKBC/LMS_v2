"""The Review Engine: turns a Curriculum Review Template into one learner's
occurrences, and the durable per-learner Review Instance/answers/signatures.

Ownership, per the architecture this module implements:

    Curriculum (reviews.py)   owns WHAT a Review is -- recurrence, eligibility,
                              participants, visibility, signatures, sections,
                              questions.
    This module              owns WHEN it happens for one learner, and the
                              learner's own record of having done it.
    Coach (coach_api)         owns execution -- scheduling, calendar, Teams,
                              opening the Review, and is the only caller of
                              this module's public functions. It never
                              hard-codes a Review's identity or behaviour by
                              name; every Coach caller passes a
                              ``review_template_id``/Review Type code and
                              reads the display title from the template's own
                              ``name`` at read time.

Two different lifetimes live here, deliberately kept apart:

  * A RAW occurrence: pure arithmetic (``resolve_learner_occurrences``), one
    row projected in-memory per learner/template/window. Cheap, and never
    written anywhere -- asking for the same window twice must return the same
    answer, and calling it 100 times before a coach ever opens one must not
    create 100 rows.
  * A Review Instance (``curriculum.review_instances``): only created the
    first time Coach actually needs a durable handle for one occurrence --
    scheduling it, opening its form, or recording an answer/signature. Its
    identity is ``(review_template_id, learner_id, occurrence_number)``, so
    calling ``ensure_review_instance`` twice for the same occurrence returns
    the same row rather than duplicating it (section 24 of the brief: expected
    occurrence vs. persisted instance are kept strictly separate).

Historical integrity: ``definition_snapshot`` freezes the template's
{signatures, visibility, sections, fields, ...} at the moment the instance is
first created. A later Curriculum edit changes what *new* instances see, but
never what an already-created instance's form looked like -- see
``review_instance_form_definition``. The display TITLE is the one thing that
stays live: the brief is explicit that a Curriculum rename must be reflected
everywhere in Coach immediately, including on a historical review's own
completion screen -- so callers resolve the title from the live template
separately from the frozen snapshot (``review_instances.py`` never embeds a
title inside the snapshot itself for that reason).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db import transaction

from . import reviews
from . import review_schedule
from . import review_types
from . import schema_gate
from . import views as curriculum_views

logger = logging.getLogger(__name__)

REVIEW_INSTANCES_TABLE = 'review_instances'
REVIEW_INSTANCE_ANSWERS_TABLE = 'review_instance_answers'
REVIEW_INSTANCE_SIGNATURES_TABLE = 'review_instance_signatures'
#: Manual scheduled -> in-progress overrides ONLY (see
#: mark_review_instance_in_progress_manually). Never written for a Teams-
#: attendance transition, a completion, or a signature -- one row per manual
#: override, and nothing else.
REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE = 'review_instance_manual_overrides'
#: One row per coach-created additional Review for a single learner (see
#: create_learner_review_addition). Deliberately NOT
#: review_occurrence_overrides -- that table is skip-only (a hard CHECK
#: constraint), with no concept of adding a date; see
#: sql/2026-09-15_curriculum_learner_review_additions.sql for why this is a
#: separate table instead of an extension.
LEARNER_REVIEW_ADDITIONS_TABLE = 'learner_review_additions'
OVERRIDES_TABLE = review_schedule.OCCURRENCE_OVERRIDES_TABLE

STATUS_NOT_SCHEDULED = 'not-scheduled'
STATUS_SCHEDULED = 'scheduled'
STATUS_IN_PROGRESS = 'in-progress'
STATUS_AWAITING_SIGNATURE = 'awaiting-signature'
STATUS_COMPLETED = 'completed'

#: review_instances.occurrence_source values -- see
#: sql/2026-09-15_curriculum_learner_review_additions.sql for the identity
#: design this backs (occurrence_ref, not occurrence_number, is what lets a
#: generated and a manual occurrence coexist for the same learner+template).
OCCURRENCE_SOURCE_GENERATED = 'generated'
OCCURRENCE_SOURCE_MANUAL = 'manual'

#: Reason codes a coach may give for a learner-specific addition. Free text
#: is also captured (reason) -- these are for reporting/filtering, and the
#: DB enforces the same list via a CHECK constraint.
LEARNER_REVIEW_ADDITION_REASON_CODES = (
    'additional-coaching', 'learner-request', 'employer-request',
    'performance-concern', 'safeguarding-follow-up', 'other',
)

SIGNATURE_ROLES = reviews.PARTICIPANT_ROLES

_TABLES_READY = False


def ensure_review_instance_tables():
    global _TABLES_READY
    if _TABLES_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(
            REVIEW_INSTANCES_TABLE, REVIEW_INSTANCE_ANSWERS_TABLE, REVIEW_INSTANCE_SIGNATURES_TABLE,
        )
        _TABLES_READY = True
        return
    provision_review_instance_tables()


#: Set once this process has provisioned/verified the manual-overrides table,
#: separately from _TABLES_READY (the three core tables) -- see
#: ensure_review_instance_manual_overrides_table for why this stays its own
#: gate rather than joining ensure_review_instance_tables().
_MANUAL_OVERRIDES_TABLE_READY = False


def ensure_review_instance_manual_overrides_table():
    """Verify/provision review_instance_manual_overrides on its own, narrower
    gate than ensure_review_instance_tables().

    Deliberately not folded into the three core tables' gate: those three are
    required before ANY review-instance operation (schedule, save an answer,
    complete, sign), so adding this one there would mean a plain Teams-
    attendance transition -- which never touches this table -- starts failing
    in production the moment this code deploys, if the new table's SQL
    (sql/<date>_curriculum_review_instance_manual_overrides.sql) has not been
    run against Neon yet. Keeping it separate means only the manual-override
    action itself is affected by that ordering, not the rest of the review
    engine.
    """
    global _MANUAL_OVERRIDES_TABLE_READY
    if _MANUAL_OVERRIDES_TABLE_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)
        _MANUAL_OVERRIDES_TABLE_READY = True
        return
    _provision_review_instance_manual_overrides_table()
    _MANUAL_OVERRIDES_TABLE_READY = True


def _provision_review_instance_manual_overrides_table():
    """Mirrors sql/<date>_curriculum_review_instance_manual_overrides.sql for
    sqlite/local dev. NOT for production request paths -- see
    ensure_review_instance_manual_overrides_table/schema_gate."""
    from django.db import connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {curriculum_views.quote_ident(curriculum_views.CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {curriculum_views.authoring_table_name(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)} (
                id varchar(128) primary key,
                review_instance_id varchar(128) not null,
                calendar_event_id integer,
                previous_status varchar(32) not null,
                new_status varchar(32) not null,
                reason_code varchar(64) not null,
                note text not null default '',
                changed_by varchar(255) not null,
                changed_at timestamp not null default current_timestamp,
                manual_started_at timestamp
            )
        ''')
        cursor.execute(f'''
            create index if not exists review_instance_manual_overrides_instance_idx
            on {curriculum_views.authoring_table_name(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)} (review_instance_id, changed_at desc)
        ''')


#: Set once this process has provisioned/verified learner_review_additions,
#: separately from _TABLES_READY for the same reason
#: ensure_review_instance_manual_overrides_table is its own gate: this table
#: is only needed by the learner-specific-addition feature, not by every
#: existing review-instance operation.
_LEARNER_REVIEW_ADDITIONS_TABLE_READY = False


def ensure_learner_review_additions_table():
    global _LEARNER_REVIEW_ADDITIONS_TABLE_READY
    if _LEARNER_REVIEW_ADDITIONS_TABLE_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(LEARNER_REVIEW_ADDITIONS_TABLE)
        _LEARNER_REVIEW_ADDITIONS_TABLE_READY = True
        return
    _provision_learner_review_additions_table()
    _LEARNER_REVIEW_ADDITIONS_TABLE_READY = True


def _provision_learner_review_additions_table():
    """Mirrors sql/2026-09-15_curriculum_learner_review_additions.sql for
    sqlite/local dev. NOT for production request paths -- see
    ensure_learner_review_additions_table/schema_gate."""
    from django.db import connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {curriculum_views.quote_ident(curriculum_views.CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {curriculum_views.authoring_table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} (
                id varchar(128) primary key,
                review_template_id varchar(128) not null,
                programme_id varchar(255) not null,
                learner_id integer not null,
                target_date date not null,
                reason_code varchar(64) not null default '',
                reason varchar(1000) not null default '',
                created_by varchar(255) not null default '',
                created_at timestamp not null default current_timestamp,
                updated_by varchar(255) not null default '',
                updated_at timestamp not null default current_timestamp,
                deleted_at timestamp,
                deleted_by varchar(255)
            )
        ''')
        cursor.execute(f'''
            create index if not exists learner_review_additions_learner_idx
            on {curriculum_views.authoring_table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} (learner_id)
        ''')


def provision_review_instance_tables():
    """Mirrors sql/2026-09-13_curriculum_review_instances.sql for sqlite/local
    dev. NOT for production request paths -- see reviews.py/schema_gate."""
    global _TABLES_READY
    if _TABLES_READY:
        return
    from django.db import connection
    json_type = curriculum_views.authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {curriculum_views.quote_ident(curriculum_views.CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {curriculum_views.authoring_table_name(REVIEW_INSTANCES_TABLE)} (
                id varchar(128) primary key,
                review_template_id varchar(128) not null,
                learner_id integer not null,
                learner_kind varchar(32) not null default '',
                programme_id varchar(255) not null,
                occurrence_number integer,
                occurrence_source varchar(16) not null default 'generated',
                occurrence_ref varchar(160),
                target_date date not null,
                coach_email varchar(255) not null default '',
                calendar_event_id integer,
                definition_snapshot {json_type} not null,
                progress_snapshot {json_type},
                status varchar(32) not null default 'not-scheduled',
                started_at timestamp,
                completed_at timestamp,
                created_by varchar(255) not null default '',
                updated_by varchar(255) not null default '',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {curriculum_views.authoring_table_name(REVIEW_INSTANCE_ANSWERS_TABLE)} (
                id varchar(128) primary key,
                review_instance_id varchar(128) not null,
                field_id varchar(128) not null,
                answer {json_type},
                answered_by varchar(255) not null default '',
                answered_at timestamp not null default current_timestamp,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {curriculum_views.authoring_table_name(REVIEW_INSTANCE_SIGNATURES_TABLE)} (
                id varchar(128) primary key,
                review_instance_id varchar(128) not null,
                role varchar(32) not null,
                signed_by varchar(255) not null default '',
                signed_name varchar(255) not null default '',
                signature text,
                signed_at timestamp,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
    _TABLES_READY = True


# ---------------------------------------------------------- template lookup

def get_review_type_template(programme_id, review_type_code):
    """One enabled Review template a programme has classified with the given
    Review Type code ('mcm' | 'progress_review'), or None.

    Resolution is Review Type code -> review_types.id -> review_templates
    .review_type_id. It never looks at a template's name, and never at the
    retired coach_surface column.

    A programme is deliberately NOT limited to one Review per type -- a type
    classifies, it does not claim a slot. This returns the most recently
    updated match (get_review_template_rows orders by updated_at desc), which
    only matters to progress_reviews_api's PPTX interval fallback; both
    calendars iterate every enabled template instead of asking for one.
    """
    if not programme_id or not review_type_code:
        return None
    type_row = review_types.get_review_type_by_code(review_type_code)
    if not type_row:
        return None
    rows = reviews.get_review_template_rows(
        'programme_id = %s and enabled = true and review_type_id = %s',
        [programme_id, type_row.get('id')],
    )
    return rows[0] if rows else None


def list_enabled_review_templates(programme_id):
    """Every enabled Review template a programme has configured, in display
    order. Consumers (Coach timetable, learner calendar) iterate this rather
    than asking for named/known Reviews -- a Review Curriculum adds tomorrow
    reaches both calendars with no code change."""
    if not programme_id:
        return []
    return reviews.get_review_template_rows(
        'programme_id = %s and enabled = true',
        [programme_id],
    )


def resolve_programme_review_occurrences(
    programme_id,
    learner_id,
    learner_status,
    learner_start_date,
    window_start,
    window_end,
    *,
    template_cache=None,
    learner_scope=None,
):
    """Every Curriculum Review occurrence due for one learner in a window,
    across ALL of their programme's enabled Review templates.

    This is the single entry point both calendars use -- there is no list of
    Review types anywhere in the consumers, so whichever Reviews a programme
    has configured are exactly the Reviews its learners see.
    """
    if template_cache is None:
        template_cache = {}
    if programme_id not in template_cache:
        template_cache[programme_id] = list_enabled_review_templates(programme_id)

    # The type catalogue is a handful of rows; read once per call rather than
    # once per template, and never per learner.
    type_index = review_types.review_type_index()

    templates_by_id = {template_row.get('id'): template_row for template_row in template_cache[programme_id]}

    occurrences = []
    for template_row in template_cache[programme_id]:
        if not review_applies_to_placement(template_row, learner_scope):
            continue
        type_row = type_index.get(curriculum_views.clean_str(template_row.get('review_type_id')))
        for occurrence in resolve_learner_occurrences(
            template_row, learner_id, learner_status, learner_start_date, window_start, window_end,
        ):
            # The Review's classification travels with every occurrence, so
            # Coach and the learner calendar can bucket it without ever
            # reading its name. A template with no type yet (pre-backfill)
            # carries a blank code and lands in the generic review bucket.
            #
            # The type's NAME and system flag travel too: a consumer building
            # filter buckets needs a label and a deterministic order, and
            # re-reading the catalogue downstream would be a second query for
            # data already in hand here. The name is the FILTER label only --
            # the event's own title stays review_templates.name, so renaming a
            # template renames the card without moving its bucket.
            occurrence['reviewTypeId'] = curriculum_views.clean_str(template_row.get('review_type_id'))
            occurrence['reviewTypeCode'] = curriculum_views.clean_str((type_row or {}).get('code'))
            occurrence['reviewTypeName'] = curriculum_views.clean_str((type_row or {}).get('name'))
            occurrence['reviewTypeIsSystem'] = bool((type_row or {}).get('is_system'))
            occurrence['occurrenceSource'] = OCCURRENCE_SOURCE_GENERATED
            occurrence['occurrenceRef'] = f"{OCCURRENCE_SOURCE_GENERATED}:{occurrence['occurrenceNumber']}"
            occurrences.append(occurrence)

    # Learner-specific additions (coach "Add Review") merge in alongside the
    # generated occurrences -- same learner, same window -- without touching
    # programme recurrence, other learners, or occurrence numbering in any
    # way. See resolve_learner_manual_occurrences: each is tagged
    # occurrenceSource='manual' and never carries an occurrenceNumber.
    for occurrence in resolve_learner_manual_occurrences(
        programme_id, learner_id, window_start=window_start, window_end=window_end,
        templates_by_id=templates_by_id, type_index=type_index,
    ):
        occurrences.append(occurrence)

    occurrences.sort(key=lambda item: item['targetDate'])
    return occurrences


# ------------------------------------------------- learner-specific additions

def find_active_learner_review_addition(review_template_id, learner_id, target_date):
    ensure_learner_review_additions_table()
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} '
        f'where review_template_id = %s and learner_id = %s and target_date = %s and deleted_at is null',
        [review_template_id, learner_id, target_date],
    )
    return rows[0] if rows else None


def get_learner_review_addition(addition_id):
    ensure_learner_review_additions_table()
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} where id = %s',
        [addition_id],
    )
    return rows[0] if rows else None


def list_active_learner_review_additions(programme_id, learner_id):
    ensure_learner_review_additions_table()
    return curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} '
        f'where programme_id = %s and learner_id = %s and deleted_at is null',
        [programme_id, learner_id],
    )


def create_learner_review_addition(
    *, review_template_id, programme_id, learner_id, target_date, reason_code='', reason='', actor='system',
):
    """Idempotent get-or-create for one learner's one additional Review on
    one date -- a repeated request for the exact same
    (review_template_id, learner_id, target_date) returns the SAME addition
    rather than creating a duplicate (see the partial unique index in
    sql/2026-09-15_curriculum_learner_review_additions.sql). This is the ONLY
    way a learner-specific occurrence is created -- it never touches
    review_occurrence_overrides (skip-only) or review_templates (programme-
    wide) at all.
    """
    ensure_learner_review_additions_table()
    existing = find_active_learner_review_addition(review_template_id, learner_id, target_date)
    if existing:
        return existing

    addition_id = curriculum_views.unique_prefixed_id('LRA')
    with transaction.atomic():
        try:
            row = curriculum_views.insert_row(LEARNER_REVIEW_ADDITIONS_TABLE, {
                'id': addition_id,
                'review_template_id': review_template_id,
                'programme_id': programme_id,
                'learner_id': learner_id,
                'target_date': target_date,
                'reason_code': reason_code or '',
                'reason': reason or '',
                'created_by': actor,
                'updated_by': actor,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            })
        except Exception:
            # Lost the race with a concurrent identical request -- the unique
            # index rejected the insert. The row that won is what we want.
            existing = find_active_learner_review_addition(review_template_id, learner_id, target_date)
            if existing:
                return existing
            raise
    return row


def resolve_learner_manual_occurrences(
    programme_id, learner_id, *, window_start=None, window_end=None, templates_by_id=None, type_index=None,
):
    """Every active learner-specific addition for this learner's programme,
    shaped exactly like a generated occurrence dict (same keys consumers
    already read) so both calendars can merge the two lists with no special
    casing beyond occurrenceSource/occurrenceRef.

    An addition whose template is no longer enabled is silently excluded --
    the same rule a disabled template already applies to its generated
    occurrences (see list_enabled_review_templates) -- rather than raising,
    since this runs on every calendar read.

    Fails safe to [] on any error (including
    schema_gate.SchemaNotProvisioned before
    sql/2026-09-15_curriculum_learner_review_additions.sql has been applied in
    production) -- exactly like resolve_curriculum_review_occurrences already
    does for the rest of Curriculum: a problem reading manual additions must
    never blank a learner's GENERATED occurrences, and this feature deploying
    ahead of its own migration must never break every existing calendar read.
    """
    if not programme_id or not learner_id:
        return []
    try:
        return _resolve_learner_manual_occurrences(
            programme_id, learner_id, window_start=window_start, window_end=window_end,
            templates_by_id=templates_by_id, type_index=type_index,
        )
    except Exception:
        logger.warning(
            'Could not resolve learner-specific Review additions for programme %s learner %s',
            programme_id, learner_id, exc_info=True,
        )
        return []


def _resolve_learner_manual_occurrences(
    programme_id, learner_id, *, window_start, window_end, templates_by_id, type_index,
):
    if templates_by_id is None:
        templates_by_id = {row.get('id'): row for row in list_enabled_review_templates(programme_id)}
    if type_index is None:
        type_index = review_types.review_type_index()

    occurrences = []
    for addition in list_active_learner_review_additions(programme_id, learner_id):
        template_row = templates_by_id.get(addition.get('review_template_id'))
        if not template_row:
            continue
        raw_target_date = addition.get('target_date')
        if isinstance(raw_target_date, datetime):
            target_date = raw_target_date.date()
        elif isinstance(raw_target_date, date):
            target_date = raw_target_date
        else:
            target_date = date.fromisoformat(curriculum_views.clean_str(raw_target_date)[:10])
        if window_start and target_date < window_start:
            continue
        if window_end and target_date > window_end:
            continue
        type_row = type_index.get(curriculum_views.clean_str(template_row.get('review_type_id')))
        occurrences.append({
            'reviewTemplateId': template_row.get('id'),
            'reviewName': template_row.get('name') or '',
            'occurrenceNumber': None,
            'targetDate': target_date,
            'recurrenceLabel': 'Additional review',
            'reviewTypeId': curriculum_views.clean_str(template_row.get('review_type_id')),
            'reviewTypeCode': curriculum_views.clean_str((type_row or {}).get('code')),
            'reviewTypeName': curriculum_views.clean_str((type_row or {}).get('name')),
            'reviewTypeIsSystem': bool((type_row or {}).get('is_system')),
            'occurrenceSource': OCCURRENCE_SOURCE_MANUAL,
            'occurrenceRef': f'{OCCURRENCE_SOURCE_MANUAL}:{addition.get("id")}',
            'additionId': addition.get('id'),
            'reasonCode': curriculum_views.clean_str(addition.get('reason_code')),
            'reason': curriculum_views.clean_str(addition.get('reason')),
        })
    return occurrences


def review_applies_to_placement(template_row, learner_scope=None):
    applicability = curriculum_views.as_json_value(template_row.get('applicability'), {})
    scope = applicability.get('scope', 'programme')
    if scope == 'programme':
        return True
    if scope not in ('cohort', 'group') or not learner_scope:
        return False
    identifiers = set(applicability.get('ids') or [])
    placement_id = curriculum_views.clean_str(learner_scope.get(f'{scope}_id'))
    if placement_id:
        return placement_id in identifiers
    # Older learner mirrors carry names only. Resolve within this programme,
    # and within the cohort for groups; ambiguous names never grant access.
    table = curriculum_views.COHORT_AUTHORING_DETAILS_TABLE if scope == 'cohort' else curriculum_views.GROUPS_TABLE
    if '_placement_rows' not in template_row:
        template_row['_placement_rows'] = curriculum_views.authoring_fetch_all(
            table, 'programme_id = %s', [template_row['programme_id']],
        )
    name = curriculum_views.clean_str(learner_scope.get(scope)).casefold()
    if not name:
        return False
    matches = []
    for row in template_row['_placement_rows']:
        if curriculum_views.clean_str(row.get(f'{scope}_name')).casefold() != name:
            continue
        if scope == 'group':
            cohort_id = curriculum_views.clean_str(learner_scope.get('cohort_id'))
            cohort_name = curriculum_views.clean_str(learner_scope.get('cohort')).casefold()
            if cohort_id and curriculum_views.clean_str(row.get('cohort_id')) != cohort_id:
                continue
            if not cohort_id and (not cohort_name or curriculum_views.clean_str(row.get('cohort_name')).casefold() != cohort_name):
                continue
        matches.append(curriculum_views.clean_str(row.get(f'{scope}_id')))
    return len(matches) == 1 and matches[0] in identifiers


def review_calendar_event_key(learner_id, template_id, occurrence_number):
    """An occurrence survives renames, reclassification and target-date edits."""
    return f'review:{learner_id}:{template_id}:{occurrence_number}'


def review_calendar_event_key_manual(learner_id, template_id, addition_id):
    """A learner-specific additional Review's event key -- identity-based and
    date-independent, like the generated form above, but keyed by the
    learner_review_additions row rather than a calendar-derived occurrence
    number (a manual addition has none -- see
    sql/2026-09-15_curriculum_learner_review_additions.sql). Never contains
    target_date, so rescheduling or editing the addition's own record never
    changes the row's identity."""
    return f'review:{learner_id}:{template_id}:manual:{addition_id}'


def reconcile_review_event_keys(events, records):
    """Keep existing booking keys, matching legacy keys only when unambiguous.

    Identity-tuple matching (by_identity) is scoped to events/records that
    carry a real occurrenceNumber -- i.e. GENERATED occurrences only. A
    manual (learner-specific addition) occurrence has no occurrence_number by
    design (occurrence_ref is its identity instead -- see
    curriculum.review_instances.occurrence_ref), so it is deliberately
    excluded from this dict rather than falling back to record.sequence:
    that fallback would collide a manual review with a generated occurrence
    that happens to carry the same sequence value for the same
    learner+template. A manual occurrence is still matched correctly below,
    via its own stable, unique event_key (by_key) -- it never needs the
    identity-tuple path at all.
    """
    by_identity = {}
    by_key = {record.event_key: record for record in records}
    legacy_candidates = {}
    for event in events:
        legacy_key = f"{event['source']}:{event['learnerId']}:{event['sequence']}:{event['targetDate']}"
        legacy_candidates.setdefault(legacy_key, []).append(event)
    for record in records:
        template_id = getattr(record, 'review_template_id', '')
        occurrence_number = getattr(record, 'occurrence_number', None)
        if template_id and occurrence_number is not None:
            identity = (str(record.learner_id), template_id, occurrence_number)
            by_identity[identity] = record
    matched = {}
    for event in events:
        occurrence_number = event.get('occurrenceNumber')
        identity = (str(event['learnerId']), event.get('reviewTemplateId'), occurrence_number) if occurrence_number is not None else None
        record = (by_identity.get(identity) if identity is not None else None) or by_key.get(event['eventKey'])
        if record is None:
            legacy_key = f"{event['source']}:{event['learnerId']}:{event['sequence']}:{event['targetDate']}"
            candidate = by_key.get(legacy_key)
            if candidate and not getattr(candidate, 'review_template_id', '') and len(legacy_candidates[legacy_key]) == 1:
                record = candidate
        if record is not None:
            event['id'] = event['eventKey'] = record.event_key
            matched[record.event_key] = record
    return matched


def programme_review_template_identifiers(programme_id, *, template_cache=None):
    """[(review_template_id, review_type_code)] for a programme's enabled
    Review templates -- what a diagnostic needs to NAME the Reviews it did not
    generate, without generating anything.

    Shares ``resolve_programme_review_occurrences``'s template cache, so a
    caller already walking a caseload pays nothing for the programmes it has
    seen.
    """
    if not programme_id:
        return []
    if template_cache is None:
        template_cache = {}
    if programme_id not in template_cache:
        template_cache[programme_id] = list_enabled_review_templates(programme_id)
    type_index = review_types.review_type_index()
    identifiers = []
    for template_row in template_cache[programme_id]:
        type_row = type_index.get(curriculum_views.clean_str(template_row.get('review_type_id')))
        identifiers.append((
            template_row.get('id'),
            curriculum_views.clean_str((type_row or {}).get('code')) or None,
        ))
    return identifiers


def learner_is_eligible(template_row, learner_status):
    """applicable_statuses is Curriculum's only eligibility source -- an empty
    list means no restriction has been configured, not "nobody is eligible"."""
    statuses = curriculum_views.as_json_value(template_row.get('applicable_statuses'), [])
    if not statuses:
        return True
    return curriculum_views.clean_str(learner_status) in statuses


# --------------------------------------------------------- learner-scoped
# occurrence overrides (extends review_schedule.py's programme-wide table
# with an optional learner_id column, without touching that module's own
# programme-level clash-preview reads/writes).

def _fetch_learner_scoped_overrides(review_id, learner_id):
    """Active overrides for one Review, either programme-wide (learner_id is
    null) or scoped to this learner specifically -- keyed by occurrence date
    so a learner-specific skip never touches another learner's schedule."""
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(OVERRIDES_TABLE)} '
        f'where review_id = %s and deleted_at is null '
        f'and (learner_id is null or learner_id = %s)',
        [review_id, learner_id],
    )
    return {curriculum_views.format_date(row.get('occurrence_date')): row for row in rows}


def skip_occurrence_for_learner(review_id, occurrence_date_iso, programme_id, learner_id, *, actor='staff', reason=''):
    """Learner-specific skip -- unlike review_schedule.skip_occurrence, this
    never affects any other learner on the same programme/template."""
    existing_rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(OVERRIDES_TABLE)} '
        f'where review_id = %s and occurrence_date = %s and learner_id = %s and deleted_at is null',
        [review_id, occurrence_date_iso, learner_id],
    )
    if existing_rows:
        curriculum_views.update_rows(OVERRIDES_TABLE, 'id = %s', [existing_rows[0]['id']], {
            'reason': reason, 'updated_by': actor, 'updated_at': datetime.utcnow(),
        })
        return existing_rows[0]['id']
    override_id = curriculum_views.unique_prefixed_id('REVOL')
    curriculum_views.insert_row(OVERRIDES_TABLE, {
        'id': override_id,
        'review_id': review_id,
        'programme_id': programme_id,
        'occurrence_date': occurrence_date_iso,
        'learner_id': learner_id,
        'action': 'skip',
        'reason': reason,
        'created_by': actor,
        'updated_by': actor,
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    })
    return override_id


# -------------------------------------------------------- occurrence engine

def template_recurrence_config(row):
    return {
        'interval': curriculum_views.parse_int(row.get('recurrence_interval'), 1),
        'unit': row.get('recurrence_unit') or 'weeks',
        'occurrenceLimit': row.get('occurrence_count'),
    }


def resolve_learner_occurrences(template_row, learner_id, learner_status, learner_start_date, window_start, window_end):
    """RAW occurrences of one Review template for one learner, anchored to
    their own start date -- never the template's own schedule_anchor_date,
    which only drives the Curriculum-side programme schedule preview.

    Returns [] outright (no occurrences, ever) when the template is disabled,
    the learner is not currently eligible, or there is no start date to
    anchor from -- callers must not fall back to any hard-coded rule when
    this returns empty; an empty result means "Curriculum does not produce
    this Review for this learner right now", which is a valid, correct
    answer, not a gap to patch over.
    """
    if not template_row or not bool(template_row.get('enabled')):
        return []
    if not learner_is_eligible(template_row, learner_status):
        return []
    if not learner_start_date:
        return []

    recurrence = template_recurrence_config(template_row)
    review_id = template_row.get('id')
    overrides_by_date = _fetch_learner_scoped_overrides(review_id, learner_id)

    # Occurrence #1 is one interval AFTER the learner's start date, never the
    # start date itself (see the brief's own MCM/PR worked examples: a 2 Aug
    # start with a 1-month interval produces 2 Sep as occurrence #1, not
    # 2 Aug). generate_occurrence_steps treats its anchor as occurrence #1,
    # so the anchor passed to it here is shifted forward by one interval --
    # this is the only place that shift happens, so occurrence numbering
    # everywhere downstream (instance identity, "occurrence #2", overrides)
    # stays in the learner-facing 1-based scheme the rest of the app expects.
    interval, unit = recurrence['interval'], recurrence['unit']
    if unit == 'months':
        virtual_anchor = review_schedule.add_calendar_months(learner_start_date, interval)
    else:
        step_days = interval * (7 if unit == 'weeks' else 1)
        virtual_anchor = learner_start_date + timedelta(days=step_days)

    steps = review_schedule.generate_occurrence_steps(
        virtual_anchor, interval, unit,
        window_start, window_end, occurrence_limit=recurrence['occurrenceLimit'],
    )

    occurrences = []
    for occurrence_number, occurrence_date in steps:
        if curriculum_views.format_date(occurrence_date) in overrides_by_date:
            continue
        occurrences.append({
            'reviewTemplateId': review_id,
            'reviewName': template_row.get('name') or '',
            'occurrenceNumber': occurrence_number,
            'targetDate': occurrence_date,
            'recurrenceLabel': review_schedule.recurrence_label(recurrence['interval'], recurrence['unit']),
        })
    return occurrences


# ---------------------------------------------------------- review instance

def existing_review_instance_ids():
    rows = curriculum_views.fetch_all(
        f'select id from {curriculum_views.table_name(REVIEW_INSTANCES_TABLE)}', [],
    )
    return [row.get('id') for row in rows]


def get_review_instance(instance_id, *, for_update=False):
    # Booking callers hold a transaction while checking the linked lifecycle.
    lock = ' for update' if for_update and curriculum_views.connection.vendor == 'postgresql' else ''
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCES_TABLE)} where id = %s{lock}',
        [instance_id],
    )
    return rows[0] if rows else None


def find_review_instance(review_template_id, learner_id, occurrence_number):
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCES_TABLE)} '
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
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCES_TABLE)} '
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
    return curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCES_TABLE)} where {where} order by target_date',
        params,
    )


def json_safe(value):
    """The same structure with every value JSON can actually hold.

    The template payload carries live ``datetime``/``date`` objects (a row's
    createdAt/updatedAt), which the response encoder handles but a plain
    ``json.dumps`` into JSONB does not. Normalising on the way in also keeps
    the snapshot round-trippable: what is read back out of the column has the
    same shape as what was frozen into it.
    """
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def build_definition_snapshot(template_row):
    return json_safe(reviews.review_template_detail_payload(template_row))


def ensure_review_instance(
    template_row, *, learner_id, learner_kind, programme_id, occurrence_number, target_date,
    coach_email='', actor='system', occurrence_source=OCCURRENCE_SOURCE_GENERATED, occurrence_ref=None,
):
    """Idempotent get-or-create for one learner's one occurrence.

    Identity for a GENERATED occurrence (occurrence_source, the default) is
    (review_template_id, learner_id, occurrence_number) -- see the unique
    index in the SQL migration -- and is completely unchanged by the
    occurrence_source/occurrence_ref parameters below: every existing caller
    passes neither, so its behaviour, lookup and stored values are identical
    to before this parameter pair existed.

    Identity for a MANUAL (learner-specific addition) occurrence is instead
    (review_template_id, learner_id, occurrence_ref) -- occurrence_number is
    stored as NULL for these rows (see
    sql/2026-09-15_curriculum_learner_review_additions.sql for why a manual
    occurrence cannot safely share the generated numbering space). Callers
    creating a manual instance MUST pass occurrence_source='manual' and an
    explicit occurrence_ref (see review_calendar_event_key_manual for the
    matching event key).

    A repeated call (the caseload timetable is recomputed on every page
    load) always returns the same row rather than creating a duplicate.
    """
    ensure_review_instance_tables()
    review_template_id = template_row.get('id')
    is_manual = occurrence_source == OCCURRENCE_SOURCE_MANUAL
    ref = occurrence_ref or f'{OCCURRENCE_SOURCE_GENERATED}:{occurrence_number}'

    def _existing():
        if is_manual:
            return find_review_instance_by_ref(review_template_id, learner_id, ref)
        return find_review_instance(review_template_id, learner_id, occurrence_number)

    existing = _existing()
    if existing:
        return existing

    instance_id = curriculum_views.unique_prefixed_id('REVI', '', existing_review_instance_ids)
    with transaction.atomic():
        try:
            row = curriculum_views.insert_row(REVIEW_INSTANCES_TABLE, {
                'id': instance_id,
                'review_template_id': review_template_id,
                'learner_id': learner_id,
                'learner_kind': learner_kind or '',
                'programme_id': programme_id,
                'occurrence_number': None if is_manual else occurrence_number,
                'occurrence_source': occurrence_source,
                'occurrence_ref': ref,
                'target_date': target_date,
                'coach_email': coach_email or '',
                'definition_snapshot': curriculum_views.json_db_value(build_definition_snapshot(template_row)),
                'status': STATUS_NOT_SCHEDULED,
                'created_by': actor,
                'updated_by': actor,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            })
        except Exception:
            # Lost the race with a concurrent identical request -- the unique
            # index rejected the insert. The row that won is what we want.
            existing = _existing()
            if existing:
                return existing
            raise
    return row


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
    rows = curriculum_views.update_rows(REVIEW_INSTANCES_TABLE, 'id = %s', [instance_id], payload)
    return rows[0] if rows else None


def mark_review_instance_scheduled(instance_id, *, actor='system'):
    """not-scheduled -> scheduled, once a real booking (date/time) exists on
    the linked CoachCalendarEvent -- see coach_api.views
    persist_calendar_sync_reservation, which calls this for both new and
    already-linked bookings. Guarded in the UPDATE
    itself (``and status = 'not-scheduled'``) rather than read-then-write, so
    it is atomic and a repeat call is a no-op instead of a race.
    """
    rows = curriculum_views.update_rows(
        REVIEW_INSTANCES_TABLE, 'id = %s and status = %s', [instance_id, STATUS_NOT_SCHEDULED],
        {'status': STATUS_SCHEDULED, 'updated_by': actor, 'updated_at': datetime.utcnow()},
    )
    return rows[0] if rows else None


def mark_review_instance_not_scheduled(
    instance_id,
    *,
    calendar_event_id,
    learner_id,
    review_template_id,
    coach_email,
    actor='system',
):
    """Cancel an unstarted linked review without weakening its lifecycle.

    The only write this function can make is ``scheduled -> not-scheduled``.
    Link identity and current status are all predicates in the UPDATE itself,
    so a stale request cannot cancel a different learner's review or regress
    an instance that attendance, completion or signatures already advanced.
    Returning the already-not-scheduled row makes cancellation retries
    idempotent; every other no-op returns ``None`` for the caller to reject.
    """
    where = (
        'id = %s and status = %s and calendar_event_id = %s '
        'and learner_id = %s and review_template_id = %s '
        'and lower(trim(coach_email)) = lower(trim(%s))'
    )
    identity = [
        instance_id,
        STATUS_SCHEDULED,
        calendar_event_id,
        learner_id,
        review_template_id,
        coach_email,
    ]
    rows = curriculum_views.update_rows(
        REVIEW_INSTANCES_TABLE,
        where,
        identity,
        {
            'status': STATUS_NOT_SCHEDULED,
            'updated_by': actor,
            'updated_at': datetime.utcnow(),
        },
    )
    if rows:
        return rows[0]

    current = get_review_instance(instance_id)
    if not current or current.get('status') != STATUS_NOT_SCHEDULED:
        return None
    if (
        current.get('calendar_event_id') != calendar_event_id
        or current.get('learner_id') != learner_id
        or curriculum_views.clean_str(current.get('review_template_id'))
        != curriculum_views.clean_str(review_template_id)
        or curriculum_views.clean_str(current.get('coach_email')).lower()
        != curriculum_views.clean_str(coach_email).lower()
    ):
        return None
    return current


def mark_review_instance_in_progress_from_attendance(instance_id, *, started_at, actor='attendance-sync'):
    """The ONLY writer of review_instances.status -> in-progress that reflects
    a real, Microsoft-Graph-confirmed Teams join by an expected coach or
    learner (see coach_api.views.apply_teams_attendance_status_transition for
    how the caller established that, and where it is invoked from). Never
    call this because a form was opened, a draft was saved, a "Start" button
    was clicked, or the scheduled time has passed.

    Strictly monotonic and idempotent: the UPDATE only ever matches a row
    still at exactly ``scheduled`` (guarded in the WHERE clause, not by a
    separate read first, so there is no race and no possibility of
    regressing an instance already at awaiting-signature/completed/
    not-scheduled back to in-progress). A second sync pass that finds the
    same attendance again is a no-op -- ``started_at`` is not rewritten and no
    duplicate transition is recorded.
    """
    rows = curriculum_views.update_rows(
        REVIEW_INSTANCES_TABLE, 'id = %s and status = %s', [instance_id, STATUS_SCHEDULED],
        {'status': STATUS_IN_PROGRESS, 'started_at': started_at, 'updated_by': actor, 'updated_at': datetime.utcnow()},
    )
    return rows[0] if rows else None


#: Stable, machine-readable reasons for a manual scheduled -> in-progress
#: override (Phase 4). The frontend maps these to friendly labels; the
#: backend never accepts free text as the reason itself.
MANUAL_OVERRIDE_REASON_CODES = (
    'coach-confirmed-live-start',
    'teams-link-issue',
    'graph-unavailable',
    'attendance-not-detected',
    'meeting-held-outside-teams',
    'scheduler-delay',
    'other',
)

_manual_override_logger = logging.getLogger('curriculum_api.review_instance_manual_override')


def _manual_override_status_rejection(current_status):
    if current_status == STATUS_IN_PROGRESS:
        return 'This review is already in progress.'
    if current_status == STATUS_AWAITING_SIGNATURE:
        return 'This review has already been submitted and is awaiting signature.'
    if current_status == STATUS_COMPLETED:
        return 'This review has already been completed.'
    if current_status == STATUS_NOT_SCHEDULED:
        return 'This review has not been scheduled yet.'
    return 'This review cannot be manually marked in progress from its current status.'


def _log_manual_in_progress_override(*, review_instance_id, calendar_event_id, reason_code, note, changed_by):
    """Operational log line for a manual override -- useful for debugging,
    but NOT the authoritative record. curriculum.review_instance_manual_
    overrides (record_review_instance_manual_override, below) is the
    persistent business record; this log may still be handy for
    operational debugging alongside it."""
    _manual_override_logger.info(
        'review_instance_manual_in_progress_override',
        extra={
            'review_instance_id': review_instance_id,
            'calendar_event_id': calendar_event_id,
            'previous_status': STATUS_SCHEDULED,
            'new_status': STATUS_IN_PROGRESS,
            'source': 'manual',
            'reason_code': reason_code,
            'note': note,
            'changed_by': changed_by,
            'changed_at': datetime.utcnow().isoformat(),
        },
    )


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
    return curriculum_views.insert_row(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE, {
        'id': curriculum_views.unique_prefixed_id('REVIOV'),
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
    return curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)} '
        f'where review_instance_id = %s order by changed_at desc',
        [review_instance_id],
    )


def latest_review_instance_manual_override(review_instance_id):
    """The most recent manual override for this instance, or None. Cheap
    convenience for a UI that only ever wants to show the latest one."""
    rows = list_review_instance_manual_overrides(review_instance_id)
    return rows[0] if rows else None


def mark_review_instance_in_progress_manually(instance_row, *, reason_code, note='', started_at=None, actor='system'):
    """Authorised fallback for scheduled -> in-progress when Microsoft Teams
    attendance cannot be detected (Graph outage, a delayed attendance report,
    a meeting held on another channel, a scheduler failure, or another
    exceptional operational problem). This is the EXCEPTION path --
    apply_teams_attendance_status_transition (a confirmed Teams join) remains
    the normal one. Never touches Teams identifiers, review answers,
    signatures, target_date, or scheduled_date/time.

    Authorization (the assigned coach, or a super-admin acting through the
    existing view-as/attributed-write mechanism) is the CALLER's
    responsibility -- see
    coach_api.views.coach_review_instance_mark_in_progress_manually. This
    function only enforces the lifecycle/data rules:

    * a valid reason code, with a required note when the reason is "other"
    * the instance is currently exactly `scheduled` (atomic compare-and-swap,
      same pattern as mark_review_instance_in_progress_from_attendance --
      cannot regress not-scheduled/awaiting-signature/completed, and a
      second call after a successful override is rejected, not a silent
      no-op, so a repeat click can't be mistaken for success)
    * started_at: an already-set value is never overwritten; otherwise the
      caller's optional actual-start-time, otherwise now. This value is
      never presented as Teams attendance evidence -- the instance's own
      audit trail (see _log_manual_in_progress_override) records that the
      source was manual, and that is not overwritten by a later attendance
      sync (mark_review_instance_in_progress_from_attendance's own guard
      already refuses to fire once status has moved past `scheduled`).

    Returns (ok, errors_or_row): errors is {'reason': [...]}, {'note': [...]}
    or {'status': [...]} depending on which check failed.
    """
    reason_code = curriculum_views.clean_str(reason_code).lower()
    note = curriculum_views.clean_str(note)
    if reason_code not in MANUAL_OVERRIDE_REASON_CODES:
        return False, {'reason': ['Choose a valid reason for this manual override.']}
    if reason_code == 'other' and not note:
        return False, {'note': ['Add details when the reason is "Other".']}

    current_status = instance_row.get('status')
    if current_status != STATUS_SCHEDULED:
        return False, {'status': [_manual_override_status_rejection(current_status)]}

    effective_started_at = instance_row.get('started_at') or started_at or datetime.utcnow()

    # Provisioned here, before the transaction below opens -- a lazy
    # first-time CREATE TABLE run *inside* transaction.atomic() interacts
    # badly with sqlite (DDL there implicitly ends the surrounding
    # transaction underneath Django's savepoint bookkeeping, which then
    # leaves the following pragma/column-lookup reading against a
    # connection state Django still thinks is mid-transaction). Every other
    # table's provisioning call already runs outside any atomic() block for
    # the same reason; this one is no different, it is just triggered lazily
    # instead of from a test's setUp().
    ensure_review_instance_manual_overrides_table()

    # The status UPDATE and the audit INSERT happen inside one transaction on
    # the same ('default') connection review_instances itself already lives
    # on (curriculum_views.update_rows/insert_row both go through
    # django.db.connection, never 'enrolment') -- so either both apply or,
    # on any error, neither does. A rejected attempt (wrong status, bad
    # reason, lost race) never reaches this block, so no row is ever written
    # for one.
    with transaction.atomic():
        updated = curriculum_views.update_rows(
            REVIEW_INSTANCES_TABLE, 'id = %s and status = %s',
            [instance_row.get('id'), STATUS_SCHEDULED],
            {
                'status': STATUS_IN_PROGRESS, 'started_at': effective_started_at,
                'updated_by': actor, 'updated_at': datetime.utcnow(),
            },
        )
        if not updated:
            return False, {'status': ['This review is no longer scheduled. Reload it and try again.']}

        row = updated[0]
        record_review_instance_manual_override(
            review_instance_id=row.get('id'), calendar_event_id=row.get('calendar_event_id'),
            previous_status=STATUS_SCHEDULED, new_status=STATUS_IN_PROGRESS,
            reason_code=reason_code, note=note, changed_by=actor,
            manual_started_at=effective_started_at,
        )

    _log_manual_in_progress_override(
        review_instance_id=row.get('id'), calendar_event_id=row.get('calendar_event_id'),
        reason_code=reason_code, note=note, changed_by=actor,
    )
    return True, row


def link_calendar_event(instance_id, calendar_event_id, *, actor='system'):
    return curriculum_views.update_rows(REVIEW_INSTANCES_TABLE, 'id = %s', [instance_id], {
        'calendar_event_id': calendar_event_id, 'updated_by': actor, 'updated_at': datetime.utcnow(),
    })


# -------------------------------------------------------------- form + answers

def get_review_instance_answers(instance_id):
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCE_ANSWERS_TABLE)} where review_instance_id = %s',
        [instance_id],
    )
    return {row.get('field_id'): row for row in rows}


def get_review_instance_signatures(instance_id):
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCE_SIGNATURES_TABLE)} where review_instance_id = %s',
        [instance_id],
    )
    return {row.get('role'): row for row in rows}


def _flatten_snapshot_fields(sections):
    """Every field in a definition_snapshot's sections tree, conditional
    children included -- unlike reviews.flatten_fields (which is a
    top-level-only convenience view), a saved answer/validation pass needs to
    see every field, at any nesting depth."""
    flat = []

    def _walk(fields):
        for field in fields or []:
            flat.append(field)
            _walk(field.get('yesFields'))
            _walk(field.get('noFields'))

    for section in sections or []:
        _walk(section.get('fields'))
    return flat


def review_instance_form_definition(instance_row):
    """The hierarchical {instance, template, sections[].fields[].answer} shape
    a dynamic form renderer consumes. Sections/fields/signature-and-visibility
    rules come from the FROZEN definition_snapshot (historical integrity);
    the display title/status/target date are read live."""
    snapshot = curriculum_views.as_json_value(instance_row.get('definition_snapshot'), {})
    live_template = reviews.get_review_template_row(instance_row.get('review_template_id'), include_deleted=True)
    live_name = (live_template or {}).get('name') or snapshot.get('name') or ''
    type_row = next((row for row in review_types.review_type_index().values()
                     if row.get('id') == (live_template or {}).get('review_type_id')), None)

    answers_by_field = get_review_instance_answers(instance_row.get('id'))
    signatures_by_role = get_review_instance_signatures(instance_row.get('id'))

    def _attach_answers(fields):
        decorated = []
        for field in fields or []:
            field = dict(field)
            saved = answers_by_field.get(field.get('id'))
            field['answer'] = curriculum_views.as_json_value(saved.get('answer'), None) if saved else None
            field['answeredBy'] = saved.get('answered_by') if saved else None
            field['answeredAt'] = curriculum_views.format_created_at(saved.get('answered_at')) if saved else None
            if field.get('fieldType') == reviews.CONDITIONAL_FIELD_TYPE:
                field['yesFields'] = _attach_answers(field.get('yesFields'))
                field['noFields'] = _attach_answers(field.get('noFields'))
            decorated.append(field)
        return decorated

    sections = [
        {**section, 'fields': _attach_answers(section.get('fields'))}
        for section in snapshot.get('sections', [])
    ]

    result = {
        'instance': {
            'id': instance_row.get('id'),
            'reviewTemplateId': instance_row.get('review_template_id'),
            'learnerId': instance_row.get('learner_id'),
            'programmeId': instance_row.get('programme_id'),
            'occurrenceNumber': instance_row.get('occurrence_number'),
            'targetDate': curriculum_views.format_date(instance_row.get('target_date')),
            'status': instance_row.get('status'),
            'startedAt': curriculum_views.format_created_at(instance_row.get('started_at')),
            'completedAt': curriculum_views.format_created_at(instance_row.get('completed_at')),
        },
        'template': {
            'id': instance_row.get('review_template_id'),
            'name': live_name,
            'reviewTypeId': (live_template or {}).get('review_type_id') or snapshot.get('reviewTypeId'),
            'reviewTypeCode': (type_row or {}).get('code') or snapshot.get('reviewTypeCode'),
            'reviewTypeName': (type_row or {}).get('name') or snapshot.get('reviewTypeName'),
            'signatures': snapshot.get('signatures', {}),
            'visibleTo': snapshot.get('visibleTo', {}),
            'recurrence': snapshot.get('recurrence', {}),
            'notifications': snapshot.get('notifications', {}),
            'allowEditingPriorDays': snapshot.get('allowEditingPriorDays', 0),
        },
        'sections': sections,
        'signatures': {
            role: {
                'required': bool(snapshot.get('signatures', {}).get(role)),
                'signed': bool(signatures_by_role.get(role, {}).get('signed_at')),
                'signedBy': signatures_by_role.get(role, {}).get('signed_by'),
                'signedName': signatures_by_role.get(role, {}).get('signed_name'),
                'signedAt': curriculum_views.format_created_at(signatures_by_role.get(role, {}).get('signed_at')),
                # Return the recorded mark as well as the sign-off metadata.
                # Old sign-offs may contain a non-image acknowledgement; clients
                # must only render supported image data URIs, never infer a mark.
                'signature': (
                    signatures_by_role.get(role, {}).get('signature') or None
                    if signatures_by_role.get(role, {}).get('signed_at') else None
                ),
            }
            for role in SIGNATURE_ROLES
        },
        # None for the overwhelming majority of instances -- only ever set
        # for one that was moved to in-progress by an authorised manual
        # override rather than real Teams attendance (Phase 5).
        'manualOverride': _serialize_manual_override(latest_review_instance_manual_override(instance_row.get('id'))),
        # What a coach last calculated for THIS instance, exactly as it was
        # stored -- never recomputed while reading, so an instance that was
        # never calculated reads as None and a signed one keeps its figures.
        'progressSnapshot': review_instance_progress_snapshot(instance_row),
    }
    if result['template']['reviewTypeCode'] == review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW:
        # Only this Review Type presents a RAG history, and only from the
        # learner's own completed Progress Reviews -- each row showing the RAG
        # that review itself recorded, never the learner's current coach_rag.
        result['ragHistory'] = progress_review_rag_history(instance_row.get('learner_id'))
    from .review_pdf import pdf_availability
    result['pdf'] = pdf_availability(result)
    return result


def _serialize_manual_override(row):
    if not row:
        return None
    return {
        'reasonCode': row.get('reason_code'),
        'note': row.get('note') or '',
        'changedBy': row.get('changed_by'),
        'changedAt': curriculum_views.format_created_at(row.get('changed_at')),
        'manualStartedAt': curriculum_views.format_created_at(row.get('manual_started_at')),
    }


def _visible_required_unanswered_fields(sections, answers_by_field):
    """Visible (per the boolean_case_block condition its parent answered)
    required fields with no answer yet -- a hidden conditional field can
    never block completion, whatever it was answered before being hidden."""
    missing = []

    def _walk(fields, visible=True):
        for field in fields or []:
            field_visible = visible
            if field.get('fieldType') in reviews.DISPLAY_ONLY_FIELD_TYPES:
                pass
            elif field_visible and field.get('required'):
                saved = answers_by_field.get(field.get('id'))
                answer = curriculum_views.as_json_value(saved.get('answer'), None) if saved else None
                if answer in (None, '', []):
                    missing.append(field.get('id'))

            if field.get('fieldType') == reviews.CONDITIONAL_FIELD_TYPE:
                saved = answers_by_field.get(field.get('id'))
                answer = curriculum_views.as_json_value(saved.get('answer'), None) if saved else None
                _walk(field.get('yesFields'), visible=field_visible and answer == 'yes')
                _walk(field.get('noFields'), visible=field_visible and answer == 'no')

    _walk(sections and [f for s in sections for f in s.get('fields', [])])
    return missing


def save_review_instance_answers(instance_row, answers, *, actor='system'):
    """Draft save -- merges posted {fieldId: value} into whatever is already
    stored. A conditional field hidden by its parent's current answer is
    still saved as posted (its previous answer is not corrupted/dropped just
    because it is not visible right now)."""
    if instance_row.get('status') in (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED):
        raise ValueError('Submitted review answers cannot be changed after the signature step begins.')
    snapshot = curriculum_views.as_json_value(instance_row.get('definition_snapshot'), {})
    valid_field_ids = {
        field.get('id')
        for field in _flatten_snapshot_fields(snapshot.get('sections', []))
    }

    with transaction.atomic():
        for field_id, value in (answers or {}).items():
            if field_id not in valid_field_ids:
                continue
            existing_rows = curriculum_views.fetch_all(
                f'select * from {curriculum_views.table_name(REVIEW_INSTANCE_ANSWERS_TABLE)} '
                f'where review_instance_id = %s and field_id = %s',
                [instance_row.get('id'), field_id],
            )
            payload = {
                'answer': curriculum_views.json_db_value(value),
                'answered_by': actor,
                'answered_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            }
            if existing_rows:
                curriculum_views.update_rows(
                    REVIEW_INSTANCE_ANSWERS_TABLE, 'id = %s', [existing_rows[0]['id']], payload,
                    allow_null_columns=['answer'],
                )
            else:
                curriculum_views.insert_row(REVIEW_INSTANCE_ANSWERS_TABLE, {
                    'id': curriculum_views.unique_prefixed_id('REVIA'),
                    'review_instance_id': instance_row.get('id'),
                    'field_id': field_id,
                    'created_at': datetime.utcnow(),
                    **payload,
                })

        # Saving a draft answer is not evidence the meeting started -- it used
        # to flip status to in-progress here, which is exactly the "opened/
        # edited the form" trigger Phase 2 removes. The real trigger is a
        # confirmed Microsoft Teams attendance signal; see
        # mark_review_instance_in_progress_from_attendance and
        # coach_api.views.apply_teams_attendance_status_transition.

    return review_instance_form_definition(get_review_instance(instance_row.get('id')))


# ------------------------------------------------- progress + RAG snapshots

#: The instance's own frozen copy of what a coach calculated (see
#: learner_api.review_progress_snapshot for what goes in it). Kept beside
#: definition_snapshot rather than inside it: that one freezes the QUESTION
#: SET at creation time and is written exactly once, this one is written when
#: a coach presses Calculate and may be replaced until signing begins.
PROGRESS_SNAPSHOT_COLUMN = 'progress_snapshot'

#: How a Curriculum-authored question declares itself to BE the RAG question,
#: so the RAG value is found by the template's own stable marker rather than
#: by matching a question's title. Set in the field's configuration, frozen
#: per instance with the rest of the definition, so a historical review is
#: always read through the marker IT was created with.
RAG_SEMANTIC_KEY = 'rag_status'


def review_instance_progress_snapshot(instance_row):
    """What was frozen the last time a coach pressed Calculate, or None.

    Never recalculated on read: an instance with no snapshot reads as None so
    the caller can say "not calculated yet", rather than quietly substituting
    the learner's current figures into a historical review.
    """
    return curriculum_views.as_json_value(instance_row.get(PROGRESS_SNAPSHOT_COLUMN), None)


def save_review_instance_progress_snapshot(instance_row, snapshot, *, actor='system'):
    """Freeze (or replace) this instance's calculated progress.

    Same lifecycle rule the answers themselves follow: once the instance has
    reached awaiting-signature/completed, the figures a party is about to sign
    -- or has already signed -- can no longer move underneath them. Guarded in
    the UPDATE's own WHERE clause as well as checked up front, so a Calculate
    racing a completion cannot slip in after the transition.
    """
    if instance_row.get('status') in (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED):
        raise ValueError('Progress cannot be recalculated after the signature step begins.')
    if PROGRESS_SNAPSHOT_COLUMN not in curriculum_views.column_names(REVIEW_INSTANCES_TABLE):
        # filtered_payload would otherwise drop the snapshot silently and the
        # write would look like it succeeded. Fail loudly instead, naming the
        # migration that adds the column.
        raise ValueError(
            'This deployment cannot store a Progress Review snapshot yet: run '
            'sql/2026-09-16_curriculum_review_instance_progress_snapshot.sql.'
        )

    rows = curriculum_views.update_rows(
        REVIEW_INSTANCES_TABLE,
        'id = %s and status not in (%s, %s)',
        [instance_row.get('id'), STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED],
        {
            PROGRESS_SNAPSHOT_COLUMN: curriculum_views.json_db_value(json_safe(snapshot)),
            'updated_by': actor,
            'updated_at': datetime.utcnow(),
        },
    )
    if not rows:
        raise ValueError('Progress cannot be recalculated after the signature step begins.')
    return rows[0]


def _rag_field_ids(snapshot):
    return [
        field.get('id')
        for field in _flatten_snapshot_fields(snapshot.get('sections', []))
        if (field.get('configuration') or {}).get('semanticKey') == RAG_SEMANTIC_KEY
    ]


def review_instance_rag_value(instance_row):
    """This instance's own recorded RAG answer, or ''.

    Read from the answer saved against this instance, located through the
    RAG marker in the definition THIS instance froze -- never from the
    learner's current/live coach_rag, which a coach can change at any time and
    which would otherwise rewrite the history of an already-signed review.
    """
    snapshot = curriculum_views.as_json_value(instance_row.get('definition_snapshot'), {})
    field_ids = _rag_field_ids(snapshot)
    if not field_ids:
        return ''
    answers = get_review_instance_answers(instance_row.get('id'))
    for field_id in field_ids:
        saved = answers.get(field_id)
        value = curriculum_views.as_json_value(saved.get('answer'), None) if saved else None
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''


def list_learner_review_instances(learner_id, review_type_code, *, statuses=(STATUS_COMPLETED,)):
    """This learner's own instances of one Review Type, newest target date
    first. Scoped by the Review Type's stable code -- never by template name --
    so a Progress Review history can never pick up a Monthly Coaching Meeting
    or any other Review the programme happens to run."""
    ensure_review_instance_tables()
    type_row = review_types.get_review_type_by_code(review_type_code)
    if not type_row or not learner_id:
        return []
    placeholders = ', '.join(['%s'] * len(statuses)) if statuses else ''
    status_clause = f' and i.status in ({placeholders})' if statuses else ''
    return curriculum_views.fetch_all(
        f'select i.* from {curriculum_views.table_name(REVIEW_INSTANCES_TABLE)} i '
        f'join {curriculum_views.table_name(reviews.REVIEW_TEMPLATES_TABLE)} t '
        f'on t.id = i.review_template_id '
        f'where i.learner_id = %s and t.review_type_id = %s{status_clause} '
        f'order by i.target_date desc, i.occurrence_number desc',
        [learner_id, type_row.get('id'), *statuses],
    )


def progress_review_rag_history(learner_id, *, limit=8):
    """Completed Progress Reviews for this learner, newest first, each with the
    RAG answer IT recorded.

    A review that never captured a RAG value contributes an empty rag rather
    than being dropped, so the history shows the occurrence took place -- the
    same way the legacy export shows an entry with no RAG against it.
    """
    history = []
    for row in list_learner_review_instances(learner_id, review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW):
        template = reviews.get_review_template_row(row.get('review_template_id'), include_deleted=True)
        history.append({
            'reviewInstanceId': row.get('id'),
            'reviewName': (template or {}).get('name') or '',
            'occurrenceNumber': row.get('occurrence_number'),
            'targetDate': curriculum_views.format_date(row.get('target_date')),
            'completedAt': curriculum_views.format_created_at(row.get('completed_at')),
            'rag': review_instance_rag_value(row),
        })
        if len(history) >= limit:
            break
    return history


def _all_required_signatures_present(instance_id, snapshot):
    required_roles = [role for role in SIGNATURE_ROLES if bool(snapshot.get('signatures', {}).get(role))]
    if not required_roles:
        return True
    signatures_by_role = get_review_instance_signatures(instance_id)
    return all(signatures_by_role.get(role, {}).get('signed_at') for role in required_roles)



def _mirror_linked_calendar_after_signature(instance_row, *, status, completed_at=None):
    """Project a signature-owned status onto its linked Calendar row atomically."""
    calendar_event_id = instance_row.get('calendar_event_id')
    if not calendar_event_id:
        return

    # Import lazily: coach_api.views imports this module at application start.
    from coach_api.models import CoachCalendarEvent

    calendar = CoachCalendarEvent.objects.select_for_update().filter(
        pk=calendar_event_id,
    ).first()
    if calendar is None:
        raise ValueError(
            'The linked Calendar event is missing; review reconciliation is required.'
        )

    instance_id = curriculum_views.clean_str(instance_row.get('id'))
    if curriculum_views.clean_str(calendar.review_instance_id) != instance_id:
        raise ValueError(
            'The linked Calendar event does not point back to this Review Instance; '
            'review reconciliation is required.'
        )
    if str(calendar.learner_id) != str(instance_row.get('learner_id')):
        raise ValueError(
            'The linked Calendar event belongs to a different learner; '
            'review reconciliation is required.'
        )
    template_id = curriculum_views.clean_str(instance_row.get('review_template_id'))
    calendar_template_id = curriculum_views.clean_str(calendar.review_template_id)
    if template_id and calendar_template_id and template_id != calendar_template_id:
        raise ValueError(
            'The linked Calendar event has a different Review template; '
            'review reconciliation is required.'
        )
    coach_email = curriculum_views.clean_str(instance_row.get('coach_email')).lower()
    owner_email = curriculum_views.clean_str(calendar.owner_email).lower()
    if coach_email and owner_email and coach_email != owner_email:
        raise ValueError(
            'The linked Calendar event has a different coach; '
            'review reconciliation is required.'
        )

    if status == STATUS_AWAITING_SIGNATURE:
        allowed = {
            CoachCalendarEvent.STATUS_IN_PROGRESS,
            CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
        }
        if calendar.status not in allowed:
            raise ValueError(
                'The linked Calendar event cannot enter awaiting-signature from its '
                f'current status ({calendar.status}).'
            )
        if calendar.status != CoachCalendarEvent.STATUS_AWAITING_SIGNATURE:
            calendar.status = CoachCalendarEvent.STATUS_AWAITING_SIGNATURE
            calendar.save(update_fields=['status', 'updated_at'])
        return

    if status == STATUS_COMPLETED:
        allowed = {
            CoachCalendarEvent.STATUS_IN_PROGRESS,
            CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
            CoachCalendarEvent.STATUS_COMPLETED,
        }
        if calendar.status not in allowed:
            raise ValueError(
                'The linked Calendar event cannot enter completed from its '
                f'current status ({calendar.status}).'
            )
        calendar.status = CoachCalendarEvent.STATUS_COMPLETED
        calendar.review_completed_at = completed_at or datetime.utcnow()
        calendar.save(update_fields=['status', 'review_completed_at', 'updated_at'])


def record_review_instance_signature(instance_row, role, *, signed_by, signed_name, signature, actor='system'):
    """Record one party's sign-off and mirror its lifecycle status atomically."""
    if role not in SIGNATURE_ROLES:
        raise ValueError(f'Unknown signature role "{role}".')
    snapshot = curriculum_views.as_json_value(instance_row.get('definition_snapshot'), {})
    if not bool(snapshot.get('signatures', {}).get(role)):
        raise ValueError(f'This review does not require a "{role}" signature.')
    if instance_row.get('status') not in (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED):
        raise ValueError('This review must be finished before it can be signed.')

    with transaction.atomic():
        existing_rows = curriculum_views.fetch_all(
            f'select * from {curriculum_views.table_name(REVIEW_INSTANCE_SIGNATURES_TABLE)} '
            f'where review_instance_id = %s and role = %s',
            [instance_row.get('id'), role],
        )
        signed_at = datetime.utcnow() if signature else None
        payload = {
            'signed_by': signed_by or '', 'signed_name': signed_name or '',
            'signature': signature or '', 'signed_at': signed_at,
            'updated_at': datetime.utcnow(),
        }
        if existing_rows:
            curriculum_views.update_rows(
                REVIEW_INSTANCE_SIGNATURES_TABLE, 'id = %s', [existing_rows[0]['id']], payload,
                allow_null_columns=['signed_at'],
            )
        else:
            curriculum_views.insert_row(REVIEW_INSTANCE_SIGNATURES_TABLE, {
                'id': curriculum_views.unique_prefixed_id('REVIS'),
                'review_instance_id': instance_row.get('id'),
                'role': role,
                'created_at': datetime.utcnow(),
                **payload,
            })

        current_status = instance_row.get('status')
        if _all_required_signatures_present(instance_row.get('id'), snapshot):
            completed_at = datetime.utcnow()
            if current_status == STATUS_AWAITING_SIGNATURE:
                updated = curriculum_views.update_rows(
                    REVIEW_INSTANCES_TABLE,
                    'id = %s and status = %s',
                    [instance_row.get('id'), STATUS_AWAITING_SIGNATURE],
                    {
                        'status': STATUS_COMPLETED, 'completed_at': completed_at,
                        'updated_by': actor, 'updated_at': completed_at,
                    },
                )
                if not updated:
                    raise ValueError(
                        'This review status changed while the signature was being recorded. '
                        'Reload it and try again.'
                    )
                completed_at = updated[0].get('completed_at') or completed_at
            elif current_status != STATUS_COMPLETED:
                raise ValueError('This review must be awaiting signature before it can be completed.')
            _mirror_linked_calendar_after_signature(
                instance_row, status=STATUS_COMPLETED, completed_at=completed_at,
            )
        else:
            # A completed instance is terminal even if a legacy/concurrent
            # signature row is being backfilled. Keep its Calendar projection
            # completed instead of trying to regress it to awaiting-signature.
            if current_status == STATUS_COMPLETED:
                _mirror_linked_calendar_after_signature(
                    instance_row,
                    status=STATUS_COMPLETED,
                    completed_at=instance_row.get('completed_at'),
                )
            else:
                _mirror_linked_calendar_after_signature(
                    instance_row, status=STATUS_AWAITING_SIGNATURE,
                )

    return review_instance_form_definition(get_review_instance(instance_row.get('id')))


def _complete_review_instance_status_rejection(current_status):
    if current_status in (STATUS_NOT_SCHEDULED, STATUS_SCHEDULED):
        return 'This review cannot be completed until attendance has been confirmed for the scheduled Teams meeting.'
    if current_status == STATUS_AWAITING_SIGNATURE:
        return 'This review has already been submitted and is awaiting signature.'
    if current_status == STATUS_COMPLETED:
        return 'This review has already been completed.'
    return 'This review cannot be completed from its current status.'


def complete_review_instance(instance_row, *, actor='system'):
    """Finishes the form: validates every visible required field is
    answered, then moves the instance to Awaiting Signature (if the
    Curriculum template requires any signature) or straight to Completed (if
    it requires none). Returns (ok, errors).

    The only valid transition is in-progress -> awaiting-signature/completed
    (Phase 3). Completion is not a client-side button-visibility rule: this
    is the backend enforcement, so an API call cannot skip attendance by
    calling this directly. The DB write itself is guarded on the instance
    still being in-progress (an atomic compare-and-swap, not a read-then-
    write), so a concurrent completion attempt or an out-of-order request
    can't silently move the same instance twice or race a legitimate
    transition -- ``errors`` names the reason as ``{'fields': [...]}`` for
    unmet field requirements (as before), or ``{'status': [...]}`` for an
    invalid status transition, so callers can tell the two apart.
    """
    current_status = instance_row.get('status')
    if current_status != STATUS_IN_PROGRESS:
        return False, {'status': [_complete_review_instance_status_rejection(current_status)]}

    definition = review_instance_form_definition(instance_row)
    answers_by_field = get_review_instance_answers(instance_row.get('id'))
    missing_fields = _visible_required_unanswered_fields(definition['sections'], answers_by_field)
    if missing_fields:
        return False, {'fields': missing_fields}

    snapshot = curriculum_views.as_json_value(instance_row.get('definition_snapshot'), {})
    requires_signature = any(bool(snapshot.get('signatures', {}).get(role)) for role in SIGNATURE_ROLES)
    if requires_signature:
        updated = curriculum_views.update_rows(
            REVIEW_INSTANCES_TABLE, 'id = %s and status = %s',
            [instance_row.get('id'), STATUS_IN_PROGRESS],
            {'status': STATUS_AWAITING_SIGNATURE, 'updated_by': actor, 'updated_at': datetime.utcnow()},
        )
    else:
        updated = curriculum_views.update_rows(
            REVIEW_INSTANCES_TABLE, 'id = %s and status = %s',
            [instance_row.get('id'), STATUS_IN_PROGRESS],
            {
                'status': STATUS_COMPLETED, 'completed_at': datetime.utcnow(),
                'updated_by': actor, 'updated_at': datetime.utcnow(),
            },
        )
    if not updated:
        # Lost a race: something else (another completion attempt) moved this
        # instance off in-progress between the caller's read and this write.
        return False, {'status': ['This review is no longer in progress. Reload it and try again.']}
    return True, None
