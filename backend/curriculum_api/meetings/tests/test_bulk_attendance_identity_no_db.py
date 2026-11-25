"""Bulk Attendance identity and response regression tests; DB/network forbidden."""
import json
from contextlib import nullcontext
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from learner_api.models import EnrolmentUser, LearnerProfile

from curriculum_api import bulk_attendance_identity as identity
from curriculum_api import bulk_attendance_live_day as manual
from curriculum_api import bulk_attendance_live_day_records as daily
from curriculum_api import bulk_attendance_live_register as register


class Rows(list):
    """In-memory ORM boundary for synthetic rows; all actual DB access is denied."""
    def all(self):
        return self

    def using(self, _database):
        return self

    def select_for_update(self):
        return self

    def filter(self, **conditions):
        def matches(row):
            for key, expected in conditions.items():
                field, _, op = key.partition('__')
                value = row[field]
                if op == 'in' and value not in expected:
                    return False
                if op == 'gte' and value < expected:
                    return False
                if op == 'lt' and value >= expected:
                    return False
                if not op and value != expected:
                    return False
            return True
        return Rows(row for row in self if matches(row))

    def exclude(self, **conditions):
        excluded = self.filter(**conditions)
        return Rows(row for row in self if row not in excluded)

    def only(self, *fields):
        return [SimpleNamespace(**{key: row[key] for key in fields}) for row in self]

    def values(self, *fields):
        return [{key: row[key] for key in fields} for row in self]

    def values_list(self, *fields, flat=False):
        return Rows(row[fields[0]] if flat else tuple(row[key] for key in fields) for row in self)

    def distinct(self):
        return Rows(dict.fromkeys(self))


class LearnerOwnedIdentityTests(SimpleTestCase):
    def setUp(self):
        self.profiles = Rows([
            dict(id=11, aptem_id=301, enrolment_id=71, email='first@example.test', full_name='First learner'),
            dict(id=12, aptem_id=302, enrolment_id=None, email='second@example.test', full_name='Second learner'),
            dict(id=13, aptem_id=None, enrolment_id=73, email='unmapped@example.test', full_name='Unmapped'),
        ])
        self.enterContext(patch.object(LearnerProfile, 'objects', self.profiles))
        self.enterContext(patch.object(EnrolmentUser.all_learners, 'get_queryset',
                                      side_effect=AssertionError('Created_users must not be read')))
        self.enterContext(patch('curriculum_api.parallel_attendance_register.saved_parallel_links', return_value=({}, {})))
        self.enterContext(patch.object(daily, 'saved_parallel_links', return_value=({}, {})))
        self.enterContext(patch.object(daily, 'apply_recorded_outcomes', side_effect=lambda rows: rows))

    def fixture_register(self):
        self.sessions = Rows([dict(id='S1', module_catalogue_id='M1', status='active',
                                   module_title='Module', repeat_pattern='weekly')])
        self.occurrences = Rows([dict(id='O1', live_session_id='S1', scheduled_start=datetime(2026, 10, 17, 9, tzinfo=timezone.utc),
                                      scheduled_end=datetime(2026, 10, 17, 10, tzinfo=timezone.utc), status='scheduled', session_number=1)])
        self.attendance = Rows([dict(id=81, occurrence_id='O1', live_session_id='S1', module_catalogue_id='M1',
                                     learner_profile_id=11, attendance_status='absent', attendance_basis='staff'),
                                dict(id=82, occurrence_id='O1', live_session_id='S1', module_catalogue_id='M1',
                                     learner_profile_id=12, attendance_status='present', attendance_basis='staff')])
        for model, rows in ((register.LiveSession, self.sessions), (register.LiveSessionOccurrence, self.occurrences),
                            (register.LiveSessionLearnerAttendance, self.attendance),
                            (register.ModuleAuthoringModule, Rows([dict(module_catalogue_id='M1', title='Module')]))):
            self.enterContext(patch.object(model, 'objects', rows))
        self.enterContext(patch.object(register, '_lecture_titles', return_value={}))

    def test_register_keys_resolve_from_profiles_even_without_an_enrolment(self):
        self.assertEqual(identity.aptem_ids_by_profile({11, 12, 13}), {11: '301', 12: '302'})
        self.assertEqual([p.id for p in manual.profiles_for_kbc_ids(['302', '301'])], [12, 11])
        self.assertEqual(register._candidate_profile_ids({'301', '302'}), {11, 12})

    def test_duplicate_outside_requested_page_is_not_mistaken_for_a_unique_identity(self):
        self.profiles.append(dict(self.profiles[0], id=99))
        self.assertEqual(identity.aptem_ids_by_profile({11, 12}), {12: '302'})
        with self.assertRaises(manual.LiveAttendanceTargetError):
            manual.profiles_for_kbc_ids(['301', '302'])

    def test_unknown_or_out_of_range_ids_cannot_resolve_to_another_learner(self):
        for key in ('999', '99999999999999999999', 'invalid'):
            with self.subTest(key=key):
                self.assertEqual(identity.profiles_by_aptem_ids([key]), {})
                with self.assertRaises(manual.LiveAttendanceTargetError):
                    manual.profiles_for_kbc_ids([key])

    def test_last_four_and_details_keep_live_row_keys_and_page_scope(self):
        self.fixture_register()
        result = register.read_live_register_records(kbc_ids=['301'])
        self.assertEqual(set(result), {'301'})
        self.assertEqual(result['301'][0]['recordKey'], 'live:81')
        self.assertEqual(result['301'][0]['attendance'], 'absent')
        self.assertEqual(register.read_live_register_records('301'), result)
        self.assertEqual(register.read_live_register_records(kbc_ids=[]), {})

    def test_day_membership_reads_saved_profiles_without_created_users(self):
        self.fixture_register()
        self.assertEqual(register.read_live_day_learner_ids(date(2026, 10, 17)), {'301', '302'})

    def test_daily_and_monthly_responses_keep_exact_history_keys(self):
        self.fixture_register()
        factory = RequestFactory()
        for view, query in ((daily.bulk_attendance_live_day_records, {'date': '2026-10-17', 'module_catalogue_id': 'M1'}),
                            (daily.bulk_attendance_live_month_records, {'month': '2026-10', 'module_catalogue_id': 'M1'})):
            with self.subTest(view=view.__name__):
                response = view(factory.get('/synthetic/', query))
                self.assertEqual(response.status_code, 200)
                records = json.loads(response.content)['records']
                self.assertEqual([(r['learnerId'], r['recordKey'], r['attendance']) for r in records],
                                 [('301', 'live:81', 'absent'), ('302', 'live:82', 'present')])

    def test_add_day_writes_profile_id_and_preserves_existing_provider_evidence(self):
        self.fixture_register()
        self.attendance[0].update(recovery_status='none', attended_seconds=1800, attendance_report_id='REPORT',
                                  first_join_at='first', last_leave_at='last', teams_attendance_status='present')
        with patch.object(manual.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(manual, 'connections', {'default': MagicMock()}), \
             patch.object(manual.router, 'db_for_write', return_value='default'), \
             patch.object(manual, 'upsert_live_session_register') as save, \
             patch('curriculum_api.parallel_attendance_register.reconcile_parallel_attendance'), \
             patch('engagement_api.feedback_delivery.reconcile_feedback_after_attendance_commit') as feedback:
            response = manual.bulk_attendance_live_day(RequestFactory().post('/synthetic/', {
                'learnerIds': ['301'], 'moduleCatalogueId': 'M1', 'date': '2026-10-17',
                'occurrenceId': 'O1', 'attendance': 'absent', 'learnerProfileId': 999,
            }, content_type='application/json'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'created': 0, 'updated': 1})
        row = save.call_args.args[1][0]
        self.assertEqual(row['learner_profile_id'], 11)
        self.assertEqual(row['attendance_report_id'], 'REPORT')
        self.assertEqual(row['attended_seconds'], 1800)
        self.assertEqual(row['teams_attendance_status'], 'present')
        self.assertEqual(row['attendance_status'], 'absent')
        feedback.assert_called_once_with(['O1'], using='default', use_learner_profiles=True)
