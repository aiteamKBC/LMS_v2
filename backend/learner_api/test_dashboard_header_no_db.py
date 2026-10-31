"""Synthetic Dashboard header contracts; database access is prohibited."""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory

from . import dashboard_header as header


class DashboardHeaderTests(SimpleTestCase):
    def test_source_projection_keeps_plan_fallback_and_assignment_values_without_snapshots(self):
        model = MagicMock()
        query = model.all_learners.only.return_value
        query.annotate.return_value = query
        source = SimpleNamespace(_header_training_plan=[{'moduleId': 'M1', 'assignmentMode': 'explicit'}, None],
                                 _header_learning_plan={'legacy': True})
        query.get.return_value = source
        self.assertIs(header.read_header_source(model, 7), source)
        self.assertEqual(source.training_plan, source._header_training_plan)
        self.assertEqual(source.learning_plan, {'legacy': True})
        fields = model.all_learners.only.call_args.args
        self.assertNotIn('status', fields)
        self.assertNotIn('training_plan', fields)
        self.assertNotIn('learning_plan', fields)
        for call in query.annotate.call_args_list:
            expression = next(iter(call.kwargs.values()))
            self.assertIn("item->'moduleId'", expression.sql)
            self.assertIn("ELSE 'null'::jsonb", expression.sql)
            self.assertIn('ORDER BY position', expression.sql)
            self.assertIn('ELSE "', expression.sql)

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
             patch.object(header, 'header_profile', return_value=(profile, {'id': 17})) as owner, \
             patch.object(header, 'connections', {'enrolment': MagicMock()}), \
             patch.object(header, '_effective_plan_ids', return_value=[]), \
             patch.object(header.canonical_learning, 'curriculum_module_ids_for', return_value=[]), \
             patch.object(header, 'current_coach', return_value={'coach_name': 'Coach', 'coach_email': ''}), \
             patch.object(header, 'plan_reviews', return_value=[]), \
             patch.object(header, 'upcoming_assignment_deadlines', return_value=[]):
            result = header.build_dashboard_header(source, 'commercial', 7, include_pending_delivery=True)
        self.assertEqual(result['schedule']['coach']['name'], 'Coach')
        owner.assert_called_once_with(source, 7)

    def test_single_profile_read_keeps_canonical_identity_validation(self):
        source = SimpleNamespace(pk=7, email=' Learner@Example.test ', aptem_id='0009')
        profile = SimpleNamespace(id=17, email='learner@example.test', aptem_id=9)
        with patch.object(header, 'LearnerProfile') as model:
            model.objects.filter.return_value.only.return_value.__getitem__.return_value = [profile]
            actual, owner = header.header_profile(source, 7)
        self.assertIs(actual, profile)
        self.assertEqual(owner['id'], 17)
        model.objects.filter.assert_called_once_with(enrolment_id=7)

    def test_missing_duplicate_or_conflicting_profiles_fail_closed(self):
        source = SimpleNamespace(pk=7, email='learner@example.test', aptem_id='9')
        profile = SimpleNamespace(id=17, email='learner@example.test', aptem_id=9)
        for profiles in ([], [profile, profile], [SimpleNamespace(id=18, email='other@example.test', aptem_id=9)],
                         [SimpleNamespace(id=18, email=source.email, aptem_id=10)]):
            with self.subTest(profiles=profiles), patch.object(header, 'LearnerProfile') as model:
                model.objects.filter.return_value.only.return_value.__getitem__.return_value = profiles
                with self.assertRaises(header.ServiceError):
                    header.header_profile(source, 7)

    def test_v2_preserves_actions_and_omits_unused_event_fields(self):
        legacy = {'learner': {'id': '7', 'accessGate': {'blocked': True}},
            'schedule': {'coach': {'name': 'Coach'}, 'modules': [{'id': 'M1', 'title': 'Module'}],
                'sessions': [{'id': 'O1', 'moduleId': 'M1', 'title': 'Session', 'start': '2026-10-20T09:00:00Z', 'status': 'scheduled'}],
                'reviews': [{'id': 'R1', 'source': 'progress-review', 'status': 'scheduled',
                    'scheduledDate': '2026-10-21', 'scheduledTime': '10:00', 'targetDate': '2026-10-01',
                    'meetingLink': 'https://example.test/meeting'}]},
            'week': {'deadlines': [{'id': 'A1', 'title': 'Assignment', 'type': 'assignment', 'date': '2026-10-25'}]},
            'lectureHref': '/learner/component/commercial/7/C1', 'weeklyCandidates': []}
        compact = header.compact_header(legacy)
        self.assertIs(compact['learner'], legacy['learner'])
        self.assertEqual(compact['nextReview']['sessionId'], 'R1')
        self.assertEqual(compact['nextReview']['eventKey'], 'R1')
        self.assertEqual(compact['nextReview']['date'], '2026-10-21')
        self.assertEqual(compact['nextReview']['meetingLink'], 'https://example.test/meeting')
        self.assertNotIn('targetDate', compact['nextReview'])
        self.assertNotIn('status', compact['nextLiveSession'])
        self.assertEqual(compact['nextLiveSession']['href'], legacy['lectureHref'])
        self.assertEqual(compact['nextDeadline']['href'], '/learner/monthly-submission')
        self.assertIn('schedule', legacy)

    def test_v2_missing_optional_data_has_null_cards(self):
        legacy = {'learner': {'id': '7'}, 'schedule': {'coach': {'name': ''}, 'modules': [],
                  'sessions': [], 'reviews': []}, 'week': {'deadlines': []}, 'lectureHref': None}
        compact = header.compact_header(legacy)
        self.assertIsNone(compact['nextReview'])
        self.assertIsNone(compact['nextLiveSession'])
        self.assertIsNone(compact['nextDeadline'])

    def call_endpoint(self, account, kind='commercial', missing=False, error=None, version=None):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        query = model.all_learners.only.return_value
        query.annotate.return_value = query
        query.get.side_effect = model.DoesNotExist() if missing else None
        request = RequestFactory().get(f'/learner_api/dashboard/{kind}/7/header/',
                                       **({'HTTP_X_LMS_HEADER_VERSION': version} if version else {}))
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
                            SimpleNamespace(role='staff', subject_id=1), SimpleNamespace(role='admin', subject_id=1)):
                with self.subTest(kind=kind, role=account.role):
                    response, build, model = self.call_endpoint(account, kind)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response['Cache-Control'], 'private, no-store')
                    build.assert_called_once()
                    model.all_learners.only.return_value.get.assert_called_once_with(pk=7)

    def test_endpoint_contract_version_is_explicit_and_varies_by_cookie(self):
        account = SimpleNamespace(role='learner', subject_id=7)
        with patch.object(header, 'compact_header', return_value={'version': 2}) as compact:
            response, _, _ = self.call_endpoint(account, version='2')
            self.assertJSONEqual(response.content, {'version': 2})
            self.assertEqual(response['Vary'], 'X-LMS-Header-Version, Cookie')
            compact.assert_called_once_with({'learner': {'id': '7'}})
        for version in (None, '1', 'unknown'):
            with patch.object(header, 'compact_header') as compact:
                response, _, _ = self.call_endpoint(account, version=version)
                self.assertJSONEqual(response.content, {'learner': {'id': '7'}})
                compact.assert_not_called()

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
             patch.object(header, 'header_profile') as profile, \
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


class MinimalHeaderTests(SimpleTestCase):
    def test_profile_delivery_window_is_reused_by_identity_without_extra_lookup(self):
        source = SimpleNamespace(pk=7, programme='P', cohort='C', start_date='', end_date='2026-12-18',
                                 email='learner@example.test', aptem_id='9')
        profile = SimpleNamespace(id=9, email=source.email, aptem_id=9,
                                  _header_delivery_window={'start': '2026-01-05', 'end': '2026-12-20'})
        query = MagicMock()
        query.annotate.return_value = query
        query.only.return_value.__getitem__.return_value = [profile]
        with patch.object(header.LearnerProfile, 'objects') as objects:
            objects.filter.return_value = query
            actual, owner = header.header_profile(source, 7, delivery_window=True)
        self.assertIs(actual, profile)
        self.assertEqual(owner['id'], 9)
        self.assertEqual(source._resolved_group_dates,
                         (date(2026, 1, 5), date(2026, 12, 18), 'learner/cohort'))
        query.annotate.assert_called_once()

    def test_single_projection_preserves_actions_and_coach_without_candidates_dates(self):
        now = datetime(2026, 10, 15, 9, tzinfo=timezone.utc)
        source = SimpleNamespace(programme='P', cohort='C', group='G', programme_status='Active')
        identity = {'id': '7', 'name': 'Synthetic Learner', 'programmeStatus': 'Active'}
        modules = [{'id': ident, 'title': title, 'start_date': date(2026, 10, 1),
                    'end_date': date(2026, 10, 31), 'sessions_number': 1, 'week_count': 1}
                   for ident, title in [('M2', 'Zulu'), ('M1', 'alpha')]]
        connection = MagicMock()
        review = {'id': 'R1', 'eventKey': 'review:R1', 'title': 'Review', 'source': 'progress-review',
                  'status': 'scheduled', 'scheduledDate': '2026-10-16', 'scheduledTime': '10:00',
                  'meetingLink': 'https://example.test/meeting'}
        for kind in ('commercial', 'apprenticeship'):
            for imported in (False, True):
                profile = SimpleNamespace(id=9, aptem_id=123 if imported else None)
                with self.subTest(kind=kind, imported=imported), \
                     patch.object(header, 'header_identity', return_value=identity), \
                     patch.object(header, 'header_profile', return_value=(profile, {'id': 9})), \
                     patch.object(header, 'dashboard_modules', return_value=(['M1', 'M2'], modules)) as read_modules, \
                     patch.object(header, 'connections', {'enrolment': connection}), \
                     patch.object(header, 'header_sessions', return_value=[{'id': 'O1', 'moduleId': 'M1',
                         'title': 'Session', 'start': '2026-10-16T09:00:00+00:00', 'status': 'scheduled'}]) as sessions, \
                     patch.object(header, 'lecture_href', return_value='/learner/component/C1'), \
                     patch.object(header, 'plan_reviews', return_value=[review]) as reviews, \
                     patch.object(header, 'upcoming_assignment_deadlines', return_value=[{
                         'id': 'A1', 'title': 'Assignment', 'date': '2026-10-18'}]) as assignments, \
                     patch.object(header, 'build_dashboard_bootstrap', side_effect=AssertionError('Full Bootstrap forbidden')), \
                     patch.object(header, 'build_dashboard_header', side_effect=AssertionError('Full Header forbidden')), \
                     patch.object(header, 'current_coach', return_value={'coach_name': 'Example Coach', 'coach_email': 'coach@example.test'}), \
                     patch.object(header, 'coach_phone', return_value='000000000'):
                    result = header.build_minimal_header(source, kind, 7, now)
                self.assertEqual(set(result), {'learner', 'coach', 'modules', 'moduleLabel', 'initialWeeklyModuleId',
                                              'nextAssignment', 'nextLiveSession', 'nextReview'})
                self.assertEqual(result['modules'], [{'id': 'M1', 'title': 'alpha'}, {'id': 'M2', 'title': 'Zulu'}])
                self.assertEqual(result['initialWeeklyModuleId'], 'M1')
                self.assertEqual(result['nextAssignment'], {'title': 'Assignment', 'date': '2026-10-18',
                                                         'href': '/learner/monthly-submission'})
                self.assertEqual(result['nextLiveSession']['href'], '/learner/component/C1')
                self.assertEqual(result['nextReview']['eventKey'], 'review:R1')
                self.assertEqual(result['nextReview']['meetingLink'], review['meetingLink'])
                self.assertEqual(result['coach'], {'name': 'Example Coach', 'email': 'coach@example.test', 'phone': '000000000'})
                self.assertEqual(read_modules.call_args.kwargs, {})
                self.assertEqual(sessions.call_count, 1)
                self.assertEqual(reviews.call_count, 1)
                self.assertEqual(assignments.call_count, 1)

    def test_redirected_learners_skip_all_delivery_reads(self):
        for status in ('Fresh user', 'Onboarding'):
            with patch.object(header, 'header_identity', return_value={'programmeStatus': status}), \
                 patch.object(header, 'header_profile', side_effect=AssertionError('Delivery forbidden')):
                result = header.build_minimal_header(SimpleNamespace(programme_status=status),
                                                     'apprenticeship', 7)
            self.assertEqual(result['modules'], [])
            self.assertIsNone(result['initialWeeklyModuleId'])
            self.assertIsNone(result['nextAssignment'])

    def test_selection_keeps_identity_with_duplicate_module_names(self):
        modules = [{'id': 'M2', 'title': 'Same', 'start_date': '2026-10-01', 'end_date': '2026-10-31'},
                   {'id': 'M1', 'title': 'Same', 'start_date': '2026-10-01', 'end_date': '2026-10-31'}]
        label, selected = header.selected_header_modules(modules, '2026-10-15')
        self.assertEqual(label, 'Current modules')
        self.assertEqual([m['id'] for m in selected], ['M1', 'M2'])
        self.assertEqual(header.selected_header_modules(modules, '2026-09-01')[1][0]['id'], 'M1')
        self.assertEqual(header.selected_header_modules(modules, '2026-11-01')[1][0]['id'], 'M1')
        self.assertEqual(header.selected_header_modules([], '2026-10-15'), ('Module', []))

    def test_minimal_route_retains_authorization_and_private_cache(self):
        from django.urls import resolve
        route = resolve('/learner_api/dashboard/commercial/7/header/minimal/')
        self.assertTrue(route.kwargs['minimal'])
        for kind in ('commercial', 'apprenticeship'):
            for account, status in [(SimpleNamespace(role='learner', subject_id=7), 200),
                                    (SimpleNamespace(role='staff'), 200),
                                    (SimpleNamespace(role='learner', subject_id=8), 404),
                                    (SimpleNamespace(role='employer'), 403), (None, 401)]:
                with self.subTest(kind=kind, status=status), \
                     patch('login.permissions.authenticate_request', return_value=account), \
                     patch.object(header, 'read_header_source') as source, \
                     patch.object(header, 'build_minimal_header', return_value={'learner': {'id': '7'}}) as build:
                    response = header.dashboard_header(RequestFactory().get('/'), kind=kind, pk=7, minimal=True)
                self.assertEqual(response.status_code, status)
                self.assertEqual(build.call_count, int(status == 200))
                self.assertEqual(source.call_count, int(status == 200))
                if status == 200:
                    self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_minimal_source_does_not_load_curriculum_snapshots(self):
        model = MagicMock()
        query = model.all_learners.only.return_value
        query.annotate.return_value = query
        query.get.return_value = SimpleNamespace(_header_training_plan=[], _header_learning_plan=[])
        header.read_header_source(model, 7, minimal=True)
        fields = model.all_learners.only.call_args.args
        for field in ('modules', 'weeks', 'components'):
            self.assertNotIn(field, fields)

    def test_minimal_identity_contains_requested_values_and_only_required_gate_facts(self):
        source = SimpleNamespace(id=7, username='Synthetic Learner', programme='Example Programme',
            cohort='October 2026', employer='Example Employer', organization='Example Organization',
            onboarding_status='Submitted', learner_start_date='2026-10-01', learner_end_date='2027-10-01',
            aptem_id=None)
        gate = {'blocked': False, 'reasons': [], 'startDate': '', 'outstandingDocuments': []}
        learning = {'blocked': False, 'startDate': '2026-10-01'}
        with patch.object(header, 'programme_status', return_value='Active'), \
             patch.object(header, '_group_dates', return_value=(date(2026, 10, 1), date(2027, 10, 1), 'group')), \
             patch.object(header, '_first_session_unlocked', return_value=True), \
             patch.object(header, 'access_gate', return_value=gate), \
             patch.object(header, 'learning_access', return_value=learning), \
             patch.object(header, 'student_activity_available', return_value=False):
            actual = header.header_identity(source, minimal=True)
        self.assertEqual(actual, {'id': '7', 'name': 'Synthetic Learner', 'programme': 'Example Programme',
            'cohort': 'October 2026', 'employer': 'Example Employer', 'organization': 'Example Organization',
            'learnerStartDate': '2026-10-01', 'learnerEndDate': '2027-10-01', 'programmeStatus': 'Active',
            'onboardingStatus': 'Submitted', 'firstSessionUnlocked': True,
            'accessGate': gate, 'learningAccess': learning, 'studentActivityAvailable': False})
