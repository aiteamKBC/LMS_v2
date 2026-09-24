"""Learner calendar projects Curriculum reviews and preserves stored bookings."""
from datetime import date, timedelta
import inspect
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from curriculum_api.review_instances import review_calendar_event_key


from .calendar import _belongs_to_current_cycle, _generated_cycle_events, coaching_events_for_learner

START = date(2026, 8, 3)
END = date(2027, 8, 2)


def _mirror(**kwargs):
    fields = {
        'id': 248,
        'email': 'aya.khater@example.com',
        'start_date': START,
        'end_date': END,
        'coach_name': 'Coach Two',
        'coach_email': 'coach21@g.com',
        # Read when live curriculum sessions are folded in; empty keeps these
        # focused on the coaching cycle.
        'programme': '',
        'cohort': '',
        'group_name': '',
    }
    fields.update(kwargs)
    return SimpleNamespace(**fields)


def _learner(**kwargs):
    fields = {
        'pk': 101,
        'email': 'aya.khater@example.com',
        # learner_start_date is the Review recurrence anchor; start_date is
        # kept in step too since resolve_schedule_window's WINDOW bound
        # still reads it.
        'learner_start_date': START,
        'start_date': START,
        'end_date': None,
        'practical_period_end_date': '',
        'apprenticeship_end_date': '',
    }
    fields.update(kwargs)
    return SimpleNamespace(**fields)


def _record(event_type='mcr', learner_id=248, event_key='mcr:248:1:2026-09-02', idempotency_key=''):
    return SimpleNamespace(
        event_type=event_type,
        learner_id=learner_id,
        event_key=event_key,
        idempotency_key=idempotency_key,
        status='scheduled',
    )


class CurriculumCycleFixture:
    def setUp(self):
        super().setUp()
        self.programme = patch('coach_api.views.resolve_curriculum_programme_id', return_value='PROG-1').start()
        self.occurrences = patch('coach_api.views.resolve_curriculum_review_occurrences', return_value=[
            {'reviewTemplateId': 'REV-MCM', 'reviewName': 'Coaching conversation',
             'reviewTypeCode': 'mcm', 'reviewTypeId': 'REVT-MCM',
             'reviewTypeName': 'Monthly Coaching Meeting', 'reviewTypeIsSystem': True,
             'occurrenceNumber': sequence, 'targetDate': START + timedelta(weeks=6 * sequence)}
            for sequence in (1, 2)
        ] + [
            {'reviewTemplateId': 'REV-PR', 'reviewName': 'Progress conversation',
             'reviewTypeCode': 'progress_review', 'reviewTypeId': 'REVT-PROGRESS_REVIEW',
             'reviewTypeName': 'Progress Review', 'reviewTypeIsSystem': True,
             'occurrenceNumber': 1, 'targetDate': START + timedelta(weeks=8)}
        ]).start()
        self.addCleanup(patch.stopall)


class GeneratedCycleTests(CurriculumCycleFixture, SimpleTestCase):
    def test_shared_coaching_source_rejects_another_email_with_a_colliding_numeric_id(self):
        mine=_record();mine.learner_email='AYA.KHATER@example.com'
        foreign=_record(event_key='someone-else');foreign.learner_email='another@example.com'
        blank=_record(event_key='legacy-empty-email');blank.learner_email=''
        wrong_blank=_record(learner_id=101,event_key='ambiguous-source-id');wrong_blank.learner_email=''
        queryset=Mock();queryset.order_by.return_value=[mine,foreign,blank,wrong_blank]
        with patch('learner_api.calendar.CoachCalendarEvent.objects.filter',return_value=queryset), \
             patch('learner_api.calendar._serialize_event',side_effect=lambda record,**_:{'eventKey':record.event_key}), \
             patch('learner_api.calendar._generated_cycle_events',return_value=[]) as generate:
            events=coaching_events_for_learner(_learner(),_mirror())
        self.assertEqual([row['eventKey'] for row in events],[mine.event_key,blank.event_key])
        self.assertEqual(generate.call_args.args[2], set())

    def test_the_cycle_is_generated_from_the_learners_window(self):
        events = _generated_cycle_events(_learner(), _mirror(), set())

        monthly = [e for e in events if e['source'] == 'mcr']
        reviews = [e for e in events if e['source'] == 'progress-review']
        self.assertTrue(monthly)
        self.assertTrue(reviews)
        # Counted from the start date at the coach's own intervals.
        self.assertEqual(monthly[0]['date'], (START + timedelta(weeks=6)).isoformat())
        self.assertEqual(
            reviews[0]['date'], (START + timedelta(weeks=8)).isoformat(),
        )

    def test_every_slot_carries_the_key_the_coach_timetable_builds(self):
        # The keys are how the two calendars are reconciled — a different key
        # would put the same meeting on both screens as two separate items.
        events = _generated_cycle_events(_learner(), _mirror(), set())
        first = next(e for e in events if e['source'] == 'mcr')

        self.assertEqual(
            first['eventKey'],
            review_calendar_event_key(248, 'REV-MCM', 1),
        )

    def test_a_generated_slot_reads_as_not_scheduled_with_no_time(self):
        events = _generated_cycle_events(_learner(), _mirror(), set())
        first = events[0]

        self.assertEqual(first['status'], 'not-scheduled')
        self.assertIsNone(first['scheduledDate'])
        self.assertIsNone(first['scheduledTime'])
        self.assertFalse(first['invited'])
        self.assertTrue(first['isTimeEstimated'])
        # Named as the learner's own coach, since that is who they would meet.
        self.assertEqual(first['coachEmail'], 'coach21@g.com')

    def test_new_slots_use_current_assignment_even_when_profile_is_stale(self):
        learner = _learner(case_owner='Test curriculum', coach_name='Test curriculum',
                           coach_email='curriculum@example.com')
        for programme_id in ('PROG-1', None):
            with self.subTest(programme_id=programme_id):
                self.programme.return_value = programme_id
                events = _generated_cycle_events(learner, _mirror(), set())
                self.assertTrue(events)
                self.assertTrue(all(event['coachName'] == 'Test curriculum' for event in events))
                self.assertTrue(all(event['coachEmail'] == 'curriculum@example.com' for event in events))

    def test_explicitly_cleared_assignment_does_not_reuse_profile_coach(self):
        events = _generated_cycle_events(
            _learner(case_owner='', coach_name='', coach_email=''), _mirror(), set(),
        )
        self.assertTrue(events)
        self.assertTrue(all(event['coachName'] == event['coachEmail'] == '' for event in events))

    def test_a_slot_that_is_already_booked_is_left_to_its_stored_row(self):
        booked = review_calendar_event_key(248, 'REV-MCM', 1)

        events = _generated_cycle_events(_learner(), _mirror(), {booked})

        self.assertNotIn(booked, [e['eventKey'] for e in events])
        # The rest of the cycle still generates.
        self.assertTrue([e for e in events if e['source'] == 'mcr'])

    def test_the_window_falls_back_to_the_enrolment_row(self):
        # The coach passes prefetched commercial/enrolment maps; this endpoint
        # holds one learner, so the row's own dates stand in.
        learner = _learner(learner_start_date='2026-08-03', start_date='2026-08-03', end_date='2027-08-02')

        events = _generated_cycle_events(learner, _mirror(start_date=None, end_date=None), set())

        self.assertTrue(events)

    def test_a_learner_with_no_window_has_no_cycle_to_show(self):
        # Nothing to count from — the coach timetable skips them too.
        self.assertEqual(
            _generated_cycle_events(
                _learner(learner_start_date=None, start_date=None), _mirror(start_date=None, end_date=None), set(),
            ), [],
        )

    def test_an_end_date_before_the_start_generates_nothing(self):
        mirror = _mirror(start_date=END, end_date=START)

        self.assertEqual(
            _generated_cycle_events(
                _learner(learner_start_date=END, start_date=END, end_date=START), mirror, set(),
            ), [],
        )

    def test_a_learner_with_no_delivery_record_has_no_cycle(self):
        self.assertEqual(_generated_cycle_events(_learner(), None, set()), [])

    def test_no_configured_reviews_means_no_fallback_cycle(self):
        self.occurrences.return_value = []
        self.assertEqual(_generated_cycle_events(_learner(), _mirror(), set()), [])

    def test_placement_is_forwarded_to_the_shared_engine(self):
        _generated_cycle_events(_learner(), _mirror(cohort_id='C-1', group_id='G-1'), set())
        self.assertEqual(self.occurrences.call_args.kwargs['learner_scope']['group_id'], 'G-1')
        self.assertEqual(self.occurrences.call_args.kwargs['learner_start_date'], START)


class StoredRowOwnershipTests(SimpleTestCase):
    """Which stored rows are this learner's cycle.

    Rows match on email as well as mirror id, so a learner's bookings survive
    their mirror being recreated. The bad case is a cycle slot generated against
    a mirror that has since been deleted: its dates came from a window the
    learner no longer has, and the coach — who only builds keys from live
    caseload profiles — cannot see it.
    """

    def test_a_slot_from_this_learners_own_mirror_is_kept(self):
        self.assertTrue(_belongs_to_current_cycle(_record(), _mirror()))

    def test_a_slot_left_behind_by_a_deleted_mirror_is_dropped(self):
        orphan = _record(learner_id=2, event_key='mcr:2:1:2026-08-07')

        self.assertFalse(_belongs_to_current_cycle(orphan, _mirror()))

    def test_a_learner_booked_review_survives_source_and_mirror_id_difference(self):
        # Learner calendar POSTs use the source learner id (101), while the
        # current Active_users mirror can have a different id (248). The GET
        # must return that durable booking after a page refresh.
        booked = _record(
            event_type='progress-review',
            learner_id=101,
            event_key='progress-review:101:1:2026-09-06',
            idempotency_key='learner-book:operation-hash',
        )

        self.assertTrue(_belongs_to_current_cycle(booked, _mirror()))

    def test_a_booking_is_kept_whatever_mirror_it_was_made_under(self):
        # Somebody arranged these; they belong to the learner regardless.
        for event_type in ('catch-up', 'student-support', 'eligibility-review'):
            record = _record(event_type=event_type, learner_id=2)
            self.assertTrue(
                _belongs_to_current_cycle(record, _mirror()),
                f'{event_type} should survive a mirror change',
            )

    def test_a_row_with_no_learner_id_is_kept(self):
        # Matched by email alone; nothing says it is not theirs.
        self.assertTrue(_belongs_to_current_cycle(_record(learner_id=None), _mirror()))

    def test_nothing_is_filtered_for_a_learner_with_no_mirror(self):
        # Without a mirror there is no id to compare against, and hiding their
        # history would be worse than showing an old row.
        self.assertTrue(_belongs_to_current_cycle(_record(learner_id=2), None))


class CalendarResponseTests(CurriculumCycleFixture, SimpleTestCase):
    """The endpoint hands the page one calendar in date order."""

    def _call(self, records, mirror, live_events=None, module_ids=None, learner=None, kind='commercial'):
        from django.test import RequestFactory

        from . import calendar as module

        queryset = Mock()
        queryset.order_by.return_value = records
        with patch.object(module, 'SOURCE_MODELS', {kind: Mock()}) as models, \
                patch.object(module.CoachCalendarEvent.objects, 'filter', return_value=queryset), \
                patch('coach_api.views.collect_live_session_events', return_value=live_events or []) as collect_live, \
                patch.object(module, 'learner_profile_for_source', return_value=mirror), \
                patch.object(module.connections['enrolment'], 'cursor') as cursor, \
                patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff', id=-1)):
            cursor.return_value.__enter__.return_value.fetchall.return_value = [(key,) for key in (module_ids if module_ids is not None else ['MOD-1'])]
            models[kind].all_learners.filter.return_value.first.return_value = learner or _learner()
            response = inspect.unwrap(module.learner_calendar)(RequestFactory().get('/x'), kind, 101)
        self.assertEqual(response.status_code, 200)
        import json
        return json.loads(response.content), collect_live

    def test_legacy_cycle_keeps_saved_teams_booking_without_review_template_fields(self):
        from .tests_booking_calendar import RescheduleEndpointTests

        self.programme.return_value = None
        learner, mirror = _learner(), _mirror()
        generated = _generated_cycle_events(learner, mirror, set())
        for kind in ('commercial', 'apprenticeship'):
            for event_type in ('mcr', 'progress-review'):
                slot = next(event for event in generated if event['source'] == event_type)
                for status in ('scheduled', 'completed'):
                    with self.subTest(kind=kind, event_type=event_type, status=status):
                        record = RescheduleEndpointTests.scheduled_record()
                        record.event_key = slot['eventKey']
                        record.event_type = event_type
                        record.sequence = slot['sequence']
                        record.target_date = date.fromisoformat(slot['targetDate'])
                        record.learner_id = mirror.id
                        record.learner_email = learner.email
                        record.status = status
                        record.notes = 'Preserve the booked session'
                        record.review_responses = {'learner_signature': 'synthetic-signature'}
                        record.save = Mock(side_effect=AssertionError('Calendar reads must not save bookings'))
                        original = vars(record).copy()
                        with patch('coach_api.views.microsoft_graph_request') as graph:
                            for _ in range(2):
                                body, _ = self._call([record], mirror, module_ids=[], learner=learner, kind=kind)
                                booked = [event for event in body['events'] if event['eventKey'] == record.event_key]
                                self.assertEqual(len(booked), 1)
                                event = booked[0]
                                self.assertEqual(event['status'], status)
                                self.assertEqual(event['source'], event_type)
                                self.assertEqual(event['date'], record.scheduled_date.isoformat())
                                self.assertEqual(event['targetDate'], slot['targetDate'])
                                self.assertEqual(event['scheduledTime'], '10:00')
                                self.assertEqual(event['durationMinutes'], 60)
                                self.assertEqual(event['meetingLink'], record.meeting_link)
                                self.assertEqual(event['coachEmail'], record.owner_email)
                                self.assertEqual(event['notes'], record.notes)
                                self.assertEqual(event['reviewResponses'], record.review_responses)
                                self.assertTrue(event['learnerSigned'])
                                self.assertTrue(event['invited'])
                                self.assertEqual(event['syncState'], 'synced')
                                self.assertIsNone(event['reviewTemplateId'])
                                self.assertEqual(event['occurrenceNumber'], record.sequence)
                                self.assertEqual(len(body['events']), len(generated))
                            graph.assert_not_called()
                        record.save.assert_not_called()
                        self.assertEqual(vars(record), original)

    def test_current_coach_is_separate_from_existing_meeting_organiser_and_link(self):
        from .tests_booking_calendar import RescheduleEndpointTests
        record = RescheduleEndpointTests.scheduled_record()
        record.event_type = 'mcr'
        record.learner_id = 248
        record.learner_email = 'aya.khater@example.com'
        record.owner_name = 'Rewan Yasser'
        record.owner_email = 'rewan@example.com'
        learner = _learner(case_owner='Test curriculum', coach_name=None, coach_email=None)
        for status in ('scheduled', 'completed', 'awaiting-signature'):
            with self.subTest(status=status), patch('learner_api.coach_assignment.StaffUser.objects.filter') as staff:
                record.status = status
                staff.return_value.only.return_value.__getitem__.return_value = [
                    SimpleNamespace(email='curriculum@example.com')]
                body, _ = self._call([record], _mirror(), module_ids=[], learner=learner)
                self.assertEqual(body['currentCoach'], {
                    'name': 'Test curriculum', 'email': 'curriculum@example.com',
                })
                stored = next(event for event in body['events'] if event['eventKey'] == record.event_key)
                self.assertEqual(stored['coachName'], 'Rewan Yasser')
                self.assertEqual(stored['coachEmail'], 'rewan@example.com')
                self.assertEqual(stored['meetingLink'], 'https://teams.microsoft.com/l/meetup-join/test')
                self.assertEqual(record.owner_name, 'Rewan Yasser')

    def test_empty_calendar_still_returns_current_assignment(self):
        learner = _learner(email='', case_owner='Test curriculum', coach_name='Test curriculum',
                           coach_email='curriculum@example.com')
        body, _ = self._call([], None, learner=learner)
        self.assertEqual(body['events'], [])
        self.assertEqual(body['currentCoach'], {
            'name': 'Test curriculum', 'email': 'curriculum@example.com',
        })

    def test_generated_slots_are_returned_in_date_order(self):
        # No coach email: live curriculum sessions are folded in through the
        # coach module and read the database, which is not what these assert.
        body, _collect_live = self._call([], _mirror(coach_email=''))
        dates = [event['date'] for event in body['events']]

        self.assertTrue(dates)
        self.assertEqual(dates, sorted(dates))

    def test_the_cycle_appears_even_with_nothing_booked(self):
        # The reported bug: an empty learner calendar beside a coach calendar
        # full of "Not Scheduled" slots.
        body, _collect_live = self._call([], _mirror(coach_email=''))

        cycle = [e for e in body['events'] if e['source'] in ('mcr', 'progress-review')]
        self.assertTrue(cycle)
        self.assertTrue(all(e['status'] == 'not-scheduled' for e in cycle))

    def test_live_sessions_are_scoped_by_assigned_modules_not_profile_group(self):
        body, collect_live = self._call(
            [],
            _mirror(
                coach_email='',
                programme='Digital Marketing',
                programme_id='PROG-1',
                cohort='September',
                cohort_id='COHORT-1',
                group_name='Group A',
                group_id='GROUP-1',
            ),
            live_events=[{
                'id': 'live-session-MOD-1-1',
                'eventKey': 'live-session-MOD-1-1',
                'title': 'Marketing Foundations - Week 1',
                'source': 'live-session',
                'type': 'live-session',
                'sequence': 1,
                'status': 'scheduled',
                'date': '2026-09-14',
                'targetDate': '2026-09-14',
                'startHour': 10,
                'durationMinutes': 60,
                'tutor': 'Tutor One',
                'meetingLink': 'https://teams.example/join',
                'programme': 'Digital Marketing',
                'cohort': 'September',
                'group': 'Group A',
                'module': 'Marketing Foundations',
            }],
        )

        self.assertTrue(collect_live.called)
        _, _, kwargs = collect_live.mock_calls[0]
        self.assertFalse(kwargs['require_coach_access'])
        self.assertTrue(kwargs['include_past'])
        self.assertEqual(kwargs['learner_module_ids'], ['MOD-1'])
        self.assertNotIn('learner_scope', kwargs)
        live = [event for event in body['events'] if event['source'] == 'live-session']
        self.assertEqual(len(live), 1)
        self.assertEqual(live[0]['meetingLink'], 'https://teams.example/join')

    def test_no_assigned_modules_does_not_fall_back_to_group_sessions(self):
        body, collect_live = self._call([], _mirror(), module_ids=[])
        collect_live.assert_not_called()
        self.assertFalse(any(event['source'] == 'live-session' for event in body['events']))


class AssignedModuleLiveSessionTests(SimpleTestCase):
    def test_explicit_assignment_includes_other_group_and_excludes_unassigned_module(self):
        from coach_api import views
        rows = [
            {'id': key, 'module_name': key, 'start_date': '2026-09-01',
             'sessions_number': 1, 'session_week_day': 'Tuesday',
             '_meta': {'module_catalogue_id': key}}
            for key in ['assigned-other-group', 'unassigned-same-group']
        ]
        with patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'authoring_fetch_all', side_effect=lambda table, *args, **kwargs: [
                 {'id': 'W1', 'module_catalogue_id': 'assigned-other-group', 'week_number': 1, 'title': 'Week 1'}
             ] if table == views.AUTHORING_WEEKS_TABLE else []), \
             patch.object(views, 'authoring_modules_as_training_rows', return_value=rows), \
             patch.object(views, 'is_operational_training_row', return_value=True), \
             patch.object(views, 'programme_identity', return_value={'name': 'Programme', 'sourceId': 'P'}), \
             patch.object(views, 'actual_cohort_identity', return_value={'name': 'Cohort', 'id': 'C'}), \
             patch.object(views, 'actual_group_identity', return_value={'name': 'Other group', 'id': 'OTHER'}), \
             patch.object(views, 'live_session_matches_curriculum_scope', return_value=False) as placement_match, \
             patch.object(views, 'fetch_cohort_selected_holidays', return_value=[]):
            events = views.collect_live_session_events(
                '', '', require_coach_access=False, include_past=True,
                learner_scope={'group_id': 'ORIGINAL'},
                learner_module_ids=['assigned-other-group'],
            )
            self.assertEqual([event['module'] for event in events], ['assigned-other-group'])
            placement_match.assert_not_called()
            self.assertEqual(views.collect_live_session_events(
                '', '', require_coach_access=False, include_past=True,
                learner_module_ids=[],
            ), [])

    def test_content_only_week_does_not_consume_the_next_teams_occurrence(self):
        from coach_api import views
        weeks = [
            # Archived/library copies of an earlier week must not shift the
            # current week-to-occurrence mapping.
            {'id': 'W1-ARCHIVED', 'module_catalogue_id': 'MOD-1', 'week_number': 1,
             'title': 'Old Week 1', 'deleted_at': '2026-09-01T00:00:00Z'},
            *[
                {'id': f'W{i}', 'module_catalogue_id': 'MOD-1', 'week_number': i,
                 'title': f'Week {i}'}
                for i in range(1, 5)
            ],
        ]
        components = [
            {'type': 'live_session', 'module_catalogue_id': 'MOD-1', 'week_id': week_id,
             'live_sessions_link': 'https://teams.microsoft.com/meet/one'}
            for week_id in ('W1', 'W2', 'W4')
        ]
        components.append({
            'type': 'live_session', 'module_catalogue_id': 'MOD-1', 'week_id': 'W3',
            'live_sessions_link': 'https://teams.microsoft.com/meet/old',
            'deleted_at': '2026-09-01T00:00:00Z',
        })
        series = [{'id': 'LIVE-1', 'module_catalogue_id': 'MOD-1', 'status': 'active'}]
        occurrences = [
            {'id': f'OCC-{i}', 'live_session_id': 'LIVE-1', 'session_number': i}
            for i in range(1, 4)
        ]
        plan = {'warnings': [], 'sessions': [
            {'sessionNumber': 1, 'date': '2026-09-18', 'skippedHolidays': []},
            {'sessionNumber': 2, 'date': '2026-09-25', 'skippedHolidays': []},
            {'sessionNumber': 3, 'date': '2026-10-02', 'skippedHolidays': ['2026-10-02']},
            {'sessionNumber': 4, 'date': '2026-10-09', 'skippedHolidays': []},
        ]}

        def fetch(table, *args, **kwargs):
            return {
                views.AUTHORING_WEEKS_TABLE: weeks,
                views.AUTHORING_COMPONENTS_TABLE: components,
                views.LIVE_SESSIONS_TABLE: series,
                views.LIVE_SESSION_OCCURRENCES_TABLE: occurrences,
            }.get(table, [])

        row = {
            'module_name': 'MarTech', 'start_date': '2026-09-18', 'sessions_number': 4,
            'session_week_day': 'Friday',
            '_meta': {'module_catalogue_id': 'MOD-1', 'cohort_id': 'COHORT-1'},
        }
        with patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'authoring_fetch_all', side_effect=fetch), \
             patch.object(views, 'authoring_modules_as_training_rows', return_value=[row]), \
             patch.object(views, 'is_operational_training_row', return_value=True), \
             patch.object(views, 'programme_identity', return_value={'name': 'Programme', 'sourceId': 'P'}), \
             patch.object(views, 'actual_cohort_identity', return_value={'name': 'Cohort', 'id': 'COHORT-1'}), \
             patch.object(views, 'actual_group_identity', return_value={'name': 'Group', 'id': 'GROUP-1'}), \
             patch.object(views, 'fetch_cohort_selected_holidays', return_value=[]), \
             patch.object(views, 'delivery_days_per_week', return_value=1), \
             patch.object(views, 'build_module_session_plan', return_value=plan), \
             patch.object(views, 'build_live_session_calendar_event', side_effect=lambda _row, session, **kwargs: {
                 'date': session['date'],
                 'sessionNumber': session['sessionNumber'],
                 'occurrenceId': (kwargs.get('tracked_occurrence') or {}).get('id'),
             }):
            events = views.collect_live_session_events(
                '', '', require_coach_access=False, include_past=True,
                learner_module_ids=['MOD-1'],
            )

        self.assertEqual(events, [
            {'date': '2026-09-18', 'sessionNumber': 1, 'occurrenceId': 'OCC-1'},
            {'date': '2026-09-25', 'sessionNumber': 2, 'occurrenceId': 'OCC-2'},
            {'date': '2026-10-09', 'sessionNumber': 3, 'occurrenceId': 'OCC-3'},
        ])
