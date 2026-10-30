"""Legacy timing regressions: signed evidence, ownership, retries and hours.

Run with scripts/validate_progress_transfer_no_io.py; no DB or network needed.
"""
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
import json
import unittest
from unittest.mock import MagicMock, Mock, patch

from . import subject_store, subject_timing
from .time_tracking import TrackingSessionError
from .working_rules import DeclaredCompletionError
from .test_current_learning_no_db import adapter

START = datetime(2026, 10, 21, 10, tzinfo=timezone.utc)


class LegacyTimingTests(unittest.TestCase):
    def session(self, kind='commercial', **definition):
        definition = {'title': 'Synthetic reading', 'available': True, 'has_reading': True,
                      'catalogue_kind': 'material', **definition}
        with patch('learner_api.subject_timing.timezone.now', return_value=START):
            attempt, session = subject_timing.create_session(kind, 9, 50, 60, definition)
        return attempt, {**definition, 'studyTimingSession': session}

    def complete(self, attempt, definition, **overrides):
        args = dict(kind='commercial', learner_id=9, group_id=50, activity_id=60, attempt_id=attempt)
        args.update(overrides)
        payload = {'trackingToken': definition['studyTimingSession']['trackingToken'], 'timeTakenSeconds': 80}
        with patch('learner_api.subject_timing.timezone.now', return_value=START + timedelta(seconds=60)):
            return subject_timing.completion_time(definition, payload, **args)

    def test_both_learner_types_save_capped_seconds_and_real_completion(self):
        for kind in ('commercial', 'apprenticeship'):
            attempt, definition = self.session(kind)
            result = self.complete(attempt, definition, kind=kind)
            self.assertEqual(result['claimedSeconds'], 80)
            self.assertEqual(result['verifiedSeconds'], 60)
            self.assertEqual(result['submittedAt'], (START + timedelta(seconds=60)).isoformat())
            json.dumps(result)

    def test_manual_selection_preserves_signed_evidence_for_materials_and_quizzes(self):
        for kind in ('commercial', 'apprenticeship'):
            for quiz in (None, {'id': 'q'}):
                with self.subTest(kind=kind, quiz=quiz):
                    attempt, definition = self.session(kind, quiz=quiz)
                    payload = {'trackingToken': definition['studyTimingSession']['trackingToken'],
                               'timeTakenSeconds': 1800, 'timeEntrySource': 'input'}
                    with patch('learner_api.subject_timing.timezone.now', return_value=START + timedelta(seconds=60)):
                        result = subject_timing.completion_time(definition, payload, kind=kind,
                            learner_id=9, group_id=50, activity_id=60, attempt_id=attempt)
                    self.assertEqual(result['verifiedSeconds'], 60)
                    self.assertEqual(result['selectedSeconds'], 1800)
                    self.assertEqual(result['timeEntrySource'], 'input')
                    self.assertEqual(subject_timing.measured_seconds(result), 1800)
                    self.assertEqual(result['submittedAt'], (START + timedelta(seconds=60)).isoformat())

    def test_manual_time_still_requires_the_owned_token_and_valid_duration(self):
        attempt, definition = self.session()
        original = {'trackingToken': definition['studyTimingSession']['trackingToken'],
                    'timeTakenSeconds': 1800, 'timeEntrySource': 'input'}
        for changes in ({'trackingToken': 'forged'}, {'timeTakenSeconds': -1},
                        {'timeTakenSeconds': 'NaN'}, {'timeTakenSeconds': 'Infinity'},
                        {'timeEntrySource': 'unknown'}):
            with self.subTest(changes=changes), self.assertRaises(TrackingSessionError):
                subject_timing.completion_time(definition, {**original, **changes}, kind='commercial',
                    learner_id=9, group_id=50, activity_id=60, attempt_id=attempt)

    def test_invalid_saved_manual_time_cannot_award_hours(self):
        for seconds in (None, -1, True, '1800'):
            self.assertIsNone(subject_timing.measured_seconds({'version': 1,
                'verifiedSeconds': 60, 'timeEntrySource': 'input', 'selectedSeconds': seconds}))

    def test_token_is_bound_to_learner_course_activity_type_and_attempt(self):
        attempt, definition = self.session()
        for override in ({'learner_id': 10}, {'group_id': 51}, {'activity_id': 61},
                         {'attempt_id': 'another'}, {'kind': 'apprenticeship'}):
            with self.subTest(override=override), self.assertRaises(TrackingSessionError):
                self.complete(attempt, definition, **override)
        with self.assertRaises(TrackingSessionError):
            self.complete(attempt, {**definition, 'catalogue_kind': 'quiz'})

    def test_unsigned_time_cannot_be_added_to_an_old_attempt(self):
        args = dict(kind='commercial', learner_id=9, group_id=50, activity_id=60, attempt_id='old')
        self.assertIsNone(subject_timing.completion_time({}, {}, **args))
        with self.assertRaises(TrackingSessionError):
            subject_timing.completion_time({}, {'timeTakenSeconds': 800}, **args)

    def test_timer_modes_follow_actual_player_capabilities(self):
        for media, expected in [
            ([{'kind': 'video', 'url': 'https://example.org/video.mp4'}], 'active_playback'),
            ([{'kind': 'audio', 'url': 'https://example.org/audio.mp3'}], 'active_playback'),
            ([{'kind': 'video', 'url': 'https://vimeo.com/1234'}], 'visible_page'),
            ([{'kind': 'audio', 'url': 'https://open.spotify.com/episode/example'}], 'visible_page'),
        ]:
            _, definition = self.session(has_reading=False, media=media)
            self.assertEqual(definition['studyTimingSession']['countingMode'], expected)
        _, definition = self.session(quiz={'id': 'q'})
        self.assertEqual(definition['studyTimingSession']['countingMode'], 'active_quiz')

    def test_outside_hours_requires_correction_but_keeps_real_submission(self):
        attempt, definition = self.session()
        late = START.replace(hour=22)
        payload = {'trackingToken': definition['studyTimingSession']['trackingToken'], 'timeTakenSeconds': 60}
        args = dict(kind='commercial', learner_id=9, group_id=50, activity_id=60, attempt_id=attempt)
        with patch('learner_api.subject_timing.timezone.now', return_value=late):
            with self.assertRaises(DeclaredCompletionError):
                subject_timing.completion_time(definition, payload, **args)
            result = subject_timing.completion_time(definition, {**payload, 'declaredCompletedAt': START.isoformat()}, **args)
        self.assertEqual(result['submittedAt'], late.isoformat())
        self.assertEqual(datetime.fromisoformat(result['declaredCompletedAt']), START)

    def test_owned_attempt_can_resume_after_signed_token_age_without_native_draft_db(self):
        attempt, definition = self.session()
        with patch('django.core.signing.time.time', return_value=4102444800):
            self.assertEqual(self.complete(attempt, definition)['verifiedSeconds'], 60)


class TimedAttemptStoreTests(unittest.TestCase):
    session = LegacyTimingTests.session
    def setUp(self):
        self.cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.side_effect = lambda: nullcontext(self.cursor)
        self.enterContext(patch.object(subject_store, 'connections', {'enrolment': connection}))
        self.enterContext(patch.object(subject_store, 'ready', return_value=True))
        self.lock = self.enterContext(patch('learner_api.progress_transfer_store.lock_learner', side_effect=lambda _: nullcontext(self.cursor)))
        self.gate = self.enterContext(patch('learner_api.progress_transfer_store.assert_legacy_writable'))

    def test_finish_persists_time_with_completion_and_retry_never_writes_again(self):
        attempt, definition = self.session()
        self.cursor.fetchone.return_value = [definition, None, None, None, False]
        payload = {'trackingToken': definition['studyTimingSession']['trackingToken'], 'timeTakenSeconds': 30}
        with patch('learner_api.subject_timing.timezone.now', return_value=START + timedelta(seconds=60)):
            saved = subject_store.finish(9, 11, 50, 60, attempt, {}, True, learner_kind='commercial', timing_payload=payload)
        self.assertTrue(saved['completed'])
        self.assertEqual(saved['study_time']['verifiedSeconds'], 30)
        self.gate.assert_called_once_with(self.cursor, 9, 50)
        updates = [call.args for call in self.cursor.execute.call_args_list if call.args[0].startswith('UPDATE')]
        self.assertEqual(len(updates), 2)
        self.assertEqual(json.loads(updates[0][1][0]), saved['study_time'])
        self.cursor.reset_mock()
        self.cursor.fetchone.return_value = [{**definition, 'studyTime': saved['study_time']}, START, None, None, True]
        retry = subject_store.finish(9, 11, 50, 60, attempt, {}, True, learner_kind='commercial', timing_payload=payload)
        self.assertTrue(retry['already_submitted'])
        self.assertEqual(retry['study_time'], saved['study_time'])
        self.assertEqual(self.cursor.execute.call_count, 1)

    def test_invalid_timing_cannot_write_completion(self):
        attempt, definition = self.session()
        self.cursor.fetchone.return_value = [definition, None, None, None, False]
        with self.assertRaises(TrackingSessionError):
            subject_store.finish(9, 11, 50, 60, attempt, {}, True, learner_kind='commercial', timing_payload={'trackingToken': 'forged'})
        self.assertEqual(self.cursor.execute.call_count, 1)

    def test_retake_choice_survives_start_restore_and_finish_without_changing_measured_time(self):
        attempt, definition = self.session()
        definition['retakeTimeChoice'] = 'keep'
        subject_store.start(9, 11, 50, 60, definition, attempt_id=attempt,
                            timing_session=definition['studyTimingSession'])
        insert = next(call.args for call in self.cursor.execute.call_args_list if 'INSERT INTO' in call.args[0])
        stored = json.loads(insert[1][-1])
        self.assertEqual(stored['retakeTimeChoice'], 'keep')
        self.cursor.fetchone.return_value = [stored, None, None, None, False]
        with patch('learner_api.subject_timing.timezone.now', return_value=START + timedelta(seconds=60)):
            saved = subject_store.finish(9, 11, 50, 60, attempt, {}, True, learner_kind='commercial',
                timing_payload={'trackingToken': definition['studyTimingSession']['trackingToken'], 'timeTakenSeconds': 30})
        self.assertEqual(saved['study_time']['retakeTimeChoice'], 'keep')
        self.assertEqual(saved['study_time']['verifiedSeconds'], 30)

    def test_transfer_freezes_start_and_finish_before_any_writes(self):
        self.gate.side_effect = ValueError('Transfer pending')
        with self.assertRaisesRegex(ValueError, 'Transfer pending'):
            subject_store.start(9, 11, 50, 60, {'available': True})
        with self.assertRaisesRegex(ValueError, 'Transfer pending'):
            subject_store.finish(9, 11, 50, 60, 'attempt', {}, True)
        self.cursor.execute.assert_not_called()


class LegacyHoursProjectionTests(unittest.TestCase):
    def test_manual_duration_matches_dashboard_and_monthly_hours_without_counting_failed_retries(self):
        timing = {'version': 1, 'verifiedSeconds': 60, 'selectedSeconds': 1800,
                  'timeEntrySource': 'input', 'submittedAt': START.isoformat()}
        attempt = {'group_id': 50, 'activity_id': 60, 'catalogue_kind': 'quiz',
                   'submitted_at': START, 'completed': True, 'timed_attempts': [
                       {'id': 'saved', 'completed': True, 'timing': timing},
                       {'id': 'failed', 'completed': False, 'timing': {**timing, 'selectedSeconds': 7200}}]}
        merge = adapter()['merge_attempts']
        projected = merge([], [attempt])
        self.assertEqual(sum(row.get('actual_seconds') or 0 for row in projected), 1800)
        timed = next(row for row in projected if row.get('actual_seconds') == 1800)
        self.assertEqual(timed['actual_basis'], 'legacy_activity_manual_time')
        self.assertEqual(merge(projected, [attempt]), projected)
        from . import canonical_learning as canonical
        records = canonical.progress_records_with_completion([], projected)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['actual_seconds'], 1800)
        item = {'id': 123, 'title': 'Synthetic quiz', 'category': 'Quiz'}
        owner = {'id': 1, 'enrolment_id': 9, 'aptem_id': 11}
        with patch.object(canonical, 'query', return_value=[{'definition': {}, 'answers': {}}]) as query:
            preview = canonical.content(item, owner, records[0])
        self.assertIn('Manual study time: 30m 0s', preview['parts'][0]['html'])
        self.assertEqual(query.call_args.args[1], ['saved', 9, 11])
        from . import monthly_log_sources as sources
        rows = [{'id': saved['id'], 'group_id': 50, 'activity_id': 60, 'submitted_at': START,
                 'completed': saved['completed'], 'score_percent': 100 if saved['completed'] else 0,
                 'passed': saved['completed'], 'group_name': 'Synthetic course',
                 'definition': {'catalogue_kind': 'quiz', 'studyTime': saved['timing']}}
                for saved in attempt['timed_attempts']]
        with patch.object(sources, 'query', side_effect=[[{'table_name': 'exists'}], rows]):
            monthly = sources._attempts({'id': 9, 'aptem_id': 11})
        self.assertEqual(sum(row['actual_hours'] for row in monthly), 0.5)
        self.assertFalse(monthly[-1]['accepted'])

    def test_monthly_attempts_do_not_award_failed_or_repeated_hours(self):
        from . import monthly_log_sources as sources
        rows = [{'id': str(index), 'group_id': 50, 'activity_id': 60, 'submitted_at': START,
                 'completed': completed, 'score_percent': 100 if completed else 0, 'passed': completed,
                 'group_name': 'Course', 'definition': json.dumps({'catalogue_kind': 'quiz',
                    'studyTime': {'version': 1, 'verifiedSeconds': seconds}})}
                for index, (seconds, completed) in enumerate([(60, True), (30, True), (900, False)])]
        with patch.object(sources, 'query', side_effect=[[{'table_name': 'exists'}], rows]):
            result = sources._attempts({'id': 9, 'aptem_id': 11})
        self.assertAlmostEqual(sum(item['actual_hours'] for item in result), 1/60)
        self.assertFalse(result[-1]['accepted'])

    def test_canonical_hours_include_saved_time_without_an_extra_completed_activity(self):
        from . import canonical_learning as canonical
        scope = adapter()
        historical = {'id': 'audit:1', 'kind': 'quiz', 'completed': False, 'accepted': True,
                      'actual_seconds': 120, 'reporting_month': '2026-09',
                      'source_payload': {'original_source_ref': 'la:50:60'}}
        attempt = {'group_id': 50, 'activity_id': 60, 'submitted_at': START, 'completed': True,
                   'timed_attempts': [{'id': 'new', 'completed': True, 'timing': {
                       'version': 1, 'verifiedSeconds': 60, 'submittedAt': START.isoformat()}}]}
        projected = scope['merge_attempts']([historical], [attempt])
        records = canonical.progress_records_with_completion([historical], projected)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]['actual_seconds'], 120)
        self.assertEqual(records[0]['reporting_month'], '2026-09')
        self.assertEqual(records[1]['reporting_month'], '2026-10')
        summary = canonical.metrics_from_records(records, {})
        self.assertEqual(summary['programme']['total'], 1)
        self.assertEqual(summary['programme']['completed'], 1)
        self.assertEqual(summary['otjh']['actual'], .05)
        courses = [{'id': 1, 'source_course_ref': '50', 'source_course_title': 'Course'}]
        definitions = [{'source_course_ref': '50', 'source_activity_id': 'material:60',
            'source_course_title': 'Course', 'source_activity_title': 'Reading'}]
        items, subjects, _ = canonical.recorded_course_items(courses, definitions, records, include_catalogue=True)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['actual'], .05)
        self.assertEqual(subjects[0]['accepted_hours'], .05)
        overview, _, _ = canonical.recorded_course_items(courses, definitions, records, overview_only=True)
        self.assertEqual(len(overview), 1)
        # When there was no audited entry, the saved timed activity counts once.
        records = canonical.progress_records_with_completion([], scope['merge_attempts']([], [attempt]))
        summary = canonical.metrics_from_records(records, {})
        self.assertEqual(summary['programme']['total'], 1)
        self.assertEqual(summary['otjh']['actual'], round(1/60, 4))

    def test_monthly_evidence_reads_the_owned_attempt_not_a_numeric_progress_id(self):
        from . import canonical_learning as canonical
        record = {'id': 'subject:timing:50:material:60', 'actual_basis': 'legacy_activity_verified_timer',
                  'actual_seconds': 90, 'source_payload': {'subject_attempt_id': '00000000-0000-4000-8000-000000000001'}}
        item = {'id': 123, 'title': 'Synthetic reading', 'category': 'Reading'}
        owner = {'id': 1, 'enrolment_id': 9, 'aptem_id': 11}
        with patch.object(canonical, 'query', return_value=[{'definition': {}, 'answers': {}}]) as query, \
             patch.object(canonical, 'material_parts', side_effect=AssertionError('Wrong evidence store')):
            result = canonical.content(item, owner, record)
        self.assertEqual(query.call_args.args[1], ['00000000-0000-4000-8000-000000000001', 9, 11])
        self.assertIn('1m 30s', result['parts'][0]['html'])

    def test_bulk_timing_never_leaks_to_another_learner(self):
        scope = adapter()
        scope['query'] = Mock(side_effect=[[], [{'name': 'exists'}], [{
            'enrolment_id': 9, 'aptem_id': 11, 'group_id': 50, 'activity_id': 60,
            'submitted_at': START, 'completed': True, 'timed_attempts': [{'id': 'new', 'completed': True,
                'timing': {'version': 1, 'verifiedSeconds': 60, 'submittedAt': START.isoformat()}}]}]])
        owners = [{'id': 1, 'enrolment_id': 9, 'aptem_id': 11, 'learner_type': 'commercial'},
                  {'id': 2, 'enrolment_id': 10, 'aptem_id': 12, 'learner_type': 'apprenticeship'}]
        rows = scope['current_records_bulk'](owners, {1: [], 2: []})
        self.assertEqual(sum(row.get('actual_seconds') or 0 for row in rows[9]), 60)
        self.assertEqual(rows[10], [])

    def test_new_time_preserves_audit_and_only_best_completed_attempt_counts(self):
        scope = adapter()
        history = {'id': 'audit:1', 'source_payload': {'original_source_ref': 'la:50:60'},
                   'actual_seconds': 120, 'accepted': True, 'completed': False}
        def saved(ident, seconds, completed=True):
            return {'id': ident, 'completed': completed, 'timing': {'version': 1,
                'verifiedSeconds': seconds, 'submittedAt': START.isoformat()}}
        attempt = {'group_id': 50, 'activity_id': 60, 'submitted_at': START,
                   'completed': True, 'timed_attempts': [saved('a', 30), saved('b', 60), saved('failed', 900, False)]}
        records = scope['merge_attempts']([history], [attempt])
        self.assertEqual(scope['merge_attempts']([history], [{**attempt,
            'timed_attempts': json.dumps(attempt['timed_attempts'])}]), records)
        self.assertEqual([row['actual_seconds'] for row in records], [120, 60])
        self.assertFalse(history['completed'])
        self.assertTrue(records[0]['completed'])
        self.assertEqual(scope['merge_attempts'](records, [attempt]), records)
        self.assertEqual(records[1]['sources'][0]['source_activity_id'], 'material:60')

    def test_unmeasured_and_failed_attempts_award_no_hours(self):
        merge = adapter()['merge_attempts']
        for timing in (None, {'version': 1, 'verifiedSeconds': -1}, {'version': 1, 'verifiedSeconds': True}):
            records = merge([], [{'group_id': 50, 'activity_id': 60, 'submitted_at': START,
                'completed': False, 'timed_attempts': [{'id': 'a', 'completed': False, 'timing': timing}]}])
            self.assertEqual(len(records), 1)
            self.assertIsNone(records[0]['actual_seconds'])
