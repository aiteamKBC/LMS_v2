"""Calendar query budgets with synthetic records; real database access is forbidden."""
from contextlib import ExitStack
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from django.test import SimpleTestCase

from coach_api import views
from coach_api.models import CoachCalendarEvent
from learner_api.models import LearnerProfile


class TimetableBatchMetadataTests(SimpleTestCase):
    def test_confirmed_bookings_share_metadata_reads_and_keep_their_payload(self):
        owner = SimpleNamespace(id=7, learner_type='commercial', enrolment_id=107)
        records = [CoachCalendarEvent(
            pk=index + 1, event_key=f'booking:{index}', learner_id=7,
            owner_email='coach@example.invalid', learner_email='learner@example.invalid',
            learner_name='Synthetic learner', event_type='mcr', review_template_id='template',
            review_instance_id=f'instance:{index}', target_date=date(2026, 11, 2),
            scheduled_date=date(2026, 11, 2), scheduled_time=time(10), duration_minutes=60,
            status='scheduled', sync_state='synced', graph_event_id=f'event:{index}',
            meeting_link='https://example.invalid/meeting',
        ) for index in range(30)]
        type_row = {'id': 'MCM', 'code': 'mcm', 'name': 'Monthly Coaching Meeting', 'is_system': True}
        template = {'id': 'template', 'review_type_id': 'MCM', 'name': 'Renamed monthly conversation'}
        with ExitStack() as stack:
            templates = stack.enter_context(patch.object(views.curriculum_reviews, 'get_review_template_rows', return_value=[template]))
            types = stack.enter_context(patch('curriculum_api.review_types.review_type_index', return_value={'MCM': type_row}))
            expected = views.build_catchup_calendar_event(records[0], owner_name='Coach', learner=owner)
            templates.reset_mock(); types.reset_mock()
            for name, result in {
                'fetch_owner_active_learner_profiles': [],
                'fetch_caseload_timetable_profiles': [owner],
                'build_learner_profile_map': {7: owner},
                'coach_staff_display_name': 'Coach',
                'resolve_coach_review_events': {'events': [], 'sourceCounts': {}, 'reviewGenerationIssues': [], 'aptemProfileIds': {7}},
                'fetch_standalone_event_records': records,
                'build_timetable_summary': {},
            }.items():
                stack.enter_context(patch.object(views, name, return_value=result))
            stack.enter_context(patch.object(views.curriculum_review_instances, 'reconcile_review_event_keys', return_value={}))
            stack.enter_context(patch('coach_api.review_sources.standalone_review_records', return_value=[]))
            stack.enter_context(patch('coach_api.calendar_booking_only.unlinked_review_bookings', return_value=[(record, owner) for record in records]))
            stack.enter_context(patch.object(views, 'assign_timetable_slots', side_effect=lambda events: events))
            result = views.collect_generated_timetable('coach@example.invalid', include_live_sessions=False,
                include_scheduler_queues=False, include_unlinked_bookings=True)
            self.assertEqual(len(result['events']), 30)
            self.assertEqual(templates.call_count, 2)  # One type batch and one title batch, regardless of booking count.
            types.assert_called_once()
            self.assertTrue(all(call.kwargs['include_deleted'] for call in templates.call_args_list))
            first = result['events'][0]
            for field in ('eventKey', 'title', 'source', 'status', 'date', 'scheduledTime',
                          'meetingLink', 'durationMinutes', 'reviewTypeId', 'reviewTypeName'):
                self.assertEqual(first[field], expected[field], field)
            self.assertTrue(all(event['bookingOnly'] and event['reviewId'] is None for event in result['events']))

    def test_empty_and_missing_template_names_do_not_fall_back_to_per_booking_reads(self):
        with patch.object(views.curriculum_reviews, 'get_review_template_rows', return_value=[]) as read:
            self.assertEqual(views.review_titles_by_template([]), {})
            read.assert_not_called()
            titles = views.review_titles_by_template(['missing', 'missing', '', None])
            read.assert_called_once()
            self.assertEqual(read.call_args.args[1], ['missing'])
            record = CoachCalendarEvent(event_type='review', review_template_id='missing',
                target_date=date(2026, 11, 2), status='scheduled')
            event = views.build_catchup_calendar_event(record, review_type_fields={}, review_titles=titles)
            self.assertEqual(event['title'], 'Review')
            read.assert_called_once()


class TimetableLearnerIdentityQueryTests(SimpleTestCase):
    def test_catchup_queue_does_not_lazy_load_each_learners_type(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), patch.object(LearnerProfile, 'objects') as manager:
                query = MagicMock()
                manager.annotate.return_value.filter.return_value = query

                def selected(*fields):
                    values = {'id': 7, 'full_name': 'Synthetic learner', 'learner_type': kind, 'enrolment_id': 107}
                    # Accessing any omitted model field triggers a real lazy
                    # query, which SimpleTestCase will reject.
                    names = [field.attname for field in LearnerProfile._meta.concrete_fields if field.attname in fields]
                    row = LearnerProfile.from_db('default', names, [values.get(name) for name in names])
                    return SimpleNamespace(order_by=lambda *args: [row])

                query.only.side_effect = selected
                rows = views.fetch_owner_active_learner_profiles('coach@example.invalid')
                events = views.build_catchup_scheduler_events('coach@example.invalid', 'Coach', rows, {}, [])
                self.assertEqual(len(events), 1)
                self.assertEqual(events[0]['learnerType'], kind)
                self.assertEqual(events[0]['enrolmentId'], '107')

    def test_schedule_projection_keeps_identity_dates_and_employer_contacts_without_plans(self):
        for kind in ('commercial', 'apprenticeship'):
            for aptem_id in (None, '701'):
                with self.subTest(kind=kind, imported=bool(aptem_id)), ExitStack() as stack:
                    profile_values = {
                        'id': 7, 'enrolment_id': 107, 'full_name': 'Synthetic learner',
                        'learner_type': kind, 'aptem_id': aptem_id, 'programme': 'Programme',
                        'coach_email': 'coach@example.invalid',
                    }
                    source_values = {
                        'id': 107, 'learner_type': kind, 'aptem_id': aptem_id,
                        'start_date': '2026-09-01', 'end_date': '2027-09-01',
                        'learner_start_date': '2026-10-05', 'employer': 'Synthetic employer',
                        'contacts': [{'email': 'manager@example.invalid', 'name': 'Manager'}],
                    }

                    def deferred(model, fields, values):
                        names = [field.attname for field in model._meta.concrete_fields if field.attname in fields]
                        return model.from_db('default', names, [values.get(name) for name in names])

                    profile_manager = stack.enter_context(patch.object(LearnerProfile, 'objects'))
                    query = profile_manager.annotate.return_value.filter.return_value
                    query.only.side_effect = lambda *fields: SimpleNamespace(
                        order_by=lambda *args: [deferred(LearnerProfile, fields, profile_values)])
                    source_manager = stack.enter_context(patch.object(views.EnrolmentUser, 'all_learners'))
                    source_manager.filter.return_value.only.side_effect = lambda *fields: [
                        deferred(views.EnrolmentUser, fields, source_values)]
                    profiles = views.fetch_caseload_timetable_profiles('coach@example.invalid')
                    profile = profiles[0]
                    source = profile._caseload_source
                    self.assertTrue({'learning_plan', 'training_plan', 'review_documents'}.issubset(source.get_deferred_fields()))
                    resolved, conflicts = views.resolve_effective_aptem_ids(profiles, strict=True)
                    self.assertEqual(resolved, {7: 701} if aptem_id else {})
                    self.assertFalse(conflicts)
                    commercial, enrolment = ({7: source}, {}) if kind == 'commercial' else ({}, {7: source})
                    self.assertEqual(views.resolve_review_anchor_date(7, commercial, enrolment)[0], date(2026, 10, 5))
                    self.assertEqual(views.resolve_schedule_window(7, commercial, enrolment, profile),
                                     (date(2026, 9, 1), date(2027, 9, 1)))
                    self.assertEqual(views.learner_employer_attendee(profile, source)['email'], 'manager@example.invalid')
                    source_manager.filter.assert_called_once_with(pk__in={107: 7})


class TimetableLiveComponentProjectionTests(SimpleTestCase):
    def test_narrowed_components_keep_live_occurrence_and_skip_content_and_archived_weeks(self):
        module = {'id': 'M1', 'module_name': 'Synthetic module', 'start_date': '2026-11-02',
                  'sessions_number': 2, 'session_week_day': 'Monday',
                  '_meta': {'module_catalogue_id': 'M1', 'cohort_id': 'C1'}}
        weeks = [{'id': f'W{n}', 'module_catalogue_id': 'M1', 'week_number': n, 'title': f'Week {n}'}
                 for n in (1, 2)]
        components = [
            {'id': 'Q1', 'type': 'quiz', 'module_catalogue_id': 'M1', 'week_id': 'W1'},
            {'id': 'OLD', 'type': 'live_session', 'module_catalogue_id': 'M1', 'week_id': 'W1',
             'deleted_at': '2026-10-01'},
            {'id': 'LIVE', 'type': ' Live_Session ', 'module_catalogue_id': 'M1', 'week_id': 'W2',
             'live_sessions_link': 'https://example.invalid/component'},
        ]
        transferred = []

        def read(table, where='', params=None, *args, **kwargs):
            if table == views.AUTHORING_WEEKS_TABLE:
                return weeks
            if table == views.AUTHORING_COMPONENTS_TABLE:
                self.assertIn('type', where)
                self.assertEqual(params, ['%live_session%'])
                rows = [row for row in components if 'live_session' in row['type'].lower()]
                transferred.extend(rows)
                return rows
            if table == views.LIVE_SESSIONS_TABLE:
                return [{'id': 'S1', 'module_catalogue_id': 'M1', 'timezone': 'Europe/London'}]
            if table == views.LIVE_SESSION_OCCURRENCES_TABLE:
                return [{'id': 'O1', 'live_session_id': 'S1', 'session_number': 1,
                         'join_url': 'https://example.invalid/occurrence', 'status': 'scheduled'}]
            self.fail(f'Unexpected table: {table}')

        with ExitStack() as stack:
            for name, value in {
                'coach_has_live_session_access': True, 'fetch_official_assigned_groups': [{'id': 'G1'}],
                'get_program_config_rows': [], 'authoring_modules_as_training_rows': [module],
                'is_operational_training_row': True,
                'programme_identity': {'name': 'Programme', 'sourceId': 'P1'},
                'actual_cohort_identity': {'id': 'C1', 'name': 'Cohort'},
                'actual_group_identity': {'id': 'G1', 'name': 'Group'},
                'live_session_matches_assigned_group': True, 'fetch_cohort_selected_holidays': [],
            }.items():
                stack.enter_context(patch.object(views, name, return_value=value))
            stack.enter_context(patch.object(views, 'authoring_fetch_all', side_effect=read))
            events = views.collect_live_session_events('coach@example.invalid', 'Coach', include_past=True)
        self.assertEqual(len(transferred), 2)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['occurrenceId'], 'O1')
        self.assertEqual(events[0]['date'], '2026-11-09')
        self.assertEqual(events[0]['meetingLink'], 'https://example.invalid/occurrence')
        self.assertIn('Week 2', events[0]['title'])
