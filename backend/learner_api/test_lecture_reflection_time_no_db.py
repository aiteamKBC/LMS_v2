"""Reflection additions use the existing quiz/activity arithmetic without I/O."""
import json
from contextlib import ExitStack, nullcontext
from copy import deepcopy
from datetime import datetime, timezone
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from .lecture_reflection_time import add_reflection_time
from .active_users import completed_hours_value_from_progress
from .current_learning import project_current


def payload(**changes):
    return dict(learnerKind='apprenticeship', learnerId='19', activityType='session',
                activityId='LECTURE', additionalReflectionSeconds=1800,
                otjhConfirmed=True, signedDeclaration=True, **changes)


class LectureReflectionTimeTests(SimpleTestCase):
    def add(self, data=None, *, history=None, credits=None, component_type='live_session', assigned=True, protected=False, stored=None, original_missing=False):
        history = history if history is not None else [dict(kind='component', componentId='LECTURE',
            claimedSeconds=7200, reportedTime='120 minutes', timeTrackingSource='signed:input',
            submittedAt='2026-11-09T10:00:00Z')]
        before = deepcopy(history)
        source = SimpleNamespace(pk=19)
        learner = SimpleNamespace(pk=1, training_plan_progress=history)
        cursor = MagicMock()
        settings = dict(recordingSeriesId='SERIES', recordingSessionNumber=1, recordingDate='2026-11-09') if component_type != 'live_session' else {}
        cursor.fetchone.side_effect = [(component_type, settings, 'MODULE'), ('recording_placeholder', {}, 'MODULE')]
        with ExitStack() as stack:
            stack.enter_context(patch('learner_api.lecture_reflection_time.connections'))['enrolment'].cursor.return_value.__enter__.return_value = cursor
            models = stack.enter_context(patch('learner_api.components.SOURCE_MODELS'))
            models.__getitem__.return_value.objects.get.return_value = source
            stack.enter_context(patch('learner_api.active_users.learner_profile_for_source', return_value=learner))
            stack.enter_context(patch('learner_api.learning_plan.effective_training_plan', return_value=[{'moduleId': 'MODULE' if assigned else 'OTHER'}]))
            stack.enter_context(patch('learner_api.live_session_progress.read_live_credits', return_value=credits or []))
            known = (stored or {}).get('lectureReflectionTime', {})
            stack.enter_context(patch('old_otjh.repository.query', side_effect=lambda sql, args: ([] if original_missing else
                [{'id': args[0], 'claimed_seconds': known.get('ledgerSeconds', known.get('inputSeconds', known.get('seconds')))}]) if 'WHERE id=%s' in sql
                else [{'source_system': 'historical'}] if protected else []))
            stack.enter_context(patch('learner_api.working_rules.resolve_completion_instants', return_value=(None, '')))
            stack.enter_context(patch('learner_api.lecture_reflection_time.timezone.now', return_value=datetime(2026, 11, 10, 12, tzinfo=timezone.utc)))
            save = stack.enter_context(patch('learner_api.active_users.save_progress_record', return_value=SimpleNamespace(pk=101)))
            body = payload()
            body['activityType'] = {'live_session': 'session', 'recording_placeholder': 'recording', 'video': 'video'}.get(component_type, 'reading')
            result = add_reflection_time(data or body, stored or {}, submission_mode='submit')
            self.saved_records = [deepcopy(call.args[1]) for call in save.call_args_list]
        self.assertEqual(history, before)
        return result, save.call_args.args[1], history

    def test_adds_thirty_minutes_to_two_hours_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                data = payload(); data['learnerKind'] = kind
                receipt, record, history = self.add(data)
                self.assertEqual(receipt['seconds'], 1800)
                self.assertEqual(receipt['countedSeconds'], 9000)
                self.assertEqual(record['retakeTimeChoice'], 'add')
                self.assertEqual(record['retakePreviousSeconds'], 7200)
                self.assertEqual(record['claimedSeconds'], 1800)
                self.assertEqual(record['verifiedSeconds'], 0)
                self.assertEqual(completed_hours_value_from_progress([*history, record]), 2.5)
                rows = [dict(id=i, learner_id=1, kind=r['kind'], component_ref='LECTURE', component_type='live_session',
                    component_link_source='direct', submitted_at=r['submittedAt'], reported_time=r['reportedTime'],
                    claimed_seconds=r['claimedSeconds'], time_tracking_source=r['timeTrackingSource'],
                    source_payload={k: r[k] for k in ('retakeTimeChoice', 'retakePreviousSeconds') if k in r})
                    for i, r in enumerate([*history, record], 1)]
                self.assertEqual(project_current(rows, {})[0]['actual_seconds'], 9000)

    def test_preserves_attendance_only_credit_as_the_server_baseline(self):
        receipt, record, _ = self.add(history=[], credits=[dict(componentId='LECTURE', hours=2)])
        self.assertEqual(record['retakePreviousSeconds'], 7200)
        self.assertEqual(receipt['countedSeconds'], 9000)

    def test_dated_video_recordings_use_the_video_history_kind(self):
        receipt, record, _ = self.add(component_type='video')
        self.assertEqual(record['kind'], 'video')
        self.assertEqual(receipt['countedSeconds'], 9000)

    def test_linked_recording_cards_can_add_to_an_existing_submitted_completion(self):
        receipt, record, _ = self.add(component_type='recording_placeholder')
        self.assertEqual(record['componentType'], 'recording_placeholder')
        self.assertEqual(receipt['countedSeconds'], 9000)

    def test_uses_recording_completion_already_approved_by_the_current_read_model(self):
        receipt, record, _ = self.add(history=[], credits=[dict(componentId='LECTURE', hours=2,
            timeTrackingSource='verified_recording_watch')])
        self.assertEqual(receipt['countedSeconds'], 9000)
        self.assertEqual(record['retakePreviousSeconds'], 7200)

    def linked_credits(self):
        shared = dict(moduleId='MODULE', creditComponentIds=['LECTURE', 'REC'], timeTrackingSource='verified_recording_watch')
        return [dict(shared, componentId='REC', hours=2.5), dict(shared, componentId='LECTURE', hours=0)]

    def test_linked_recording_credit_is_retained_when_reflection_is_added_from_either_card(self):
        from .live_session_progress import supplement_module_hours
        for old_id, old_seconds, target, writes in ((None, 0, 'REC', 1), ('LECTURE', 0, 'LECTURE', 2),
                ('LECTURE', 7200, 'LECTURE', 2), ('REC', 9000, 'REC', 1), ('REC', 14400, 'REC', 1)):
            with self.subTest(identity=old_id, seconds=old_seconds):
                history = [] if old_id is None else [dict(kind='component', componentId=old_id,
                    claimedSeconds=old_seconds, reportedTime=f'{old_seconds / 60:g} minutes',
                    timeTrackingSource='signed:input', submittedAt='2026-11-09T10:00:00Z')]
                credits = self.linked_credits()
                receipt, record, _ = self.add(history=history, credits=credits)
                self.assertEqual(record['componentId'], target)
                self.assertEqual(len(self.saved_records), writes)
                expected = max(old_seconds, 9000) + 1800
                self.assertEqual(receipt['countedSeconds'], expected)
                rows = [dict(id=i, learner_id=1, kind=r['kind'], component_ref=r['componentId'],
                    component_type='live_session', component_link_source='direct', submitted_at=r['submittedAt'],
                    reported_time=r['reportedTime'], claimed_seconds=r['claimedSeconds'],
                    verified_seconds=r.get('verifiedSeconds'), time_tracking_source=r['timeTrackingSource'],
                    source_payload={k: r[k] for k in ('retakeTimeChoice', 'retakePreviousSeconds') if k in r})
                    for i, r in enumerate([*history, *self.saved_records], 1)]
                current = project_current(rows, {})
                actual = sum(r['actual_seconds'] for r in current) / 3600
                updated = supplement_module_hours({'MODULE': {'hours': {'actual': actual}}}, current, credits)
                self.assertEqual(updated['MODULE']['hours']['actual'], expected / 3600)

    def test_linked_protected_or_ambiguous_history_cannot_be_overridden(self):
        with self.assertRaisesMessage(ValueError, 'historical or staff-reviewed'):
            self.add(history=[], credits=self.linked_credits(), protected=True)
        history = [dict(kind='component', componentId=identity) for identity in ('LECTURE', 'REC')]
        with self.assertRaisesMessage(ValueError, 'multiple linked activities'):
            self.add(history=history, credits=self.linked_credits())

    def test_the_locked_write_resolves_a_dated_video_baseline_without_crediting_ordinary_videos(self):
        from .activity_time_history import attendance_baseline
        record = dict(kind='video', componentType='video', componentId='LECTURE', retakeTimeChoice='add')
        for settings, expected in (({}, 0), (dict(recordingSeriesId='SERIES', recordingSessionNumber=1,
                                                    recordingDate='2026-11-09'), 7200)):
            with self.subTest(settings=bool(settings)), \
                 patch('learner_api.activity_time_history.connections') as db, \
                 patch('learner_api.live_session_progress.read_live_credits', return_value=[dict(componentId='LECTURE', hours=2)]) as read:
                db['enrolment'].cursor.return_value.__enter__.return_value.fetchone.return_value = ('MODULE', settings)
                self.assertEqual(attendance_baseline(record, [], source=SimpleNamespace(id=19)), expected)
                self.assertEqual(read.called, bool(settings))

    def test_drafts_zero_and_ordinary_reflections_never_touch_progress(self):
        with patch('learner_api.lecture_reflection_time.connections') as db:
            self.assertIsNone(add_reflection_time(payload(), {}, submission_mode='draft'))
            data = payload(); data['additionalReflectionSeconds'] = 0
            self.assertIsNone(add_reflection_time(data, {}, submission_mode='submit'))
            self.assertIsNone(add_reflection_time({}, {}, submission_mode='submit'))
            db.__getitem__.assert_not_called()

    def test_retries_and_text_edits_keep_the_server_receipt_without_a_second_write(self):
        receipt = dict(seconds=1800, progressEntryId=101, addedAt='2026-11-10T12:00:00Z', countedSeconds=9000)
        with patch('learner_api.lecture_reflection_time.connections') as db:
            for mode in ('submit', 'draft'):
                self.assertEqual(add_reflection_time(payload(), {'lectureReflectionTime': receipt}, submission_mode=mode), receipt)
            self.assertEqual(add_reflection_time({}, {'lectureReflectionTime': receipt}, submission_mode='submit'), receipt)
            db.__getitem__.assert_not_called()
        changed = payload(); changed['additionalReflectionSeconds'] = 2700
        with self.assertRaisesMessage(ValueError, 'already been added'):
            add_reflection_time(changed, {'lectureReflectionTime': receipt}, submission_mode='submit')

    def test_invalid_and_excessive_times_are_rejected(self):
        for value in (-1, True, '30', float('nan'), float('inf'), 1.2, 28801):
            data = payload(); data['additionalReflectionSeconds'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                add_reflection_time(data, {}, submission_mode='submit')
        data = payload(); data['additionalReflectionSeconds'] = 7 * 3600
        with self.assertRaisesMessage(ValueError, '8-hour limit'):
            self.add(data)

    def test_does_not_complete_an_unfinished_lecture_or_credit_another_plan(self):
        with self.assertRaisesMessage(ValueError, 'Complete the lecture'):
            self.add(history=[])
        with self.assertRaisesMessage(ValueError, 'not in your learning plan'):
            self.add(assigned=False)

    def test_non_lecture_components_cannot_claim_time_through_this_flow(self):
        # No recording association on a normal reading.
        with patch('learner_api.lecture_reflection_time.connections') as db:
            db['enrolment'].cursor.return_value.__enter__.return_value.fetchone.return_value = ('reading', {}, 'MODULE')
            with self.assertRaisesMessage(ValueError, 'only available for lectures'):
                add_reflection_time(payload(), {}, submission_mode='submit')

    def test_a_time_addition_requires_the_learner_declarations(self):
        for field in ('otjhConfirmed', 'signedDeclaration'):
            data = payload(); data[field] = False
            with self.subTest(field=field), self.assertRaisesMessage(ValueError, 'Confirm the OTJH'):
                add_reflection_time(data, {}, submission_mode='submit')

    def test_the_activity_type_cannot_be_changed_to_create_another_credit_identity(self):
        data = payload(); data['activityType'] = 'video'
        with self.assertRaisesMessage(ValueError, 'does not match this lecture'):
            self.add(data)

    def test_quiz_choices_apply_only_to_reflection_time_and_agree_with_reported_hours(self):
        old_receipt = dict(seconds=1800, progressEntryId=99, countedSeconds=9000, addedAt='2026-11-09T12:00:00Z')
        history = [dict(kind='component', componentId='LECTURE', claimedSeconds=7200,
            timeTrackingSource='signed:input', submittedAt='2026-11-09T10:00:00Z'),
            dict(kind='component', componentId='LECTURE', claimedSeconds=1800, retakeTimeChoice='add',
            retakePreviousSeconds=7200, timeTrackingSource='lecture_reflection:input', submittedAt='2026-11-09T12:00:00Z')]
        for mode, seconds, expected in [('correct', 1200, 8400), ('add', 1200, 10200), ('retry', 1200, 9000), ('retry', 2400, 9600)]:
            with self.subTest(mode=mode, seconds=seconds):
                body = payload(); body['additionalReflectionSeconds'] = seconds
                body['reflectionTimeOperation'] = dict(id='00000000-0000-4000-8000-000000000001', choice=mode,
                    reason='Correcting writing time.', expectedReflectionSeconds=1800, expectedProgressEntryId=99)
                result, record, _ = self.add(body, stored={'lectureReflectionTime': old_receipt}, history=history)
                self.assertEqual(result['countedSeconds'], expected)
                self.assertEqual(result['lectureSeconds'], 7200)
                self.assertEqual(result['seconds'], expected - 7200)
                self.assertEqual(result['inputSeconds'], seconds)
                self.assertEqual(record['retakeTimeChoice'], mode)
                self.assertAlmostEqual(completed_hours_value_from_progress([*history, record]), expected / 3600)
                rows = [dict(id=i, learner_id=1, kind=r['kind'], component_ref='LECTURE', component_type='live_session',
                    component_link_source='direct', submitted_at=r['submittedAt'], claimed_seconds=r['claimedSeconds'],
                    time_tracking_source=r['timeTrackingSource'], source_payload={k: r[k] for k in ('retakeTimeChoice', 'retakePreviousSeconds') if k in r})
                    for i, r in enumerate([*history, record], 1)]
                self.assertEqual(project_current(rows, {})[0]['actual_seconds'], expected)

    def test_new_verified_lecture_credit_is_not_allowed_to_absorb_existing_or_new_writing_time(self):
        receipt = dict(seconds=1800, progressEntryId=99, countedSeconds=9000)
        history = [dict(kind='component', componentId='LECTURE', claimedSeconds=1800, retakeTimeChoice='add',
            retakePreviousSeconds=7200, timeTrackingSource='lecture_reflection:input', submittedAt='2026-11-09T12:00:00Z')]
        body = payload(); body['additionalReflectionSeconds'] = 1200
        body['reflectionTimeOperation'] = dict(id='00000000-0000-4000-8000-000000000001', choice='add', reason='',
            expectedReflectionSeconds=1800, expectedProgressEntryId=99)
        result, _, _ = self.add(body, stored={'lectureReflectionTime': receipt}, history=history,
            credits=[dict(componentId='LECTURE', hours=3)])
        self.assertEqual(result['lectureSeconds'], 10800)
        self.assertEqual(result['seconds'], 3000)
        self.assertEqual(result['countedSeconds'], 13800)
        self.assertEqual(len(self.saved_records), 2)
        with self.assertRaisesMessage(ValueError, 'original reflection time entry needs a coach review'):
            self.add(body, stored={'lectureReflectionTime': receipt}, history=history, original_missing=True)

    def test_stale_operation_and_correction_without_reason_never_reach_database(self):
        body = payload()
        body['reflectionTimeOperation'] = dict(id='00000000-0000-4000-8000-000000000001', choice='add',
            reason='', expectedReflectionSeconds=0, expectedProgressEntryId=0)
        receipt = dict(seconds=1800, progressEntryId=99, countedSeconds=9000)
        with patch('learner_api.lecture_reflection_time.connections') as db:
            for mode in ('submit', 'draft'):
                with self.subTest(mode=mode), self.assertRaisesMessage(ValueError, 'saved reflection time changed'):
                    add_reflection_time(body, {'lectureReflectionTime': receipt}, submission_mode=mode)
            db.__getitem__.assert_not_called()
        body['reflectionTimeOperation']['choice'] = 'correct'
        with self.assertRaisesMessage(ValueError, 'Explain the time correction'):
            add_reflection_time(body, {}, submission_mode='submit')


class ReflectionTimeSubmissionTests(SimpleTestCase):
    def submit(self, *, existing=None, addition=None, forged=False, old_client=False, operation=None, mode='submit'):
        from . import reflection_submissions as view
        body = dict(learnerKind='apprenticeship', learnerId='19', activityType='session', activityId='LECTURE',
                    learningReflection='Synthetic reflection', submissionMode=mode, actualTimeHours='2',
                    additionalReflectionSeconds=1800)
        if forged:
            body['lectureReflectionTime'] = {'progressEntryId': 'FORGED', 'seconds': 99999}
        if old_client:
            body.pop('additionalReflectionSeconds')
        if operation:
            body['reflectionTimeOperation'] = operation
        cursor = MagicMock()
        cursor.fetchone.side_effect = [existing, ('SAVED',)]
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(view, 'connections', {'enrolment': connection}), \
             patch.object(view.transaction, 'atomic', return_value=nullcontext()), \
             patch('learner_api.programme_access.submission_refusal', return_value=None), \
             patch.object(view, '_reflection_lineage', return_value={}), \
             patch.object(view, 'record_submission_row'), \
             patch('learner_api.lecture_reflection_time.add_reflection_time',
                   **({'side_effect': addition} if isinstance(addition, Exception) else {'return_value': addition})) as add:
            response = unwrap(view._submit_reflection)(RequestFactory().post('/reflection', data=json.dumps(body), content_type='application/json'))
        return response, cursor, add

    def test_locks_before_first_upsert_and_stores_only_the_server_receipt(self):
        receipt = dict(seconds=1800, progressEntryId=101, addedAt='now', countedSeconds=9000)
        response, cursor, _ = self.submit(addition=receipt, forged=True)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIn('FOR UPDATE', cursor.execute.call_args_list[0].args[0])
        write = next(call for call in cursor.execute.call_args_list if 'insert into' in call.args[0])
        full = next(json.loads(value) for value in write.args[1] if isinstance(value, str) and value.startswith('{') and 'learningReflection' in value)
        self.assertEqual(full['lectureReflectionTime'], receipt)
        self.assertEqual(full['actualTimeHours'], '2.5')
        self.assertEqual(json.loads(response.content)['lectureReflectionTime'], receipt)

    def test_an_accepted_reflection_refuses_the_time_change(self):
        response, _, add = self.submit(existing=('accepted', {}, None, None, None, None))
        self.assertEqual(response.status_code, 409)
        add.assert_not_called()

    def test_replaying_a_confirmed_action_after_coach_acceptance_does_not_write_or_change_review(self):
        operation = dict(id='00000000-0000-4000-8000-000000000001', choice='add', reason='',
            expectedReflectionSeconds=0, expectedProgressEntryId=0)
        receipt = dict(seconds=1800, inputSeconds=1800, operationId=operation['id'], choice='add', reason='',
            progressEntryId=101, countedSeconds=9000)
        response, cursor, add = self.submit(existing=('accepted', {'lectureReflectionTime': receipt}, 'Keep feedback', 'Coach', None, None, 'SAVED'), operation=operation)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(json.loads(response.content)['status'], 'accepted')
        add.assert_not_called()
        self.assertFalse(any('insert into' in call.args[0] or 'update ' in call.args[0].lower() for call in cursor.execute.call_args_list))

    def test_a_delayed_draft_of_a_confirmed_action_cannot_downgrade_the_submission(self):
        operation = dict(id='00000000-0000-4000-8000-000000000001', choice='add', reason='',
            expectedReflectionSeconds=0, expectedProgressEntryId=0)
        receipt = dict(seconds=1800, inputSeconds=1800, operationId=operation['id'], choice='add', reason='',
            progressEntryId=101, countedSeconds=9000)
        response, cursor, add = self.submit(existing=('submitted_for_tutor_review', {'lectureReflectionTime': receipt}, None, None, None, None, 'SAVED'),
            operation=operation, mode='draft')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(json.loads(response.content)['status'], 'submitted_for_tutor_review')
        add.assert_not_called()
        self.assertFalse(any('insert into' in call.args[0] for call in cursor.execute.call_args_list))

    def test_an_older_open_tab_uses_the_same_lock_and_preserves_the_stored_receipt(self):
        receipt = dict(seconds=1800, progressEntryId=101, addedAt='now', countedSeconds=9000)
        document = {'lectureReflectionTime': receipt}
        response, cursor, add = self.submit(existing=('submitted_for_tutor_review', document, None, None, None, None),
            addition=receipt, old_client=True)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIn('Created_users', cursor.execute.call_args_list[0].args[0])
        self.assertIn('FOR UPDATE', cursor.execute.call_args_list[0].args[0])
        self.assertEqual(add.call_args.args[1], document)
        self.assertNotIn('additionalReflectionSeconds', add.call_args.args[0])
        self.assertEqual(json.loads(response.content)['lectureReflectionTime'], receipt)

    def test_working_time_refusal_returns_the_existing_dialog_contract_without_upserting(self):
        from .working_rules import DeclaredCompletionError
        response, cursor, _ = self.submit(addition=DeclaredCompletionError('Confirm the working instant.', reason='weekend'))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)['validation']['reason'], 'weekend')
        self.assertFalse(any('insert into' in call.args[0] for call in cursor.execute.call_args_list))
