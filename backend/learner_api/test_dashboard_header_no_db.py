"""Synthetic Dashboard header contracts; database access is prohibited."""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory

from . import dashboard_header as header


class DashboardHeaderTests(SimpleTestCase):
    def test_imported_header_booking_overlay_does_not_reread_deferred_review_bodies(self):
        from . import imported_review_calendar as imported
        event = {'eventKey': 'review-key', 'reviewId': '8', 'importedReviewType': 'Monthly Coaching Meeting'}
        profile = SimpleNamespace(id=17, coach_name='Coach', coach_email='coach@example.test')
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = [(8,)]
        with patch('coach_api.views.fetch_aptem_review_events', return_value=([event], {})), \
             patch('coach_api.views.overlay_calendar_record', return_value={**event, 'meetingLink': 'https://example.test/meeting'}) as overlay, \
             patch.object(imported, 'connection', connection), \
             patch.object(imported, '_review_rows', side_effect=AssertionError('review history body')), \
             patch.object(imported, 'load_imported_links', return_value=({'review-key': None}, {'review-key': None})) as links:
            result = imported.imported_events_for_learner(SimpleNamespace(pk=7, learner_type='commercial'), profile, 9,
                                                         [], dates_only=True, compact_bookings=True)
        self.assertEqual(result[0]['meetingLink'], 'https://example.test/meeting')
        self.assertTrue(overlay.call_args.kwargs['compact'])
        self.assertTrue(links.call_args.kwargs['compact'])
        self.assertNotIn('review_data', connection.cursor.return_value.__enter__.return_value.execute.call_args.args[0])

    def test_module_candidates_keep_dates_without_duplicate_placement_or_links(self):
        source = SimpleNamespace(programme='Programme', cohort='C1', group='G1')
        base = {'id': 'M1', 'title': 'A &amp; B', 'start_date': date(2026, 10, 1), 'end_date': date(2026, 10, 31),
                'programme_name': 'Programme', 'cohort_name': 'C1', 'group_name': 'G1'}
        result = header.header_modules([base, {**base, 'id': 'OLD', 'cohort_name': 'Old'}], source)
        self.assertEqual(result, [{'id': 'M1', 'title': 'A & B', 'start_date': '2026-10-01', 'end_date': '2026-10-31'}])
        # Imported catalogue labels do not hide a real assignment if no placement matches.
        self.assertEqual(header.header_modules([{**base, 'cohort_name': 'Imported'}], source)[0]['id'], 'M1')
        # Match the existing browser normalizer: don't collapse internal whitespace in learner labels.
        source.programme = 'Programme  Two'
        other = {**base, 'id': 'M2', 'programme_name': 'Programme Two'}
        self.assertEqual({m['id'] for m in header.header_modules([base, other], source)}, {'M1', 'M2'})

    def test_weekly_candidates_exclude_undated_empty_modules_before_placement(self):
        source = SimpleNamespace(programme='P', cohort='C', group='G')
        base = {'id': 'empty', 'title': 'No slots', 'start_date': date(2026, 10, 1), 'end_date': date(2026, 10, 31),
                'programme_name': 'P', 'cohort_name': 'C', 'group_name': 'G', 'sessions_number': 0, 'week_count': 0}
        fallback = {**base, 'id': 'M1', 'title': 'apple', 'cohort_name': 'Imported', 'week_count': 2}
        second = {**fallback, 'id': 'M2', 'title': 'Banana'}
        result = header.weekly_header_candidates([base, {**fallback, 'id': 'undated', 'start_date': None}, fallback, second], source)
        self.assertEqual([row['id'] for row in result], ['M1', 'M2'])
        self.assertEqual(set(result[0]), {'id', 'title', 'start_date', 'end_date'})
        # Both tied-date titles reach the browser unchanged for localeCompare.
        self.assertEqual([row['title'] for row in result], ['apple', 'Banana'])

    def test_only_next_eligible_review_survives_booking_precedence_and_uk_time(self):
        now = datetime(2026, 10, 15, 9, tzinfo=timezone.utc)  # 10:00 UK
        def event(id, **extra):
            return {'id': id, 'source': 'mcr', 'status': 'not-scheduled', 'targetDate': '2026-10-15', **extra}
        chosen = event('chosen', scheduledDate='2026-10-15', scheduledTime='10:01')
        events = [event('history', targetDate='2025-01-01'), event('completed', status=' completed '),
                  event('passed', scheduledDate='2026-10-15', scheduledTime='09:59'),
                  event('moved', scheduledDate='2026-12-01'), event('bad', targetDate='invalid'),
                  event('future', targetDate='2026-11-01'), chosen]
        self.assertEqual(header.next_review(events, now), [chosen])
        self.assertEqual(header.next_review([], now), [])

    def test_undated_time_orders_last_and_ties_keep_event_identity(self):
        events = [{'id': id, 'source': 'progress-review', 'status': 'scheduled', 'targetDate': '2026-10-15',
                   'scheduledDate': '2026-10-15', 'scheduledTime': clock} for id, clock in [('z', None), ('b', '12:00'), ('a', '12:00')]]
        self.assertEqual(header.next_review(events, datetime(2026, 10, 15, 9, tzinfo=timezone.utc))[0]['id'], 'a')

    def test_header_only_calendar_projection_preserves_links_without_review_bodies(self):
        from .calendar import _serialize_event
        record = SimpleNamespace(event_type='mcr', review_template_id='', event_key='review-1', status='scheduled',
                                 scheduled_date=date(2026, 10, 15), target_date=date(2026, 10, 1), scheduled_time=None,
                                 duration_minutes=60, meeting_link='https://example.test/meeting', graph_web_link='')
        result = _serialize_event(record, review_types_by_template={}, templates_by_id={}, compact=True, include_meeting_link=True)
        self.assertEqual(result['meetingLink'], 'https://example.test/meeting')
        self.assertNotIn('reviewResponses', result)
        self.assertNotIn('notes', result)
        legacy = _serialize_event(record, review_types_by_template={}, templates_by_id={}, compact=True)
        self.assertNotIn('meetingLink', legacy)

    def test_staff_pending_preview_keeps_header_cards_and_resolves_each_identity_once(self):
        source = SimpleNamespace(pk=7, email='learner@example.test', programme='', cohort='', group='')
        profile = MagicMock()
        profile.coach_name = 'Coach'
        profile.coach_email = ''
        with patch.object(header, 'header_identity', return_value={'programmeStatus': 'Onboarding'}), \
             patch.object(header.canonical_learning, 'require_profile', return_value={'id': 17}) as owner, \
             patch.object(header, 'LearnerProfile') as profiles, \
             patch.object(header, 'connections', {'enrolment': MagicMock()}), \
             patch.object(header, '_effective_plan_ids', return_value=[]), \
             patch.object(header.canonical_learning, 'curriculum_module_ids_for', return_value=[]), \
             patch.object(header, 'current_coach', return_value={'coach_name': 'Coach', 'coach_email': ''}), \
             patch.object(header, 'plan_reviews', return_value=[]), \
             patch.object(header, 'upcoming_assignment_deadlines', return_value=[]):
            profiles.objects.filter.return_value.only.return_value.first.return_value = profile
            result = header.build_dashboard_header(source, 'commercial', 7, include_pending_delivery=True)
        self.assertEqual(result['schedule']['coach']['name'], 'Coach')
        owner.assert_called_once_with(7)
        profiles.objects.filter.assert_called_once_with(enrolment_id=7)

    def call_endpoint(self, account, kind='commercial', missing=False, error=None):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        query = model.all_learners.only.return_value
        query.get.side_effect = model.DoesNotExist() if missing else None
        request = RequestFactory().get(f'/learner_api/dashboard/{kind}/7/header/')
        request.login_account = account
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch.dict(header.SOURCE_MODELS, {'commercial': model, 'apprenticeship': model}), \
             patch.object(header, 'build_dashboard_header', return_value={'learner': {'id': '7'}},
                          side_effect=error) as build:
            response = header.dashboard_header(request, kind=kind, pk=7)
        return response, build, model

    def test_endpoint_authorizes_own_learner_and_staff_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            for account in (SimpleNamespace(role='learner', subject_id=7),
                            SimpleNamespace(role='staff', subject_id=1)):
                with self.subTest(kind=kind, role=account.role):
                    response, build, model = self.call_endpoint(account, kind)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response['Cache-Control'], 'private, no-store')
                    build.assert_called_once()
                    model.all_learners.only.return_value.get.assert_called_once_with(pk=7)

    def test_endpoint_rejects_other_learner_employer_and_signed_out_without_reads(self):
        for account, status in ((SimpleNamespace(role='learner', subject_id=8), 404),
                                (SimpleNamespace(role='employer', subject_id=7), 403),
                                (None, 401)):
            with self.subTest(status=status, account=account):
                response, build, model = self.call_endpoint(account)
                self.assertEqual(response.status_code, status)
                build.assert_not_called()
                model.all_learners.only.assert_not_called()

    def test_endpoint_distinguishes_missing_identity_and_failed_reads(self):
        account = SimpleNamespace(role='learner', subject_id=7)
        self.assertEqual(self.call_endpoint(account, missing=True)[0].status_code, 404)
        self.assertEqual(self.call_endpoint(account, error=DatabaseError('offline'))[0].status_code, 503)

    def test_redirected_learner_does_not_read_delivery_data(self):
        source = SimpleNamespace(pk=7)
        with patch.object(header, 'header_identity', return_value={'programmeStatus': 'Onboarding'}), \
             patch.object(header.canonical_learning, 'require_profile') as profile, \
             patch.object(header, 'connections', {}) :
            result = header.build_dashboard_header(source, 'commercial', 7)
        profile.assert_not_called()
        self.assertEqual(result['schedule']['sessions'], [])
        self.assertIsNone(result['lectureHref'])

    def test_session_read_excludes_attendance_and_keeps_recurrence_and_shared_identity(self):
        cursor = MagicMock()
        cursor.description = [(field,) for field in ('id', 'moduleId', 'title', 'start', 'status')]
        cursor.fetchall.return_value = [('occ-1', 'M1', 'Teaching', datetime(2026, 10, 15, 12), 'scheduled')]
        now = datetime(2026, 10, 15, tzinfo=timezone.utc)
        result = header.header_sessions(cursor, ['M1'], now)
        self.assertEqual(result[0]['start'], '2026-10-15T12:00:00+00:00')
        self.assertEqual(result[0]['id'], 'occ-1')
        sql, params = cursor.execute.call_args.args
        self.assertIn('teams_shared_source_module_id', sql)
        self.assertIn('o.id IS NOT NULL OR', sql)
        self.assertNotIn('attendance', sql)
        self.assertNotIn('join_url', sql)
        self.assertEqual(params, [['M1'], datetime(2026, 10, 15)])

    def test_lecture_route_matches_authored_date_and_encodes_scope(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('C1', 'A & B', 'Week 1', '2026-10-15', None),
                                       ('C2', 'A & B', 'Week 2', '2026-10-22', None)]
        sessions = [{'id': 'O1', 'moduleId': 'M1', 'start': '2026-10-15T12:00:00+00:00',
                     'status': 'scheduled'}]
        result = header.lecture_href(cursor, sessions, 'commercial', 7,
                                     datetime(2026, 10, 15, tzinfo=timezone.utc))
        self.assertEqual(result, '/learner/component/commercial/7/C1?module=A%20%26%20B&week=Week%201')

    def test_ambiguous_undated_session_has_no_fabricated_activity_link(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('C1', 'Module', 'Week 1', None, None),
                                       ('C2', 'Module', 'Week 2', None, None)]
        sessions = [{'id': 'O1', 'moduleId': 'M1', 'start': '2026-10-15T12:00:00+00:00',
                     'status': 'scheduled'}]
        self.assertIsNone(header.lecture_href(cursor, sessions, 'apprenticeship', 7,
                                              datetime(2026, 10, 15, tzinfo=timezone.utc)))

    def test_empty_schedule_avoids_component_query(self):
        cursor = MagicMock()
        self.assertIsNone(header.lecture_href(cursor, [], 'commercial', 7,
                                              datetime(2026, 10, 15, tzinfo=timezone.utc)))
        cursor.execute.assert_not_called()

    def test_lecture_route_matches_utc_day_for_offset_authored_instant(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('C1', 'Module', 'Week 1', None, '2026-10-16T00:30:00+02:00'),
                                       ('C2', 'Module', 'Week 2', None, '2026-10-22T12:00:00Z')]
        sessions = [{'id': 'O1', 'moduleId': 'M1', 'start': '2026-10-15T22:30:00+00:00',
                     'status': 'scheduled'}]
        self.assertEqual(header.lecture_href(cursor, sessions, 'commercial', 7,
                                            datetime(2026, 10, 15, tzinfo=timezone.utc)),
                         '/learner/component/commercial/7/C1?module=Module&week=Week%201')
