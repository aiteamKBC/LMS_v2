"""Attendance reads curriculum.modules without its removed columns.

deleted_at, deleted_via_parent and is_programme_deleted no longer exist on
curriculum.modules. Module status is not an attendance rule, so planned and
inactive modules keep their history. Session/occurrence status filters, the
replaced-attendance identity and the shared-source traversal are unchanged.
No database: SQL text is inspected and a recorder answers the one reader.
"""
import re
from types import SimpleNamespace
from unittest.mock import patch

from django.db.models import Model
from django.test import SimpleTestCase

from . import attendance_lectures as lectures

MODULE_ALIASES = ('m', 'cm')
REMOVED = ('deleted_at', 'deleted_via_parent', 'is_programme_deleted')
STATUS_FILTER = "NOT IN ('cancelled','canceled','deleted','failed','superseded')"


def module_column_refs(sql):
    """Removed columns referenced through a curriculum.modules alias."""
    return [match.group(0) for match in re.finditer(
        r'\b(?:%s)\.(?:%s)\b' % ('|'.join(MODULE_ALIASES), '|'.join(REMOVED)), sql)]


class Recorder:
    def __init__(self, answers):
        self.answers, self.calls, self.description, self.rows = answers, [], [], []

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
        columns, self.rows = self.answers.pop(0) if self.answers else ((), [])
        self.description = [(name,) for name in columns]

    def fetchall(self):
        return list(self.rows)


class AttendanceSqlTests(SimpleTestCase):
    def test_module_subjects_read_every_assigned_module(self):
        sql = ' '.join(lectures.ATTENDANCE_SUBJECTS_SQL.split())
        self.assertEqual(sql, 'SELECT DISTINCT cm.module_catalogue_id,cm.title FROM curriculum.modules cm '
                              'WHERE cm.module_catalogue_id=ANY(%s)')

    def test_occurrence_sql_no_longer_reads_removed_module_columns(self):
        for name in ('NATIVE_OCCURRENCES_SQL', 'SHARED_NATIVE_OCCURRENCES_SQL', 'ATTENDANCE_SUBJECTS_SQL'):
            with self.subTest(sql=name):
                self.assertEqual(module_column_refs(getattr(lectures, name)), [])

    def test_no_module_status_rule_was_introduced(self):
        for name in ('NATIVE_OCCURRENCES_SQL', 'SHARED_NATIVE_OCCURRENCES_SQL', 'ATTENDANCE_SUBJECTS_SQL'):
            with self.subTest(sql=name):
                self.assertNotRegex(getattr(lectures, name), r'\b(?:m|cm)\.status\b')

    def test_session_and_occurrence_status_rules_are_unchanged(self):
        sql = lectures.NATIVE_OCCURRENCES_SQL
        self.assertIn(f"lower(btrim(s.status)) {STATUS_FILTER}", sql)
        self.assertIn(f"lower(btrim(o.status)) {STATUS_FILTER}", sql)
        self.assertIn("OR lower(btrim(o.status)) IN ('cancelled','canceled')", sql)
        # Attendance identity, replacement and the 180-second presence rule.
        self.assertIn('COALESCE(replaced_attendance.occurrence_id,o.id) AS attendance_source_occurrence_id', sql)
        self.assertIn('a.total_attendance_seconds>180', sql)
        self.assertIn(lectures.REPLACED_ATTENDANCE_LATERAL_SQL, sql)

    def test_shared_sources_still_wrap_exactly_one_module_filter(self):
        shared = lectures.SHARED_NATIVE_OCCURRENCES_SQL
        self.assertEqual(lectures.NATIVE_OCCURRENCES_SQL.count('WHERE s.module_catalogue_id=ANY(%s)'), 1)
        self.assertIn('OR s.module_catalogue_id IN (SELECT source_id FROM shared)', shared)
        self.assertIn('JOIN curriculum.modules m ON m.module_catalogue_id=targets.module_id', shared)


class CancelledOccurrenceTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch.object(Model, 'save', side_effect=AssertionError('write during attendance read')))

    def test_cancelled_reader_reads_tombstones_without_module_deletion_columns(self):
        from datetime import datetime, timezone
        recorder = Recorder([
            (('occurrence_id', 'module_catalogue_id', 'module_title', 'scheduled_start', 'session_number'),
             [('O1', 'M1', 'Module one', datetime(2026, 10, 1, 9, tzinfo=timezone.utc), 1)]),
        ])
        with patch.object(lectures, 'connections', {'enrolment': recorder}):
            rows = lectures.read_cancelled_native_occurrences(SimpleNamespace(email='synthetic@example.invalid'),
                                                              module_ids=['M1', ' ', 'M2'])
        [(sql, params)] = recorder.calls
        self.assertEqual(params, [['M1', 'M2']])
        self.assertEqual(module_column_refs(sql), [])
        self.assertNotRegex(sql, r'\bm\.status\b')
        self.assertIn("lower(btrim(coalesce(s.status,''))) IN ('cancelled','canceled','deleted','failed','superseded')", sql)
        self.assertEqual([row['occurrence_id'] for row in rows], ['O1'])

    def test_module_ids_default_to_every_assigned_module(self):
        recorder = Recorder([(('module_catalogue_id', 'title'), [('M1', 'Module one'), ('M2', 'Module two')]),
                             (('occurrence_id',), [])])
        with patch.object(lectures, 'connections', {'enrolment': recorder}), \
                patch.object(lectures, 'effective_assigned_module_ids', return_value=['M1', 'M2']):
            lectures.read_cancelled_native_occurrences(SimpleNamespace(email='synthetic@example.invalid'))
        self.assertEqual(recorder.calls[0], (' '.join(lectures.ATTENDANCE_SUBJECTS_SQL.split()), [['M1', 'M2']]))
        self.assertEqual(recorder.calls[1][1], [['M1', 'M2']])

    def test_no_email_reads_nothing(self):
        recorder = Recorder([])
        with patch.object(lectures, 'connections', {'enrolment': recorder}):
            self.assertEqual(lectures.read_cancelled_native_occurrences(SimpleNamespace(email='')), [])
        self.assertEqual(recorder.calls, [])
