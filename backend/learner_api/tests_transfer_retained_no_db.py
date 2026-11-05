"""Original transfer activities: no database or external-service access."""
from contextlib import nullcontext
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from . import progress_transfer as api
from .progress_transfer_matching import build_review, validate_decisions, RETAIN_ORIGINAL
from .transfer_retained import retained_sources
from old_otjh.service import ServiceError
from .tests_transfer_matching_no_db import context
from .tests_progress_transfer_no_db import item, saved
from .tests_my_learning_no_db import MyLearningAggregateTests, component, native, metadata


class RetainedTransferTests(SimpleTestCase):
    def test_approval_keeps_unmatched_original_and_counts_it_without_shared_writes(self):
        data = context()
        pending = saved(modules=[item(completedSourceActivities=['material:7', 'material:8'])])
        request_id = pending['items'][0]['requestId']
        review = build_review(request_id, pending['items'], data)
        decisions = {'reviewToken': review['reviewToken'], 'mappings': [
            {'moduleId': 'M1', 'sourceActivityRef': 'material:8', 'targetComponentId': RETAIN_ORIGINAL}]}
        cursor = MagicMock(); cursor.fetchone.return_value = (7, 'commercial')
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(api, 'connections', {'enrolment': connection}), \
                patch.object(api.store, 'lock_learner', return_value=nullcontext(cursor)), \
                patch.object(api.store, 'read_state', return_value=pending), \
                patch.object(api, 'source_owner', return_value=(SimpleNamespace(pk=7), {'id': 9})), \
                patch('learner_api.my_learning.load_context', return_value=data):
            api.approve_request(request_id, SimpleNamespace(id=11), decisions)
        write = next(call for call in cursor.execute.call_args_list if 'SET snapshot=' in call.args[0])
        snapshot = json.loads(write.args[1][0])
        self.assertEqual(snapshot['retainedSources'], [{'sourceActivityRef': 'material:8', 'title': 'Unmatched reading', 'week': 'Week 1', 'type': 'reading'}])
        self.assertEqual(set(snapshot['matchedComponents']), {'AUTO'})
        self.assertEqual(snapshot['componentCounts'], {'total': 4, 'matched': 1, 'completed': 2, 'remaining': 2})
        self.assertEqual((snapshot['mergedPercent'], snapshot['hours']), (50, 2))
        self.assertTrue(all(not call.args[0].lstrip().startswith(('INSERT INTO curriculum.', 'UPDATE curriculum.', 'DELETE FROM curriculum.')) for call in cursor.execute.call_args_list))
        approved = dict(snapshot, status='approved')
        self.assertEqual(set(retained_sources(approved)), {'catalogue:50:material:8'})
        self.assertEqual(retained_sources(dict(approved, status='pending')), {})
        self.assertEqual(retained_sources(dict(approved, completedSourceActivities=[])), {})

    def test_retaining_original_requires_current_review_and_scoped_completed_source(self):
        review = build_review('R1', [item(completedSourceActivities=['material:8'])], context())
        mapping = {'moduleId': 'M1', 'sourceActivityRef': 'material:8', 'targetComponentId': RETAIN_ORIGINAL}
        self.assertTrue(validate_decisions(review, {'reviewToken': review['reviewToken'], 'mappings': [mapping]})[('M1', 'material:8')]['retainOriginal'])
        for token, row in [('stale', mapping), (review['reviewToken'], dict(mapping, moduleId='M2')),
                           (review['reviewToken'], dict(mapping, sourceActivityRef='material:9'))]:
            with self.subTest(row=row), self.assertRaises(ServiceError):
                validate_decisions(review, {'reviewToken': token, 'mappings': [row]})

    def test_card_counts_original_once_only_for_approved_owner_module(self):
        transfer = item(completedSourceActivities=['material:8'], retainedSources=[
            {'sourceActivityRef': 'material:8', 'title': 'Original reading', 'week': 'Week 2', 'type': 'reading'}])
        for status, expected in [('approved', (2, 1, 50)), ('pending', (1, 0, 0))]:
            meta = metadata(); meta['progress_transfers'] = saved(status, [transfer])['items']
            cards, _ = MyLearningAggregateTests().cards(native([component()]), meta=meta)
            card = next(row for row in cards if row['id'] == 'current:M1')
            self.assertEqual((card['activityCount'], card['completedActivityCount'], card['progress']), expected)
        cards, _ = MyLearningAggregateTests().cards(native([component()]), meta=metadata())
        self.assertEqual(cards[0]['activityCount'], 1)
