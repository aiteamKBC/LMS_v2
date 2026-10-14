"""Read-only course placement and exact links to retained source materials.

These dates belong to My Learning, never to the reporting ledger or meetings.
"""
from collections import defaultdict
from html import unescape
import json
import re

from .subject_dates import MONTH, MONTHS, activity_schedule, apply_section_placement


def metadata(value):
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, dict) else {}


def section_schedule(title):
    title = unescape(str(title or '')).replace('\\', '/')
    schedule = activity_schedule(title, section_title=title)
    if schedule['date_source'] == 'undated':
        # A month heading supplies a month, not an invented delivery day.
        matches = re.findall(r'\b(' + MONTH + r')[\s,./-]+(20\d{2})\b', title, re.I)
        months = {f'{year}-{MONTHS[month.lower()]:02}' for month, year in matches}
        if len(months) == 1:
            schedule.update(month=months.pop(), date_source='section_month')
        elif months:
            schedule.update(date_source='section_needs_review', date_needs_review=True)
    return schedule


def read_export_placements(query, courses):
    if not courses:
        return []
    return query('''WITH exports AS (
        SELECT course_id, CASE WHEN jsonb_typeof(curriculum)='string'
            THEN (curriculum #>> '{}')::jsonb ELSE curriculum END AS payload
        FROM "MBA".course_curriculum WHERE course_id=ANY(%s))
        SELECT course_id,section->>'source_section_id' AS section_id,
            section->>'section_order' AS section_order,section->>'section_title' AS section_title,
            material->>'source_component_id' AS component_id,
            material->>'component_kind' AS component_kind,material->>'post_type' AS post_type
        FROM exports CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(payload->'sections')='array'
                THEN payload->'sections' ELSE '[]'::jsonb END) section
        LEFT JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(section->'materials')='array'
                THEN section->'materials' ELSE '[]'::jsonb END) material ON true''',
        [[int(course['source_course_ref']) for course in courses]])


def catalogue_display_context(definitions, exports):
    """Use typed source IDs inside the owned course, never title matching."""
    owned = {str(item['source_course_ref']) for item in definitions}
    sections, placements, section_refs = defaultdict(dict), defaultdict(list), defaultdict(list)
    for row in exports:
        course = str(row['course_id'])
        if course not in owned:
            continue
        section = (str(row.get('section_id') or ''), str(row.get('section_order') or ''),
                   unescape(str(row.get('section_title') or '')))
        sections[course][section] = section_schedule(section[2])
        if section[0] and section not in section_refs[(course, section[0])]:
            section_refs[(course, section[0])].append(section)
        kind = str(row.get('component_kind') or '').lower()
        post_type = str(row.get('post_type') or '').lower()
        kind = 'quiz' if kind == 'quiz' or post_type == 'stm-quizzes' else 'material' if kind == 'lesson' or post_type == 'stm-lessons' else None
        ident = str(row.get('component_id') or '')
        if kind and ident.isdigit():
            if section not in placements[(course, f'{kind}:{ident}')]:
                placements[(course, f'{kind}:{ident}')].append(section)

    introductions = set()
    for course, values in sections.items():
        # Duplicated/missing order cannot establish what preceded teaching.
        orders = [int(s[1]) for s in values if s[1].isdigit()]
        if len(orders) != len(values) or len(set(orders)) != len(orders):
            continue
        dated = [int(s[1]) for s, schedule in values.items() if schedule['month'] != 'undated']
        if dated:
            introductions.update((course, s) for s in values if int(s[1]) < min(dated)
                                 and values[s]['date_source'] in {'undated', 'introduction'})

    enriched = []
    for definition in definitions:
        item = dict(definition)
        course, ref = str(item['source_course_ref']), item['source_activity_id']
        matches = list(placements.get((course, ref), []))
        # The retained catalogue also records section membership directly.
        # Attached quizzes need not appear as standalone export materials.
        section_ref = str(item.get('source_section_ref') or '').strip()
        for section in section_refs.get((course, section_ref), []):
            if section not in matches:
                matches.append(section)
        payload = metadata(item.get('source_payload'))
        title = item.get('source_section_title') or payload.get('section_title') or ''
        if len(matches) == 1:
            section = matches[0]
            title = section[2]
            schedule = dict(sections[course][section])
            if (course, section) in introductions:
                schedule.update(date_source='introduction')
            apply_section_placement(schedule, int(course), section[0])
        elif len(matches) > 1:
            schedule = activity_schedule('')
            schedule.update(date_source='section_needs_review', date_needs_review=True)
        else:
            schedule = section_schedule(title)
        if schedule['date_source'] == 'undated':
            schedule = activity_schedule(item.get('source_activity_title'))
        if schedule['date_source'] == 'undated':
            schedule['date_needs_review'] = True
        item['_display_schedule'] = schedule
        item['source_section_title'] = title
        enriched.append(item)

    by_id = {(str(d['source_course_ref']), d['source_activity_id']): d for d in enriched}
    for item in enriched:
        course, ref = str(item['source_course_ref']), item['source_activity_id']
        if ref.startswith('quiz:'):
            quiz_id = ref.partition(':')[2]
            # Imported quizzes identify their parent by activity_id. Confirm
            # the inverse quiz_id link as well, in this exact owned course.
            payload = metadata(item.get('source_payload'))
            parent_id = str(payload.get('activity_id') or payload.get('parent_activity_id') or '')
            parent = by_id.get((course, f'material:{parent_id}'))
            if (parent_id.isdigit() and parent
                    and str(metadata(parent.get('source_payload')).get('quiz_id') or '') == quiz_id):
                parent_schedule = parent['_display_schedule']
                if (item['_display_schedule']['date_source'] == 'undated'
                        and parent_schedule['date_source'] != 'undated'
                        and not parent_schedule['date_needs_review']):
                    item['_display_schedule'] = dict(parent_schedule)
                    item['source_section_title'] = item['source_section_title'] or parent['source_section_title']
                if parent.get('material_available'):
                    item['source_material_activity_id'] = f'catalogue:{course}:material:{parent_id}'
    return enriched


def apply_catalogue_display(items, definitions):
    by_id = {f"catalogue:{d['source_course_ref']}:{d['source_activity_id']}": d for d in definitions}
    for item in items:
        definition = by_id[item['activity_id']]
        schedule = definition.get('_display_schedule')
        if schedule and (not item.get('month') or item.get('month') == 'undated'
                         or schedule['date_source'] in {'introduction', 'extra_activity'}):
            item.update(schedule)
        if definition.get('source_material_activity_id'):
            item['source_material_activity_id'] = definition['source_material_activity_id']
    return items
