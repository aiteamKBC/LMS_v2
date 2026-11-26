"""Original-week recovery for transfer review/approval; all IO is mocked."""
from contextlib import nullcontext
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from old_otjh.service import ServiceError

from . import progress_transfer as api
from .progress_transfer_matching import build_review
from .tests_progress_transfer_no_db import item, saved
from .tests_transfer_matching_no_db import context


def placement(ident=8, title='Week 2: Delivery &amp; review', *, course=50, section=2, kind='lesson'):
    return {'course_id': course, 'component_id': ident, 'component_kind': kind,
            'section_id': str(section), 'section_order': str(section), 'section_title': title}


class TransferSourceWeekTests(SimpleTestCase):
    def setUp(self):
        self.data = context()
        self.data[5][1]['source_section_title'] = ''
        self.pending = saved(modules=[item(completedSourceActivities=['material:7', 'material:8'])])
        self.request_id = self.pending['items'][0]['requestId']
        self.cursor = MagicMock()
        self.cursor.fetchone.return_value = (7, 'commercial')
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        for patcher in (
            patch.object(api, 'connections', {'enrolment': connection}),
            patch.object(api.store, 'lock_learner', return_value=nullcontext(self.cursor)),
            patch.object(api.store, 'read_state', return_value=self.pending),
            patch.object(api, 'source_owner', return_value=(SimpleNamespace(pk=7), {'id': 9})),
            patch.object(api, 'with_planned_hours', side_effect=lambda data, _: data),
            patch('learner_api.my_learning.load_context', return_value=self.data),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.query = self.enterContext(patch.object(api.canonical, 'query', return_value=[placement()]))

    def test_review_recovers_source_week_without_changing_completions_matches_or_targets(self):
        before = deepcopy(self.data)
        review = api.review_request(self.request_id)
        module = review['modules'][0]
        self.assertEqual([(source['sourceActivityRef'], source['week']) for source in module['sources']],
                         [('material:7', 'Week 1'), ('material:8', 'Week 2: Delivery & review')])
        original = build_review(self.request_id, self.pending['items'], self.data)['modules'][0]
        self.assertEqual(module['targets'], original['targets'])
        self.assertEqual([{key: value for key, value in source.items() if key != 'week'} for source in module['sources']],
                         [{key: value for key, value in source.items() if key != 'week'} for source in original['sources']])
        self.assertEqual(self.data, before)
        self.query.assert_called_once()
        self.assertEqual(self.query.call_args.args[1], [[50]])
        self.assertNotIn("material->>'content'", self.query.call_args.args[0])
        self.assertTrue(all(call.args[0].startswith('SELECT') for call in self.cursor.execute.call_args_list))

    def test_stored_section_and_payload_recover_week_when_no_export_is_available(self):
        self.query.return_value = []
        for details in (
            {'source_payload': {'section_title': 'Week 3: Stored section'}},
            {'source_section_ref': '3'},
        ):
            with self.subTest(details=details):
                data = deepcopy(self.data)
                data[5][0].update(source_section_ref='3', source_section_title='Week 3: Stored section')
                data[5][1].update(details)
                enriched = api.with_source_weeks(data, self.pending['items'])
                self.assertEqual(enriched[5][1]['source_section_title'], 'Week 3: Stored section')
                self.assertEqual(data[5][1]['source_section_title'], '')

    def test_completed_quiz_recovers_its_verified_unfinished_parents_week(self):
        parent = self.data[5][1]
        parent['source_payload'] = {'quiz_id': 80}
        quiz = {**parent, 'source_activity_id': 'quiz:80', 'source_activity_type': 'quiz',
                'source_payload': {'activity_id': 8}}
        self.data[5].insert(0, quiz)
        self.pending['items'][0]['completedSourceActivities'] = ['quiz:80']
        self.query.return_value = [placement(title='Induction')]
        review = api.review_request(self.request_id)
        self.assertEqual([(source['sourceActivityRef'], source['week']) for source in review['modules'][0]['sources']],
                         [('quiz:80', 'Induction')])
        # A one-way link is not evidence of section membership.
        parent['source_payload']['quiz_id'] = 99
        self.assertEqual(api.review_request(self.request_id)['modules'][0]['sources'][0]['week'], '')

    def test_foreign_courses_other_activity_types_and_ambiguous_placements_do_not_supply_a_week(self):
        self.data[4].append({'source_course_ref': '99'})
        self.data[5].append({**self.data[5][1], 'source_course_ref': '99'})
        for exports in (
            [placement(course=99)],
            [placement(kind='quiz')],
            [placement(), placement(title='Week 3: Another section', section=3)],
            [],
        ):
            with self.subTest(exports=exports):
                self.query.return_value = exports
                review = api.review_request(self.request_id)
                self.assertEqual(review['modules'][0]['sources'][1]['week'], '')
                self.assertEqual(self.query.call_args.args[1], [[50]])
                self.assertEqual(self.data[5][-1]['source_section_title'], '')

    def test_recovery_is_limited_to_frozen_completions_with_missing_weeks(self):
        for refs in ([], ['material:7'], ['material:100']):
            with self.subTest(refs=refs):
                self.pending['items'][0]['completedSourceActivities'] = refs
                api.review_request(self.request_id)
        self.query.assert_not_called()
        # Older pending requests use recorded completed references, never started ones.
        self.pending['items'][0].pop('completedSourceActivities')
        self.data[6].clear()
        self.data[6].add(('50', 'material:8'))
        self.data[7].add(('50', 'material:9'))
        sources = api.review_request(self.request_id)['modules'][0]['sources']
        self.assertEqual([(source['sourceActivityRef'], source['week']) for source in sources],
                         [('material:8', 'Week 2: Delivery & review')])

    def test_conflicting_section_reference_and_export_do_not_choose_the_payload_label(self):
        self.data[5][1].update(source_section_ref='3', source_payload={'section_title': 'Week 3: Stored section'})
        self.query.return_value = [placement(), placement(None, 'Week 3: Stored section', section=3)]
        self.assertEqual(api.review_request(self.request_id)['modules'][0]['sources'][1]['week'], '')

    def test_review_and_approval_share_recovered_weeks_and_reject_stale_review(self):
        review = api.review_request(self.request_id)
        decisions = {'reviewToken': review['reviewToken'], 'mappings': [
            {'moduleId': 'M1', 'sourceActivityRef': 'material:8', 'targetComponentId': 'MANUAL'}]}
        self.query.return_value = [placement(title='Week 4: Corrected section')]
        with self.assertRaises(ServiceError) as stale:
            api.approve_request(self.request_id, SimpleNamespace(id=11), decisions)
        self.assertEqual(stale.exception.code, 'transfer_review_changed')
        self.assertTrue(all(not call.args[0].startswith('UPDATE') for call in self.cursor.execute.call_args_list))
        self.query.return_value = [placement()]
        api.approve_request(self.request_id, SimpleNamespace(id=11), decisions)
        write = next(call for call in self.cursor.execute.call_args_list if 'SET snapshot=' in call.args[0])
        snapshot = json.loads(write.args[1][0])
        self.assertEqual(snapshot['completedSourceActivities'], ['material:7', 'material:8'])
        self.assertEqual(set(snapshot['matchedComponents']), {'AUTO', 'MANUAL'})
        self.assertEqual((snapshot['percent'], snapshot['hours']), (40, 2))

    def test_placement_read_failure_is_not_reported_as_successful_review(self):
        self.query.side_effect = api.DatabaseError('Placement read failed')
        with self.assertRaises(api.DatabaseError):
            api.review_request(self.request_id)
