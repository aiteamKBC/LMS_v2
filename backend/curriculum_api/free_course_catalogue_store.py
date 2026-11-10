"""Free-course catalogue save for the self-contained schema (the new database).

On the new database a free course is three tables of its own::

    curriculum.free_courses.id
      -> curriculum.free_course_weeks.course_id          (ON DELETE RESTRICT)
         -> curriculum.free_programme_components.free_module_id   (RESTRICT)

and learner records point into them: ``Learner.learner_free_courses`` at the
course, ``Learner.learner_free_course_progress`` at the course and the
component (both RESTRICT). A week stores its own title, summary, learning
outcomes and status; there is no ``curriculum.weeks`` mirror any more.

The legacy save (``views.save_free_programme_modules``) deleted every row and
inserted it again, and mirrored each week into ``curriculum.weeks``. Here that
cannot work -- the mirror write breaks the weeks->modules key, and the delete is
refused as soon as one learner holds an assignment or a completion -- so this
save compares the incoming catalogue with what is stored and:

* keeps every stored id (course, week and component) the client sends back;
* writes only the rows that changed, one batched statement per table;
* deletes only what was removed, and refuses (FreeCourseInUse) to remove a
  course that learners are assigned to, or an activity a learner completed;
* leaves archived (inactive) weeks and their activities alone -- the catalogue
  does not show them, so their absence from a save is not a removal.
"""
import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal

from django.db import connection, transaction

from . import schema_compat
from .course_pricing import pricing_values

COURSE_ID = re.compile(r'^FREECOURSE-[A-Za-z0-9][A-Za-z0-9_-]*$')
WEEK_ID = re.compile(r'^(?:FREEWEEK|FREEWLINK)-[A-Za-z0-9][A-Za-z0-9_-]*$')
JSON_COLUMNS = frozenset({'settings_json', 'learning_outcomes'})
BATCH_ROWS = 200

# is_for_sale / price / currency: a free course's sale metadata lives on its
# own row (free_course_pricing); the catalogue save keeps or sets it per course.
COURSE_COLUMNS = ('id', 'course_name', 'description', 'cover_image_url', 'display_order',
                  'week_count', 'component_count', 'total_otjh', 'is_for_sale', 'price', 'currency')
WEEK_COLUMNS = ('id', 'course_id', 'week_number', 'title', 'summary', 'learning_outcomes', 'status',
                'holiday_note_enabled', 'display_order', 'component_count', 'total_otjh')
COMPONENT_COLUMNS = ('id', 'free_module_id', 'programme_id', 'type', 'title', 'description', 'expected_otjh',
                     'points', 'reflection_required', 'workplace_evidence_required',
                     'tutor_validation_required', 'display_order', 'settings_json')


class FreeCourseInUse(ValueError):
    """A removal the learner records refuse. Nothing has been written."""


def applies():
    """True on the self-contained free-course schema (see module docstring)."""
    from . import views
    if connection.vendor != 'postgresql':
        return False
    return schema_compat.free_weeks_self_contained(views.column_names(views.FREE_PROGRAMME_MODULES_TABLE))


def _views():
    from . import views
    return views


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


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


def _bulk_upsert(table, rows, columns):
    """Insert-or-update ``rows`` in batches of one statement each.

    ``created_at`` is set only on insert; ``updated_at`` on every write.
    Columns the table does not have are dropped.
    """
    if not rows:
        return
    views = _views()
    present = set(views.column_names(table))
    names = [column for column in columns if column in present]
    stamp = datetime.utcnow()
    insert_names = [*names, 'updated_at', 'created_at']
    row_sql = '(' + ', '.join(
        '%s::jsonb' if name in JSON_COLUMNS else '%s' for name in insert_names
    ) + ')'
    updates = ', '.join(f'{_quote(name)} = excluded.{_quote(name)}' for name in [*names, 'updated_at'] if name != 'id')
    target = views.authoring_table_name(table)
    for start in range(0, len(rows), BATCH_ROWS):
        batch = rows[start:start + BATCH_ROWS]
        params = []
        for row in batch:
            params.extend([row.get(name) for name in names])
            params.extend([stamp, stamp])
        sql = (
            f'insert into {target} ({", ".join(_quote(name) for name in insert_names)}) '
            f'values {", ".join([row_sql] * len(batch))} '
            f'on conflict ("id") do update set {updates}'
        )
        with connection.cursor() as cursor:
            cursor.execute(sql, params)


def _delete_ids(table, column, ids):
    if not ids:
        return
    with connection.cursor() as cursor:
        cursor.execute(
            f'delete from {_views().authoring_table_name(table)} where {_quote(column)} = any(%s)',
            [list(ids)],
        )


def _rows(sql, params):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        columns = [column.name for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _rows_many(queries):
    """Parameterless SELECTs sent as one multi-statement query; one row list each."""
    results = []
    with connection.cursor() as cursor:
        cursor.execute('; '.join(queries))
        while True:
            columns = [column.name for column in cursor.description]
            results.append([dict(zip(columns, row)) for row in cursor.fetchall()])
            if not cursor.nextset():
                break
    if len(results) != len(queries):
        raise RuntimeError(f'Expected {len(queries)} result sets, got {len(results)}.')
    return results


def _plural(count, word, plural=None):
    return f'{count} {word if count == 1 else (plural or word + "s")}'


def refuse_in_use(course_ids=(), component_ids=(), course_names=None, component_titles=None):
    """Raise FreeCourseInUse when learner records still point at these rows."""
    course_ids = sorted({value for value in course_ids if value})
    component_ids = sorted({value for value in component_ids if value})
    course_names = course_names or {}
    component_titles = component_titles or {}
    problems = []
    if course_ids:
        for row in _rows(
            'select free_course_ref as id, count(distinct learner_id) as learners '
            'from "Learner"."learner_free_courses" where free_course_ref = any(%s) group by 1 order by 1',
            [course_ids],
        ):
            name = course_names.get(row['id']) or row['id']
            problems.append(f'"{name}" is assigned to {_plural(row["learners"], "learner")}; '
                            'remove it from their learning plans first.')
    progress_sql = (
        'select {key} as id, count(distinct learner_id) as learners '
        'from "Learner"."learner_free_course_progress" where {key} = any(%s) group by 1 order by 1'
    )
    if course_ids:
        for row in _rows(progress_sql.format(key='free_course_ref'), [course_ids]):
            name = course_names.get(row['id']) or row['id']
            problems.append(f'"{name}" has completed activities from {_plural(row["learners"], "learner")}, '
                            'and their completion history cannot be deleted.')
    if component_ids:
        completed = _rows(progress_sql.format(key='component_ref'), [component_ids])
        if completed:
            titles = [f'"{component_titles.get(row["id"]) or row["id"]}"' for row in completed[:5]]
            more = f' and {len(completed) - 5} more' if len(completed) > 5 else ''
            problems.append(f'{_plural(len(completed), "activity", "activities")} that learners have completed cannot be '
                            f'removed: {", ".join(titles)}{more}. Keep them in the course.')
    if problems:
        raise FreeCourseInUse('This change was not saved. ' + ' '.join(problems))


def _resolve_week_id(module, course_id, stored_weeks, used):
    """Keep the stored week this entry names, else a well-formed requested id, else mint."""
    views = _views()
    candidates = [views.clean_str(module.get(key)) for key in ('id', 'moduleId', 'weekId', 'week_id')]
    for candidate in candidates:
        stored = stored_weeks.get(candidate)
        if candidate and candidate not in used and stored and stored.get('course_id') == course_id:
            return candidate
    requested = candidates[0] or candidates[1]
    if requested and WEEK_ID.match(requested) and requested not in used and requested not in stored_weeks:
        return requested
    return views.unique_timestamp_prefixed_id('FREEWEEK', [*stored_weeks, *used])


def _keep_stored_order(courses, weeks, stored_courses, stored_weeks):
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
             if row.get('course_id') == course_id and not schema_compat.status_is_inactive(row.get('status'))),
            key=lambda row: (row.get('display_order') or 0, row.get('week_number') or 0, row['id']),
        )
        unchanged = [row['id'] for row in live] == [week['id'] for week in course_weeks]
        for index, week in enumerate(course_weeks):
            week['display_order'] = stored_weeks[week['id']].get('display_order') or 0 if unchanged else index

    for week in stored_weeks.values():
        course = courses.get(week.get('course_id'))
        if course and schema_compat.status_is_inactive(week.get('status')):
            course['week_count'] += 1
            course['component_count'] += week.get('component_count') or 0
            course['total_otjh'] = round(course['total_otjh'] + float(week.get('total_otjh') or 0), 2)


def save_catalogue(programme_id, modules):
    """Save the whole free-course catalogue the client sent (see module docstring)."""
    with transaction.atomic():
        _save_catalogue(programme_id, modules)


def _save_catalogue(programme_id, modules):
    views = _views()
    programme_id = views.clean_str(programme_id)

    # The stored catalogue, read in one round trip (three result sets).
    course_rows, week_rows, component_rows = _rows_many([
        f'select {", ".join(COURSE_COLUMNS)} from {views.authoring_table_name(views.FREE_COURSES_TABLE)}',
        f'select {", ".join(WEEK_COLUMNS)} from {views.authoring_table_name(views.FREE_PROGRAMME_MODULES_TABLE)}',
        # settings_json is most of the catalogue's bytes (reading text): the
        # snapshot takes its hash, which is all the change check needs.
        f'select {", ".join(column for column in COMPONENT_COLUMNS if column != "settings_json")}, '
        f'md5(settings_json::text) as settings_md5 '
        f'from {views.authoring_table_name(views.FREE_PROGRAMME_COMPONENTS_TABLE)}',
    ])
    stored_courses = {row['id']: row for row in course_rows}
    stored_weeks = {row['id']: row for row in week_rows}
    stored_components = {row['id']: row for row in component_rows}

    courses, weeks, components = {}, [], []
    course_ids_by_key = {}
    used_week_ids, used_component_ids = set(), set()
    stored_cover_urls = {}
    for module_index, module in enumerate(modules):
        if not isinstance(module, dict):
            continue
        course_name = views.clean_str(module.get('courseName') or module.get('course_name')
                                      or module.get('title') or module.get('name'))
        description = views.clean_str(module.get('description') or '')
        raw_cover = views.clean_str(module.get('coverImageUrl') or module.get('cover_image_url') or '')
        requested_course = views.clean_str(module.get('courseId') or module.get('course_id'))
        if requested_course and (requested_course in stored_courses or COURSE_ID.match(requested_course)):
            course_id = requested_course
        else:
            key = (course_name, description, raw_cover)
            if key not in course_ids_by_key:
                course_ids_by_key[key] = views.unique_timestamp_prefixed_id(
                    'FREECOURSE', [*stored_courses, *courses, *course_ids_by_key.values()])
            course_id = course_ids_by_key[key]

        if course_id not in courses:
            cover_key = (course_id, raw_cover)
            if cover_key not in stored_cover_urls:
                stored_cover_urls[cover_key] = views.stored_module_cover_image(course_id, raw_cover)
            # Omitted sale values keep the stored ones (course_pricing.pricing_values).
            try:
                sale = pricing_values(module, stored_courses.get(course_id) or {})
            except ValueError as error:
                raise ValueError(f'{course_name or "Free course"}: {error.args[1]}') from error
            courses[course_id] = {
                'id': course_id,
                'course_name': course_name or f'Free course {len(courses) + 1}',
                'description': description,
                'cover_image_url': stored_cover_urls[cover_key],
                'display_order': len(courses),
                'week_count': 0,
                'component_count': 0,
                'total_otjh': 0.0,
                **sale,
            }
        course = courses[course_id]

        week_id = _resolve_week_id(module, course_id, stored_weeks, used_week_ids)
        used_week_ids.add(week_id)
        stored_week = stored_weeks.get(week_id) or {}
        structure = module.get('weekStructure') if isinstance(module.get('weekStructure'), list) else module.get('weeks')
        week_input = next((item for item in structure if isinstance(item, dict)), {}) if isinstance(structure, list) else {}
        week_number = max(1, views.parse_int(module.get('weekNumber') or module.get('week_number')
                                             or week_input.get('weekNumber'), module_index + 1))
        week_title = views.clean_str(module.get('weekTitle') or module.get('week_title') or week_input.get('title')
                                     or stored_week.get('title') or course['course_name'] or f'Week {week_number}')
        # The catalogue screen sends no per-week summary or outcomes: keep the
        # stored ones unless this entry carries its own.
        summary = week_input.get('summary') if 'summary' in week_input else stored_week.get('summary')
        outcomes = week_input.get('learningOutcomes', week_input.get('learning_outcomes'))
        if outcomes is None:
            outcomes = _comparable(stored_week.get('learning_outcomes')) or []

        week_components = views.active_components_payload(
            module.get('components') if isinstance(module.get('components'), list) else [])
        minutes = 0
        for component_index, component in enumerate(week_components):
            payload = views.free_programme_component_payload(component, component_index)
            if not payload:
                continue
            if payload['id'] in used_component_ids:
                payload['id'] = views.canonical_authoring_id('FREECOMP')
            used_component_ids.add(payload['id'])
            minutes += views.component_expected_otjh_minutes(component)
            components.append({**payload, 'free_module_id': week_id, 'programme_id': programme_id})
        total_otjh = round(float(views.otjh_hours_from_minutes(minutes) or 0), 2)
        component_count = sum(1 for row in components if row['free_module_id'] == week_id)

        weeks.append({
            'id': week_id,
            'course_id': course_id,
            'week_number': week_number,
            'title': week_title,
            'summary': summary,
            'learning_outcomes': json.dumps(outcomes if isinstance(outcomes, list) else []),
            'status': stored_week.get('status') or schema_compat.ACTIVE,
            'holiday_note_enabled': bool(stored_week.get('holiday_note_enabled')),
            'display_order': module_index,
            'component_count': component_count,
            'total_otjh': total_otjh,
        })
        course['week_count'] += 1
        course['component_count'] += component_count
        course['total_otjh'] = round(course['total_otjh'] + total_otjh, 2)

    _keep_stored_order(courses, weeks, stored_courses, stored_weeks)

    # Owned = this programme's stored rows. A course is this programme's when
    # none of its activities belong to another programme.
    foreign_weeks = {row['free_module_id'] for row in stored_components.values()
                     if row.get('programme_id') != programme_id}
    foreign_courses = {stored_weeks[week]['course_id'] for week in foreign_weeks if week in stored_weeks}
    removed_courses = {course for course in stored_courses if course not in courses and course not in foreign_courses}
    incoming_weeks = {row['id'] for row in weeks}
    archived = {week for week, row in stored_weeks.items() if schema_compat.status_is_inactive(row.get('status'))}
    removed_weeks = {
        week for week, row in stored_weeks.items()
        if week not in incoming_weeks and week not in foreign_weeks
        and (row.get('course_id') in removed_courses or week not in archived)
    }
    incoming_components = {row['id'] for row in components}
    removed_components = {
        component for component, row in stored_components.items()
        if row.get('programme_id') == programme_id and component not in incoming_components
        and (row.get('free_module_id') in removed_weeks or row.get('free_module_id') not in archived)
    }
    refuse_in_use(
        removed_courses,
        # An activity of a refused course is already reported with its course.
        [component for component in removed_components
         if stored_weeks.get(stored_components[component].get('free_module_id'), {}).get('course_id')
         not in removed_courses],
        course_names={key: row.get('course_name') for key, row in stored_courses.items()},
        component_titles={key: row.get('title') for key, row in stored_components.items()},
    )

    # Parents before children on write, children before parents on delete: a
    # moved activity lands on its new week before its old week goes.
    _bulk_upsert(views.FREE_COURSES_TABLE,
                 [row for row in courses.values() if _changed(row, stored_courses.get(row['id']))], COURSE_COLUMNS)
    _bulk_upsert(views.FREE_PROGRAMME_MODULES_TABLE,
                 [row for row in weeks if _changed(row, stored_weeks.get(row['id']))], WEEK_COLUMNS)
    _bulk_upsert(views.FREE_PROGRAMME_COMPONENTS_TABLE,
                 [row for row in components if _changed(row, stored_components.get(row['id']))], COMPONENT_COLUMNS)
    _delete_ids(views.FREE_PROGRAMME_COMPONENTS_TABLE, 'id', removed_components)
    _delete_ids(views.FREE_PROGRAMME_MODULES_TABLE, 'id', removed_weeks)
    _delete_ids(views.FREE_COURSES_TABLE, 'id', removed_courses)


def delete_course(course_id):
    """Delete one free course (the "move" conversion) on the self-contained schema.

    The caller has already removed the learner assignments the move scrubs.
    Completion history is never deleted, so a course learners completed
    activities in is refused -- copy it instead.
    """
    views = _views()
    course = _rows(f'select id, course_name from {views.authoring_table_name(views.FREE_COURSES_TABLE)} '
                   'where id = %s', [course_id])
    refuse_in_use([course_id], course_names={course_id: course[0]['course_name']} if course else None)
    weeks = [row['id'] for row in _rows(
        f'select id from {views.authoring_table_name(views.FREE_PROGRAMME_MODULES_TABLE)} where course_id = %s',
        [course_id])]
    _delete_ids(views.FREE_PROGRAMME_COMPONENTS_TABLE, 'free_module_id', weeks)
    _delete_ids(views.FREE_PROGRAMME_MODULES_TABLE, 'id', weeks)
    _delete_ids(views.FREE_COURSES_TABLE, 'id', [course_id])
