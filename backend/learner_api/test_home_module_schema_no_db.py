"""Learner Home readers on the canonical curriculum.modules schema.

curriculum.modules has no deleted_at/deleted_via_parent and no copied
programme_name/cohort_name/group_name. Module names now come through
programme_id/cohort_id/group_id; child weeks/components use status; module
status affects current-list membership only. No database: a recorder
answers each SELECT and refuses anything else.
"""
import inspect
import re
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from django.db.models import Model
from django.test import SimpleTestCase

from . import dashboard_header, overview_week, training_plan_dashboard
from .module_placement_sql import module_placement_names_sql
from curriculum_api.week_visibility import visible_child_sql, visible_week_sql

REMOVED_MODULE = re.compile(r'\b(?:m|cm)\.(?:deleted_at|deleted_via_parent|is_programme_deleted|programme_name|'
                            r'cohort_name|group_name|status)\b')


class Recorder:
    def __init__(self, columns=(), rows=()):
        self.columns, self.result, self.calls = columns, list(rows), []
        self.description = [(name,) for name in columns]

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        text = ' '.join(sql.split())
        self.calls.append((text, params))
        assert text.upper().startswith(('SELECT', 'WITH')), text

    def fetchall(self):
        return list(self.result)

    def fetchone(self):
        return self.result[0] if self.result else None


class PlacementNameSqlTests(SimpleTestCase):
    def test_names_come_through_the_ids_with_the_old_column_names(self):
        sql = module_placement_names_sql('m')
        for table, column, key, result in (('programmes', 'name', 'programme_id', 'programme_name'),
                                           ('cohorts', 'cohort_name', 'cohort_id', 'cohort_name'),
                                           ('groups', 'group_name', 'group_id', 'group_name')):
            self.assertIn(f"COALESCE((SELECT CASE WHEN count(*) = 1 THEN min(placement.{column}) END "
                          f"FROM curriculum.{table} placement WHERE placement.{key} = m.{key} "
                          f"AND btrim(coalesce(m.{key}, '')) <> ''), '') AS {result}", sql)
        self.assertEqual(REMOVED_MODULE.findall(sql), [])
        # Its own alias cannot collide with a caller's groups alias ``g``.
        self.assertNotRegex(sql, r'\bg\.')
        self.assertNotIn('JOIN', sql)


class HomeSubjectsTests(SimpleTestCase):
    def test_every_assigned_module_is_a_subject(self):
        sql = overview_week.HOME_SUBJECTS_SQL
        # status is a real column; Option A reads it only for the CURRENT flag.
        self.assertEqual([found for found in REMOVED_MODULE.findall(sql) if found != 'cm.status'], [])
        self.assertNotRegex(sql, r'\bcm\.(?:deleted_at|deleted_via_parent)\b')
        # Owner decision (Option A): status 'inactive' only clears the CURRENT
        # flag; no WHERE filter, so Attendance still receives every assigned row.
        self.assertIn("bool_or(assigned.current_plan) AND bool_or(lower(btrim(coalesce(cm.status, ''))) <> 'inactive')", sql)
        self.assertNotRegex(sql, r'WHERE[^)]*cm\.status')
        self.assertIn('FROM assigned JOIN curriculum.modules cm ON cm.module_catalogue_id=assigned.module_id', sql)
        self.assertIn('GROUP BY cm.module_catalogue_id,cm.title', sql)


class LectureHrefTests(SimpleTestCase):
    def test_module_filter_removed_and_child_filters_kept(self):
        now = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)
        sessions = [{'id': 'S1', 'status': 'scheduled', 'moduleId': 'M1',
                     'start': (now + timedelta(days=1)).isoformat()}]
        cursor = Recorder()
        with patch.object(Model, 'save', side_effect=AssertionError('write during Home read')):
            dashboard_header.lecture_href(cursor, sessions, 'commercial', 101, now)
        [(sql, params)] = cursor.calls
        self.assertEqual(params, ['M1'])
        self.assertEqual(REMOVED_MODULE.findall(sql), [])
        self.assertIn(visible_child_sql('c'), sql)
        self.assertIn(visible_week_sql('w'), sql)
        self.assertNotRegex(sql, r'\b[wc]\.(?:deleted_at|deleted_via_parent|is_programme_deleted)\b')
        self.assertIn('JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id', sql)


class DashboardModulesTests(SimpleTestCase):
    def read(self, include_coach=True):
        columns = ('id', 'title', 'start_date', 'end_date', 'programme_name', 'cohort_name', 'group_name',
                   'sessions_number', 'week_count') + (('coach_name',) if include_coach else ())
        row = ('M1', 'Module one', None, None, 'Marketing', 'October 2026', 'Group A', 6, True) + (
            ('Coach',) if include_coach else ())
        recorder = Recorder(columns, [row])
        with patch.object(dashboard_header, '_effective_plan_ids', return_value=['M1']), \
                patch.object(dashboard_header.canonical_learning, 'curriculum_module_ids_for', return_value=[]), \
                patch.object(dashboard_header, 'connections', {'enrolment': recorder}), \
                patch.object(Model, 'save', side_effect=AssertionError('write during Home read')):
            ids, modules = dashboard_header.dashboard_modules(object(), {'id': 30}, include_coach=include_coach)
        return ids, modules, recorder.calls

    def test_names_are_read_through_ids_and_returned_unchanged(self):
        for include_coach in (True, False):
            with self.subTest(include_coach=include_coach):
                ids, modules, [(sql, params)] = self.read(include_coach)
                self.assertEqual(ids, ['M1'])
                self.assertEqual(params, [['M1']])
                self.assertIn(module_placement_names_sql('m'), sql)
                self.assertEqual(REMOVED_MODULE.findall(sql.replace(module_placement_names_sql('m'), '')), [])
                self.assertEqual((modules[0]['programme_name'], modules[0]['cohort_name'], modules[0]['group_name']),
                                 ('Marketing', 'October 2026', 'Group A'))
                self.assertEqual('LEFT JOIN curriculum.groups g ON g.group_id=m.group_id' in sql, include_coach)


class TrainingPlanModuleRowsTests(SimpleTestCase):
    def test_module_rows_read_names_through_ids(self):
        source = inspect.getsource(training_plan_dashboard.read_dashboard)
        self.assertIn("{module_placement_names_sql('m')},m.total_otjh,m.weeks_number,m.sessions_number", source)
        self.assertNotRegex(source, r'\bm\.(?:programme_name|cohort_name|group_name|deleted_at|deleted_via_parent)\b')
        self.assertIn('FROM curriculum.modules m LEFT JOIN curriculum.groups g ON g.group_id=m.group_id', source)

    def test_none_of_the_three_readers_keeps_a_removed_module_column(self):
        for module in (dashboard_header, overview_week, training_plan_dashboard):
            with self.subTest(module=module.__name__):
                self.assertEqual(REMOVED_MODULE.findall(inspect.getsource(module)), [])


class BuilderSubjectMetadataTests(SimpleTestCase):
    """plan_module_ids (Home "upcoming") resolves module links through this read."""

    def test_modules_resolve_by_id_without_removed_columns(self):
        from .student_activity import _builder_subject_metadata
        recorder = Recorder(rows=[('M1', 'Module one', None), ('M2', 'Module two', '')])
        with patch.object(Model, 'save', side_effect=AssertionError('write during Home read')):
            covers, links = _builder_subject_metadata(recorder, ['current:M1', 'current:M2', 'legacy:9'])
        [(sql, params)] = recorder.calls
        self.assertEqual(sql, 'SELECT m.module_catalogue_id,m.title,m.cover_image_url FROM curriculum.modules m '
                              'WHERE m.module_catalogue_id=ANY(%s)')
        self.assertEqual(params, [['M1', 'M2']])
        self.assertEqual(REMOVED_MODULE.findall(sql), [])
        self.assertEqual(links, {'current:M1': {'id': 'M1', 'title': 'Module one'},
                                 'current:M2': {'id': 'M2', 'title': 'Module two'}})
        self.assertEqual(set(covers), {'current:M1', 'current:M2'})

    def test_no_current_refs_reads_nothing(self):
        from .student_activity import _builder_subject_metadata
        recorder = Recorder()
        self.assertEqual(_builder_subject_metadata(recorder, ['legacy:9']), ({}, {}))
        self.assertEqual(recorder.calls, [])
