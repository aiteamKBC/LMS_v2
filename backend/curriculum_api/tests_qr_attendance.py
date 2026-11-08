"""Isolated QR policy/HTTP checks. All curriculum IO is synthetic or mocked."""
import importlib
import json
import sqlite3
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone as utc
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from unittest import mock, TestCase

from django.core.cache import cache
from django.db import DatabaseError
from django.test import Client, RequestFactory, SimpleTestCase, override_settings
from django.urls import path

from . import qr_attendance as qr, qr_attendance_store as store

urlpatterns = [path('curriculum_api/qr-attendance/', qr.attendance)]
NOW = datetime(2026, 11, 7, 11, tzinfo=utc.utc)


def module(key='M1', programme='P1', group='G1', cohort='C1', **extra):
    return dict(id=key, title=f'Module {key}', programme_id=programme, group_id=group,
                cohort_id=cohort, group_cohort_id=cohort, group_programme_id=programme,
                cohort_programme_id=programme, group_cohort_programme_id=programme,
                group_name=group, cohort_name=cohort, deleted=False, shared_source=None,
                share_relation=None, learner_roster_mode='inherited', **extra)


def occurrence(key='O1', source='M1', offset=0, status='scheduled', **extra):
    return dict(id=key, source_module_id=source, live_session_id='S1', session_number=1,
                scheduled_start=NOW + timedelta(hours=offset-1),
                scheduled_end=NOW + timedelta(hours=offset+1), status=status,
                series_status='active', **extra)


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}, TIME_ZONE='Europe/London')
class QRPolicyTests(SimpleTestCase):
    databases = {'default'}  # The approved runner permits only in-memory SQLite.

    def setUp(self):
        from django.db import connections
        self.assertEqual(connections['default'].settings_dict['ENGINE'], 'django.db.backends.sqlite3')
        self.assertEqual(connections['default'].settings_dict['NAME'], ':memory:')
        cache.clear()
        self.student = SimpleNamespace(id=17, pk=17, programme='Programme One', group='G1',
            training_plan=None, learning_plan=[{'moduleId': 'M1', 'assignmentMode': 'explicit'}])
        self.mods = [module(), module('M2', group='G2', cohort='C2'), module('OTHER', 'P2', 'G3', 'C3')]
        self.occs = [occurrence(), occurrence('O2', 'M2', offset=100), occurrence('O3', 'OTHER')]
        self.components = []
        for name, result in (
            ('students', [self.student]),
            ('placements', [dict(programme_id='P1', group_id='G1', cohort_id='C1')]),
            ('programmes', [dict(id='P1', name='Programme One'), dict(id='P2', name='Programme Two')]),
            ('modules', self.mods),
            ('groups', [dict(id='G1', programme_id='P1', cohort_id='C1', module_ids=['M1']),
                        dict(id='G2', programme_id='P1', cohort_id='C2', module_ids=['M2'])]),
            ('cohorts', [dict(id='C1', programme_id='P1'), dict(id='C2', programme_id='P1')]),
        ):
            self.enterContext(mock.patch.object(store, name, return_value=result))
        self.enterContext(mock.patch.object(store, 'occurrences', side_effect=lambda ids: [o for o in self.occs if o['source_module_id'] in ids]))
        self.enterContext(mock.patch.object(store, 'lecture_components', side_effect=lambda ids: [c for c in self.components if c['module_catalogue_id'] in ids]))
        self.enterContext(mock.patch.object(qr.timezone, 'now', return_value=NOW))

    def lectures(self, module_id='M1'):
        _, _, _, catalog, eligible = qr.context('student@example.test')
        return qr.lecture_options(module_id, catalog, eligible)

    def test_chronological_list_keeps_fifth_lecture_selected_without_promoting_it(self):
        self.occs = [occurrence(f'O{number}', offset=(number-5)*24*7)
                     for number in (5, 6, 4, 7, 3, 8, 2, 9, 1)]
        result = self.request({'action': 'lectures', 'email': 'student@example.test', 'moduleId': 'M1'})
        body = json.loads(result.content)
        self.assertEqual([row['id'] for row in body['lectures']], [f'O{n}' for n in range(1, 10)])
        self.assertEqual(body['suggestedOccurrenceId'], 'O5')
        self.assertEqual(qr.lookup('student@example.test')['selection']['occurrenceId'], 'O5')

    def test_authored_title_uses_saved_occurrence_identity_not_module_or_week_position(self):
        self.components = [dict(id='C1', module_catalogue_id='M1', title='P1:LIVE:Introduction',
                                settings_json={'teamsOccurrenceId': 'O1', 'teamsLiveSessionId': 'S1'}),
                           dict(id='C2', module_catalogue_id='M1', title='Wrong lecture',
                                settings_json={'teamsOccurrenceId': 'OTHER', 'teamsLiveSessionId': 'S1', 'teamsSessionNumber': 1})]
        self.assertEqual(self.lectures()[0]['title'], 'P1:LIVE:Introduction')
        self.components[0]['title'] = 'Updated authored title'
        self.assertEqual(self.lectures()[0]['title'], 'Updated authored title')

    def test_title_supports_series_number_and_legacy_settings_without_guessing_dates(self):
        for settings in ({'teamsLiveSessionId': 'S1', 'teamsSessionNumber': '1'},
                         {'legacySettings': json.dumps({'teamsLiveSessionId': 'S1', 'teamsSessionNumber': 1})}):
            self.components = [dict(id='C1', module_catalogue_id='M1', title='Authored title', settings_json=json.dumps(settings))]
            self.assertEqual(self.lectures()[0]['title'], 'Authored title')
        self.components[0]['settings_json'] = {'sessionDate': NOW.date().isoformat()}
        self.assertEqual(self.lectures()[0]['title'], 'Session 1')

    def test_shared_title_prefers_selected_delivery_then_source_without_cross_group_leak(self):
        self.mods[0]['shared_source'] = 'OTHER'
        self.components = [dict(id='SOURCE', module_catalogue_id='OTHER', title='Source title', settings_json={'teamsOccurrenceId': 'O3'}),
                           dict(id='UNRELATED', module_catalogue_id='M2', title='Other group title', settings_json={'teamsOccurrenceId': 'O3'})]
        def shared_title():
            return next(row['title'] for row in self.lectures() if row['id'] == 'O3')
        self.assertEqual(shared_title(), 'Source title')
        self.components.append(dict(id='DELIVERY', module_catalogue_id='M1', title='Delivery title', settings_json={'teamsOccurrenceId': 'O3'}))
        self.assertEqual(shared_title(), 'Delivery title')
        self.assertTrue(all(row['moduleId'] == 'M1' for row in self.lectures()))

    def test_missing_blank_ambiguous_or_unverified_title_keeps_occurrence_selectable(self):
        component = dict(id='C1', module_catalogue_id='M1', title='Title', settings_json={'teamsOccurrenceId': 'O1'})
        for components in ([], [{**component, 'title': ' '}],
                           [component, {**component, 'id': 'C2', 'title': 'Conflicting'}],
                           [{**component, 'settings_json': {'teamsOccurrenceId': 'O1', 'teamsCalendarBinding': 'unverified'}}],
                           [{**component, 'settings_json': {'teamsOccurrenceId': 'O1', 'teamsLiveSessionId': 'OTHER'}}]):
            self.components = components
            self.assertEqual(self.lectures()[0]['title'], 'Session 1')
            self.assertEqual(qr.lookup('student@example.test')['selection']['occurrenceId'], 'O1')

    def test_additional_meeting_title_does_not_label_inherited_main_series(self):
        self.components = [dict(id='C1', module_catalogue_id='M1', title='Additional lecture',
                           settings_json={'extraTeamsLiveSessionId': 'EXTRA', 'teamsLiveSessionId': 'S1', 'teamsOccurrenceId': 'O1'})]
        self.assertEqual(self.lectures()[0]['title'], 'Session 1')
        self.occs[0]['live_session_id'] = 'EXTRA'
        self.assertEqual(self.lectures()[0]['title'], 'Additional lecture')

    def test_trimmed_case_insensitive_email(self):
        self.assertEqual(qr.email_value('  Student@Example.TEST  '), 'student@example.test')

    def test_missing_and_invalid_email(self):
        for value in (None, '', ' ', 'not-an-email', [], 'a' * 321 + '@example.test'):
            with self.subTest(value=type(value).__name__), self.assertRaises(qr.AttendanceError):
                qr.email_value(value)

    def test_unknown_and_duplicate_email_never_choose_a_student(self):
        for matches in ([], [self.student, self.student]):
            store.students.return_value = matches
            with self.assertRaises(qr.AttendanceError):
                qr.context('student@example.test')

    def test_unassigned_other_group_and_cohort_in_same_programme_allowed(self):
        result = qr.lookup('student@example.test')
        self.assertEqual({row['id'] for row in result['modules']}, {'M1', 'M2'})
        self.assertEqual(self.lectures('M2')[0]['id'], 'O2')
        self.assertEqual([row['id'] for row in result['suggestions']], ['O1'])

    def test_no_assignment_or_current_lecture_does_not_hide_modules(self):
        self.student.learning_plan = []
        for item in self.occs:
            item['scheduled_start'] += timedelta(days=5)
            item['scheduled_end'] += timedelta(days=5)
        result = qr.lookup('student@example.test')
        self.assertEqual(len(result['modules']), 2)
        self.assertEqual(result['suggestions'], [])

    def test_commercial_training_plan_is_used_only_for_suggestion(self):
        self.student.training_plan = [{'moduleId': 'M2', 'assignmentMode': 'explicit'}]
        self.occs[1] = occurrence('O2', 'M2')
        result = qr.lookup('student@example.test')
        self.assertEqual(result['suggestions'][0]['moduleId'], 'M2')
        self.assertEqual(len(result['modules']), 2)

    def test_programme_is_rechecked_and_other_programme_denied(self):
        with self.assertRaises(qr.AttendanceError):
            self.lectures('OTHER')
        with self.assertRaises(qr.AttendanceError):
            self.lectures('missing')

    def test_ambiguous_profile_programme_does_not_fall_back_to_name(self):
        store.placements.return_value.append(dict(programme_id='P2', group_id=None, cohort_id=None))
        with self.assertRaises(qr.AttendanceError):
            qr.context('student@example.test')

    def test_legacy_programme_resolves_exactly_and_uniquely(self):
        store.placements.return_value = []
        self.assertEqual(qr.context('student@example.test')[1], 'P1')
        store.programmes.return_value.append(dict(id='P3', name='Programme One'))
        with self.assertRaises(qr.AttendanceError):
            qr.context('student@example.test')

    def test_ambiguous_original_placement_does_not_block_same_programme(self):
        store.placements.return_value.append(dict(programme_id='P1', group_id='G2', cohort_id='C2'))
        self.assertEqual(qr.context('student@example.test')[2],
                         dict(programme_id='P1', group_id=None, cohort_id=None))
        self.assertEqual(self.lectures('M2')[0]['id'], 'O2')

    def test_malformed_optional_preset_does_not_block_manual_selection(self):
        for preset in ('invalid JSON', '{"unexpected": true}', None):
            store.groups.return_value[0]['module_ids'] = preset
            self.assertEqual(len(qr.lookup('student@example.test')['modules']), 2)

    def test_unverified_profile_programme_is_rejected(self):
        store.placements.return_value[0]['programme_id'] = 'missing'
        with self.assertRaises(qr.AttendanceError):
            qr.context('student@example.test')

    def test_invalid_ancestry_never_grants_programme_access(self):
        self.mods[0]['group_programme_id'] = 'P2'
        with self.assertRaises(qr.AttendanceError):
            self.lectures()

    def test_shared_cross_programme_source_does_not_expand_module_eligibility(self):
        self.mods[0]['shared_source'] = 'OTHER'
        self.mods[0]['share_relation'] = 'OTHER'
        self.assertEqual({item['id'] for item in self.lectures()}, {'O1', 'O3'})
        self.assertTrue(all(item['moduleId'] == 'M1' and item['group'] == 'G1' for item in self.lectures()))
        self.assertNotIn('OTHER', {item['id'] for item in qr.lookup('student@example.test')['modules']})

    def test_shared_occurrence_is_deduplicated(self):
        self.mods[0]['shared_source'] = 'M2'
        self.occs.append(dict(self.occs[0]))
        self.assertEqual(len(self.lectures()), 2)

    def test_shared_cycles_and_conflicts_are_reported(self):
        self.mods[0]['shared_source'] = 'M2'
        self.mods[1]['shared_source'] = 'M1'
        with self.assertRaises(qr.AttendanceError):
            self.lectures()
        # Optional suggestion failure still permits the module selector to load.
        self.assertEqual(len(qr.lookup('student@example.test')['modules']), 2)
        self.mods[1]['shared_source'] = None
        self.mods[0]['share_relation'] = 'OTHER'
        with self.assertRaises(qr.AttendanceError):
            self.lectures()

    def test_all_dates_remain_visible_but_only_same_day_can_be_confirmed(self):
        for offset in (-1000, -24, -4, -1, 0, 1, 4, 1000):
            with self.subTest(offset=offset):
                self.occs[:] = [occurrence(offset=offset, status='completed' if offset < 0 else 'scheduled')]
                self.assertEqual(len(self.lectures()), 1)
                with mock.patch.object(store.transaction, 'atomic'), mock.patch.object(store.connection, 'cursor'), \
                        mock.patch.object(store, 'insert_evidence', return_value=(True, NOW)) as insert:
                    if offset in (-4, -1, 0, 1, 4):
                        self.assertEqual(store.confirm('student@example.test', 'M1', 'O1'), (True, NOW))
                    else:
                        with self.assertRaises(qr.AttendanceError) as error:
                            store.confirm('student@example.test', 'M1', 'O1')
                        self.assertEqual(error.exception.code, 'outside_attendance_day')
                        insert.assert_not_called()

    def test_day_boundaries_follow_london_including_short_and_long_dst_days(self):
        for start, opening, closing in (
            ('2026-11-07T10:00:00+00:00', '2026-11-07T00:00:00+00:00', '2026-11-08T00:00:00+00:00'),
            ('2026-07-01T23:30:00+00:00', '2026-07-01T23:00:00+00:00', '2026-07-02T23:00:00+00:00'),
            ('2026-03-29T10:00:00+00:00', '2026-03-29T00:00:00+00:00', '2026-03-29T23:00:00+00:00'),
            ('2026-10-25T10:00:00+00:00', '2026-10-24T23:00:00+00:00', '2026-10-26T00:00:00+00:00'),
        ):
            self.occs[0]['scheduled_start'] = datetime.fromisoformat(start)
            self.occs[0]['scheduled_end'] = datetime.fromisoformat(start) + timedelta(hours=1)
            first, last = datetime.fromisoformat(opening), datetime.fromisoformat(closing)
            for now, allowed in ((first - timedelta(microseconds=1), False), (first, True),
                                 (last - timedelta(microseconds=1), True), (last, False)):
                with self.subTest(start=start, now=now), mock.patch.object(qr.timezone, 'now', return_value=now), \
                        mock.patch.object(store.transaction, 'atomic'), mock.patch.object(store.connection, 'cursor'), \
                        mock.patch.object(store, 'insert_evidence', return_value=(True, now)) as insert:
                    self.assertEqual(self.lectures()[0]['dueToday'], allowed)
                    if allowed:
                        self.assertEqual(store.confirm('student@example.test', 'M1', 'O1'), (True, now))
                    else:
                        with self.assertRaises(qr.AttendanceError):
                            store.confirm('student@example.test', 'M1', 'O1')
                        insert.assert_not_called()

    def test_confirmation_rechecks_day_after_preview_and_ignores_client_day_claims(self):
        self.assertTrue(self.lectures()[0]['dueToday'])
        with mock.patch.object(qr.timezone, 'now', return_value=NOW + timedelta(days=1)), \
                mock.patch.object(store.transaction, 'atomic'), mock.patch.object(store.connection, 'cursor'), \
                mock.patch.object(store, 'insert_evidence') as insert:
            result = self.request({'action': 'confirm', 'email': 'student@example.test',
                                   'moduleId': 'M1', 'occurrenceId': 'O1', 'dueToday': True,
                                   'serverNow': NOW.isoformat(), 'timeZone': 'Pacific/Honolulu'})
            self.assertEqual(result.status_code, 400)
            self.assertEqual(json.loads(result.content)['code'], 'outside_attendance_day')
            insert.assert_not_called()

    def test_running_overnight_lecture_from_previous_day_is_not_suggested(self):
        self.occs[:] = [occurrence()]
        self.occs[0]['scheduled_start'] = NOW - timedelta(days=1)
        self.assertTrue(self.lectures()[0]['current'])
        self.assertEqual(qr.lookup('student@example.test')['suggestions'], [])

    def test_completed_today_is_suggested_and_missing_end_does_not_block_same_day(self):
        self.occs[:] = [occurrence(status='completed')]
        self.occs[0]['scheduled_end'] = None
        self.assertEqual(qr.lookup('student@example.test')['selection']['occurrenceId'], 'O1')
        with mock.patch.object(store.transaction, 'atomic'), mock.patch.object(store.connection, 'cursor'), \
                mock.patch.object(store, 'insert_evidence', return_value=(True, NOW)):
            self.assertEqual(store.confirm('student@example.test', 'M1', 'O1'), (True, NOW))

    def test_invalid_occurrences_and_series_are_excluded_but_completed_is_allowed(self):
        for field in ('status', 'series_status'):
            for status in qr.INVALID:
                with self.subTest(field=field, status=status):
                    self.occs[0][field] = status
                    self.assertEqual(self.lectures(), [])
            self.occs[0][field] = 'completed'
        self.assertEqual(len(self.lectures()), 1)

    def test_deleted_module_is_excluded(self):
        self.mods[0]['deleted'] = True
        with self.assertRaises(qr.AttendanceError):
            self.lectures()

    def test_naive_database_instants_are_utc(self):
        self.occs[0]['scheduled_start'] = datetime(2026, 7, 1, 9)
        self.occs[0]['scheduled_end'] = datetime(2026, 7, 1, 10)
        self.assertEqual(self.lectures()[0]['startsAt'], '2026-07-01T09:00:00+00:00')

    def test_confirmation_rechecks_identity_and_preserves_selected_delivery(self):
        self.occs[1] = occurrence('O2', 'M2')
        with mock.patch.object(store.transaction, 'atomic'), mock.patch.object(store.connection, 'cursor'), \
                mock.patch.object(store, 'insert_evidence', return_value=(True, NOW)) as insert:
            self.assertEqual(store.confirm('student@example.test', 'M2', 'O2'), (True, NOW))
            self.assertEqual(insert.call_args.args[1], [17, 'P1', 'M2', 'O2', 'G1', 'G2', 'C1', 'C2'])
            store.students.assert_called_with('student@example.test')
            for mod, occ in [('M2', 'O1'), ('OTHER', 'O3'), ('M1', 'missing')]:
                with self.assertRaises(qr.AttendanceError):
                    store.confirm('student@example.test', mod, occ)
            self.assertEqual(insert.call_count, 1)

    def request(self, payload):
        request = RequestFactory().post('/curriculum_api/qr-attendance/', json.dumps(payload), content_type='application/json')
        request._dont_enforce_csrf_checks = True
        return qr.attendance(request)

    def test_public_lookup_exposes_no_student_profile_or_join_link(self):
        result = self.request({'action': 'lookup', 'email': 'Student@example.test'})
        body = json.loads(result.content)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(set(body), {'modules', 'suggestions', 'moduleCandidates', 'selection'})
        self.assertNotIn('email', result.content.decode())
        self.assertNotIn('join_url', result.content.decode())
        store.students.assert_called_with('student@example.test')

    def test_unique_current_assigned_lecture_selects_both_ids(self):
        self.assertEqual(qr.lookup('student@example.test')['selection'],
                         {'moduleId': 'M1', 'occurrenceId': 'O1'})

    def test_current_module_window_is_independent_of_a_running_lecture(self):
        self.mods[0].update(start_date=NOW.date()-timedelta(days=10), end_date=NOW.date()+timedelta(days=10))
        self.occs[0] = occurrence(offset=48)
        result = qr.lookup('student@example.test')
        self.assertEqual(result['selection'], {'moduleId': 'M1', 'occurrenceId': None})
        self.assertEqual(result['suggestions'], [])

    def test_real_shifted_occurrences_extend_the_module_window(self):
        self.mods[0].update(start_date=NOW.date()-timedelta(days=10), end_date=NOW.date()-timedelta(days=1))
        self.occs[0] = occurrence(offset=48)
        self.assertEqual(qr.lookup('student@example.test')['selection'], {'moduleId': 'M1', 'occurrenceId': None})

    def test_unique_current_module_is_selected_without_any_lecture_records(self):
        self.mods[0].update(start_date=NOW.date()-timedelta(days=10), end_date=NOW.date()+timedelta(days=10))
        self.occs.clear()
        result = qr.lookup('student@example.test')
        self.assertEqual(result['moduleCandidates'], ['M1'])
        self.assertEqual(result['selection'], {'moduleId': 'M1', 'occurrenceId': None})
        self.assertEqual(result['suggestions'], [])
        self.assertEqual(self.lectures('M1'), [])

    def test_today_fallback_uses_business_date_before_or_after_the_time(self):
        for offset in (-4, 4):
            with self.subTest(offset=offset):
                self.occs[0] = occurrence(offset=offset)
                self.assertEqual(qr.lookup('student@example.test')['selection'],
                                 {'moduleId': 'M1', 'occurrenceId': 'O1'})
        self.occs[0]['status'] = 'completed'
        # Completion does not close the agreed all-day attendance window.
        self.assertEqual(qr.lookup('student@example.test')['selection']['occurrenceId'], 'O1')
        self.assertEqual(len(self.lectures()), 1)

    def test_today_fallback_uses_london_date_across_summer_midnight(self):
        summer = datetime(2026, 7, 1, 23, 30, tzinfo=utc.utc)
        self.occs[0].update(scheduled_start=datetime(2026, 7, 2, 9, tzinfo=utc.utc),
                            scheduled_end=datetime(2026, 7, 2, 10, tzinfo=utc.utc))
        with mock.patch.object(qr.timezone, 'now', return_value=summer):
            self.assertEqual(qr.lookup('student@example.test')['selection']['occurrenceId'], 'O1')

    def test_multiple_equal_occurrences_select_module_but_not_a_lecture(self):
        self.occs.append(occurrence('TIE'))
        result = qr.lookup('student@example.test')
        self.assertEqual(result['selection'], {'moduleId': 'M1', 'occurrenceId': None})
        self.assertEqual({row['id'] for row in result['suggestions']}, {'O1', 'TIE'})

    def test_multiple_current_modules_do_not_choose_alphabetically(self):
        self.mods.append(module('AA'))
        self.student.learning_plan.append({'moduleId': 'AA', 'assignmentMode': 'explicit'})
        self.occs.append(occurrence('OAA', source='AA'))
        result = qr.lookup('student@example.test')
        self.assertEqual(result['selection'], {'moduleId': None, 'occurrenceId': None})
        self.assertEqual(set(result['moduleCandidates']), {'M1', 'AA'})

    def test_multiple_current_windows_without_lectures_remain_ambiguous(self):
        self.mods.append(module('AA'))
        self.student.learning_plan.append({'moduleId': 'AA', 'assignmentMode': 'explicit'})
        self.occs.clear()
        for row in (self.mods[0], self.mods[-1]):
            row.update(start_date=NOW.date(), end_date=NOW.date()+timedelta(days=1))
        result = qr.lookup('student@example.test')
        self.assertIsNone(result['selection']['moduleId'])
        self.assertEqual(set(result['moduleCandidates']), {'M1', 'AA'})

    def test_normal_placement_running_lecture_outranks_other_assigned_delivery(self):
        self.student.learning_plan.append({'moduleId': 'M2', 'assignmentMode': 'explicit'})
        self.occs[1] = occurrence('O2', 'M2')
        self.assertEqual(qr.lookup('student@example.test')['selection']['moduleId'], 'M1')
        self.occs[0] = occurrence(offset=4)
        # A running assigned lecture outranks a later normal lecture today.
        self.assertEqual(qr.lookup('student@example.test')['selection']['moduleId'], 'M2')

    def test_explicit_and_empty_plans_do_not_inherit_unassigned_group_suggestions(self):
        self.student.learning_plan = [{'moduleId': 'M2', 'assignmentMode': 'explicit'}]
        self.assertEqual(qr.lookup('student@example.test')['suggestions'], [])
        self.student.learning_plan = []
        self.assertEqual(qr.lookup('student@example.test')['moduleCandidates'], [])
        self.assertEqual(len(qr.lookup('student@example.test')['modules']), 2)
        self.assertEqual(len(self.lectures('M1')), 1)

    def test_unsaved_plan_uses_verified_legacy_group_preset_and_cohort(self):
        store.placements.return_value = []
        self.student.learning_plan = None
        self.student.group = ' group one '
        self.student.cohort = ' cohort one '
        store.groups.return_value[0]['group_name'] = 'Group One'
        store.cohorts.return_value[0]['cohort_name'] = 'Cohort One'
        result = qr.lookup('student@example.test')
        self.assertEqual(result['selection'], {'moduleId': 'M1', 'occurrenceId': 'O1'})
        self.assertEqual(qr.context('student@example.test')[2]['group_id'], 'G1')

    def test_ambiguous_legacy_group_does_not_invent_assignment(self):
        store.placements.return_value = []
        self.student.learning_plan = None
        self.student.group = 'Repeated group'
        for row in store.groups.return_value:
            row['group_name'] = 'Repeated group'
        result = qr.lookup('student@example.test')
        self.assertEqual(result['selection'], {'moduleId': None, 'occurrenceId': None})
        self.assertEqual(len(result['modules']), 2)

    def test_shared_suggestion_preserves_assigned_module_and_actual_occurrence(self):
        self.mods[0]['shared_source'] = 'OTHER'
        self.occs[0] = occurrence(offset=48)
        self.assertEqual(qr.lookup('student@example.test')['selection'],
                         {'moduleId': 'M1', 'occurrenceId': 'O3'})
        self.assertNotIn('OTHER', qr.lookup('student@example.test')['moduleCandidates'])

    def test_shared_alias_ties_do_not_choose_the_lowest_module_id(self):
        self.mods.append(module('ALIAS'))
        self.mods[-1]['shared_source'] = 'M1'
        self.student.learning_plan.append({'moduleId': 'ALIAS', 'assignmentMode': 'explicit'})
        result = qr.lookup('student@example.test')
        self.assertIsNone(result['selection']['moduleId'])
        self.assertEqual(set(result['moduleCandidates']), {'ALIAS', 'M1'})
        self.assertEqual(result['suggestions'], [])
        self.assertEqual(len(self.lectures('ALIAS')), 1)

    def test_manual_endpoint_returns_no_arbitrary_past_or_future_selection(self):
        result = self.request({'action': 'lectures', 'email': 'student@example.test', 'moduleId': 'M2'})
        body = json.loads(result.content)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(body['lectures']), 1)
        self.assertIsNone(body['suggestedOccurrenceId'])

    def test_http_confirm_and_duplicate_success_and_storage_failure(self):
        payload = {'action': 'confirm', 'email': 'student@example.test', 'moduleId': 'M1', 'occurrenceId': 'O1', 'programmeId': 'forged'}
        for created, status in ((True, 201), (False, 200)):
            with mock.patch.object(store, 'confirm', return_value=(created, NOW)) as save:
                result = self.request(payload)
                self.assertEqual(result.status_code, status)
                self.assertEqual(json.loads(result.content)['alreadyRecorded'], not created)
                save.assert_called_with('student@example.test', 'M1', 'O1')
        with mock.patch.object(store, 'confirm', side_effect=DatabaseError('PRIVATE DATABASE DETAIL')):
            result = self.request(payload)
            self.assertEqual(result.status_code, 503)
            self.assertNotIn(b'PRIVATE', result.content)

    def test_csrf_is_required_even_for_a_valid_email(self):
        request = RequestFactory().post('/curriculum_api/qr-attendance/', '{}', content_type='application/json')
        self.assertEqual(qr.attendance(request).status_code, 403)

    @override_settings(ROOT_URLCONF=__name__, FRONTEND_URL='https://college.example.test',
                       SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=['testserver'])
    def test_anonymous_flow_through_middleware_with_real_csrf_cookie(self):
        client = Client(enforce_csrf_checks=True)
        with mock.patch.dict('os.environ', {'API_REQUIRE_AUTH': '1'}):
            config = client.get('/curriculum_api/qr-attendance/')
            self.assertEqual(config.status_code, 200)
            response = client.post('/curriculum_api/qr-attendance/',
                json.dumps({'action': 'lookup', 'email': ' Student@Example.test '}),
                content_type='application/json', HTTP_X_CSRFTOKEN=config.json()['csrfToken'])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()['modules']), 2)

    @override_settings(TRUST_PROXY_IP_HEADER=False)
    def test_ip_limit_is_not_bypassed_by_changing_email_or_forwarded_header(self):
        request = RequestFactory().post('/', REMOTE_ADDR='192.0.2.1', HTTP_X_FORWARDED_FOR='192.0.2.200')
        for _ in range(3000):
            qr.throttle(request)
        request.META['HTTP_X_FORWARDED_FOR'] = '192.0.2.201'
        with self.assertRaises(qr.AttendanceError) as error:
            qr.throttle(request)
        self.assertEqual(error.exception.status, 429)

    @override_settings(TRUST_PROXY_IP_HEADER=True)
    def test_trusted_proxy_uses_existing_client_ip_policy(self):
        request = RequestFactory().post('/', REMOTE_ADDR='127.0.0.1', HTTP_X_FORWARDED_FOR='192.0.2.1')
        with mock.patch.object(qr.cache, 'add', return_value=True) as add:
            qr.throttle(request)
            first_key = add.call_args.args[0]
            request.META['HTTP_X_FORWARDED_FOR'] = '192.0.2.2'
            qr.throttle(request)
            self.assertNotEqual(add.call_args.args[0], first_key)

    def test_email_limit_applies_across_addresses(self):
        request = RequestFactory().post('/')
        for _ in range(30):
            qr.throttle(request, 'student@example.test')
        request.META['REMOTE_ADDR'] = '192.0.2.2'
        with self.assertRaises(qr.AttendanceError):
            qr.throttle(request, 'student@example.test')

    def test_public_gate_is_exact_and_neighbouring_apis_stay_protected(self):
        from login.api_gate import rule_for
        self.assertIsNone(rule_for('/curriculum_api/qr-attendance/'))
        for path_value in ('/curriculum_api/qr-attendance/admin/', '/curriculum_api/curriculum/programmes/'):
            self.assertIsNotNone(rule_for(path_value))

    @override_settings(DEBUG=False, FRONTEND_URL='https://college.example.test/')
    def test_configured_public_qr_and_csrf_bootstrap(self):
        result = qr.attendance(RequestFactory().get('/curriculum_api/qr-attendance/'))
        body = json.loads(result.content)
        self.assertEqual(body['url'], 'https://college.example.test/qr-attendance')
        self.assertTrue(body['csrfToken'])
        self.assertEqual(body['timeZone'], 'Europe/London')

    @override_settings(DEBUG=False, FRONTEND_URL='http://localhost:5173')
    def test_production_never_generates_a_localhost_qr(self):
        with self.assertRaises(qr.AttendanceError):
            qr.public_url()


class QRComponentReadTests(SimpleTestCase):
    databases = {'default'}

    def setUp(self):
        from django.db import connection
        self.assertEqual(connection.settings_dict['ENGINE'], 'django.db.backends.sqlite3')
        self.assertEqual(connection.settings_dict['NAME'], ':memory:')
        self.cursor = connection.cursor()
        self.addCleanup(self.cursor.close)
        self.cursor.execute("ATTACH DATABASE ':memory:' AS curriculum")
        self.addCleanup(lambda: self.cursor.execute('DETACH DATABASE curriculum'))
        self.cursor.execute('''CREATE TABLE curriculum.weeks (
            id text, module_catalogue_id text, deleted_at text,
            is_programme_deleted boolean, library_state text)''')
        self.cursor.execute('''CREATE TABLE curriculum.components (
            id text, week_id text, module_catalogue_id text, title text, settings_json text,
            type text, deleted_at text, is_programme_deleted boolean, library_state text)''')
        self.cursor.execute("INSERT INTO curriculum.weeks VALUES ('W1','M1',NULL,false,''), ('W2','M2',NULL,false,'')")
        for key, module_id, week_id, kind in [('C1', 'M1', 'W1', 'live_session'),
                                              ('C2', 'M2', 'W2', 'live-session'),
                                              ('C3', 'M1', 'W1', 'video'),
                                              ('C4', 'M1', 'W2', 'live_session')]:
            self.cursor.execute('INSERT INTO curriculum.components VALUES (%s,%s,%s,%s,%s,%s,NULL,false,%s)',
                                [key, week_id, module_id, f'Authored {key}', '{"teamsOccurrenceId":"O1"}', kind, ''])

    def test_real_reader_scopes_titles_to_delivery_and_matching_week(self):
        self.assertEqual(store.lecture_components([]), [])
        self.assertEqual([row['id'] for row in store.lecture_components(['M1'])], ['C1'])
        self.assertEqual([row['id'] for row in store.lecture_components(['M1', 'M2'])], ['C1', 'C2'])
        self.assertEqual(store.lecture_components(["M1' OR 1=1 --"]), [])
        components = store.lecture_components(['M1'])
        self.assertEqual(qr.lecture_title(occurrence(), components, ['M1']), 'Authored C1')

    def test_deleted_archived_and_library_components_or_weeks_do_not_supply_titles(self):
        for table, key in [('components', 'C1'), ('weeks', 'W1')]:
            for field, value, reset in [('deleted_at', '2026-11-01', None),
                                        ('is_programme_deleted', True, False), ('library_state', 'library', '')]:
                with self.subTest(table=table, field=field):
                    self.cursor.execute(f'UPDATE curriculum.{table} SET {field}=%s WHERE id=%s', [value, key])
                    self.assertEqual(store.lecture_components(['M1']), [])
                    self.cursor.execute(f'UPDATE curriculum.{table} SET {field}=%s WHERE id=%s', [reset, key])


class SQLiteCursor:
    """Execute the actual conflict-handling writer on an isolated SQLite database."""
    def __init__(self, connection):
        self.cursor = connection.cursor()

    def execute(self, sql, params):
        self.cursor.execute(sql.replace('%s', '?'), params)

    def fetchone(self):
        return self.cursor.fetchone()


class QRStorageTests(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lms-qr-synthetic-')
        self.addCleanup(self.temp.cleanup)
        self.path = str(Path(self.temp.name) / 'qr.sqlite3')
        conn = self.connect()
        with conn:
            conn.execute('''CREATE TABLE curriculum.qr_attendance (
                enrolment_id integer NOT NULL, programme_id text, module_id text, occurrence_id text NOT NULL,
                assigned_group_id text, attended_group_id text, assigned_cohort_id text, attended_cohort_id text,
                confirmed_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(enrolment_id, occurrence_id))''')
        conn.close()
        self.values = [17, 'P1', 'M1', 'O1', 'G1', 'G2', 'C1', 'C2']

    def connect(self):
        conn = sqlite3.connect(':memory:', timeout=10)
        conn.execute('ATTACH DATABASE ? AS curriculum', [self.path])
        return conn

    def test_retry_and_shared_alias_preserve_first_record_and_timestamp(self):
        conn = self.connect()
        self.addCleanup(conn.close)
        with conn:
            first = store.insert_evidence(SQLiteCursor(conn), self.values)
        with conn:
            retry = store.insert_evidence(SQLiteCursor(conn), [*self.values[:2], 'SHARED', *self.values[3:]])
        self.assertTrue(first[0])
        self.assertEqual(retry, (False, first[1]))
        self.assertEqual(conn.execute('SELECT module_id FROM curriculum.qr_attendance').fetchall(), [('M1',)])

    def test_simultaneous_requests_create_exactly_one_record(self):
        barrier = Barrier(2)
        def submit():
            conn = self.connect()
            try:
                barrier.wait(timeout=5)
                with conn:
                    return store.insert_evidence(SQLiteCursor(conn), self.values)
            finally:
                conn.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: submit(), range(2)))
        self.assertEqual(sorted(result[0] for result in results), [False, True])
        self.assertEqual(results[0][1], results[1][1])

    def test_rollback_leaves_no_record_and_unique_constraint_rejects_raw_duplicate(self):
        conn = self.connect()
        self.addCleanup(conn.close)
        with self.assertRaises(RuntimeError), conn:
            store.insert_evidence(SQLiteCursor(conn), self.values)
            raise RuntimeError('rollback')
        self.assertEqual(conn.execute('SELECT count(*) FROM curriculum.qr_attendance').fetchone(), (0,))
        with conn:
            store.insert_evidence(SQLiteCursor(conn), self.values)
        with self.assertRaises(sqlite3.IntegrityError), conn:
            conn.execute("INSERT INTO curriculum.qr_attendance(enrolment_id,occurrence_id) VALUES(17,'O1')")

    def test_migration_fails_on_unsupported_database_without_claiming_success(self):
        migration = importlib.import_module('curriculum_api.migrations.0079_qr_attendance')
        with self.assertRaises(RuntimeError):
            migration.install(None, SimpleNamespace(connection=SimpleNamespace(vendor='sqlite')))
