"""Full owned course catalogues with learner progress; no Django or network."""
import copy
import unittest
from unittest.mock import Mock

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
        self.assertEqual(self.scope['query'].call_args_list[1].args[1], [[1, 2]])


if __name__ == '__main__':
    unittest.main()
