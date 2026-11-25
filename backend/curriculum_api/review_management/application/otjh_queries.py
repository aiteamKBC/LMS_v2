"""Read-only review OTJH projections using the existing occurrence/read owners.

Planned hours sum raw due occurrences; actual hours sum completed instances.
Both use the live template's counts_towards_otjh gate and expected_otjh value.
Saved form snapshots remain authoritative for signed answers, not hours values.

The existing availability behavior is preserved: template/instance read failures
are logged and produce no hours; failed occurrence reads omit that template.
These fallbacks do not distinguish unavailable totals from a real zero.
"""
from __future__ import annotations

import logging

from curriculum_api.catalogue.domain.values import clean_str, format_date
from ..domain.instance_rules import STATUS_COMPLETED
from ..domain.otjh_rules import template_otjh_hours
from ..infrastructure.instance_rows import list_review_instances_for_learner
from ..infrastructure.template_rows import get_review_template_row
from .learner_occurrences import list_enabled_review_templates, resolve_learner_occurrences

logger = logging.getLogger("curriculum_api.review_otjh")


def otjh_template_rows(programme_id):
    """The programme's enabled, OTJH-bearing Review templates.

    Filtered in Python rather than SQL because ``counts_towards_otjh`` and
    ``expected_otjh`` are provisioned by a later migration than the table
    itself -- an older database that has not run it yet returns rows without
    those keys, which must read as "contributes nothing", not blow up.
    """
    if not programme_id:
        return []
    return [
        template_row
        for template_row in list_enabled_review_templates(programme_id)
        if template_otjh_hours(template_row) > 0
    ]


def planned_hours(
    programme_id,
    learner_id,
    learner_status,
    learner_start_date,
    window_start,
    window_end,
    *,
    template_cache=None,
):
    """Forecast OTJ hours from every Review occurrence due in the window.

    A raw projection -- see ``resolve_learner_occurrences``. Asking twice for
    the same window returns the same answer and creates nothing, so this is
    safe to call on every page render.
    """
    meetings = planned_meetings(
        programme_id, learner_id, learner_status, learner_start_date,
        window_start, window_end, template_cache=template_cache,
    )
    return round(sum(meeting['hours'] for meeting in meetings), 2)


def planned_meetings(
    programme_id,
    learner_id,
    learner_status,
    learner_start_date,
    window_start,
    window_end,
    *,
    template_cache=None,
):
    """One row per OTJH-bearing Review template, for display beside a plan.

    Same projection ``planned_hours`` sums, kept itemised so a reader can see
    WHERE the hours come from -- a total that rises with no visible cause is
    worse than no total. Each row carries the template's own name (read live,
    never frozen: renaming a Review in Curriculum must rename it here), what
    one occurrence is worth, how many fall in the window, and the product.

    Templates that produce no occurrence in the window are omitted rather than
    listed as zero: they are not part of this learner's plan.
    """
    if not programme_id or not learner_start_date:
        return []

    if template_cache is None:
        template_cache = {}
    cache_key = f'otjh:{programme_id}'
    try:
        if cache_key not in template_cache:
            template_cache[cache_key] = otjh_template_rows(programme_id)
        template_rows = template_cache[cache_key]
    except Exception as exc:
        logger.warning('Could not load OTJH review templates for programme %s: %s', programme_id, exc)
        return []

    meetings = []
    for template_row in template_rows:
        hours = template_otjh_hours(template_row)
        try:
            occurrences = resolve_learner_occurrences(
                template_row, learner_id, learner_status, learner_start_date,
                window_start, window_end,
            )
        except Exception as exc:
            logger.warning(
                'Could not resolve review occurrences for OTJH (template=%s learner=%s): %s',
                template_row.get('id'), learner_id, exc,
            )
            continue
        if not occurrences:
            continue
        dates = sorted(
            format_date(occurrence['targetDate'])
            for occurrence in occurrences
        )
        meetings.append({
            'reviewTemplateId': template_row.get('id'),
            'name': clean_str(template_row.get('name')),
            'hoursEach': hours,
            'occurrences': len(occurrences),
            'hours': round(hours * len(occurrences), 2),
            'recurrenceLabel': clean_str(
                occurrences[0].get('recurrenceLabel')
            ),
            # The window this projection actually covers, so the plan can show
            # the same start/end columns it shows for a module.
            'startDate': dates[0],
            'endDate': dates[-1],
        })
    return meetings


def completed_hours(learner_id, *, window_start=None, window_end=None):
    """Banked OTJ hours from this learner's COMPLETED Review Instances.

    Read against the live template, not the instance's ``definition_snapshot``:
    the snapshot freezes a review's FORM so history stays honest, while what a
    review is worth in hours is a curriculum-wide figure a coach may correct
    after the fact. Correcting it must fix every learner's total, the same way
    editing a component's ``expected_otjh`` does.
    """
    if not learner_id:
        return 0.0

    try:
        instances = list_review_instances_for_learner(
            learner_id, window_start=window_start, window_end=window_end,
        )
    except Exception as exc:
        logger.warning('Could not load review instances for OTJH (learner=%s): %s', learner_id, exc)
        return 0.0

    completed = [
        instance for instance in instances
        if clean_str(instance.get('status')) == STATUS_COMPLETED
    ]
    if not completed:
        return 0.0

    hours_by_template: dict[str, float] = {}
    total = 0.0
    for instance in completed:
        template_id = clean_str(instance.get('review_template_id'))
        if not template_id:
            continue
        if template_id not in hours_by_template:
            try:
                template_row = get_review_template_row(template_id, include_deleted=True)
            except Exception as exc:
                logger.warning('Could not load review template %s for OTJH: %s', template_id, exc)
                template_row = None
            hours_by_template[template_id] = template_otjh_hours(template_row)
        total += hours_by_template[template_id]
    return round(total, 2)
