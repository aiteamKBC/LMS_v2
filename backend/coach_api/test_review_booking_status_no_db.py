"""Real booking functions with synthetic storage; no Django, SQL or Graph I/O.

Run: python -I backend/coach_api/test_review_booking_status_no_db.py
AST loading omits application imports/decorators. These tests check the
transaction boundary with a rollback double, not PostgreSQL locking itself.
"""
import ast
import copy
import json
import re
import runpy
import sys
import unittest
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


BACKEND = Path(__file__).resolve().parents[1]


def load(path, names, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body
             if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    assert {node.name for node in nodes} == set(names)
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class ReviewBookingStatusTests(unittest.TestCase):
    def setUp(self):
        harness = runpy.run_path(str(BACKEND / 'learner_api/test_assignment_booking_no_db.py'))
        self.base = harness['AssignmentBookingTests']()
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        self.response = harness['Response']
        self.record = dict(
            pk=1, event_key=self.base.event['eventKey'], review_instance_id='INSTANCE-SYNTHETIC',
            review_template_id='REV-SYNTHETIC', occurrence_number=1, sequence=1,
            owner_email='coach@example.invalid', owner_name='Synthetic coach', learner_id=248,
            learner_name='Synthetic learner', learner_email='learner@example.invalid', event_type='mcr',
            target_date=date(2026, 10, 16), scheduled_date=None, scheduled_time=None, duration_minutes=60,
            status='not-scheduled', sync_state='synced', notes='',
            graph_event_id='GRAPH-SYNTHETIC', meeting_link='https://example.invalid/meeting',
            graph_organizer_email='organizer@example.invalid',
        )
        self.instance = dict(
            id='INSTANCE-SYNTHETIC', calendar_event_id=1, learner_id=248, coach_email='coach@example.invalid',
            review_template_id='REV-SYNTHETIC', status='not-scheduled', started_at=None, completed_at=None,
            definition_snapshot={'sections': ['frozen']}, progress_snapshot={'actual': 42},
        )
        self.history = []
        self.depth = 0
        self.updates = []
        self.manager = self.base.manager
        self.manager.get_or_create.side_effect = lambda **_: (self.read_record(), False)
        self.manager.select_for_update.return_value.get.side_effect = lambda **_: self.read_record()
        constants = {name: name.removeprefix('STATUS_').lower().replace('_', '-') for name in (
            'STATUS_NOT_SCHEDULED', 'STATUS_SCHEDULED', 'STATUS_IN_PROGRESS', 'STATUS_AWAITING_SIGNATURE',
            'STATUS_COMPLETED', 'STATUS_CANCELLED')}
        constants.update({name: name.removeprefix('SYNC_').lower() for name in (
            'SYNC_PENDING', 'SYNC_SYNCING', 'SYNC_RECONCILIATION', 'SYNC_SYNCED', 'SYNC_CANCELLED')})
        model = type('CalendarRecord', (), dict(objects=self.manager, **constants))
        self.curriculum = SimpleNamespace(
            connection=SimpleNamespace(vendor='postgresql'), table_name=lambda name: name,
            fetch_all=self.fetch_instance, update_rows=self.update_instance,
        )
        self.engine = dict(curriculum_views=self.curriculum, REVIEW_INSTANCES_TABLE='review_instances',
                           datetime=datetime, **constants)
        load(BACKEND / 'curriculum_api/review_instances.py',
             {'get_review_instance', 'mark_review_instance_scheduled', 'mark_review_instance_in_progress_from_attendance'},
             self.engine)
        self.engine.update(
            OCCURRENCE_SOURCE_GENERATED='generated', OCCURRENCE_SOURCE_MANUAL='manual',
            ensure_review_instance=Mock(side_effect=lambda *a, **kw: copy.deepcopy(self.instance)),
            link_calendar_event=Mock(side_effect=self.link),
        )
        self.coach = self.base.coach
        self.coach.__dict__.update(
            CoachCalendarEvent=model, transaction=SimpleNamespace(atomic=self.atomic),
            curriculum_review_instances=SimpleNamespace(**self.engine),
            clean_text=lambda value: str(value or '').strip(),
            clean_email=lambda value: str(value or '').strip().lower(),
            lock_learner_calendar=Mock(), ensure_learner_calendar_available=Mock(),
            ensure_learner_session_not_booked_in_week=Mock(),
            curriculum_reviews=SimpleNamespace(get_review_template_row=Mock(return_value={'id': 'REV-SYNTHETIC'})),
        )
        load(BACKEND / 'coach_api/views.py', {
            'persist_calendar_sync_reservation', 'sync_scheduled_review_instance',
            'require_review_template_for_first_linkage', 'ensure_review_instance_for_calendar_record',
        }, self.coach.__dict__)
        self.coach.synchronize_reserved_calendar_event.side_effect = self.graph
        self.base.ns['CoachCalendarEvent'] = model
        load(BACKEND / 'learner_api/calendar.py', {'learner_calendar_reschedule'}, self.base.ns)
        self.base.ns.update(_learner_booking_record=Mock(side_effect=lambda *a: self.read_record()),
                            _record_enrolment_review=Mock())
        self.coach.build_booked_calendar_event = Mock(return_value=self.base.event)
        self.warning = ''
        self.prepare_coach_endpoint()

    @contextmanager
    def atomic(self):
        before = copy.deepcopy((self.record, self.instance))
        self.depth += 1
        try:
            yield
        except BaseException:
            self.record, self.instance = before
            raise
        finally:
            self.depth -= 1

    def read_record(self):
        row = SimpleNamespace(**copy.deepcopy(self.record))

        def save(update_fields=None):
            for field in update_fields or self.record:
                if field != 'updated_at':
                    self.record[field] = copy.deepcopy(getattr(row, field))

        row.save = save
        return row

    def fetch_instance(self, query, params):
        self.assertEqual(params, ['INSTANCE-SYNTHETIC'])
        if query.endswith(' for update'):
            self.assertGreater(self.depth, 0)
            self.history.append('locked-instance')
        return [copy.deepcopy(self.instance)] if self.instance else []

    def update_instance(self, table, where, params, values):
        self.assertGreater(self.depth, 0)
        self.assertEqual(table, 'review_instances')
        self.assertEqual(where, 'id = %s and status = %s')
        if self.instance['id'] != params[0] or self.instance['status'] != params[1]:
            return []
        self.updates.append(copy.deepcopy(values))
        self.instance.update(values)
        return [copy.deepcopy(self.instance)]

    def link(self, instance_id, calendar_id, **kwargs):
        self.assertGreater(self.depth, 0)
        self.assertEqual(instance_id, self.instance['id'])
        self.instance['calendar_event_id'] = calendar_id

    def graph(self, pk, event):
        self.assertEqual(self.depth, 0, 'Graph must run after the local transaction commits')
        self.assertEqual(pk, 1)
        self.assertEqual(self.instance['status'], 'scheduled')
        return self.read_record(), self.warning, True

    def prepare_coach_endpoint(self):
        ns = self.coach.__dict__
        ns.update(json=json, re=re, timedelta=timedelta, JsonResponse=self.response)
        load(BACKEND / 'coach_api/validation.py',
             {'ObjectValidator', 'ValidationError', 'parse_json_object', 'validation_error_response'}, ns)
        ns.update(
            parse_int=lambda value, default=0: int(value) if value is not None else default,
            authenticated_coach_email=lambda _: 'coach@example.invalid',
            find_catchup_calendar_record=Mock(return_value=(None, 'Synthetic coach')),
            find_catchup_template_event=Mock(return_value=(None, 'Synthetic coach')),
            fetch_owner_active_learner_profiles=Mock(return_value=[self.base.profile]),
            build_learner_profile_map=lambda rows: {row.id: row for row in rows},
            coach_learner_personal_calendar_conflicts=Mock(return_value=False),
            calendar_record_has_launch_url=lambda row: bool(row.meeting_link),
            public_graph_sync_warning=lambda warning: warning,
            overlay_calendar_record=lambda event, row: dict(event, status=row.status),
            TIMETABLE_DEFAULT_DURATION_MINUTES=60,
            coach_error=lambda request, **kw: self.response({'detail': kw['message']}, status=kw['status']),
        )
        load(BACKEND / 'coach_api/views.py', {'parse_json_body', 'coach_timetable_schedule_event'}, ns)

    def coach_book(self):
        request = SimpleNamespace(method='POST', body=json.dumps({
            'eventKey': self.base.event['eventKey'], 'scheduledDate': '2026-10-28',
            'scheduledTime': '10:00', 'durationMinutes': 60,
        }).encode())
        return self.coach.coach_timetable_schedule_event(request)

    def reschedule(self, day='2026-10-29', kind='commercial'):
        request = SimpleNamespace(method='PATCH', body=json.dumps({
            'eventKey': self.base.event['eventKey'], 'scheduledDate': day,
            'scheduledTime': '10:00', 'durationMinutes': 60,
        }))
        return self.base.ns['learner_calendar_reschedule'](request, kind, 101)

    def test_prelinked_form_becomes_scheduled_from_either_role(self):
        for book in (self.coach_book, self.base.book):
            with self.subTest(role=book.__name__):
                self.instance['status'] = self.record['status'] = 'not-scheduled'
                result = book()
                self.assertEqual(result.status_code, 200, result)
                self.assertEqual(self.record['status'], 'scheduled')
                self.assertEqual(self.instance['status'], 'scheduled')
        self.coach.curriculum_reviews.get_review_template_row.assert_not_called()
        self.coach.curriculum_review_instances.ensure_review_instance.assert_not_called()
        self.assertEqual(len(self.updates), 2)

    def test_first_booking_links_and_schedules_in_one_transaction(self):
        for book in (self.coach_book, self.base.book):
            with self.subTest(role=book.__name__):
                self.record['review_instance_id'] = ''
                self.instance['calendar_event_id'] = None
                self.instance['status'] = self.record['status'] = 'not-scheduled'
                self.assertEqual(book().status_code, 200)
                self.assertEqual(self.record['review_instance_id'], self.instance['id'])
                self.assertEqual(self.instance['calendar_event_id'], self.record['pk'])
                self.assertEqual(self.instance['status'], 'scheduled')

    def test_reschedule_covers_both_learner_types_and_unchanged_dates(self):
        self.record.update(status='scheduled', scheduled_date=date(2026, 10, 28), scheduled_time=time(10))
        for kind in ('commercial', 'apprenticeship'):
            for day in ('2026-10-28', '2026-10-29'):
                with self.subTest(kind=kind, day=day):
                    self.instance['status'] = 'not-scheduled'
                    self.record.update(scheduled_date=date(2026, 10, 28), sync_state='synced')
                    self.coach.synchronize_reserved_calendar_event.reset_mock()
                    result = self.reschedule(day, kind)
                    self.assertEqual(result.status_code, 200, result)
                    self.assertEqual(self.instance['status'], 'scheduled')
                    if day == '2026-10-28':
                        self.coach.synchronize_reserved_calendar_event.assert_not_called()
                        self.assertEqual(self.record['sync_state'], 'synced')

    def test_retries_preserve_instance_history_and_teams_identity(self):
        frozen = {key: copy.deepcopy(self.instance[key]) for key in
                  ('definition_snapshot', 'progress_snapshot', 'started_at', 'completed_at')}
        self.assertEqual(self.base.book().status_code, 200)
        first_updated = self.instance['updated_at']
        self.assertEqual(self.base.book().status_code, 200)
        self.assertEqual(self.instance['updated_at'], first_updated)
        self.assertEqual(len(self.updates), 1)
        self.assertEqual({key: self.instance[key] for key in frozen}, frozen)
        self.assertEqual(self.record['graph_event_id'], 'GRAPH-SYNTHETIC')
        self.assertEqual(self.record['graph_organizer_email'], 'organizer@example.invalid')
        self.assertEqual(self.record['meeting_link'], 'https://example.invalid/meeting')

    def test_graph_failure_does_not_undo_scheduling(self):
        self.warning = 'Synthetic Teams sync failure'
        result = self.base.book()
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(result['warning'], self.warning)
        self.assertEqual(self.record['status'], self.instance['status'])
        self.assertEqual(self.instance['status'], 'scheduled')

    def test_link_failure_rolls_back_booking_and_instance(self):
        self.record['review_instance_id'] = ''
        self.instance['calendar_event_id'] = None
        before = copy.deepcopy((self.record, self.instance))
        self.coach.curriculum_review_instances.link_calendar_event.side_effect = RuntimeError('Synthetic link failure')
        with self.assertRaisesRegex(RuntimeError, 'link failure'):
            self.coach_book()
        self.assertEqual((self.record, self.instance), before)
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_status_failure_rolls_back_booking(self):
        before = copy.deepcopy((self.record, self.instance))
        self.curriculum.update_rows = Mock(return_value=[])
        result = self.base.book()
        self.assertEqual(result.status_code, 409, result)
        self.assertEqual((self.record, self.instance), before)
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_advanced_status_on_either_row_is_never_regressed(self):
        for source in ('record', 'instance'):
            for status in ('in-progress', 'awaiting-signature', 'completed'):
                with self.subTest(source=source, status=status):
                    getattr(self, source)['status'] = status
                    before = copy.deepcopy((self.record, self.instance))
                    result = self.coach_book()
                    self.assertEqual(result.status_code, 409, result)
                    self.assertEqual((self.record, self.instance), before)
                    self.record['status'] = self.instance['status'] = 'not-scheduled'
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_archived_template_and_stored_occurrence_survive_rescheduling(self):
        self.coach.curriculum_reviews.get_review_template_row.return_value = None
        self.base.event['reviewTemplateId'] = ''
        self.base.event['occurrenceNumber'] = 99
        result = self.base.book()
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.record['review_template_id'], 'REV-SYNTHETIC')
        self.assertEqual(self.record['occurrence_number'], 1)
        self.coach.curriculum_reviews.get_review_template_row.assert_not_called()

    def test_first_linkage_failure_returns_conflict_without_partial_booking(self):
        for book in (self.coach_book, self.base.book):
            with self.subTest(role=book.__name__):
                self.record['review_instance_id'] = ''
                self.instance['calendar_event_id'] = None
                before = copy.deepcopy((self.record, self.instance))
                self.coach.curriculum_reviews.get_review_template_row.side_effect = [
                    {'id': 'REV-SYNTHETIC'}, None,
                ]
                result = book()
                self.assertEqual(result.status_code, 409, result)
                self.assertEqual((self.record, self.instance), before)
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_unchanged_reschedule_rejects_an_advanced_instance(self):
        self.record.update(status='scheduled', scheduled_date=date(2026, 10, 28), scheduled_time=time(10))
        self.instance['status'] = 'completed'
        before = copy.deepcopy((self.record, self.instance))
        result = self.reschedule('2026-10-28')
        self.assertEqual(result.status_code, 409, result)
        self.assertEqual((self.record, self.instance), before)
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_instance_lock_is_opt_in_and_sqlite_reads_still_work(self):
        self.curriculum.fetch_all = Mock(return_value=[self.instance])
        self.engine['get_review_instance'](self.instance['id'])
        self.assertNotIn('for update', self.curriculum.fetch_all.call_args.args[0])
        with self.atomic():
            self.engine['get_review_instance'](self.instance['id'], for_update=True)
        self.assertTrue(self.curriculum.fetch_all.call_args.args[0].endswith(' for update'))
        self.curriculum.connection.vendor = 'sqlite'
        with self.atomic():
            self.engine['get_review_instance'](self.instance['id'], for_update=True)
        self.assertNotIn('for update', self.curriculum.fetch_all.call_args.args[0])

    def test_mismatched_link_never_updates_another_review(self):
        for field, wrong in (('calendar_event_id', 999), ('learner_id', 999),
                             ('coach_email', 'other@example.invalid'), ('review_template_id', 'OTHER')):
            with self.subTest(field=field):
                correct = self.instance[field]
                self.instance[field] = wrong
                before = copy.deepcopy((self.record, self.instance))
                self.assertEqual(self.base.book().status_code, 409)
                self.assertEqual((self.record, self.instance), before)
                self.instance[field] = correct
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_active_graph_operation_is_not_overwritten(self):
        for state in ('syncing', 'reconciliation'):
            self.record['sync_state'] = state
            before = copy.deepcopy((self.record, self.instance))
            self.assertEqual(self.coach_book().status_code, 409)
            self.assertEqual((self.record, self.instance), before)
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_non_review_reservation_does_not_query_review_engine(self):
        self.record.update(review_instance_id='', review_template_id='', event_type='catch-up')
        candidate = self.read_record()
        candidate.status = 'scheduled'
        candidate.scheduled_date, candidate.scheduled_time = date(2026, 10, 28), time(10)
        self.curriculum.fetch_all = Mock(side_effect=AssertionError('Unexpected review read'))
        result = self.coach.persist_calendar_sync_reservation(candidate)
        self.assertEqual(result.status, 'scheduled')
        self.assertEqual(self.instance['status'], 'not-scheduled')

    def test_attendance_can_advance_the_repaired_scheduled_instance(self):
        self.assertEqual(self.base.book().status_code, 200)
        joined_at = datetime(2026, 10, 28, 10, 5)
        with self.atomic():
            self.engine['mark_review_instance_in_progress_from_attendance'](
                self.instance['id'], started_at=joined_at)
        self.assertEqual(self.instance['status'], 'in-progress')
        self.assertEqual(self.instance['started_at'], joined_at)

    def test_manual_start_works_after_booking_without_a_teams_link(self):
        self.record['meeting_link'] = ''
        self.warning = 'Synthetic Teams sync failure'
        self.assertEqual(self.base.book().status_code, 200)
        audit = Mock()
        self.curriculum.clean_str = lambda value: str(value or '').strip()
        self.engine.update(
            transaction=SimpleNamespace(atomic=self.atomic),
            MANUAL_OVERRIDE_REASON_CODES=('coach-confirmed-live-start',),
            ensure_review_instance_manual_overrides_table=Mock(),
            record_review_instance_manual_override=audit,
            _log_manual_in_progress_override=Mock(),
        )
        load(BACKEND / 'curriculum_api/review_instances.py',
             {'mark_review_instance_in_progress_manually', '_manual_override_status_rejection'}, self.engine)
        ok, result = self.engine['mark_review_instance_in_progress_manually'](
            copy.deepcopy(self.instance), reason_code='coach-confirmed-live-start',
            actor='coach@example.invalid',
        )
        self.assertTrue(ok, result)
        self.assertEqual(self.instance['status'], 'in-progress')
        self.assertEqual(audit.call_args.kwargs['reason_code'], 'coach-confirmed-live-start')
        self.assertEqual(audit.call_args.kwargs['review_instance_id'], self.instance['id'])
        self.assertEqual(self.record['meeting_link'], '')

    def test_stale_scheduling_request_cannot_overwrite_a_started_booking(self):
        candidate = self.read_record()
        candidate.status = 'scheduled'
        candidate.scheduled_date, candidate.scheduled_time = date(2026, 10, 28), time(10)
        self.record['status'] = self.instance['status'] = 'in-progress'
        before = copy.deepcopy((self.record, self.instance))
        with self.assertRaisesRegex(self.coach.LearnerCalendarConflict, 'unstarted'):
            self.coach.persist_calendar_sync_reservation(candidate, review_event=self.base.event)
        self.assertEqual((self.record, self.instance), before)


if __name__ == '__main__':
    if not sys.flags.isolated:
        raise RuntimeError('Run with python -I to avoid application imports.')
    unittest.main()
