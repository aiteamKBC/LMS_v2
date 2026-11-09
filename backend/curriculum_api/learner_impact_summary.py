"""The programme card's "Learners" dialog, answered without the raw rows.

``/curriculum/programmes/<id>/learner-ksb-impact/`` returns every progress row
and every learner activity in the programme. For the largest programme that is
135k progress rows and 62k activities -- 187 MB of JSON, nearly all of it field
names repeated per row. The dialog reads eight of those fields to build one
line per learner and KSB code, so with ``?view=summary`` the server builds those
lines and sends them instead of the rows.

``learner_ksb_achievements`` is the dialog's own roll-up, moved here from the
page (it used to be ``learnerAchievementMap`` in programmes/page.tsx). There is
one implementation: the page now only reads what this returns.

Activity labels repeat across learners (every learner on a component shares its
title), so they are sent once in ``activityLabels`` and each line refers to them
by position.
"""
import math

SUMMARY_VIEW = 'summary'

# What the dialog reads from the full payload, kept as it is.
SUMMARY_KEPT_KEYS = (
    'scope', 'identifier', 'lineage', 'placementBasis', 'structure',
    'assignedLearnerCount', 'assignedLearners', 'learnerKsbConsumption',
    'otjhAchievement', 'ksbAchievement', 'ksbAchievementPolicy', 'learnerActivityCount',
)


def _text(value):
    """``String(value || '').trim()``."""
    return str(value or '').strip()


def _number(value):
    """``Number(value || 0)``: falsy is 0, anything unreadable is NaN."""
    if not value:
        return 0.0
    if isinstance(value, bool):
        return 1.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan


def _finite(value):
    return 0.0 if math.isnan(value) or math.isinf(value) else value


def learner_ksb_achievements(payload):
    """Achieved KSB weight per learner and code, plus that code's reflections.

    Achievement comes from ``consumptionSources.progress`` alone. Activities
    only annotate a line the progress rows created: actual OTJH, reflection text
    and declared weight, which is reported beside achieved weight, never in it.

    Returns ``(lines_by_learner, activity_labels)``.
    """
    labels, label_index = [], {}
    by_learner = {}

    def line_for(learner_key, code, create):
        lines = by_learner.get(learner_key)
        line = lines.get(code) if lines else None
        if line is not None or not create:
            return line
        line = {
            'code': code, 'count': 0, 'weight': 0.0, 'declaredWeight': 0.0,
            'actualOtjh': None, 'actualOtjhSource': 'not_returned',
            'plannedOtjh': None, 'plannedOtjhSource': 'not_returned',
            'activities': [], 'reflections': [],
        }
        by_learner.setdefault(learner_key, {})[code] = line
        return line

    progress = (payload.get('consumptionSources') or {}).get('progress') or []
    for source in progress:
        learner_key = _text(source.get('learnerId') or '')
        code = _text(source.get('code')).upper()
        if not learner_key or not code:
            continue
        line = line_for(learner_key, code, True)
        line['count'] += 1
        line['weight'] += _finite(_number(source.get('weight')))
        planned = source.get('plannedOtjh')
        if planned is not None:
            line['plannedOtjh'] = (line['plannedOtjh'] or 0) + _number(planned)
            line['plannedOtjhSource'] = _text(source.get('plannedOtjhSource')) or 'returned'
        label = ' - '.join(part for part in (
            _text(source.get('componentTitle')), _text(source.get('module')), _text(source.get('week')),
        ) if part)
        if label:
            index = label_index.get(label)
            if index is None:
                index = label_index[label] = len(labels)
                labels.append(label)
            if index not in line['activities']:
                line['activities'].append(index)

    for activity in payload.get('learnerActivities') or []:
        # ``String(activity.learnerId ?? '')``: nullish only, not falsy.
        learner_id = activity.get('learnerId')
        learner_key = '' if learner_id is None else str(learner_id).strip()
        if not learner_key:
            continue
        reflection = activity.get('reflection')
        text = _text(reflection.get('text')) if isinstance(reflection, dict) else ''
        actual = activity.get('actualOtjh')
        for item in activity.get('ksbSnapshot') or []:
            line = line_for(learner_key, _text(item.get('code')).upper(), False)
            if line is None:
                continue
            if actual is not None:
                line['actualOtjh'] = (line['actualOtjh'] or 0) + _number(actual)
                line['actualOtjhSource'] = _text(activity.get('actualOtjhSource')) or 'returned'
            if text and text not in line['reflections']:
                line['reflections'].append(text)
        for item in activity.get('declaredReflectionKsbs') or []:
            line = line_for(learner_key, _text(item.get('code')).upper(), False)
            if line is not None:
                line['declaredWeight'] += _number(item.get('weight'))

    lines_by_learner = {key: list(lines.values()) for key, lines in by_learner.items()}
    return lines_by_learner, labels


def _json_number(value):
    # NaN is not JSON; the page showed it as NaN text, the closest is null.
    return None if isinstance(value, float) and math.isnan(value) else value


def learner_impact_summary(payload):
    """The full impact payload reduced to what the Learners dialog draws."""
    lines_by_learner, labels = learner_ksb_achievements(payload)
    for lines in lines_by_learner.values():
        for line in lines:
            for key in ('weight', 'declaredWeight', 'actualOtjh', 'plannedOtjh'):
                line[key] = _json_number(line[key])
    summary = {key: payload[key] for key in SUMMARY_KEPT_KEYS if key in payload}
    summary['view'] = SUMMARY_VIEW
    summary['activityLabels'] = labels
    summary['learnerKsbAchievements'] = lines_by_learner
    return summary
