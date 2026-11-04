"""Phase 1C: curriculum.modules without deleted_at/deleted_via_parent/programme_name.

The shared visibility predicate shows only rows without a deletion stamp;
_resolve_from_master and _append_week_quizzes read modules through the
learner's assigned ids and derive a module's programme name through
modules.programme_id -> curriculum.programmes. No database: a recorder cursor
answers each SELECT by statement and refuses anything else.
"""
import re
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql

from . import learner_detail as detail

REMOVED_MODULE_COLUMNS = ('m.deleted_at', 'm.deleted_via_parent', 'm.programme_name', 'archived_module')
PROGRAMME_NAME_SQL = ("COALESCE((SELECT CASE WHEN count(*) = 1 THEN min(p.name) END FROM curriculum.programmes p "
                      "WHERE p.programme_id = m.programme_id AND btrim(coalesce(m.programme_id, '')) <> ''), '')")


def visible(predicate, row):
    """Evaluate the shared predicate for one row (it is a single IS NULL test)."""
    match = re.fullmatch(r'\((\w+)\.deleted_at IS NULL\)', predicate)
    assert match, f'unexpected predicate: {predicate}'
    return row.get('deleted_at') is None


class Recorder:
    """Answers SELECTs from ``answer(sql)``; records SQL and parameters."""

    def __init__(self, answer):
        self.answer, self.calls, self.result = answer, [], []

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        text = ' '.join(sql.split())
        self.calls.append((text, params))
        if not text.upper().startswith(('SELECT', 'WITH')):
            raise AssertionError(f'non-SELECT statement: {text}')
        self.result = self.answer(text, params)

    def fetchall(self):
        return list(self.result or [])

    def fetchone(self):
        return self.result[0] if self.result else None

    def sql_for(self, fragment):
        return [text for text, _ in self.calls if fragment in text]


class SharedPredicateTests(SimpleTestCase):
    def test_every_child_table_gets_the_same_stamp_only_rule(self):
        for alias in ('weeks', 'w', 'components', 'c', 'component', 'k', 'mapping', 'visible_parent'):
            with self.subTest(alias=alias):
                self.assertEqual(visible_child_sql(alias), f'({alias}.deleted_at IS NULL)')
                self.assertEqual(visible_week_sql(alias), visible_child_sql(alias))

    def test_no_stamped_row_is_ever_visible(self):
        rows = {
            'live': {'deleted_at': None, 'deleted_via_parent': None},
            'live with a leftover parent link': {'deleted_at': None, 'deleted_via_parent': 'MOD-1'},
            'deleted directly': {'deleted_at': '2026-10-01T10:00:00Z', 'deleted_via_parent': None},
            'archived with its module': {'deleted_at': '2026-10-01T10:00:00Z', 'deleted_via_parent': 'MOD-1'},
            'archived with its programme': {'deleted_at': '2026-10-01T10:00:00Z', 'deleted_via_parent': 'PROG-1'},
            'stale child of a restored module': {'deleted_at': '2026-09-01T10:00:00Z', 'deleted_via_parent': 'MOD-1'},
        }
        for table in ('weeks', 'components', 'k'):
            predicate = visible_child_sql(table)
            shown = {name for name, row in rows.items() if visible(predicate, row)}
            with self.subTest(table=table):
                self.assertEqual(shown, {'live', 'live with a leftover parent link'})

    def test_the_predicate_reads_nothing_from_curriculum_modules(self):
        sql = visible_child_sql('weeks')
        for removed in ('curriculum.modules', 'archived_module', 'deleted_via_parent', 'interval', ' OR ', 'EXISTS'):
            self.assertNotIn(removed, sql)


MODULE_ROWS = {'MOD-1': 'Module one', 'MOD-2': 'Module two', 'MOD-3': 'Module three', 'MOD-OTHER': 'Unassigned'}
WEEK_ROWS = [('WEEK-1', 'MOD-1', 'Week 1', 1, 0), ('WEEK-2', 'MOD-2', 'Week 1', 1, 0), ('WEEK-3', 'MOD-3', 'Week 1', 1, 0),
             ('WEEK-X', 'MOD-OTHER', 'Week 1', 1, 0)]


def component_row(comp_id, week_id, module_id):
    return (comp_id, week_id, module_id, 'reading', f'Reading · {comp_id}', 'Body', {}, '', 0, [], False, None, False)


COMPONENT_ROWS = [component_row('COMP-1', 'WEEK-1', 'MOD-1'), component_row('COMP-2', 'WEEK-2', 'MOD-2'),
                  component_row('COMP-3', 'WEEK-3', 'MOD-3'), component_row('COMP-X', 'WEEK-X', 'MOD-OTHER')]


def resolver_answer(sql, params):
    """A database that ignores the id filter, to prove the reader scopes itself."""
    if 'FROM curriculum.modules m' in sql:
        return list(MODULE_ROWS.items())
    if 'FROM curriculum.weeks' in sql:
        return list(WEEK_ROWS)
    if 'FROM curriculum.components WHERE' in sql:
        return list(COMPONENT_ROWS)
    return []


class ResolveFromMasterTests(SimpleTestCase):
    def resolve(self, assigned, weeks=(), components=(), answer=resolver_answer, **options):
        recorder = Recorder(answer)
        with patch.object(detail, 'connections', {'enrolment': recorder}):
            result = detail._resolve_from_master([], list(weeks), list(components), assigned_modules=assigned, **options)
        return result, recorder

    def test_module_sql_reads_only_assigned_ids_without_removed_columns(self):
        _, recorder = self.resolve([{'moduleId': 'MOD-1'}, {'moduleId': 'MOD-2'}])
        [(sql, params)] = [(text, params) for text, params in recorder.calls if 'FROM curriculum.modules m' in text]
        self.assertEqual(sql, 'SELECT m.module_catalogue_id, m.title FROM curriculum.modules m '
                              'WHERE m.module_catalogue_id = ANY(%s)')
        self.assertEqual(params, [['MOD-1', 'MOD-2']])
        for removed in REMOVED_MODULE_COLUMNS + ('status',):
            self.assertNotIn(removed, sql)

    def test_weeks_and_components_use_the_shared_stamp_rule(self):
        _, recorder = self.resolve([{'moduleId': 'MOD-1'}])
        [week_sql] = recorder.sql_for('FROM curriculum.weeks')
        self.assertIn(visible_week_sql('weeks'), week_sql)
        [component_sql] = recorder.sql_for('FROM curriculum.components WHERE')
        self.assertIn(visible_child_sql('components'), component_sql)
        for sql in (week_sql, component_sql):
            for removed in ('deleted_via_parent', 'archived_module'):
                self.assertNotIn(removed, sql)

    def test_modules_outside_the_assignment_never_appear(self):
        (modules, weeks, components), _ = self.resolve([{'moduleId': 'MOD-1'}])
        self.assertEqual(modules, ['Module one'])
        self.assertEqual({w['moduleId'] for w in weeks}, {'MOD-1'})
        self.assertEqual({c['componentId'] for c in components}, {'COMP-1'})

    def test_planned_active_and_inactive_modules_all_resolve(self):
        # Status is not a visibility rule; three assigned modules in any state resolve.
        (modules, _, components), recorder = self.resolve(
            [{'moduleId': 'MOD-1'}, {'moduleId': 'MOD-2'}, {'moduleId': 'MOD-3'}])
        self.assertEqual(modules, ['Module one', 'Module two', 'Module three'])
        self.assertEqual({c['componentId'] for c in components}, {'COMP-1', 'COMP-2', 'COMP-3'})
        self.assertFalse(any('status' in sql for sql in recorder.sql_for('FROM curriculum.modules')))

    def test_a_missing_module_stays_out_and_legacy_entries_are_kept(self):
        legacy_week = {'module': 'Old course', 'week': 'Week 1'}
        legacy_component = {'module': 'Old course', 'week': 'Week 1', 'component': 'Reading · Old notes'}
        (modules, weeks, components), _ = self.resolve(
            [{'moduleId': 'MOD-1'}, {'moduleId': 'MOD-GONE'}], weeks=[legacy_week], components=[legacy_component])
        self.assertEqual(modules, ['Module one', 'Old course'])
        self.assertIn(legacy_week, weeks)
        self.assertIn(legacy_component, components)
        self.assertNotIn('MOD-GONE', {w.get('moduleId') for w in weeks})

    def test_a_database_error_returns_the_stored_plan_unchanged(self):
        stored = (['Module one'], [{'module': 'Module one', 'week': 'Week 1', 'moduleId': 'MOD-1', 'weekId': 'W'}],
                  [{'module': 'Module one', 'week': 'Week 1', 'component': 'Reading · stored', 'moduleId': 'MOD-1'}])

        def broken(sql, params):
            raise DatabaseError('column m.deleted_at does not exist')
        recorder = Recorder(broken)
        with patch.object(detail, 'connections', {'enrolment': recorder}), \
                self.assertLogs('learner_api.learner_detail', level='WARNING'):
            result = detail._resolve_from_master(*stored, assigned_modules=[{'moduleId': 'MOD-1'}])
        self.assertEqual(result, stored)


def quiz_row(quiz_id, *, week_id='', programme_id='', programme='', module=''):
    return (quiz_id, week_id, f'Quiz {quiz_id}', 5, 30, 'Minutes', programme_id, programme, module)


class AppendWeekQuizzesTests(SimpleTestCase):
    WEEKS = [{'module': 'Risk Management', 'week': 'Week 1', 'moduleId': 'MOD-RISK', 'weekId': 'WEEK-RISK-1'}]

    def append(self, module_row, quizzes=(), links=(), weeks=None):
        def answer(sql, params):
            if 'FROM curriculum.modules m' in sql:
                return [module_row]
            if 'FROM curriculum.quiz_course_links' in sql:
                return list(links)
            if 'FROM curriculum.quizzes' in sql:
                return list(quizzes)
            return []
        recorder = Recorder(answer)
        with patch.object(detail, 'connections', {'enrolment': recorder}):
            result = detail._append_week_quizzes(list(weeks or self.WEEKS), [])
        return result, recorder

    def test_module_sql_derives_the_programme_name_through_its_id(self):
        _, recorder = self.append(('MOD-RISK', 'Risk Management', 'PROG-1', 'Marketing'))
        [(sql, params)] = [(text, params) for text, params in recorder.calls if 'FROM curriculum.modules m' in text]
        self.assertEqual(sql, "SELECT m.module_catalogue_id, m.title, COALESCE(m.programme_id, ''), "
                              f"{PROGRAMME_NAME_SQL} FROM curriculum.modules m WHERE m.module_catalogue_id = ANY(%s)")
        self.assertEqual(params, [['MOD-RISK']])
        for removed in REMOVED_MODULE_COLUMNS:
            self.assertNotIn(removed, sql)
        self.assertNotIn('JOIN curriculum.programmes', sql)

    def test_a_legacy_quiz_matches_by_the_derived_programme_name(self):
        quiz = quiz_row(41, programme='Marketing', module='Risk Management')
        (_, components), _ = self.append(('MOD-RISK', 'Risk Management', 'PROG-1', 'Marketing'), quizzes=[quiz])
        self.assertEqual([c['quizMeta']['quizId'] for c in components], [41])
        self.assertEqual(components[0]['moduleId'], 'MOD-RISK')

    def test_a_blank_or_duplicate_programme_id_fails_closed_for_label_matching(self):
        # The subquery yields '' for a blank, unknown or duplicated programme id.
        quiz = quiz_row(41, programme='Marketing', module='Risk Management')
        (_, components), _ = self.append(('MOD-RISK', 'Risk Management', '', ''), quizzes=[quiz])
        self.assertEqual(components, [])

    def test_only_published_quizzes_are_read_on_every_path(self):
        links = [(52, 'MOD-RISK', 'WEEK-RISK-1')]
        _, recorder = self.append(('MOD-RISK', 'Risk Management', 'PROG-1', 'Marketing'),
                                  quizzes=[quiz_row(52, week_id='WEEK-RISK-1')], links=links)
        quiz_sql = recorder.sql_for('FROM curriculum.quizzes')
        self.assertTrue(quiz_sql)
        for sql in quiz_sql:
            self.assertIn("lower(COALESCE(status, '')) = 'published'", sql)

    def test_quizzes_attach_only_to_the_learners_modules(self):
        foreign = quiz_row(77, programme_id='PROG-1', module='Another module')
        linked_elsewhere = [(78, 'MOD-OTHER', '')]
        (_, components), _ = self.append(('MOD-RISK', 'Risk Management', 'PROG-1', 'Marketing'),
                                         quizzes=[foreign, quiz_row(78)], links=linked_elsewhere)
        self.assertEqual(components, [])

    def test_no_statement_references_removed_module_columns(self):
        _, recorder = self.append(('MOD-RISK', 'Risk Management', 'PROG-1', 'Marketing'),
                                  quizzes=[quiz_row(41, programme='Marketing', module='Risk Management')])
        for sql, _params in recorder.calls:
            for removed in REMOVED_MODULE_COLUMNS:
                self.assertNotIn(removed, sql)
