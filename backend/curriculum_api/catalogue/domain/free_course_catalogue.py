"""Catalogue reconciliation decisions: stable values, ordering and archived totals."""
import hashlib
import json
from decimal import Decimal

class FreeCourseInUse(ValueError):
    """A removal the learner records refuse. Nothing has been written."""


def _comparable(value):
    """Normalise a stored or incoming value so equal content compares equal."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped[:1] in ('{', '['):
            try:
                return json.loads(stripped)
            except ValueError:
                return value
    return value


def _same(new, old):
    if new in (None, '') and old in (None, ''):
        return True  # an empty text column reads back as NULL or ''
    return _comparable(new) == _comparable(old)


def _jsonb_text(value):
    """``value`` as PostgreSQL prints jsonb: keys by length then bytes, ', ' and ': '."""
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda item: (len(item[0].encode('utf-8')), item[0].encode('utf-8')))
        return '{' + ', '.join(json.dumps(key, ensure_ascii=False) + ': ' + _jsonb_text(item)
                               for key, item in items) + '}'
    if isinstance(value, list):
        return '[' + ', '.join(_jsonb_text(item) for item in value) + ']'
    return json.dumps(value, ensure_ascii=False)


def _jsonb_md5(value):
    """md5(column::text) for the JSON ``value`` would hold once stored.

    A mismatch only ever costs a write of identical content (a number printed
    differently, say), never a missed change: equal hashes mean equal text.
    """
    return hashlib.md5(_jsonb_text(_comparable(value)).encode('utf-8')).hexdigest()


def _changed(new_row, old_row):
    if old_row is None:
        return True
    for key, value in new_row.items():
        if key == 'settings_json' and 'settings_md5' in old_row:
            if _jsonb_md5(value) != old_row['settings_md5']:
                return True
        elif not _same(value, old_row.get(key)):
            return True
    return False


def _plural(count, word, plural=None):
    return f'{count} {word if count == 1 else (plural or word + "s")}'


def _keep_stored_order(courses, weeks, stored_courses, stored_weeks, *, status_is_inactive):
    """Keep stored order and archived-week totals so an unchanged save writes nothing.

    * A stored course keeps its display_order; a new one goes after the rest.
    * A course's weeks keep their stored display_order while the client sends
      them in the stored sequence; once it reorders, adds or drops a week, that
      course's weeks are renumbered 0..n-1 (the order the client sent).
    * Archived weeks are not sent, but the stored course totals count them, so
      they are added back.
    """
    next_order = max((row.get('display_order') or 0 for row in stored_courses.values()), default=-1) + 1
    for course_id, course in courses.items():
        if course_id in stored_courses:
            course['display_order'] = stored_courses[course_id].get('display_order') or 0
        else:
            course['display_order'] = next_order
            next_order += 1

    by_course = {}
    for week in weeks:
        by_course.setdefault(week['course_id'], []).append(week)
    for course_id, course_weeks in by_course.items():
        live = sorted(
            (row for row in stored_weeks.values()
             if row.get('course_id') == course_id and not status_is_inactive(row.get('status'))),
            key=lambda row: (row.get('display_order') or 0, row.get('week_number') or 0, row['id']),
        )
        unchanged = [row['id'] for row in live] == [week['id'] for week in course_weeks]
        for index, week in enumerate(course_weeks):
            week['display_order'] = stored_weeks[week['id']].get('display_order') or 0 if unchanged else index

    for week in stored_weeks.values():
        course = courses.get(week.get('course_id'))
        if course and status_is_inactive(week.get('status')):
            course['week_count'] += 1
            course['component_count'] += week.get('component_count') or 0
            course['total_otjh'] = round(course['total_otjh'] + float(week.get('total_otjh') or 0), 2)
