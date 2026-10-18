"""Monthly V2 display/action parity with database access forbidden."""
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from . import dashboard_monthly as monthly, dashboard_monthly_v2 as display
from . import test_dashboard_monthly_no_db as legacy_tests


class MonthlyV2ProjectionTests(SimpleTestCase):
    fixture = legacy_tests.MonthlyProjectionTests.fixture

    def test_opt_in_exact_contract_legacy_summary_parity(self):
        legacy, *_ = self.fixture('?month=2026-10')
        result, *_ = self.fixture('?month=2026-10&version=2')
        self.assertEqual(set(result), {'version', 'month', 'title', 'navigation', 'summary', 'activitiesHref', 'refreshAt', 'reviews', 'assignments', 'lectures'})
        self.assertEqual(result['version'], 2)
        self.assertEqual(result['title'], 'October 2026')
        self.assertEqual(result['navigation'], legacy['navigation'])
        self.assertEqual(result['summary'], {'requiredHours': '50 hrs', 'achievedHours': '0 hrs', 'difference': '-50 hrs',
            'differenceTone': None, 'differenceDirection': 'down', 'ksbs': []})
        self.assertEqual(result['assignments'], legacy['assignments'])
        self.assertNotIn('version', legacy)

    def test_visible_lecture_cap_before_attendance_and_projection(self):
        sessions = [{'id': i, 'moduleId': 'M1', 'start': f'2026-10-{i:02d}T09:00:00Z', 'minutes': 60} for i in range(1, 5)]
        result, *_, attendance, week = self.fixture('?month=2026-10&version=2', sessions=sessions)
        self.assertEqual([r['id'] for r in result['lectures']], ['1', '2', '3'])
        self.assertEqual(attendance.call_args.kwargs['monthly_occurrences'], {
            ('teams:1', '2026-10-01'), ('teams:2', '2026-10-02'), ('teams:3', '2026-10-03')})
        for row in result['lectures']:
            self.assertNotIn('session', row)
            self.assertNotIn('attendance', row)

    def test_required_actual_and_difference_use_canonical_accepted_records(self):
        records = [{'reporting_month': '2026-10', 'actual_seconds': 54 * 3600, 'accepted': True},
                   {'reporting_month': '2026-10', 'actual_seconds': 8 * 3600, 'accepted': False}]
        result, *_ = self.fixture('?month=2026-10&version=2', records=records)
        self.assertEqual(result['summary']['achievedHours'], '54 hrs')
        self.assertEqual(result['summary']['difference'], '+4 hrs')
        self.assertEqual(result['summary']['differenceDirection'], 'up')
        self.assertEqual(result['summary']['differenceTone'], 'positive')

    def test_future_unknown_hours_and_empty_states(self):
        result, *_ = self.fixture('?month=2026-11&version=2', targets={}, fallback={})
        self.assertEqual(result['summary']['requiredHours'], 'Not available')
        self.assertEqual(result['summary']['difference'], 'Not available')
        self.assertEqual([result[key] for key in ('reviews', 'lectures', 'assignments')], [[], [], []])

    def test_midnight_and_session_end_refresh_deadline(self):
        now = datetime(2026, 10, 15, 9, tzinfo=display.UK)
        with patch.object(monthly.timezone, 'now', return_value=now):
            result, *_ = self.fixture('?month=2026-10&version=2', sessions=[{'id': 1, 'moduleId': 'M1',
                'start': '2026-10-15T08:00:00Z', 'end': '2026-10-15T09:00:00Z', 'minutes': 60}])
        self.assertEqual(result['refreshAt'], '2026-10-15T09:00:00+00:00')

    def test_attendance_projection_filters_after_register_normalization(self):
        from . import attendance_lectures as attendance
        register = [{'source': 'microsoft-teams', 'session_id': 1, 'session_date': date(2026, 10, 10), 'module_catalogue_id': 'M1'},
                    {'source': 'microsoft-teams', 'session_id': 2, 'session_date': date(2026, 10, 11), 'module_catalogue_id': 'M2'}]
        with patch.object(attendance, 'lecture_register', return_value=register) as normalize, \
             patch.object(attendance, 'read_native_components', return_value=([], [])) as native, \
             patch.object(attendance, 'build_lectures', return_value=[]) as build, \
             patch.object(attendance, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: MagicMock())}), \
             patch.object(attendance, '_attach_recovery'), patch.object(attendance, '_mark_missed_catchups'):
            attendance.read_workspace(SimpleNamespace(id=1), 'commercial', monthly='2026-10',
                monthly_occurrences={('teams:1', '2026-10-10')})
        normalize.assert_called_once()
        native.assert_called_once_with(SimpleNamespace(id=1), {'M1'}, monthly=True)
        self.assertEqual(build.call_args.args[0], register[:1])


class MonthlyV2DisplayTests(SimpleTestCase):
    now = datetime(2026, 10, 15, 12, tzinfo=display.UK)
    review = {'id': '1', 'eventKey': 'progress-review:1', 'title': 'Review', 'source': 'progress-review',
        'sequence': 1, 'status': 'not-scheduled', 'targetDate': '2026-10-10', 'durationMinutes': 60,
        'reviewTemplateId': 'template'}
    session = {'id': 1, 'start': '2026-10-20T09:00:00Z', 'end': '2026-10-20T10:00:00Z',
        'minutes': 60, 'status': 'scheduled', 'joinUrl': 'https://example.invalid/join'}

    def lecture(self, evidence=None, **session):
        return display.lecture_row({**self.session, **session}, evidence, 'Lecture', 'Tutor', self.now)

    def test_review_statuses_forms_and_booking_identity_for_both_roles_and_sources(self):
        for kind in ('commercial', 'apprenticeship'):
            for source, route, event_type in (('mcr', 'monthly-coaching', 'coaching'), ('progress-review', 'progress-reviews', 'review')):
                with self.subTest(kind=kind, source=source):
                    row = display.review_row({**self.review, 'source': source}, kind, 1, 'Coach', self.now)
                    self.assertEqual(row['status'], 'Overdue')
                    self.assertEqual(row['time'], '60 min')
                    self.assertEqual(row['date'], '10 Oct')
                    self.assertEqual(row['formHref'], f'/learner/{route}/progress-review%3A1?kind={kind}&learner=1')
                    self.assertEqual(row['booking']['eventKey'], self.review['eventKey'])
                    self.assertEqual(row['booking']['source'], source)
                    self.assertNotIn('coachEmail', row['booking'])
                    self.assertNotIn('targetDate', row['booking'])
                    self.assertEqual(row['booking']['date'], '2026-10-10')
        for status, label in (('completed', 'Attended'), ('awaiting-signature', 'Awaiting signatures'),
                              ('in-progress', 'In progress'), ('scheduled', 'Booking pending')):
            row = display.review_row({**self.review, 'status': status, 'invited': False}, 'commercial', 1, '', self.now)
            self.assertEqual(row['status'], label)
            self.assertIsNone(row['booking'])

    def test_review_booked_link_and_uk_time(self):
        row = display.review_row({**self.review, 'status': 'scheduled', 'scheduledDate': '2026-10-20',
            'scheduledTime': '14:30:00', 'meetingLink': 'https://example.invalid/join'}, 'commercial', 1, '', self.now)
        self.assertEqual(row['time'], '14:30 · UK time')
        self.assertEqual(row['status'], 'Booked')
        self.assertEqual(row['attendHref'], 'https://example.invalid/join')

    def test_uk_dst_and_month_boundary(self):
        for value, day, clock in (('2026-09-30T23:30:00Z', '1 Oct', '00:30'),
                                  ('2026-10-25T00:30:00Z', '25 Oct', '01:30'),
                                  ('2026-10-25T01:30:00Z', '25 Oct', '01:30'),
                                  ('2026-03-29T01:30:00Z', '29 Mar', '02:30')):
            row = self.lecture(start=value, end=None)
            self.assertEqual((row['date'], row['time']), (day, clock))

    def test_upcoming_past_current_inactive_and_unsafe_links(self):
        self.assertEqual(self.lecture()['attendHref'], self.session['joinUrl'])
        self.assertEqual(self.lecture(start='2026-10-15T10:00:00Z', end='2026-10-15T12:00:00Z')['attendHref'], self.session['joinUrl'])
        for status in ('cancelled', 'deleted', 'completed'):
            self.assertIsNone(self.lecture(status=status)['attendHref'])
        self.assertIsNone(self.lecture(start='2026-10-10T09:00:00Z', end=None)['attendHref'])
        self.assertEqual(self.lecture(joinUrl='javascript:alert(1)')['status'], 'Link pending')

    def test_absence_action_only_carries_dialog_inputs(self):
        row = self.lecture({'id': 'teams:1', 'date': '2026-10-20', 'title': 'Lecture', 'status': 'upcoming', 'canReportAbsence': True})
        self.assertEqual(row['absenceAction'], 'absence')
        self.assertEqual(row['absenceLabel'], 'Report absence')
        self.assertEqual(row['absence'], {'id': 'teams:1', 'date': '2026-10-20', 'title': 'Lecture', 'reportId': None})

    def test_catchup_recovery_priority_and_recovered_attendance(self):
        evidence = {'id': 'teams:1', 'date': '2026-10-20', 'title': 'Lecture', 'status': 'absent', 'absenceReport': {'id': 7, 'status': 'pending'}}
        for recovery, catchup_status, label in (({}, None, 'Book Catchup Session'),
            ({'method': 'catch-up', 'calendarKey': 'owned', 'ended': False}, 'pending', 'Change catch-up'),
            ({'method': 'recorded', 'calendarKey': 'owned', 'ended': True}, 'pending', 'Book catch-up'),
            ({'method': 'alternative', 'calendarKey': 'owned', 'ended': False}, 'pending', None),
            ({}, 'completed', None), ({'method': 'catch-up'}, 'missed', 'Book Catchup Session')):
            row = self.lecture({**evidence, 'recovery': recovery, 'catchupStatus': catchup_status})
            self.assertEqual(row['absenceLabel'], label)
            if label:
                self.assertEqual(row['absence']['reportId'], 7)
        for status in ('absent', 'present'):
            self.assertIsNone(self.lecture({**evidence, 'status': status, 'rawStatus': 'absent', 'effectiveAttendance': 1})['absence'])

    def test_hours_and_cross_year_display(self):
        for value, label in ((0, '0 hrs'), (1.234, '1.23 hrs'), (None, 'Not available'), (-0.001, '0 hrs'),
                             (50.125, '50.13 hrs'), (-1.125, '-1.13 hrs'), (1.005, '1 hrs')):
            self.assertEqual(display.hours(value), label)
        self.assertEqual(display.date_label('2027-01-01', self.now.date()), '1 Jan 2027')

    def test_assignments_use_builder_dates_completion_and_two_card_cap(self):
        learning = {'detail': {'components': [
            {'componentId': f'A{i}', 'moduleId': 'M1', 'module': 'Module', 'component': f'Assignment {i}',
             'type': 'assignment', 'week': 'Week 1', 'expectedOtjh': 2, 'sessionDate': '2026-09-01'} for i in range(1, 5)],
            'componentProgress': [{'componentId': 'A2', 'kind': 'component', 'passed': None},
                                  {'componentId': 'A1', 'kind': 'component', 'passed': False}]},
            'metadata': {'activity_dates': {f'A{i}': {'date': '2026-10-20', 'date_source': 'builder_week',
                'week_end': '2026-10-25', 'due_timing': 'end of week'} for i in range(1, 4)}}}
        subjects = monthly.display_subjects(learning)
        for kind in ('commercial', 'apprenticeship'):
            rows = display.assignment_rows(learning, subjects, '2026-10', kind, 1)
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0], {'id': 'current:M1:A1', 'title': 'Assignment 1', 'subtitle': 'Week 1',
                'requiredHours': '2 hrs', 'achievedHours': '0 hrs', 'progress': '0%', 'progressLabel': '0% complete',
                'href': f'/learner/component/{kind}/1/A1?week=Week%201', 'actionLabel': 'Start'})
            self.assertEqual(rows[1]['actionLabel'], 'View')
            self.assertEqual(rows[1]['achievedHours'], '2 hrs')
        self.assertEqual(display.assignment_rows(learning, subjects, '2026-11', 'commercial', 1), [])
        # A4 has only its fallback session date, so it remains in September.
        self.assertEqual(display.assignment_rows(learning, subjects, '2026-09', 'commercial', 1)[0]['title'], 'Assignment 4')

    def test_legacy_assignment_does_not_invent_component_navigation_or_hours(self):
        learning = {'activity': {'subjects': [{'id': 2, 'name': 'Legacy'}], 'activities': [
            {'activity_id': 'old:1', 'group_id': 2, 'activity': 'Legacy assignment', 'category': 'Assignment',
             'date': '2026-10-01', 'planned': 3, 'completed': True},
            {'activity_id': 'old:2', 'group_id': 2, 'activity': 'Ambiguous assignment', 'category': 'Assignment',
             'date': '2026-10-02', 'date_needs_review': True}]}}
        rows = display.assignment_rows(learning, monthly.display_subjects(learning), '2026-10', 'apprenticeship', 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['href'], '/learner/modules/apprenticeship/1?subject=legacy%3A2')
        self.assertEqual(rows[0]['requiredHours'], '3 hrs')
        self.assertEqual(rows[0]['achievedHours'], '3 hrs')

    def test_reconciled_legacy_assignment_uses_native_target_and_expected_hours(self):
        learning = {'activity': {'subjects': [{'id': 2, 'name': 'Legacy'}], 'activities': [
            {'activity_id': 7, 'source_activity_id': 7, 'group_id': 2, 'activity': 'Assignment', 'category': 'assignment', 'date': '2026-10-01', 'planned': 3}]},
            'detail': {'components': [{'componentId': 'A', 'moduleId': 'M', 'module': 'Module', 'component': 'Assignment',
                'type': 'assignment', 'sessionDate': '2026-10-02', 'expectedOtjh': 4}],
                'componentProgress': [{'componentId': 'A', 'passed': None}]},
            'metadata': {'builder_subjects': {'legacy:2': {'id': 'M'}},
                'activity_sources': {'A': {'module_id': 'M', 'group_id': 2, 'activity_id': 7}}}}
        rows = display.assignment_rows(learning, monthly.display_subjects(learning), '2026-10', 'commercial', 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['requiredHours'], '4 hrs')
        self.assertEqual(rows[0]['href'], '/learner/component/commercial/1/A?week=')
        self.assertEqual(rows[0]['progress'], '100%')
