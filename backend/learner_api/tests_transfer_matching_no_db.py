"""Component review cases without database or network effects."""
from copy import deepcopy
from contextlib import nullcontext
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from old_otjh.service import ServiceError

from .progress_transfer_matching import build_review, module_review, validate_decisions, manual_completion, target_fingerprint, component_counts
from .replacement_learning import project_approved_learning
from .progress_transfer_policy import merged_percent, public_item
from . import progress_transfer as api
from .tests_my_learning_no_db import component, native, metadata
from .tests_progress_transfer_no_db import item, saved


def context():
    meta = metadata()
    meta['replacement_settings'] = {'AUTO': {'legacySettings': {'sourceLessonId': 7}}}
    definitions = [{'source_course_ref': '50', 'source_activity_id': f'material:{ident}',
                    'source_activity_title': title, 'source_activity_type': 'reading',
                    'source_section_title': 'Week 1'}
                   for ident, title in [(7, 'Completed reading'), (8, 'Unmatched reading'), (9, 'Unfinished reading')]]
    meta['replacement_courses'] = {'current:M1': 'legacy:50'}
    return ([], ['M1'], [], native([component('AUTO'), component('MANUAL', expectedOtjh=1.5), component('FOREIGN', module='M2'),
                                   component('RETIRED', retired=True), component('QUIZ', isQuiz=True)]),
            [{'source_course_ref': '50'}], definitions, {('50', 'material:9')}, set(), {}, meta, [])


class TransferMatchingReviewTests(SimpleTestCase):
    def test_preview_retains_previously_passed_archived_quizzes_without_making_them_destinations(self):
        data = context()
        data[3]['retiredQuizComponents'] = [component('PASSED', retired=True, isQuiz=True, quizMeta={'quizId': 12}),
                                          component('OTHER', module='M2', retired=True, isQuiz=True, quizMeta={'quizId': 13})]
        data[3]['quizAttempts'] = [{'componentId': ident, 'passed': True} for ident in ['PASSED', 'OTHER']]
        module, _, _ = module_review(item(completedSourceActivities=['material:7']), data)
        self.assertEqual(module['retainedCompletedIds'], ['PASSED'])
        self.assertNotIn('PASSED', [target['componentId'] for target in module['targets']])
        self.assertEqual(component_counts(module, ['AUTO']), {'total': 4, 'matched': 1, 'completed': 2, 'remaining': 2})

    def test_counts_include_existing_completion_once_and_exclude_retired_or_foreign_components(self):
        data = context()
        data[3]['componentProgress'] = [{'componentId': ident, 'kind': 'component'}
                                       for ident in ['AUTO', 'AUTO', 'FOREIGN', 'RETIRED']]
        data[3]['quizAttempts'] = [{'componentId': 'QUIZ', 'passed': False}]
        before = deepcopy(data)
        snapshot = item(completedSourceActivities=['material:7', 'material:8'])
        module, _, _ = module_review(snapshot, data)
        self.assertEqual(module['completedTargetIds'], ['AUTO'])
        self.assertEqual(component_counts(module, ['AUTO', 'AUTO', 'MANUAL', 'FOREIGN', 'RETIRED']),
                         {'total': 3, 'matched': 2, 'completed': 2, 'remaining': 1})
        self.assertEqual(data, before)
        token = build_review('R1', [snapshot], data)['reviewToken']
        data[3]['quizAttempts'].append({'componentId': 'QUIZ', 'passed': True})
        updated = build_review('R1', [snapshot], data)
        self.assertNotEqual(updated['reviewToken'], token)
        self.assertEqual(component_counts(updated['modules'][0], ['AUTO', 'MANUAL']),
                         {'total': 3, 'matched': 2, 'completed': 3, 'remaining': 0})

    def test_saved_counts_are_exposed_without_reconstructing_history_or_inventing_missing_counts(self):
        self.assertNotIn('componentCounts', public_item(item()))
        self.assertNotIn('mergedPercent', public_item(item()))
        counts = {'total': 0, 'matched': 0, 'completed': 0, 'remaining': 0}
        self.assertEqual(component_counts({'targets': [], 'completedTargetIds': []}, []), counts)
        snapshot = item(componentCounts=counts)
        self.assertEqual(public_item(snapshot)['componentCounts'], counts)
        self.assertEqual((public_item(snapshot)['percent'], public_item(snapshot)['hours']), (40, 2))

    def test_review_uses_frozen_completed_names_without_loading_document_or_question_content(self):
        data = context()
        pending = saved(modules=[item(completedSourceActivities=['material:7', 'material:8'])])
        request_id = pending['items'][0]['requestId']
        cursor = MagicMock(); cursor.fetchone.return_value = (7, 'commercial')
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(api, 'connections', {'enrolment': connection}), \
                patch.object(api.store, 'read_state', return_value=pending), \
                patch.object(api, 'source_owner', return_value=(SimpleNamespace(pk=7), {'id': 9})), \
                patch.object(api, 'with_planned_hours', side_effect=lambda c, _: c), \
                patch('learner_api.my_learning.load_context', return_value=data), \
                patch('learner_api.progress_transfer_content.content_review', side_effect=AssertionError('Content not needed')) as content:
            result = api.review_request(request_id)
        self.assertEqual(result, build_review(request_id, pending['items'], data))
        self.assertEqual([s['title'] for s in result['modules'][0]['sources']], ['Completed reading', 'Unmatched reading'])
        content.assert_not_called()
        self.assertTrue(all(call.args[0].startswith('SELECT') for call in cursor.execute.call_args_list))

    def test_started_and_untouched_old_components_are_excluded_and_new_content_remains(self):
        data = list(context())
        data[6] = {('50', 'material:7')}
        data[7] = {('50', 'material:8')}
        before = deepcopy(data)
        # Compatibility path for pending snapshots predating completedSourceActivities.
        review, matches, _ = module_review(item(), data)
        self.assertEqual([source['sourceActivityRef'] for source in review['sources']], ['material:7'])
        snapshot = item(status='approved', completedSourceActivities=['material:7'], matchedComponents=matches)
        projected = project_approved_learning(data[3]['components'], data[9]['replacement_settings'], [snapshot])
        self.assertEqual([c['componentId'] for c in projected], [c['componentId'] for c in data[3]['components']])
        for component_row, original in zip(projected, data[3]['components']):
            self.assertEqual({k: v for k, v in component_row.items() if k != 'previousLearning'}, original)
            if component_row['componentId'] != 'AUTO':
                self.assertNotIn('previousLearning', component_row)
        self.assertEqual(merged_percent(['AUTO'], 10), 10)
        self.assertEqual(merged_percent(['AUTO', 'MANUAL'], 10), 20)
        self.assertEqual(data, before)

    def test_authored_hours_read_is_limited_to_request_destinations_and_keeps_actual_hours(self):
        data = context()
        before = deepcopy(data)
        cursor = MagicMock(); cursor.fetchall.return_value = [('AUTO', 'M1', 3)]
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(api, 'connections', {'enrolment': connection}):
            enriched = api.with_planned_hours(data, [item()])
        self.assertEqual(next(c for c in enriched[3]['components'] if c['componentId'] == 'AUTO')['expectedOtjh'], 3)
        self.assertNotIn('FOREIGN', cursor.execute.call_args.args[1][0])
        self.assertEqual(cursor.execute.call_args.args[1][1], ['M1'])
        self.assertEqual(data, before)

    def test_compact_and_full_settings_share_the_same_manual_identity(self):
        row = component()
        identity = {'sourceLessonId': 7, 'sourceMaterialKey': 'material-7'}
        self.assertEqual(target_fingerprint(row, {'legacySettings': identity}),
                         target_fingerprint(row, {'legacySettings': {**identity, 'sourceSection': 'Week 1'}}))
        self.assertEqual(target_fingerprint(row, {}), target_fingerprint(row, {'legacySettings': {'sourceLessonId': None, 'sourceMaterialKey': None}}))

    def test_only_frozen_completions_are_reviewed_and_targets_are_scoped(self):
        data = context()
        snapshot = item(completedSourceActivities=['material:7', 'material:8'])
        original = deepcopy([snapshot, data])
        review, matches, _ = module_review(snapshot, data)
        self.assertEqual([source['sourceActivityRef'] for source in review['sources']], ['material:7', 'material:8'])
        self.assertEqual(review['sources'][0]['automaticTargetId'], 'AUTO')
        self.assertIsNone(review['sources'][1]['automaticTargetId'])
        self.assertEqual(review['sources'][1]['title'], 'Unmatched reading')
        self.assertEqual({target['componentId'] for target in review['targets']}, {'AUTO', 'MANUAL', 'QUIZ'})
        self.assertEqual(set(matches), {'AUTO'})
        self.assertEqual([snapshot, data], original)

    def test_review_token_changes_for_request_source_assignment_or_target_changes(self):
        data = context()
        items = [item(completedSourceActivities=['material:7', 'material:8'])]
        before = build_review('R1', items, data)['reviewToken']
        self.assertEqual(before, build_review('R1', items, data)['reviewToken'])
        self.assertNotEqual(before, build_review('R2', items, data)['reviewToken'])
        for changed in [component('MANUAL', type='quiz'), component('NEW'), component('MANUAL', component='Renamed')]:
            edited = deepcopy(data)
            edited[3]['components'][1] = changed
            self.assertNotEqual(before, build_review('R1', items, edited)['reviewToken'])

    def test_demo_percentage_does_not_invent_completed_activities(self):
        review, matches, _ = module_review(item(demoProgress=True, completedSourceActivities=[]), context())
        self.assertEqual(review['sources'], [])
        self.assertEqual(matches, {})

    def test_missing_stored_metadata_keeps_source_identity_visible_without_guessing_type(self):
        review, _, _ = module_review(item(completedSourceActivities=['material:100', 'quiz:101']), context())
        self.assertEqual(review['sources'][0]['title'], 'material:100')
        self.assertEqual(review['sources'][0]['type'], 'unknown')
        self.assertEqual(review['sources'][1]['type'], 'quiz')

    def test_server_rejects_missing_skipped_duplicate_foreign_wrong_type_and_stale_mappings(self):
        review = build_review('R1', [item(completedSourceActivities=['material:7', 'material:8'])], context())
        mapping = {'moduleId': 'M1', 'sourceActivityRef': 'material:8', 'targetComponentId': 'MANUAL'}
        good = {'reviewToken': review['reviewToken'], 'mappings': [mapping]}
        self.assertEqual(validate_decisions(review, good)[('M1', 'material:8')]['plannedHours'], 1.5)
        bad = [None, {}, {**good, 'reviewToken': 'stale'}, {**good, 'mappings': []},
               {**good, 'mappings': [mapping, mapping]}]
        for field, value in [('moduleId', 'M2'), ('sourceActivityRef', 'material:9'),
                             ('targetComponentId', None), ('targetComponentId', ''), ('targetComponentId', 'AUTO'),
                             ('targetComponentId', 'FOREIGN'), ('targetComponentId', 'RETIRED'), ('targetComponentId', 'QUIZ')]:
            bad.append({**good, 'mappings': [{**mapping, field: value}]})
        for decisions in bad:
            with self.subTest(decisions=decisions), self.assertRaises(ServiceError):
                validate_decisions(review, decisions)

    def test_two_unmatched_sources_cannot_claim_one_destination(self):
        review = build_review('R1', [item(completedSourceActivities=['material:8', 'material:9'])], context())
        rows = [{'moduleId': 'M1', 'sourceActivityRef': ref, 'targetComponentId': 'MANUAL'} for ref in ['material:8', 'material:9']]
        with self.assertRaises(ServiceError):
            validate_decisions(review, {'reviewToken': review['reviewToken'], 'mappings': rows})

    def test_approved_manual_completion_survives_without_shared_provenance_or_double_credit(self):
        data = context()
        snapshot = item(status='approved', completedSourceActivities=['material:8'])
        review, _, _ = module_review(snapshot, data)
        target = next(target for target in review['targets'] if target['componentId'] == 'MANUAL')
        match = manual_completion(snapshot, 'material:8', target)
        snapshot['matchedComponents'] = {'MANUAL': match}
        original = deepcopy([data, snapshot])
        result = project_approved_learning(data[3]['components'], data[9]['replacement_settings'], [snapshot])
        destination = next(c for c in result if c['componentId'] == 'MANUAL')
        self.assertEqual(destination['previousLearning'], match)
        self.assertEqual(destination['expectedOtjh'], 1.5)
        self.assertEqual(snapshot['hours'], 2)
        self.assertEqual(merged_percent(['MANUAL'], 10), 10)
        self.assertEqual(merged_percent(['MANUAL', 'NEW'], 10), 20)
        self.assertEqual([data, snapshot], original)
        for change in [{'status': 'pending'}, {'moduleId': 'M2'}, {'courseRef': 'legacy:90'}, {'completedSourceActivities': []}]:
            projected = project_approved_learning(data[3]['components'], data[9]['replacement_settings'], [{**snapshot, **change}])
            self.assertTrue(all('previousLearning' not in c for c in projected))
        for changed in [component('MANUAL', type='video'), component('MANUAL', retired=True), component('MANUAL', module='M2')]:
            self.assertNotIn('previousLearning', project_approved_learning([changed], {}, [snapshot])[0])
        self.assertNotIn('previousLearning', project_approved_learning([destination], {'MANUAL': {'legacySettings': {'sourceLessonId': 99}}}, [snapshot])[0])

    def test_approval_validates_every_mapping_before_writing_and_saves_auditable_matches(self):
        data = context()
        pending = saved(modules=[item(completedSourceActivities=['material:7', 'material:8'])])
        request_id = pending['items'][0]['requestId']
        review = build_review(request_id, pending['items'], data)
        decisions = {'reviewToken': review['reviewToken'], 'mappings': [
            {'moduleId': 'M1', 'sourceActivityRef': 'material:8', 'targetComponentId': 'MANUAL'}]}
        cursor = MagicMock(); cursor.fetchone.return_value = (7, 'commercial')
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(api, 'connections', {'enrolment': connection}), \
                patch.object(api.store, 'lock_learner', return_value=nullcontext(cursor)), \
                patch.object(api.store, 'read_state', return_value=pending), \
                patch.object(api, 'source_owner', return_value=(SimpleNamespace(pk=7), {'id': 9})), \
                patch('learner_api.my_learning.load_context', return_value=data):
            with self.assertRaises(ServiceError):
                api.approve_request(request_id, SimpleNamespace(id=11))
            self.assertTrue(all(not call.args[0].startswith('UPDATE') for call in cursor.execute.call_args_list))
            api.approve_request(request_id, SimpleNamespace(id=11), decisions)
        write = next(call for call in cursor.execute.call_args_list if 'SET snapshot=' in call.args[0])
        snapshot = json.loads(write.args[1][0])
        self.assertEqual((snapshot['percent'], snapshot['hours']), (40, 2))
        self.assertEqual(set(snapshot['matchedComponents']), {'AUTO', 'MANUAL'})
        self.assertTrue(snapshot['matchedComponents']['MANUAL']['manualMatch'])
        self.assertEqual(snapshot['componentMatches'][1]['plannedHours'], 1.5)
        self.assertEqual(snapshot['componentCounts'], {'total': 3, 'matched': 2, 'completed': 2, 'remaining': 1})
        self.assertEqual(public_item(snapshot)['mergedPercent'], 66.67)
        self.assertEqual(write.args[1][1:], [request_id, 7, 'M1'])
        self.assertEqual([call.args[0].split()[1] for call in cursor.execute.call_args_list
                          if call.args[0].startswith('UPDATE')], [api.store.ITEMS, api.store.REQUESTS])

    def test_approval_uses_the_same_verified_reading_type_as_review(self):
        from .progress_transfer_content import verified_source_types
        data = context(); data[5][1]['source_activity_type'] = 'Reading+Quiz'
        pending = saved(modules=[item(completedSourceActivities=['material:8'])])
        request_id = pending['items'][0]['requestId']
        type_cursor = MagicMock(); type_cursor.fetchall.return_value = [('50', 'material:8', 'pdf', {}, {}, None, None)]
        type_connection = MagicMock(); type_connection.cursor.return_value.__enter__.return_value = type_cursor
        cursor = MagicMock(); cursor.fetchone.return_value = (7, 'commercial')
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.progress_transfer_content.connections', {'enrolment': type_connection}):
            reviewed = build_review(request_id, pending['items'], verified_source_types(data, pending['items']))
            decisions = {'reviewToken': reviewed['reviewToken'], 'mappings': [
                {'moduleId': 'M1', 'sourceActivityRef': 'material:8', 'targetComponentId': 'MANUAL'}]}
            with patch.object(api, 'connections', {'enrolment': connection}), \
                 patch.object(api, 'with_planned_hours', side_effect=lambda c, _: c), \
                 patch.object(api.store, 'lock_learner', return_value=nullcontext(cursor)), \
                 patch.object(api.store, 'read_state', return_value=pending), \
                 patch.object(api, 'source_owner', return_value=(SimpleNamespace(pk=7), {'id': 9})), \
                 patch('learner_api.my_learning.load_context', return_value=data):
                api.approve_request(request_id, SimpleNamespace(id=11), decisions)
        write = next(call for call in cursor.execute.call_args_list if 'SET snapshot=' in call.args[0])
        self.assertEqual(set(json.loads(write.args[1][0])['matchedComponents']), {'MANUAL'})
        self.assertEqual(data[5][1]['source_activity_type'], 'Reading+Quiz')
