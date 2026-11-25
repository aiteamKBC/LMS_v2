"""Validate exported course ownership and retain deterministic adoption identities."""
from collections import defaultdict
from curriculum_api.legacy_free_course_migration import adopted_id, course_payload


def import_payloads(export, *, free_programme_module_response):
    def index(rows, label):
        result = {row['id']: row for row in rows}
        if len(result) != len(rows) or any(not ident for ident in result):
            raise ValueError(f'Duplicate or missing {label} identity.')
        return result

    courses = index(export['courses'], 'course')
    links = index(export['week_links'], 'week link')
    weeks = index(export['weeks'], 'week')
    components = index(export['components'], 'component')
    by_link = defaultdict(list)
    for component in components.values():
        link = links.get(component['free_module_id'])
        if not link or component.get('week_id') != link.get('week_id'):
            raise ValueError('A component does not belong to its exported week.')
        by_link[link['id']].append(component)
    by_course = defaultdict(list)
    for link in links.values():
        week = weeks.get(link['week_id'])
        if link['course_id'] not in courses or not week or week.get('free_course_id') != link['course_id']:
            raise ValueError('A week does not belong to its exported course.')
        merged = {**link, 'week_number': week['week_number'], 'week_title': week['title']}
        response = free_programme_module_response(merged, by_link[link['id']], courses[link['course_id']])
        by_course[link['course_id']].append(response)
    result = []
    for course in courses.values():
        payload = course_payload(course, by_course[course['id']])
        source_by_native = {adopted_id('WEEK', course['id'], link['id']): weeks[link['week_id']]
                            for link in links.values() if link['course_id'] == course['id']}
        for week in payload['weekStructure']:
            source = source_by_native[week['id']]
            week.update(summary=source.get('summary') or '',
                        learningOutcomes=source.get('learning_outcomes') or [],
                        holidayNoteEnabled=bool(source.get('holiday_note_enabled')),
                        holidayNote=source.get('holiday_note') or '')
            # A branch-local copied_from_id may identify a template absent from
            # this database. Keep provenance in the export, not a dangling FK.
        result.append((course, payload))
    return result
