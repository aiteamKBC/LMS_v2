"""Module-level transfer credit. Never manufacture activity completion or hours."""
from collections import Counter
from copy import deepcopy


def eligible_pairs(imports, replacements, owned, assigned, transferred=()):
    links = {**imports, **replacements}
    uses = Counter(links.values())
    taken = {item['courseRef'] for item in transferred}
    return {current: old for current, old in links.items()
            if current.removeprefix('current:') in assigned and old in owned
            and uses[old] == 1 and old not in taken}


def record_courses(record):
    return {str(item.get('source_course_ref') or '')
            for bucket in ('sources', 'historical_components')
            for item in record.get(bucket, [])
            if item.get('source_system') == 'old_lms'}


def frozen_records(records, state, *, entry_ids=None):
    """Keep the request's old facts even when a later import changes the source.

    Current-LMS rows and other courses are untouched. Snapshots retain their
    original record identity, reporting dates and seconds; no credit row is added.
    """
    courses = {item['courseRef'].removeprefix('legacy:') for item in state.get('items', [])}
    snapshots = {str(record['id']): record for record in state.get('records', [])}
    allowed = None if entry_ids is None else {str(value) for value in entry_ids}
    result, seen = [], set()
    for record in records:
        key = str(record['id'])
        if key in snapshots:
            result.append(deepcopy(snapshots[key]))
            seen.add(key)
        elif record.get('source_system') == 'old_lms' and record_courses(record) & courses:
            continue
        else:
            result.append(record)
    result.extend(deepcopy(record) for key, record in snapshots.items()
                  if key not in seen and (allowed is None or key in allowed))
    return result


def public_item(item):
    return {key: item[key] for key in ('courseRef', 'moduleId', 'oldTitle', 'newTitle', 'percent', 'hours')}


def credited_percent(item, completed_ids, total):
    baseline = set(item.get('baselineCompletedIds', []))
    newly_completed = len(set(completed_ids) - baseline)
    start = max(float(item['percent']), float(item.get('baselinePercent', 0)))
    return round(min(100, start + (100 * newly_completed / total if total else 0)), 2)
