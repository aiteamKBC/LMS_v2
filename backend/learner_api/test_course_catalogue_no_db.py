"""Full owned course catalogues with learner progress; no Django or network."""
import ast
import copy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from learner_api.test_canonical_learning_no_db import adapter


class CourseCatalogueTests(unittest.TestCase):
    def setUp(self):
        self.scope = adapter(Mock())
        self.courses = [
            {'source_course_ref': '50', 'source_course_title': 'Course A'},
            {'source_course_ref': '60', 'source_course_title': 'Course B'},
        ]
        self.catalogue = [self.definition('50', kind) for kind in ('material:10', 'material:20', 'quiz:10')]
        self.catalogue.append(self.definition('60', 'material:10'))

    @staticmethod
    def definition(course, activity):
        return {'source_course_ref': course, 'source_activity_id': activity,
                'source_course_title': f'Course {course}', 'source_activity_title': activity,
                'curriculum_module_ref': f'M-{course}', 'curriculum_component_ref': f'C-{course}-{activity}'}

    @staticmethod
    def record(ident=1, course='50', **changes):
        return {'id': ident, 'accepted': True, 'actual_seconds': 3600, 'ksbs': [],
                'sources': [{'source_system': 'old_lms', 'source_course_ref': course,
                             'source_activity_id': 'material:10'}], **changes}

    def project(self, records, catalogue=None):
        return self.scope['recorded_course_items'](self.courses, self.catalogue if catalogue is None else catalogue,
                                                   records, include_catalogue=True)

    def test_every_owned_component_including_unstarted_courses_is_visible(self):
        records = [self.record()]
        before = copy.deepcopy(records)
        items, subjects, links = self.project(records)
        self.assertEqual(len(items), 4)
        self.assertEqual([subject['catalogue_count'] for subject in subjects], [3, 1])
        self.assertEqual(sum(item['completed'] for item in items), 1)
        pending = [item for item in items if not item['has_result']]
        self.assertEqual(len(pending), 3)
        self.assertTrue(all(item['status'] == 'Not started' and item['actual'] == 0 for item in pending))
        self.assertIn('C-50-material:20', links)
        self.assertNotIn('C-50-quiz:10', links)
        self.assertEqual(records, before)

    def test_repeated_results_share_one_component_and_preserve_accepted_hours(self):
        records = [self.record(1, actual_seconds=1800, achieved_score=5, total_score=10),
                   self.record(2, actual_seconds=3600, achieved_score=8, total_score=10),
                   self.record(3, accepted=False, actual_seconds=99999, achieved_score=2, total_score=10)]
        items, subjects, _ = self.project(records)
        completed = [item for item in items if item['completed']]
        self.assertEqual(len(completed), 1)
        self.assertEqual(completed[0]['quiz_score'], 8)
        self.assertEqual(completed[0]['record_ids'], ['1', '2', '3'])
        self.assertEqual(subjects[0]['accepted_hours'], 1.5)
        self.assertEqual(len({item['activity_id'] for item in items}), 4)

    def test_one_record_can_complete_two_linked_components_without_double_hours(self):
        record = self.record()
        record['sources'] += [dict(record['sources'][0]),
                              {**record['sources'][0], 'source_activity_id': 'material:20'}]
        items, subjects, _ = self.project([record])
        self.assertEqual(sum(item['completed'] for item in items), 2)
        self.assertEqual(sum(item['actual'] for item in items), 1)
        self.assertEqual(subjects[0]['accepted_hours'], 1)
        self.assertEqual(sum('1' in item['record_ids'] for item in items), 1)
        self.assertFalse(next(item for item in items if item['catalogue_kind'] == 'quiz')['completed'])

    def test_missing_or_foreign_lineage_does_not_complete_matching_titles(self):
        records = [self.record(course='99'), self.record(2, sources=[], component_title='material:10')]
        items, subjects, _ = self.project(records, self.catalogue + [self.definition('99', 'material:10')])
        self.assertEqual(len(items), 4)
        self.assertFalse(any(item['completed'] for item in items))
        self.assertEqual(sum(s['accepted_hours'] for s in subjects), 0)

    def test_verified_journal_routes_complete_each_component_once(self):
        records = [self.record(sources=[], journal_routes=[
            {'group_id': 50, 'activity_id': i, 'source_ref': f'la:50:{i}'} for i in (10, 20)])]
        items, _, _ = self.project(records)
        self.assertEqual(sum(item['completed'] for item in items), 2)
        self.assertEqual(sum(item['actual'] for item in items), 1)
        records[0]['journal_routes'].append({'group_id': 99, 'activity_id': 10, 'source_ref': 'la:99:10'})
        self.assertFalse(any(item['completed'] for item in self.project(records)[0]))

    def test_catalogue_ids_remain_stable_after_first_completion(self):
        before, _, _ = self.project([])
        after, _, _ = self.project([self.record()])
        self.assertEqual([item['activity_id'] for item in before], [item['activity_id'] for item in after])

    def test_shared_component_completion_stays_in_its_qualified_course(self):
        records = [self.record(1, course='50', accepted=False, actual_seconds=None,
            activity_status='completed', sources=[{'source_system': 'old_lms',
                'source_course_ref': '50', 'source_activity_id': 'course:50:material:10'}])]
        items, subjects, _ = self.project(records)
        self.assertEqual([i['activity_id'] for i in items if i['completed']], ['catalogue:50:material:10'])
        self.assertEqual(sum(s['accepted_hours'] for s in subjects), 0)
        records.append(self.record(2, course='60', accepted=False, actual_seconds=None,
            activity_status='completed', sources=[{'source_system': 'old_lms',
                'source_course_ref': '60', 'source_activity_id': 'course:60:material:10'}]))
        items, _, _ = self.project(records)
        self.assertEqual({i['activity_id'] for i in items if i['completed']},
                         {'catalogue:50:material:10', 'catalogue:60:material:10'})

    def test_qualified_quiz_does_not_complete_or_open_same_numbered_material(self):
        source = {'source_system': 'old_lms', 'source_course_ref': '50',
                  'source_activity_id': 'course:50:quiz:10'}
        items, _, _ = self.project([self.record(sources=[source])])
        completed = [i for i in items if i['completed']]
        self.assertEqual(len(completed), 1)
        self.assertEqual(completed[0]['activity_id'], 'catalogue:50:quiz:10')
        self.assertFalse(completed[0]['can_open_material'])

    def test_qualified_source_cannot_override_its_saved_course_or_fall_back_to_journal(self):
        for reference in ('course:60:material:10', 'course:50:material:0',
                          'course:50:quiz:10:extra', 'course:50:10'):
            record = self.record(sources=[{'source_system': 'old_lms', 'source_course_ref': '50',
                'source_activity_id': reference}], source_payload={'original_source_ref': 'la:50:10'})
            self.assertFalse(any(i['completed'] for i in self.project([record])[0]))


    def test_verified_scope_preserves_qualified_completion_in_the_other_course(self):
        self.courses[0]['verified_catalogue_scope'] = self.verified_scope('material:10')
        records = [self.record(index, course=course, accepted=False, actual_seconds=None,
            activity_status='completed', sources=[{'source_system': 'old_lms',
                'source_course_ref': course, 'source_activity_id': f'course:{course}:material:10'}])
            for index, course in enumerate(('50', '60'), start=1)]
        original = copy.deepcopy((self.courses, self.catalogue, records))
        items, subjects, _ = self.project(records)
        self.assertEqual([item['activity_id'] for item in items if item['completed']],
                         ['catalogue:60:material:10'])
        self.assertEqual([subject['catalogue_count'] for subject in subjects], [2, 1])
        self.assertEqual(sum(subject['accepted_hours'] for subject in subjects), 0)
        self.assertEqual((self.courses, self.catalogue, records), original)

    @staticmethod
    def verified_scope(*refs, course='50'):
        return {'version': 1, 'basis': 'verified-legacy-account-inventory',
                'course_ref': course, 'excluded_activity_refs': list(refs)}

    def test_restored_component_from_another_learner_does_not_reduce_completed_course(self):
        self.courses = self.courses[:1]
        self.courses[0]['verified_catalogue_scope'] = self.verified_scope('material:20')
        records = [self.record(), self.record(2, actual_seconds=1800, sources=[{
            'source_system': 'old_lms', 'source_course_ref': '50', 'source_activity_id': 'quiz:10'}])]
        original = copy.deepcopy((self.courses, self.catalogue, records))
        items, subjects, links = self.project(records)
        self.assertEqual(len(items), 2)
        self.assertTrue(all(item['completed'] for item in items))
        self.assertEqual(subjects[0]['catalogue_count'], 2)
        self.assertEqual(subjects[0]['accepted_hours'], 1.5)
        self.assertNotIn('C-50-material:20', links)
        self.assertEqual((self.courses, self.catalogue, records), original)
        # The same course still contains the restored item for other members.
        del self.courses[0]['verified_catalogue_scope']
        other_items, _, _ = self.project(records)
        self.assertEqual(len(other_items), 3)
        self.assertEqual(sum(item['completed'] for item in other_items), 2)

    def test_exclusion_is_specific_to_both_course_and_typed_component(self):
        self.courses[0]['verified_catalogue_scope'] = self.verified_scope('material:10')
        items, subjects, _ = self.project([])
        self.assertEqual({item['activity_id'] for item in items}, {
            'catalogue:50:material:20', 'catalogue:50:quiz:10', 'catalogue:60:material:10'})
        self.assertEqual([subject['catalogue_count'] for subject in subjects], [2, 1])

    def test_exclusion_does_not_freeze_catalogue_or_hide_later_assignments(self):
        self.courses[0]['verified_catalogue_scope'] = self.verified_scope('material:20')
        self.catalogue.append(self.definition('50', 'material:30'))
        items, _, _ = self.project([])
        self.assertIn('catalogue:50:material:30', {item['activity_id'] for item in items})
        self.assertTrue(all(not item['completed'] for item in items))

    def test_overview_uses_the_same_verified_course_scope(self):
        self.courses[0]['verified_catalogue_scope'] = self.verified_scope('material:10')
        items, _, _ = self.scope['recorded_course_items'](
            self.courses, self.catalogue, [self.record()], overview_only=True)
        self.assertEqual(items, [])

    def test_json_text_scope_matches_decoded_scope_without_changing_progress_or_hours(self):
        scope = self.verified_scope('material:20')
        self.courses[0]['verified_catalogue_scope'] = scope
        records = [self.record(), self.record(2, actual_seconds=1800, sources=[{
            'source_system': 'old_lms', 'source_course_ref': '50', 'source_activity_id': 'quiz:10'}])]
        expected = self.project(records)
        self.courses[0]['verified_catalogue_scope'] = json.dumps(scope)
        before = copy.deepcopy((self.courses, self.catalogue, records))
        self.assertEqual(self.project(records), expected)
        self.assertEqual((self.courses, self.catalogue, records), before)
        self.assertEqual(expected[1][0]['catalogue_count'], 2)
        self.assertEqual(expected[1][0]['accepted_hours'], 1.5)

    def test_subject_reader_accepts_database_json_text_in_catalogue_and_overview(self):
        course = {**self.courses[0], 'id': 1,
                  'verified_catalogue_scope': json.dumps(self.verified_scope('material:20'))}
        records = [self.record(), self.record(2, sources=[{
            'source_system': 'old_lms', 'source_course_ref': '50', 'source_activity_id': 'quiz:10'}])]
        owner = {'id': 7, 'name': 'Synthetic learner', 'aptem_id': 70}
        self.scope['targets_for'] = Mock(return_value={})
        for overview in (False, True):
            with self.subTest(overview=overview):
                self.scope['query'] = Mock(side_effect=[[course], self.catalogue[:3], []])
                result = self.scope['source_subjects'](17, lambda items: {'activities': items},
                    owner=owner, records=records, overview_only=overview)
                self.assertEqual(len(result['activities']), 2)
                self.assertTrue(all(item['completed'] for item in result['activities']))
                self.assertEqual(self.scope['query'].call_args_list[0].args[1], [7])

    def test_malformed_or_foreign_scope_is_reported_instead_of_hiding_work(self):
        for invalid in ['{invalid-json', 'null', '[]', 'true', json.dumps('not-an-object'),
                        json.dumps(self.verified_scope('material:10', course='60')),
                        json.dumps(self.verified_scope('10')),
                        [], {}, self.verified_scope('material:10', course='60'),
                        self.verified_scope('10'), self.verified_scope(10),
                        {**self.verified_scope('material:10'), 'version': 2},
                        {**self.verified_scope('material:10'), 'excluded_activity_refs': 'material:10'}]:
            with self.subTest(scope=invalid):
                self.courses[0]['verified_catalogue_scope'] = invalid
                with self.assertRaisesRegex(self.scope['ServiceError'], 'verified learner course scope needs review'):
                    self.project([])

    def test_empty_verified_exclusions_preserve_the_complete_catalogue(self):
        self.courses[0]['verified_catalogue_scope'] = self.verified_scope()
        items, _, _ = self.project([])
        self.assertEqual(len(items), 4)

    def test_compact_coach_reader_keeps_the_same_learner_course_scope(self):
        path = Path(__file__).parents[1] / 'coach_api' / 'learning_plan_projection.py'
        node = next(node for node in ast.parse(path.read_text(encoding='utf-8')).body
                    if isinstance(node, ast.FunctionDef) and node.name == 'read_history')
        course = {**self.courses[0], 'id': 1,
                  'verified_catalogue_scope': json.dumps(self.verified_scope('material:20'))}
        query = Mock(side_effect=[[course], self.catalogue[:3]])
        scope = {'query': query, 'canonical_learning': SimpleNamespace(
            entries_for=Mock(return_value=[self.record()]),
            recorded_course_items=self.scope['recorded_course_items'])}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), scope)
        access = SimpleNamespace(student_activity_available=lambda _ident: True)
        with patch.dict('sys.modules', {'learner_api.student_activity_access': access}):
            result = scope['read_history'](SimpleNamespace(aptem_id=70), {'id': 7})
        self.assertEqual(len(result['activities']), 2)
        self.assertEqual(result['subjects'][0]['catalogue_count'], 2)
        self.assertIn("m.source_payload->'verified_catalogue_scope'", query.call_args_list[0].args[0])
        self.assertIn("m.source_relationship='historical'", query.call_args_list[0].args[0])
        self.assertEqual(query.call_args_list[0].args[1], [7])

    def test_subject_endpoint_projects_the_owned_catalogue_without_any_progress(self):
        self.scope['profile'] = Mock(return_value={'id': 7, 'name': 'Synthetic learner', 'aptem_id': 70})
        self.scope['entries_for'] = Mock(return_value=[])
        self.scope['targets_for'] = Mock(return_value={})
        self.scope['query'].side_effect = [
            [{**course, 'id': index + 1} for index, course in enumerate(self.courses)], self.catalogue, []]
        result = self.scope['source_subjects'](17, lambda items: {'activities': items})
        self.assertEqual(result['progress_basis'], 'catalogue_activities')
        self.assertEqual(len(result['activities']), 4)
        self.assertEqual(result['recorded_otjh_total'], 0)
        self.assertEqual(len(result['subjects']), 2)
        self.assertIn('m.learner_id=%s', self.scope['query'].call_args_list[0].args[0])
        self.assertIn("m.source_relationship='historical'", self.scope['query'].call_args_list[0].args[0])
        self.assertIn("m.source_payload->'verified_catalogue_scope'", self.scope['query'].call_args_list[0].args[0])
        self.assertEqual(self.scope['query'].call_args_list[1].args[1], [[1, 2]])


if __name__ == '__main__':
    unittest.main()
