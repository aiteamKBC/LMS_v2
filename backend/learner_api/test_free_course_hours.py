"""Hours attribution without completion or ledger writes."""
import os
import unittest
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from . import free_course_hours as hours


class FreeCourseHoursTests(unittest.TestCase):
    def test_empty_assignments_do_not_read_ledger(self):
        with patch.object(hours, 'connections', {}) as connections:
            self.assertEqual(hours.accepted_activity_seconds(12, []), {})
            self.assertEqual(connections, {})

    def test_scopes_to_owner_and_selected_supported_courses(self):
        course = sorted(hours.INCLUSION_COURSES)[0]
        cursor = MagicMock()
        cursor.fetchall.return_value = [(course, 'C1', 3600, 1, 1), (course, 'C2', 30, 2, 1)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(hours, 'connections', {'enrolment': connection}):
            self.assertEqual(sum(hours.accepted_activity_seconds(12, [course, 'OTHER']).values()), 3630)
        cursor.execute.assert_called_once_with(hours.HOURS_SQL, [12, sorted([course, 'OTHER'])])

    def test_repeated_reads_do_not_add_seconds(self):
        rows = [('FREE', 'C1', 137310, 1, 1)]
        self.assertEqual(hours.activity_seconds(rows), hours.activity_seconds(rows))
        self.assertEqual(sum(hours.activity_seconds(rows).values()), 137310)

    def test_repeated_ledger_identity_fails_closed(self):
        with self.assertRaises(DatabaseError):
            hours.activity_seconds([('FREE', 'C1', 10, 1, 1), ('FREE', 'C1', 10, 1, 1)])

    def test_distinct_ledger_entries_for_one_component_sum_once(self):
        self.assertEqual(hours.activity_seconds([
            ('FREE', 'C1', 10, 1, 1), ('FREE', 'C1', 20, 2, 1),
        ]), {('FREE', 'C1'): 30})

    def test_conflicting_identity_fails_closed(self):
        with self.assertRaises(DatabaseError):
            hours.activity_seconds([('FREE', 'C1', 10, 1, 2)])

    def test_negative_seconds_fail_closed(self):
        with self.assertRaises(DatabaseError):
            hours.activity_seconds([('FREE', 'C1', -1, 1, 1)])


@unittest.skipUnless(os.environ.get('RUN_MY_LEARNING_READ_ONLY_TESTS') == '1',
                     'requires explicit read-only Development opt-in')
class FreeCourseHoursSQLTests(unittest.TestCase):
    def setUp(self):
        from scripts.verify_inclusion_canonical_targets import connect_development
        self.connection = connect_development()
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)

    def test_real_development_accepted_seconds_and_unenrolled_learner(self):
        courses = sorted(hours.INCLUSION_COURSES)
        actual = hours.activity_seconds(self.connection.execute(hours.HOURS_SQL, [272, courses]).fetchall())
        self.assertEqual(len(actual), 244)
        self.assertEqual(sum(actual.values()), 137310)
        self.assertEqual(self.connection.execute(hours.HOURS_SQL, [1000, courses]).fetchall(), [])

    def synthetic(self, *, accepted=True, enrolled=True, duplicate_enrollment=False,
                  deleted=False, owner=12, course='FREE', seconds=90, archived_component=False,
                  identity='canonical'):
        from psycopg.types.json import Jsonb
        ledger = [dict(id=1,learner_id=owner,accepted=accepted,actual_seconds=seconds,
                       free_course_ref='FREE',free_component_ref='C1',
                       deleted_at='2026-01-01T00:00:00Z' if deleted else None)]
        if identity == 'conflicting':
            # Impossible with the real PK, but exercise the reader's fail-closed
            # identity-count guard with an explicitly malformed synthetic source.
            ledger.append(dict(ledger[0], free_component_ref='C2'))
        elif identity == 'missing':
            ledger[0].update(free_course_ref=None, free_component_ref=None)
        tables = [
            ('"Learner".learner_progress_entries', ledger),
            ('curriculum.free_programme_components', [dict(id='C1',free_module_id='W1',deleted_at='2026-01-01T00:00:00Z' if archived_component else None)]),
            ('curriculum.free_course_weeks', [dict(id='W1',course_id=course,status='active')]),
            ('"Learner".learner_free_courses', [dict(id=i,learner_id=12,free_course_ref='FREE') for i in range(1, 3 if duplicate_enrollment else 2)] if enrolled else []),
        ]
        sql = hours.HOURS_SQL
        ctes, params = [], []
        for index, (table, rows) in enumerate(sorted(tables, key=lambda item: -len(item[0]))):
            alias = f'fixture_{index}'
            sql = sql.replace(table, alias)
            ctes.append(f'{alias} AS (SELECT * FROM jsonb_populate_recordset(NULL::{table},%s::jsonb))')
            params.append(Jsonb(rows))
        return self.connection.execute('WITH ' + ','.join(ctes) + ' ' + sql, params + [12, ['FREE']]).fetchall()

    def test_canonical_identity_keeps_consumer_eligibility_filters(self):
        self.assertEqual(self.synthetic(), [('FREE', 'C1', 90, 1, 1)])
        self.assertEqual(self.synthetic(deleted=True), [])
        self.assertEqual(self.synthetic(enrolled=False), [])
        self.assertEqual(self.synthetic(identity='missing'), [])

    def test_malformed_duplicate_ledger_identity_is_rejected(self):
        with self.assertRaises(DatabaseError):
            hours.activity_seconds(self.synthetic(identity='conflicting'))

    def test_current_attempt_identity_constraint_preserves_legacy_and_canonical_paths(self):
        definitions = self.connection.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='\"Learner\".subject_activity_attempts'::regclass AND conname='subject_attempt_identity_required'").fetchone()
        self.assertIsNotNone(definitions)
        self.assertIn('source_activity_fk IS NOT NULL', definitions[0])
        self.assertIn('free_component_ref IS NOT NULL', definitions[0])
        self.assertIn('source_activity_snapshot IS NOT NULL', definitions[0])

    def test_ledger_is_authoritative_and_duplicate_enrollment_does_not_multiply(self):
        self.assertEqual(self.synthetic(duplicate_enrollment=True), [('FREE', 'C1', 90, 1, 1)])

    def test_unaccepted_unenrolled_deleted_wrong_owner_and_wrong_course_are_excluded(self):
        for options in [dict(accepted=False), dict(enrolled=False), dict(deleted=True),
                        dict(owner=13), dict(course='OTHER'), dict(archived_component=True), dict(seconds=None)]:
            with self.subTest(options=options):
                self.assertEqual(self.synthetic(**options), [])
