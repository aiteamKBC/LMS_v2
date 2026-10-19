"""Conflict integration regressions, with no Django startup, DB or network."""
import unittest
from unittest.mock import Mock

from learner_api.test_canonical_learning_no_db import adapter


class CourseProjectionMergeTests(unittest.TestCase):
    def setUp(self):
        self.scope = adapter(Mock())
        self.owner = {'id': 7, 'name': 'Synthetic learner', 'aptem_id': 70}
        self.courses = [{'id': 1, 'source_course_ref': '50', 'source_course_title': 'Course A'}]
        self.record = {'id': 1, 'accepted': True, 'actual_seconds': 3600, 'ksbs': [],
                       'sources': [{'source_system': 'old_lms', 'source_course_ref': '50',
                                    'source_activity_id': 'material:10'}]}
        self.scope['profile'] = Mock(side_effect=AssertionError('Owner should be reused'))
        self.scope['entries_for'] = Mock(side_effect=AssertionError('Records should be reused'))

    def test_compact_overview_works_with_only_the_selected_catalogue_columns(self):
        self.scope['query'].side_effect = [self.courses,
            [{'source_course_ref': '50', 'source_activity_id': 'material:10'},
             {'source_course_ref': '50', 'source_activity_id': 'material:20'}]]
        summarize = Mock(side_effect=AssertionError('Overview must not build the full response'))
        result = self.scope['source_subjects'](17, summarize, owner=self.owner,
                                             records=[self.record], overview_only=True)
        self.assertEqual(result, {'progress_basis': 'recorded_activities',
            'subjects': [{'id': 50, 'name': 'Course A', 'module_id': None}],
            'activities': [{'activity_id': 'record:50:1', 'group_id': 50, 'completed': True}]})
        self.assertIn('SELECT a.source_activity_id,c.source_course_ref',
                      self.scope['query'].call_args_list[1].args[0])
        self.assertEqual(self.scope['query'].call_count, 2)
        self.assertNotIn('source_payload', self.scope['query'].call_args_list[1].args[0])
        self.assertNotIn('source_materials', self.scope['query'].call_args_list[1].args[0])

    def test_full_catalogue_keeps_unstarted_components_when_reusing_records(self):
        self.scope['query'].side_effect = [self.courses, [
            {'source_course_ref': '50', 'source_activity_id': f'material:{ident}',
             'source_course_title': 'Course A', 'source_activity_title': f'Material {ident}'}
            for ident in (10, 20)], []]
        self.scope['targets_for'] = Mock(return_value={})
        result = self.scope['source_subjects'](17, lambda items: {'activities': items},
                                             owner=self.owner, records=[self.record])
        self.assertEqual(result['progress_basis'], 'catalogue_activities')
        self.assertEqual(len(result['activities']), 2)
        self.assertEqual(sum(item['completed'] for item in result['activities']), 1)
        self.assertEqual(result['subjects'][0]['accepted_hours'], 1)
        self.assertEqual(result['recorded_otjh_total'], 1)

    def test_full_catalogue_recovers_source_placement_and_links_with_empty_reused_records(self):
        catalogue = [
            {'source_course_ref': '50', 'source_activity_id': ref,
             'source_course_title': 'Course A', 'source_activity_title': ref,
             'source_payload': payload, 'material_available': available}
            for ref, payload, available in (
                ('material:10', {}, True),
                ('material:20', {'quiz_id': 30}, True),
                ('quiz:30', {'activity_id': 20, 'quiz_id': 30}, False))]
        exports = [
            {'course_id': 50, 'component_id': ident, 'component_kind': kind,
             'section_id': str(order), 'section_order': str(order), 'section_title': title}
            for ident, kind, order, title in (
                (10, 'lesson', 1, 'Welcome resources'),
                (20, 'lesson', 2, 'March 2026'),
                (30, 'quiz', 2, 'March 2026'))]
        self.scope['query'].side_effect = [self.courses, catalogue, exports]
        self.scope['targets_for'] = Mock(return_value={})
        result = self.scope['source_subjects'](17, lambda items: {'activities': items},
                                             owner=self.owner, records=[])
        introduction, material, quiz = result['activities']
        self.assertEqual(introduction['date_source'], 'introduction')
        self.assertEqual(material['month'], '2026-03')
        self.assertEqual(quiz['month'], '2026-03')
        self.assertIsNone(material['date'])
        self.assertEqual(quiz['source_material_activity_id'], 'catalogue:50:material:20')
        self.assertFalse(any(item['completed'] for item in result['activities']))
        self.assertEqual(result['recorded_otjh_total'], 0)
        catalogue_sql = self.scope['query'].call_args_list[1].args[0]
        self.assertIn('AS source_payload', catalogue_sql)
        self.assertIn('AS material_available', catalogue_sql)

    def test_recorded_mode_still_counts_a_multi_component_record_once_per_course(self):
        catalogue = [{'source_course_ref': '50', 'source_activity_id': f'material:{ident}',
                      'source_course_title': 'Course A', 'source_activity_title': f'Material {ident}'}
                     for ident in (10, 20)]
        self.record['sources'].append({**self.record['sources'][0], 'source_activity_id': 'material:20'})
        items, subjects, _ = self.scope['recorded_course_items'](self.courses, catalogue, [self.record])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['activity_id'], 'record:50:1')
        self.assertEqual(subjects[0]['accepted_hours'], 1)
