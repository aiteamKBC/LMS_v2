"""Programme and learner-scoped occurrence reads and composition."""
from __future__ import annotations

from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.review_management.domain.instance_rules import OCCURRENCE_SOURCE_GENERATED
from curriculum_api.review_management.domain.instance_rules import OCCURRENCE_SOURCE_MANUAL
from curriculum_api.review_management.infrastructure.instance_rows import _fetch_learner_scoped_overrides
from curriculum_api.review_management.infrastructure.instance_rows import _fetch_learner_scoped_overrides_for_reviews
from curriculum_api.review_management.domain.recurrence import add_calendar_months
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.domain.values import clean_str
from datetime import date
from datetime import datetime
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.review_management.domain.recurrence import generate_occurrence_steps
from curriculum_api.review_management.infrastructure.template_rows import get_review_template_rows
from curriculum_api.review_management.infrastructure.type_rows import get_review_type_by_code
from curriculum_api.review_management.domain.instance_rules import learner_is_eligible
from curriculum_api.review_management.infrastructure.instance_rows import list_active_learner_review_additions
import logging
from curriculum_api.review_management.domain.recurrence import recurrence_label
from curriculum_api.review_management.infrastructure.type_rows import review_type_index
from curriculum_api.review_management.domain.instance_rules import template_recurrence_config
from datetime import timedelta


logger = logging.getLogger('curriculum_api.review_instances')


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
    type_row = get_review_type_by_code(review_type_code)
    if not type_row:
        return None
    rows = get_review_template_rows(
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
    return get_review_template_rows(
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
    type_index = review_type_index()

    applicable_templates = [
        template_row for template_row in template_cache[programme_id]
        if review_applies_to_placement(template_row, learner_scope)
    ]
    templates_by_id = {template_row.get('id'): template_row for template_row in applicable_templates}
    # Overrides used to be fetched once per template. A programme with four
    # Review templates therefore paid four network round-trips on every Coach
    # and Learner calendar read. Fetch the same rows in one bounded query and
    # hand each template only its own slice.
    overrides_by_review = _fetch_learner_scoped_overrides_for_reviews(
        templates_by_id, learner_id,
    )

    occurrences = []
    for template_row in applicable_templates:
        type_row = type_index.get(clean_str(template_row.get('review_type_id')))
        for occurrence in resolve_learner_occurrences(
            template_row, learner_id, learner_status, learner_start_date, window_start, window_end,
            overrides_by_date=overrides_by_review.get(template_row.get('id'), {}),
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
            occurrence['reviewTypeId'] = clean_str(template_row.get('review_type_id'))
            occurrence['reviewTypeCode'] = clean_str((type_row or {}).get('code'))
            occurrence['reviewTypeName'] = clean_str((type_row or {}).get('name'))
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
        type_index = review_type_index()

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
            target_date = date.fromisoformat(clean_str(raw_target_date)[:10])
        if window_start and target_date < window_start:
            continue
        if window_end and target_date > window_end:
            continue
        type_row = type_index.get(clean_str(template_row.get('review_type_id')))
        occurrences.append({
            'reviewTemplateId': template_row.get('id'),
            'reviewName': template_row.get('name') or '',
            'occurrenceNumber': None,
            'targetDate': target_date,
            'recurrenceLabel': 'Additional review',
            'reviewTypeId': clean_str(template_row.get('review_type_id')),
            'reviewTypeCode': clean_str((type_row or {}).get('code')),
            'reviewTypeName': clean_str((type_row or {}).get('name')),
            'reviewTypeIsSystem': bool((type_row or {}).get('is_system')),
            'occurrenceSource': OCCURRENCE_SOURCE_MANUAL,
            'occurrenceRef': f'{OCCURRENCE_SOURCE_MANUAL}:{addition.get("id")}',
            'additionId': addition.get('id'),
            'reasonCode': clean_str(addition.get('reason_code')),
            'reason': clean_str(addition.get('reason')),
        })
    return occurrences


def review_applies_to_placement(template_row, learner_scope=None):
    applicability = as_json_value(template_row.get('applicability'), {})
    scope = applicability.get('scope', 'programme')
    if scope == 'programme':
        return True
    if scope not in ('cohort', 'group') or not learner_scope:
        return False
    identifiers = set(applicability.get('ids') or [])
    placement_id = clean_str(learner_scope.get(f'{scope}_id'))
    if placement_id:
        return placement_id in identifiers
    # Older learner mirrors carry names only. Resolve within this programme,
    # and within the cohort for groups; ambiguous names never grant access.
    table = COHORT_AUTHORING_DETAILS_TABLE if scope == 'cohort' else GROUPS_TABLE
    if '_placement_rows' not in template_row:
        template_row['_placement_rows'] = authoring_fetch_all(
            table, 'programme_id = %s', [template_row['programme_id']],
        )
    name = clean_str(learner_scope.get(scope)).casefold()
    if not name:
        return False
    matches = []
    for row in template_row['_placement_rows']:
        if clean_str(row.get(f'{scope}_name')).casefold() != name:
            continue
        if scope == 'group':
            cohort_id = clean_str(learner_scope.get('cohort_id'))
            cohort_name = clean_str(learner_scope.get('cohort')).casefold()
            if cohort_id and clean_str(row.get('cohort_id')) != cohort_id:
                continue
            if not cohort_id and (not cohort_name or clean_str(row.get('cohort_name')).casefold() != cohort_name):
                continue
        matches.append(clean_str(row.get(f'{scope}_id')))
    return len(matches) == 1 and matches[0] in identifiers


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
    type_index = review_type_index()
    identifiers = []
    for template_row in template_cache[programme_id]:
        type_row = type_index.get(clean_str(template_row.get('review_type_id')))
        identifiers.append((
            template_row.get('id'),
            clean_str((type_row or {}).get('code')) or None,
        ))
    return identifiers


def resolve_learner_occurrences(
    template_row, learner_id, learner_status, learner_start_date, window_start, window_end,
    *, overrides_by_date=None,
):
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
    if overrides_by_date is None:
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
        virtual_anchor = add_calendar_months(learner_start_date, interval)
    else:
        step_days = interval * (7 if unit == 'weeks' else 1)
        virtual_anchor = learner_start_date + timedelta(days=step_days)

    steps = generate_occurrence_steps(
        virtual_anchor, interval, unit,
        window_start, window_end, occurrence_limit=recurrence['occurrenceLimit'],
    )

    occurrences = []
    for occurrence_number, occurrence_date in steps:
        if format_date(occurrence_date) in overrides_by_date:
            continue
        occurrences.append({
            'reviewTemplateId': review_id,
            'reviewName': template_row.get('name') or '',
            'occurrenceNumber': occurrence_number,
            'targetDate': occurrence_date,
            'recurrenceLabel': recurrence_label(recurrence['interval'], recurrence['unit']),
        })
    return occurrences
