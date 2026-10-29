"""New teaching weeks on an assigned import, without transferring old progress.

The owned source catalogue keeps its activities. Only dated Builder additions
after its last retained teaching date may extend the same proven import.
"""
from collections import Counter
from datetime import date


TEACHING_SOURCES = {'title', 'section_title', 'builder_section_title', 'builder_session', 'builder_week'}


def teaching_date(schedule):
    schedule = schedule or {}
    if schedule.get('date_needs_review') or schedule.get('date_source') not in TEACHING_SOURCES:
        return ''
    try:
        return date.fromisoformat(str(schedule.get('date') or '')[:10]).isoformat()
    except ValueError:
        return ''


def continuation_cutoffs(metadata, owned_activities):
    imports = metadata.get('imported_courses') or {}
    links = {**imports, **(metadata.get('replacement_courses') or {})}
    uses = Counter(links.values())
    frozen = {item.get('courseRef') for item in metadata.get('progress_transfers', [])}
    result = {}
    for ref, old in imports.items():
        if not ref.startswith('current:') or old not in owned_activities or uses[old] != 1 or old in frozen:
            continue
        dates = []
        for item in owned_activities[old]:
            schedule = item.get('schedule', item)
            if 'schedule' in item and not schedule and item.get('title'):
                # Search skips the exported placement expansion. Explicit
                # teaching dates in retained titles remain authoritative.
                from .subject_dates import activity_schedule
                schedule = activity_schedule(item['title'], section_title=item.get('section_title'))
            dates.append(teaching_date(schedule))
        cutoff = max(dates, default='')
        if cutoff:
            result[ref] = {'courseRef': old, 'afterDate': cutoff}
    return result


def continuation_components(metadata, owned_activities, components, schedules):
    result = {}
    for ref, cutoff in continuation_cutoffs(metadata, owned_activities).items():
        ids = [str(c['componentId']) for c in components
               if c.get('componentId') and c.get('moduleId') == ref[8:] and not c.get('retired')
               and teaching_date(schedules.get(c['componentId'])) > cutoff['afterDate']]
        if ids:
            result[ref] = {**cutoff, 'componentIds': list(dict.fromkeys(ids))}
    return result
