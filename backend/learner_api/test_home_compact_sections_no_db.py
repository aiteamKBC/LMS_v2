from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase, override_settings

from old_otjh.service import ServiceError

from . import overview_week as week_module
from . import training_plan_dashboard as plan_module
from .apprenticeship_agreement import _group_dates
from .overview_week import HOME_SOURCE_FIELDS, overview_week


def cursor_connections(cursor):
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor
    return {'enrolment': connection}


class HomeSummarySectionTests(SimpleTestCase):
    @override_settings(LEARNER_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_compact_section_reads_live_without_the_shared_home_snapshot(self):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        source = model.all_learners.only.return_value.get.return_value
        with patch.dict('learner_api.overview_week.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.read_model.get_learner_home') as shared, \
             patch('learner_api.read_model.enqueue_learner_home_refresh') as enqueue, \
             patch('learner_api.overview_week.attach_programme_name') as programme, \
             patch('learner_api.overview_week.read_week', return_value={'homeProgress': {}}) as live:
            response = overview_week.__wrapped__.__wrapped__(
                RequestFactory().get('/?section=home-summary'), 'commercial', 265)

        self.assertEqual(response.status_code, 200)
        self.assertNotIn('X-LMS-Cache', response)
        model.all_learners.only.assert_called_once_with(*HOME_SOURCE_FIELDS)
        programme.assert_called_once_with(source)
        live.assert_called_once_with(source, home_kind='commercial', home_summary=True)
        shared.assert_not_called()
        enqueue.assert_not_called()

    def test_home_source_loads_the_programme_period_fields(self):
        self.assertTrue({'cohort', 'start_date', 'end_date'} <= set(HOME_SOURCE_FIELDS))
        self.assertNotIn('programme', HOME_SOURCE_FIELDS)

    def test_unknown_sections_are_still_rejected(self):
        response = overview_week.__wrapped__.__wrapped__(
            RequestFactory().get('/?section=home-compact'), 'commercial', 265)
        self.assertEqual(response.status_code, 400)

    def test_missing_ssot_identity_fails_before_curriculum_reads(self):
        cursor = MagicMock()
        with patch.object(week_module.canonical_learning, 'require_profile',
                          side_effect=ServiceError('not linked', 'ssot_identity_required', 409)), \
             patch.object(week_module.canonical_learning, 'metrics') as metrics, \
             patch.object(week_module, 'connections', cursor_connections(cursor)), \
             patch.object(week_module, '_direct_progress_records') as progress:
            with self.assertRaises(ServiceError):
                week_module.read_week(SimpleNamespace(pk=265), home_kind='commercial', home_summary=True)
        metrics.assert_not_called()
        progress.assert_not_called()
        cursor.execute.assert_not_called()

    def test_verified_identity_is_read_once_and_reused(self):
        owner = {'id': 9, 'enrolment_id': 265}
        source = SimpleNamespace(pk=265)
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        with patch.object(week_module.canonical_learning, 'require_profile', return_value=owner) as identity, \
             patch.object(week_module.canonical_learning, 'metrics', return_value={'otjh': {}}) as metrics, \
             patch.object(week_module, 'connections', cursor_connections(cursor)), \
             patch.object(week_module, '_direct_progress_records', return_value=[]) as progress, \
             patch.object(week_module, 'rows', return_value=[]), \
             patch.object(week_module, 'read_builder_activity_dates', return_value={}), \
             patch('learner_api.selectors.assignments._effective_plan_ids', return_value=[]), \
             patch('learner_api.home_progress.read_home_progress', return_value={'otjh': {}, 'period': {'start': None, 'end': '2026-10-18'}}):
            week_module.read_week(source, home_kind='commercial', home_summary=True)

        identity.assert_called_once_with(265)
        metrics.assert_called_once_with(265, owner=owner)
        self.assertIs(source._canonical_profile, owner)
        # The verified owner row is the profile; no second "Learner".learners lookup.
        profile = progress.call_args.kwargs['profile']
        self.assertEqual((profile.id, profile.enrolment_id), (9, 265))

    def test_compact_payload_keeps_home_fields_and_skips_plan_aggregates(self):
        now = datetime(2026, 10, 14, 9, tzinfo=timezone.utc)
        cursor = MagicMock()
        cursor.fetchall.return_value = [('MOD-1', 'Marketing', True), ('MOD-2', 'Attendance only', False)]
        native = [
            {'id': 'c1', 'module_id': 'MOD-1', 'module_title': 'Marketing', 'title': 'Essay', 'type': 'assignment',
             'expected_hours': 2, 'section_title': 'Week 3', 'due_timing': 'End of week', 'ksb_mappings': [],
             'quiz_id': None, 'builder_week_id': 'W3', 'builder_settings': {'dueTiming': 'End of week'},
             'builder_order': 2},
            {'id': 'c2', 'module_id': 'MOD-1', 'module_title': 'Marketing', 'title': 'Check', 'type': 'checkpoint',
             'expected_hours': 1, 'section_title': 'Week 3', 'due_timing': 'End of week', 'ksb_mappings': [],
             'quiz_id': None, 'builder_week_id': 'W3', 'builder_settings': {}, 'builder_order': 1},
        ]
        dates = {key: {'date': '2026-10-14', 'week_start': '2026-10-12', 'week_end': '2026-10-18'}
                 for key in ('c1', 'c2')}
        metrics = {'otjh': {'actual': 1, 'planned': 10}}
        with patch.object(week_module.canonical_learning, 'require_profile', return_value={'id': 9}), \
             patch.object(week_module.canonical_learning, 'metrics', return_value=metrics), \
             patch.object(week_module, 'connections', cursor_connections(cursor)), \
             patch.object(week_module, '_direct_progress_records', return_value=[]), \
             patch.object(week_module, 'rows', return_value=native), \
             patch.object(week_module, 'read_builder_activity_dates', return_value=dates) as builder, \
             patch('learner_api.selectors.assignments._effective_plan_ids', return_value=['MOD-1']), \
             patch('learner_api.home_progress.read_home_progress', return_value={
                 'otjh': {}, 'period': {'start': '2026-01-05', 'end': '2026-10-18', 'timezone': 'Europe/London'}}) as home:
            payload = week_module.read_week(SimpleNamespace(pk=265), now=now,
                                            home_kind='commercial', home_summary=True)

        # Assignment deadlines moved to the Upcoming section.
        self.assertEqual(set(payload), {'weekStart', 'weekEnd', 'modules', 'homeProgress'})
        self.assertEqual(payload['homeProgress']['period'], {'start': '2026-01-05', 'end': '2026-10-18'})
        self.assertEqual(payload['modules'], [{'id': 'current:MOD-1', 'title': 'Marketing', 'weekLabels': ['Week 3']}])
        components_sql = cursor.execute.call_args_list[1].args[0]
        self.assertNotIn('curriculum.ksb_mappings', components_sql)
        # Builder dates reuse this read's components (one pass over their settings), in Builder order.
        self.assertIn('row_number() OVER (ORDER BY c.module_catalogue_id,c.display_order,c.id) AS builder_order',
                      components_sql)
        self.assertEqual(builder.call_args.kwargs['components'], [
            ('c2', 'MOD-1', 'W3', 'Check', 'checkpoint', {}),
            ('c1', 'MOD-1', 'W3', 'Essay', 'assignment', {'dueTiming': 'End of week'})])
        self.assertTrue(all(not key.startswith('builder_') for row in native for key in row))
        # The home card receives the same merged activities, attendance scope and SSOT metrics.
        args, kwargs = home.call_args
        self.assertEqual(len(list(args[2])), 2)
        self.assertEqual(kwargs, {'attendance_module_ids': ['MOD-1', 'MOD-2'], 'canonical_metrics': metrics,
                                  'module_counts_only': True})

    def test_home_assignment_fields_are_loaded_without_dropping_original_fields(self):
        self.assertEqual(set(HOME_SOURCE_FIELDS), {'id', 'aptem_id', 'email', 'username',
            'cohort', 'start_date', 'end_date', 'training_plan', 'learning_plan', 'group'})

    def test_missing_identity_prevents_even_the_assignment_navigation_read(self):
        with patch.object(week_module.canonical_learning, 'require_profile',
                          side_effect=ServiceError('not linked', 'ssot_identity_required', 409)), \
             patch('learner_api.selectors.assignments._effective_plan_ids') as assignments, \
             patch.object(week_module, 'connections') as connections:
            with self.assertRaises(ServiceError):
                week_module.read_week(SimpleNamespace(pk=265), home_kind='commercial', home_summary=True)
        assignments.assert_not_called()
        connections.__getitem__.assert_not_called()

    def test_inherited_navigation_preserves_every_home_calculation_input(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('A', 'Alpha', True), ('ATTENDANCE', 'Attendance only', False)]
        original = {'id': 'a', 'module_id': 'A', 'module_title': 'Alpha', 'title': 'Reading',
            'type': 'reading', 'section_title': 'Week 3', 'expected_hours': 2, 'ksb_mappings': [],
            'quiz_id': None, 'builder_week_id': 'WA', 'builder_settings': {}, 'builder_order': 1}
        additional = {'id': 'b', 'module_id': 'B', 'module_title': 'Beta', 'title': 'Inherited',
            'type': 'reading', 'section_title': 'Week 3',
            'builder_week_id': 'WB', 'builder_settings': {}, 'builder_order': 1}
        dates = {key: {'date': '2026-10-14', 'date_needs_review': False} for key in ('a', 'b')}
        progress = [{'componentId': 'a', 'kind': 'component', 'passed': None}]
        metrics = {'otjh': {'actual': 0, 'planned': None}}
        native_rows = [deepcopy(original)]
        captured = {}

        def home(*args, **kwargs):
            captured['before'] = deepcopy((args[2:], kwargs))
            return {'otjh': {'actual': 0, 'planned': None}, 'activities': {'completed': 1, 'total': 1},
                    'period': {'start': None, 'end': '2026-10-18', 'timezone': 'Europe/London'}}

        with patch.object(week_module.canonical_learning, 'require_profile', return_value={'id': 9}), \
             patch.object(week_module.canonical_learning, 'metrics', return_value=metrics), \
             patch.object(week_module, 'connections', cursor_connections(cursor)), \
             patch.object(week_module, '_direct_progress_records', return_value=progress), \
             patch.object(week_module, 'rows', side_effect=[native_rows, [deepcopy(additional)]]), \
             patch.object(week_module, 'read_builder_activity_dates',
                          side_effect=[{'a': dates['a']}, {'b': dates['b']}]) as builder, \
             patch('learner_api.selectors.assignments._effective_plan_ids', return_value=['A', 'B']), \
             patch('learner_api.home_progress.read_home_progress', side_effect=home) as card:
            payload = week_module.read_week(SimpleNamespace(pk=265),
                now=datetime(2026, 10, 14, tzinfo=timezone.utc), home_kind='commercial', home_summary=True)

        self.assertEqual(payload['modules'], [
            {'id': 'current:A', 'title': 'Alpha', 'weekLabels': ['Week 3']},
            {'id': 'current:B', 'title': 'Beta', 'weekLabels': ['Week 3']}])
        self.assertEqual(set(payload), {'weekStart', 'weekEnd', 'modules', 'homeProgress'})
        self.assertEqual(payload['homeProgress'], {'otjh': {'actual': 0, 'planned': None},
            'activities': {'completed': 1, 'total': 1}, 'period': {'start': None, 'end': '2026-10-18'}})
        args, kwargs = card.call_args
        self.assertEqual((args[2:], kwargs), captured['before'])
        self.assertEqual(args[5], [('A', 'Alpha')])
        self.assertEqual(args[4], progress)
        self.assertEqual([row['module_id'] for row in args[3]], ['A'])
        self.assertEqual([row['module_id'] for row in args[2]], ['A'])
        self.assertEqual(kwargs, {'attendance_module_ids': ['A', 'ATTENDANCE'], 'canonical_metrics': metrics,
                                  'module_counts_only': True})
        self.assertEqual(cursor.execute.call_args_list[0].args, (week_module.HOME_SUBJECTS_SQL, [265]))
        self.assertEqual(cursor.execute.call_args_list[-1].args[1], [['B']])
        self.assertEqual(builder.call_args_list[-1].kwargs['components'],
                         [('b', 'B', 'WB', 'Inherited', 'reading', {})])
        self.assertNotIn('b', {row['id'] for row in native_rows})

    def test_navigation_read_failure_keeps_existing_private_retryable_error(self):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        with patch.dict('learner_api.overview_week.SOURCE_MODELS', {'commercial': model}), \
             patch.object(week_module, 'read_week', side_effect=DatabaseError('private navigation SQL')):
            response = overview_week.__wrapped__.__wrapped__(
                RequestFactory().get('/?section=home-summary'), 'commercial', 265)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content), {'error': 'Could not load this week. Please try again.'})

    def test_compact_navigation_additions_do_not_change_the_full_home_branch(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        with patch.object(week_module, 'connections', cursor_connections(cursor)), \
             patch.object(week_module, '_direct_progress_records', return_value=[]), \
             patch.object(week_module, 'rows', return_value=[]), \
             patch.object(week_module, 'read_builder_activity_dates', return_value={}), \
             patch.object(week_module.canonical_learning, 'metrics', return_value={'otjh': {}}), \
             patch('learner_api.home_progress.read_home_progress', return_value={}), \
             patch.object(week_module, '_home_navigation_modules', side_effect=AssertionError('compact only')) as navigation:
            payload = week_module.read_week(SimpleNamespace(pk=265),
                now=datetime(2026, 10, 14, tzinfo=timezone.utc), home_kind='commercial')
        navigation.assert_not_called()
        self.assertEqual(payload['modules'], [])
        self.assertIn('planSubjects', payload)
        self.assertIn('monthlyOtjh', payload)


def session_row(occurrence_id, start, status='scheduled'):
    """A raw live-session row; ``start`` is naive UTC, as curriculum stores it."""
    return {'session_id': f'series-{occurrence_id}', 'module_id': 'MOD-1', 'module_title': f'Lecture {occurrence_id}',
            'start_datetime': start, 'duration_minutes': 60, 'series_join_url': None, 'repeat_pattern': 'none',
            'series_status': 'scheduled', 'occurrence_id': occurrence_id, 'scheduled_start': start,
            'scheduled_end': None, 'join_url': None, 'status': status, 'attended': None}


def review(review_id, status='scheduled', **dates):
    return {'id': review_id, 'source': 'progress-review', 'title': 'Progress Review', 'status': status,
            'date': None, 'targetDate': None, 'scheduledDate': None, 'scheduledTime': None, **dates}


class ComponentSqlTests(SimpleTestCase):
    def test_other_sections_read_components_exactly_as_before(self):
        sql = week_module.component_sql("'[]'::jsonb")
        self.assertNotIn('builder_', sql)
        self.assertIn("c.settings_json->>'linkedQuizId') AS quiz_id\n            FROM curriculum.components c", sql)

    def test_the_builder_columns_match_the_builder_read(self):
        from .builder_activity_dates import COMPONENT_SCHEDULE_SETTINGS
        sql = week_module.component_sql("'[]'::jsonb", builder_columns=True)
        self.assertIn(f'{COMPONENT_SCHEDULE_SETTINGS} AS builder_settings', sql)
        self.assertIn('c.week_id AS builder_week_id', sql)
        # Missing weeks remain allowed; deleted weeks need their module's archive event.
        # Keep this expectation independent of the production visibility helper.
        self.assertIn(
            "(w.id IS NULL OR (w.deleted_at IS NULL OR EXISTS ("
            "SELECT 1 FROM curriculum.modules archived_module "
            "WHERE archived_module.module_catalogue_id=w.module_catalogue_id "
            "AND archived_module.deleted_at IS NOT NULL "
            "AND COALESCE(w.deleted_via_parent, '') <> '' "
            "AND w.deleted_via_parent IN (archived_module.module_catalogue_id, archived_module.deleted_via_parent) "
            "AND w.deleted_at BETWEEN archived_module.deleted_at - interval '5 minutes' "
            "AND archived_module.deleted_at + interval '5 minutes')))", sql)
        self.assertNotIn(
            "(w.id IS NULL OR w.deleted_at IS NULL OR COALESCE(w.deleted_via_parent, '') <> '')", sql)


class UpcomingSectionTests(SimpleTestCase):
    def read(self, now, sessions=(), deadlines=(), reviews=(), module_ids=('MOD-1',)):
        profile = SimpleNamespace(lifecycle_status='active')
        source = SimpleNamespace(pk=265, email=' Learner@Example.test ', _canonical_profile={'id': 9})
        with patch.object(plan_module, 'connections', cursor_connections(MagicMock())), \
             patch.object(plan_module, 'plan_module_ids', return_value=(list(module_ids), {})), \
             patch.object(plan_module, '_plan_session_rows', return_value=list(sessions)) as session_rows, \
             patch.object(week_module, 'upcoming_assignment_deadlines', return_value=list(deadlines)) as assignments, \
             patch.object(plan_module, 'plan_reviews', return_value=list(reviews)) as read_reviews, \
             patch.object(plan_module.LearnerProfile.objects, 'filter') as profiles:
            profiles.return_value.only.return_value.first.return_value = profile
            payload = plan_module.read_upcoming(source, now=now)
        self.calls = SimpleNamespace(source=source, profile=profile, sessions=session_rows,
                                     assignments=assignments, reviews=read_reviews)
        return payload

    # Wednesday 14 October 2026; next week is Monday 19 to Friday 23 October (BST).
    NOW = datetime(2026, 10, 14, 9, tzinfo=timezone.utc)

    def test_every_next_week_event_merges_in_uk_time_order_without_a_limit(self):
        payload = self.read(
            self.NOW,
            sessions=[session_row('1', datetime(2026, 10, 19, 8)), session_row('2', datetime(2026, 10, 20, 9)),
                      session_row('3', datetime(2026, 10, 21, 9)), session_row('4', datetime(2026, 10, 23, 13))],
            deadlines=[{'id': 'native:c1', 'title': 'Essay', 'date': '2026-10-19'}],
            reviews=[review('R1', scheduledDate='2026-10-19', scheduledTime='08:30'),
                     review('R2', targetDate='2026-10-22'),
                     review('this-week', scheduledDate='2026-10-16', scheduledTime='10:00'),
                     review('saturday', targetDate='2026-10-24'),
                     review('sunday', scheduledDate='2026-10-25', scheduledTime='10:00'),
                     review('week-after', targetDate='2026-10-26')])

        self.assertEqual(payload, {'events': [
            # 08:30 in London is 07:30 UTC, so it precedes the 08:00 UTC (09:00 BST) lecture.
            {'id': 'R1', 'type': 'review', 'title': 'Progress Review', 'date': '2026-10-19T08:30:00+01:00',
             'booked': True},
            {'id': '1', 'type': 'session', 'title': 'Lecture 1', 'date': '2026-10-19T08:00:00+00:00'},
            {'id': 'native:c1', 'type': 'assignment', 'title': 'Essay', 'date': '2026-10-19'},
            {'id': '2', 'type': 'session', 'title': 'Lecture 2', 'date': '2026-10-20T09:00:00+00:00'},
            {'id': '3', 'type': 'session', 'title': 'Lecture 3', 'date': '2026-10-21T09:00:00+00:00'},
            {'id': 'R2', 'type': 'review', 'title': 'Progress Review', 'date': '2026-10-22', 'booked': False},
            {'id': '4', 'type': 'session', 'title': 'Lecture 4', 'date': '2026-10-23T13:00:00+00:00'},
        ]})
        # Sessions and deadlines are bounded to the window before any merging.
        self.calls.assignments.assert_called_once_with(
            self.calls.source, self.calls.profile, date(2026, 10, 19), date(2026, 10, 23))
        self.calls.reviews.assert_called_once_with(self.calls.source, self.calls.profile, ('progress-review',),
                                                   dates_only=True)
        args, kwargs = self.calls.sessions.call_args
        self.assertEqual(args[1:], ('learner@example.test', ['MOD-1']))
        self.assertEqual(kwargs, {'since': datetime(2026, 10, 19, tzinfo=plan_module.UK),
                                  'until': datetime(2026, 10, 24, tzinfo=plan_module.UK)})

    def test_same_day_events_order_by_time_and_inactive_events_drop_out(self):
        payload = self.read(
            self.NOW,
            sessions=[session_row('S', datetime(2026, 10, 20, 14)),
                      session_row('X', datetime(2026, 10, 20, 15), 'Completed ')],
            deadlines=[{'id': 'native:due', 'title': 'Essay', 'date': '2026-10-20'}],
            reviews=[review('morning', scheduledDate='2026-10-20', scheduledTime='12:30'),
                     review('unbooked', targetDate='2026-10-20'),
                     review('cancelled', status='Cancelled', scheduledDate='2026-10-20', scheduledTime='09:00'),
                     review('signing', status='awaiting-signature', targetDate='2026-10-21')])

        # A date-only deadline and review sit at the end of their day, assignment first.
        self.assertEqual([(event['type'], event['id']) for event in payload['events']],
                         [('review', 'morning'), ('session', 'S'), ('assignment', 'native:due'),
                          ('review', 'unbooked')])

    def test_the_window_is_monday_midnight_to_saturday_midnight_in_london(self):
        payload = self.read(self.NOW, reviews=[
            review('sunday-late', scheduledDate='2026-10-18', scheduledTime='23:59'),
            review('monday-start', scheduledDate='2026-10-19', scheduledTime='00:00'),
            review('friday-late', scheduledDate='2026-10-23', scheduledTime='23:59'),
            review('saturday-start', scheduledDate='2026-10-24', scheduledTime='00:00'),
            # Instants: Monday 00:00 BST is Sunday 23:00 UTC; Saturday 00:00 BST is Friday 23:00 UTC.
            review('instant-in', date='2026-10-18T23:00:00Z'),
            review('instant-out', date='2026-10-23T23:00:00Z'),
            review('instant-before', date='2026-10-18T22:59:00Z')])

        self.assertEqual([event['id'] for event in payload['events']],
                         # The two Monday 00:00 reviews share an instant, so their ids decide.
                         ['instant-in', 'monday-start', 'friday-late'])

    def test_next_week_is_counted_from_the_learners_uk_day(self):
        def days(now):
            return plan_module.next_week_window(now)[:2]
        following = (date(2026, 10, 26), date(2026, 10, 30))
        # Monday itself, and a late Sunday in UTC that is already Monday in London, look a week ahead.
        self.assertEqual(days(datetime(2026, 10, 19, 10, tzinfo=timezone.utc)), following)
        self.assertEqual(days(datetime(2026, 10, 18, 23, 30, tzinfo=timezone.utc)), following)
        self.assertEqual(days(datetime(2026, 10, 24, 12, tzinfo=timezone.utc)), following)
        # Sunday in London still looks to the next day.
        self.assertEqual(days(datetime(2026, 10, 18, 22, 30, tzinfo=timezone.utc)),
                         (date(2026, 10, 19), date(2026, 10, 23)))

    def test_london_clock_changes_set_the_window_instants(self):
        # Clocks go back on 25 October 2026 and forward on 28 March 2027.
        _, _, start, end = plan_module.next_week_window(datetime(2026, 10, 21, 9, tzinfo=timezone.utc))
        self.assertEqual((start.astimezone(timezone.utc), end.astimezone(timezone.utc)),
                         (datetime(2026, 10, 26, tzinfo=timezone.utc), datetime(2026, 10, 31, tzinfo=timezone.utc)))
        _, _, start, end = plan_module.next_week_window(datetime(2027, 3, 24, 9, tzinfo=timezone.utc))
        self.assertEqual((start.astimezone(timezone.utc), end.astimezone(timezone.utc)),
                         (datetime(2027, 3, 28, 23, tzinfo=timezone.utc), datetime(2027, 4, 2, 23, tzinfo=timezone.utc)))
        payload = self.read(datetime(2026, 10, 21, 9, tzinfo=timezone.utc),
                            sessions=[session_row('gmt', datetime(2026, 10, 26, 9, 30))],
                            reviews=[review('gmt-review', scheduledDate='2026-10-26', scheduledTime='10:00')])
        self.assertEqual([(event['id'], event['date']) for event in payload['events']], [
            ('gmt', '2026-10-26T09:30:00+00:00'), ('gmt-review', '2026-10-26T10:00:00+00:00')])

    def test_a_learner_without_events_gets_an_empty_list_and_no_session_read(self):
        self.assertEqual(self.read(self.NOW, module_ids=()), {'events': []})
        self.calls.sessions.assert_not_called()

    def test_the_session_query_is_bounded_to_the_window_in_utc(self):
        cursor = MagicMock()
        _, _, start, end = plan_module.next_week_window(self.NOW)
        with patch.object(plan_module, 'rows', return_value=[]):
            plan_module._plan_session_rows(cursor, 'learner@example.test', ['MOD-1'], since=start, until=end)
        sql, params = cursor.execute.call_args.args
        self.assertIn(' AND coalesce(o.scheduled_start,s.start_datetime)>=%s'
                      ' AND coalesce(o.scheduled_start,s.start_datetime)<%s', sql)
        self.assertNotIn('FETCH', sql)
        self.assertEqual(params, [['MOD-1'], 'learner@example.test',
                                  datetime(2026, 10, 18, 23), datetime(2026, 10, 23, 23)])

    def test_overview_session_query_has_no_time_filter(self):
        cursor = MagicMock()
        with patch.object(plan_module, 'rows', return_value=[]):
            plan_module.plan_sessions(cursor, 'learner@example.test', ['MOD-1'])
        sql, params = cursor.execute.call_args.args
        self.assertNotIn('>=%s', sql)
        self.assertEqual(params, [['MOD-1'], 'learner@example.test'])

    def test_dispatches_the_upcoming_section(self):
        with patch.object(plan_module, 'read_upcoming', return_value={'sessions': []}) as upcoming:
            self.assertEqual(plan_module.read_dashboard('source', section='upcoming'), {'sessions': []})
        upcoming.assert_called_once_with('source')


def assignment(component_id, due_timing='End of week', quiz_id=None, progress=()):
    return {'id': component_id, 'module_id': 'MOD-1', 'title': f'Essay {component_id}', 'type': 'assignment',
            'section_title': 'Week 3', 'due_timing': due_timing, 'quiz_id': quiz_id, 'progress': list(progress)}


class UpcomingAssignmentDeadlineTests(SimpleTestCase):
    def read(self, components, dates, profile=SimpleNamespace(id=9), until=None):
        cursor = MagicMock()
        with patch.object(week_module, 'connections', cursor_connections(cursor)), \
             patch.object(week_module, 'rows', return_value=components), \
             patch.object(week_module, 'read_builder_activity_dates', return_value=dates) as builder:
            result = week_module.upcoming_assignment_deadlines(SimpleNamespace(pk=265), profile,
                                                               date(2026, 10, 14), until)
        return result, cursor, builder

    def test_one_query_reads_plan_assignments_and_their_progress_and_skips_dates_without_a_due_rule(self):
        result, cursor, builder = self.read([assignment('c1', due_timing='')], {})
        self.assertEqual(result, [])
        self.assertEqual(cursor.execute.call_count, 1)
        sql, params = cursor.execute.call_args.args
        self.assertIn("c.type='assignment'", sql)
        self.assertIn('WHERE home.current_plan', sql)
        self.assertIn("p.component_link_source IN ('direct','quiz_ref') AND p.kind<>'activity_event'", sql)
        self.assertEqual(params, [9, 265])
        builder.assert_not_called()

    def test_without_a_learner_profile_no_progress_can_match(self):
        _, cursor, _ = self.read([], {}, profile=None)
        self.assertEqual(cursor.execute.call_args.args[1], [None, 265])

    def test_only_dated_incomplete_assignments_due_from_today_remain(self):
        week = lambda end: {'date': end, 'week_end': end, 'date_needs_review': False}  # noqa: E731
        components = [
            assignment('due', progress=[{'kind': 'quiz', 'passed': None, 'componentId': None, 'quizId': 'Q9'}]),
            assignment('past'),
            assignment('done', progress=[{'kind': 'assignment', 'passed': None, 'componentId': 'done', 'quizId': None}]),
            assignment('quiz-done', quiz_id='Q1',
                       progress=[{'kind': 'quiz', 'passed': True, 'componentId': None, 'quizId': 'Q1'}]),
            assignment('failed', progress=[{'kind': 'assignment', 'passed': False, 'componentId': 'failed', 'quizId': None}]),
            assignment('review', due_timing=' END OF WEEK '),
        ]
        dates = {'due': week('2026-10-18'), 'past': week('2026-10-11'), 'done': week('2026-10-14'),
                 'quiz-done': week('2026-10-25'), 'failed': week('2026-10-15'),
                 'review': {**week('2026-10-25'), 'date_needs_review': True}}

        result, _, builder = self.read(components, dates)

        # A failed hand-in is still due; a completed one or a passed linked quiz is not.
        self.assertEqual(result, [{'id': 'native:failed', 'title': 'Essay failed', 'date': '2026-10-15'},
                                  {'id': 'native:due', 'title': 'Essay due', 'date': '2026-10-18'}])
        builder.assert_called_once()
        self.assertEqual(builder.call_args.args[1], ['MOD-1'])

    def test_a_range_without_a_sunday_has_no_deadlines_and_reads_nothing(self):
        result, cursor, builder = self.read([assignment('c1')], {}, until=date(2026, 10, 16))  # Wednesday to Friday
        self.assertEqual(result, [])
        cursor.execute.assert_not_called()
        builder.assert_not_called()
        # Monday to Friday of next week likewise.
        with patch.object(week_module, 'connections') as connections:
            self.assertEqual(week_module.upcoming_assignment_deadlines(
                SimpleNamespace(pk=265), None, date(2026, 10, 19), date(2026, 10, 23)), [])
        connections.__getitem__.assert_not_called()

    def test_every_due_date_is_the_sunday_ending_its_week(self):
        # The guard above relies on ``week_end`` always being a Sunday, for
        # Builder-dated, title-dated and section-dated schedules alike.
        from .builder_activity_dates import _dated_schedule
        from .subject_dates import activity_schedule
        schedules = [_dated_schedule(date(2026, 10, 19) + timedelta(days=offset), 'builder_week') for offset in range(7)]
        schedules += [activity_schedule('Lecture 21/10/2026'), activity_schedule('', '2026-10-25'),
                      activity_schedule('Essay', section_title='Week 3 - 23 October 2026')]
        dated = [schedule for schedule in schedules if schedule['week_end']]
        self.assertGreaterEqual(len(dated), 8)
        self.assertTrue(all(date.fromisoformat(schedule['week_end']).weekday() == 6 for schedule in dated))

    def test_an_end_date_keeps_only_deadlines_due_up_to_it(self):
        week = lambda end: {'date': end, 'week_end': end, 'date_needs_review': False}  # noqa: E731
        result, _, _ = self.read([assignment('sunday'), assignment('next-sunday')],
                                 {'sunday': week('2026-10-18'), 'next-sunday': week('2026-10-25')},
                                 until=date(2026, 10, 18))
        self.assertEqual([row['id'] for row in result], ['native:sunday'])


class ResolvedGroupDatesTests(SimpleTestCase):
    def test_a_request_scoped_answer_is_reused(self):
        learner = SimpleNamespace(start_date=None, end_date=None, programme='P', cohort='C',
                                  _resolved_group_dates=(date(2026, 1, 5), date(2026, 12, 18), 'cohort'))
        with patch('learner_api.active_users.cohort_dates') as cohort:
            self.assertEqual(_group_dates(learner), (date(2026, 1, 5), date(2026, 12, 18), 'cohort'))
        cohort.assert_not_called()

    def test_mock_learners_without_a_stored_answer_still_resolve(self):
        learner = MagicMock(start_date=date(2026, 1, 5), end_date=date(2026, 12, 18))
        self.assertEqual(_group_dates(learner), (date(2026, 1, 5), date(2026, 12, 18), 'learner'))
