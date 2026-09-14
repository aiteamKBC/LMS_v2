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
OVERRIDES_TABLE = review_schedule.OCCURRENCE_OVERRIDES_TABLE

STATUS_NOT_SCHEDULED = 'not-scheduled'
STATUS_SCHEDULED = 'scheduled'
STATUS_IN_PROGRESS = 'in-progress'
STATUS_AWAITING_SIGNATURE = 'awaiting-signature'
STATUS_COMPLETED = 'completed'

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
                occurrence_number integer not null,
                target_date date not null,
                coach_email varchar(255) not null default '',
                calendar_event_id integer,
                definition_snapshot {json_type} not null,
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
            occurrences.append(occurrence)
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


def reconcile_review_event_keys(events, records):
    """Keep existing booking keys, matching legacy keys only when unambiguous."""
    by_identity = {}
    by_key = {record.event_key: record for record in records}
    legacy_candidates = {}
    for event in events:
        legacy_key = f"{event['source']}:{event['learnerId']}:{event['sequence']}:{event['targetDate']}"
        legacy_candidates.setdefault(legacy_key, []).append(event)
    for record in records:
        template_id = getattr(record, 'review_template_id', '')
        if template_id:
            identity = (str(record.learner_id), template_id, getattr(record, 'occurrence_number', None) or record.sequence)
            by_identity[identity] = record
    matched = {}
    for event in events:
        identity = (str(event['learnerId']), event.get('reviewTemplateId'), event['sequence'])
        record = by_identity.get(identity) or by_key.get(event['eventKey'])
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


def get_review_instance(instance_id):
    rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCES_TABLE)} where id = %s',
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
    coach_email='', actor='system',
):
    """Idempotent get-or-create for one learner's one occurrence.

    Identity is (review_template_id, learner_id, occurrence_number) -- see
    the unique index in the SQL migration. A repeated call (the caseload
    timetable is recomputed on every page load) always returns the same row
    rather than creating a duplicate.
    """
    ensure_review_instance_tables()
    review_template_id = template_row.get('id')
    existing = find_review_instance(review_template_id, learner_id, occurrence_number)
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
                'occurrence_number': occurrence_number,
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
            existing = find_review_instance(review_template_id, learner_id, occurrence_number)
            if existing:
                return existing
            raise
    return row


def set_review_instance_status(instance_id, status, *, actor='system', extra=None):
    payload = {'status': status, 'updated_by': actor, 'updated_at': datetime.utcnow(), **(extra or {})}
    rows = curriculum_views.update_rows(REVIEW_INSTANCES_TABLE, 'id = %s', [instance_id], payload)
    return rows[0] if rows else None


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

    return {
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

        if instance_row.get('status') == STATUS_NOT_SCHEDULED or not instance_row.get('started_at'):
            set_review_instance_status(
                instance_row.get('id'),
                STATUS_IN_PROGRESS,
                actor=actor,
                extra={'started_at': instance_row.get('started_at') or datetime.utcnow()},
            )

    return review_instance_form_definition(get_review_instance(instance_row.get('id')))


def _all_required_signatures_present(instance_id, snapshot):
    required_roles = [role for role in SIGNATURE_ROLES if bool(snapshot.get('signatures', {}).get(role))]
    if not required_roles:
        return True
    signatures_by_role = get_review_instance_signatures(instance_id)
    return all(signatures_by_role.get(role, {}).get('signed_at') for role in required_roles)


def record_review_instance_signature(instance_row, role, *, signed_by, signed_name, signature, actor='system'):
    """Records one party's sign-off. Existing preserved behaviour: signing is
    the LAST step, after the form itself is finished -- matching the current
    Coach flow (finish the form -> Awaiting Signature -> a party signs ->
    Completed), not a precondition of finishing the form. Once every
    signature this Review's Curriculum definition requires is present, the
    instance itself flips to Completed here.
    """
    if role not in SIGNATURE_ROLES:
        raise ValueError(f'Unknown signature role "{role}".')
    snapshot = curriculum_views.as_json_value(instance_row.get('definition_snapshot'), {})
    if not bool(snapshot.get('signatures', {}).get(role)):
        raise ValueError(f'This review does not require a "{role}" signature.')
    if instance_row.get('status') not in (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED):
        raise ValueError('This review must be finished before it can be signed.')

    existing_rows = curriculum_views.fetch_all(
        f'select * from {curriculum_views.table_name(REVIEW_INSTANCE_SIGNATURES_TABLE)} '
        f'where review_instance_id = %s and role = %s',
        [instance_row.get('id'), role],
    )
    payload = {
        'signed_by': signed_by or '', 'signed_name': signed_name or '',
        'signature': signature or '', 'signed_at': datetime.utcnow() if signature else None,
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

    if _all_required_signatures_present(instance_row.get('id'), snapshot):
        set_review_instance_status(
            instance_row.get('id'), STATUS_COMPLETED, actor=actor,
            extra={'completed_at': datetime.utcnow()},
        )
    return review_instance_form_definition(get_review_instance(instance_row.get('id')))


def complete_review_instance(instance_row, *, actor='system'):
    """Finishes the form: validates every visible required field is
    answered, then moves the instance to Awaiting Signature (if the
    Curriculum template requires any signature) or straight to Completed (if
    it requires none). Returns (ok, errors) -- errors only ever names unmet
    FIELD requirements; a still-outstanding signature is not a reason this
    call fails, it is the next step.
    """
    definition = review_instance_form_definition(instance_row)
    answers_by_field = get_review_instance_answers(instance_row.get('id'))
    missing_fields = _visible_required_unanswered_fields(definition['sections'], answers_by_field)
    if missing_fields:
        return False, {'fields': missing_fields}

    snapshot = curriculum_views.as_json_value(instance_row.get('definition_snapshot'), {})
    requires_signature = any(bool(snapshot.get('signatures', {}).get(role)) for role in SIGNATURE_ROLES)
    if requires_signature:
        set_review_instance_status(instance_row.get('id'), STATUS_AWAITING_SIGNATURE, actor=actor)
    else:
        set_review_instance_status(
            instance_row.get('id'), STATUS_COMPLETED, actor=actor,
            extra={'completed_at': datetime.utcnow()},
        )
    return True, None
