"""Frozen-original attachment/content parity through real compatibility exports.

Only synthetic values and explicit read/setup doubles; SimpleTestCase forbids DBs.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from curriculum_api import views

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/attachment_preparation_snapshot.json').read_text())


@contextmanager
def original_attachment_preparation():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue  # Keep explicitly supplied read doubles in both paths.
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-attachment-preparation>', 'exec'), namespace)
            original = namespace[name]
            function = FunctionType(original.__code__, vars(views), name, original.__defaults__)
            function.__kwdefaults__ = original.__kwdefaults__
            stack.enter_context(composition_fixture(views, name, function))
        yield


class AttachmentPreparationParity(SimpleTestCase):
    def compare(self, name, *args, watched=(), **kwargs):
        old_args, old_kwargs = deepcopy(args), deepcopy(kwargs)
        new_args, new_kwargs = deepcopy(args), deepcopy(kwargs)

        def invoke(arguments, keywords):
            try:
                return ('return', getattr(views, name)(*arguments, **keywords))
            except Exception as error:
                return ('raise', type(error), str(error))

        for mock in watched:
            mock.reset_mock()
        with original_attachment_preparation():
            expected = invoke(old_args, old_kwargs)
        if name == 'module_attachment_authoring_payload' and expected[0] == 'return':
            expected = ('return', {**expected[1], 'weekBoundaryMode': None})
        calls = [list(mock.mock_calls) for mock in watched]
        for mock in watched:
            mock.reset_mock()
        owner = importlib.import_module(SNAPSHOT[name]['owner'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = invoke(new_args, new_kwargs)
        called.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual((new_args, new_kwargs), (old_args, old_kwargs))
        self.assertEqual([list(mock.mock_calls) for mock in watched], calls)
        return actual

    def test_identity_whitespace_missing_ids_and_same_names(self):
        for left, right in (([], []), ([None], []), ([], ['P']), ([' P\u3000'], ['p']),
                            (['P1', 'Name'], ['P2', 'Name']), ([None, ''], [None, ''])):
            self.compare('identity_values_match_context', left, right)
        for ident, context in ((None, ['G']), ('G', [None]), (' G ', ['g']), ('G1', ['G2'])):
            self.compare('identity_ids_conflict', ident, context)
        self.compare('first_clean_payload_value', {'a': ' ', 'b': ' X\u3000'}, 'a', 'b')
        self.assertTrue(views.identity_ids_conflict('C1', ['C2']))

    def test_week_list_shapes_and_reference_preservation(self):
        for value in (None, 4, '4', {}, [], [None], [{'id': 'W'}]):
            self.compare('payload_week_list', value)
        weeks = [{'id': 'W', 'components': []}]
        self.assertIs(views.payload_week_list(weeks), weeks)
        self.assertIs(views.attachment_week_structure({'weekStructure': weeks}), weeks)

    def test_week_counts_keep_sessions_separate_from_authored_weeks(self):
        for item in ({}, {'weeks': 3}, {'weeksNumber': '2'}, {'weeks': [{'id': 'W'}]},
                     {'weeksNumber': 0, 'weekStructure': [{'id': 'W'}]}, {'weeks': -1}):
            for count in (0, 1, 10):
                self.compare('attachment_week_count', item, count, 'Monday, Thursday')
        self.assertEqual(views.attachment_week_count({}, 10, 'Monday, Thursday'), 5)

    def test_session_count_precedence_and_negative_existing_behavior(self):
        for item in (None, {}, {'sessionsNumber': 7, 'weeks': 2}, {'sessionsNumber': -1},
                     {'weeks': 3}, {'weeks': [{'id': 'W'}]}, {'weeks': 'bad'},
                     {'weeksNumber': 3, 'weeklySchedule': [
                         {'day': 'Monday', 'startTime': '09:00', 'endTime': '10:00'},
                         {'day': 'Thursday', 'startTime': '09:00', 'endTime': '10:00'}]}):
            self.compare('attachment_session_count', item)

    def test_resize_preserves_authored_content_and_drops_only_trailing_shells(self):
        first = views.empty_authoring_week(1)
        authored = {**views.empty_authoring_week(2), 'components': [{'id': 'COMP'}]}
        tail = views.empty_authoring_week(3)
        weeks = [first, authored, tail]
        for target in (0, 1, 2, 3, 5, -1, 'bad'):
            self.compare('resize_authoring_week_structure', weeks, target)
            self.compare('resize_authoring_week_structure_preserving_content', weeks, target)
        self.assertEqual(views.resize_authoring_week_structure_preserving_content(weeks, 0), [first, authored])
        self.assertIs(views.resize_authoring_week_structure_preserving_content(weeks, 0)[1], authored)

    def test_every_authored_content_marker_stops_shrink(self):
        for value in (None, {}, {'title': 'Week 1', 'weekNumber': 1},
                      {'title': 'Custom'}, {'summary': 'Text'}, {'learningOutcomes': ['X']},
                      {'ksbMappings': [{'code': 'K1'}]}, {'components': [{'id': 'COMP'}]}):
            self.compare('week_holds_authored_content', value)
        self.compare('empty_authoring_week', 2)

    def test_stored_explicit_and_list_alias_structure_precedence(self):
        stored = {'weekStructure': [{'id': 'STORED', 'components': [{'id': 'KEEP'}]}]}
        for item in ({}, {'weeks': 5}, {'weekStructure': [{'id': 'EXPLICIT'}]},
                     {'weekStructure': [], 'weeks': [{'id': 'LIST'}]}, {'weeks': [1, 2]}):
            self.compare('attachment_week_structure', item, stored, week_count=4)
        self.compare('attachment_week_structure', {'weeks': 3}, week_count=3)

    def test_custom_schedule_builds_same_bounded_slots_without_provider_access(self):
        item = {'scheduleMode': 'custom', 'weeksNumber': 2, 'startDate': '2026-09-10',
                'endDate': '2026-09-23', 'weeklySchedule': [
                    {'day': day, 'startTime': '09:00', 'endTime': '11:00'}
                    for day in ('Tuesday', 'Thursday')]}
        result = self.compare('attachment_week_structure', item, week_count=2)
        self.assertEqual(result[0], 'return')
        self.assertEqual([len(w['components']) for w in result[1]], [2, 2])

    def test_attachment_payload_keeps_explicit_blanks_and_stored_content(self):
        group = {'id': 'G', 'name': 'Group', 'tutor': 'Group tutor', 'weekDays': 'Monday'}
        cohort = {'id': 'C', 'programmeId': 'P', 'programme': 'Programme'}
        stored = {'weekStructure': [{'id': 'W', 'components': [{'id': 'KEEP'}]}],
                  'coverImage': 'old-cover', 'completionCriteria': {'preserve': True},
                  'calendarPolicy': {'stored': True}, 'moduleKsbMappings': [{'code': 'K1'}]}
        for item in ({}, {'tutor': '', 'coverImage': '', 'calendarPolicy': None},
                     {'tutorName': 'Assigned', 'weeksNumber': 3, 'ksbProfileSourceId': ''}):
            result = self.compare('module_attachment_authoring_payload', item, group, cohort,
                                  'M', 'Title', 4, '2026-09-07', '2026-10-01', stored)
            self.assertEqual(result[0], 'return')
            self.assertEqual(result[1]['weekStructure'], stored['weekStructure'])
            if 'tutor' in item:
                self.assertEqual((result[1]['tutor'], result[1]['coverImage'], result[1]['calendarPolicy']), ('', '', None))

    def test_attachment_payload_missing_required_context_still_errors(self):
        result = self.compare('module_attachment_authoring_payload', {}, {}, {}, 'M', 'Title', 1, '', '')
        self.assertEqual(result[0:2], ('raise', KeyError))

    def test_cohort_date_window_messages_and_field_order(self):
        cohort = {'startDate': '2026-09-01', 'practicalEndDate': '2027-05-31'}
        for start, end in (('2026-07-31', '2027-06-01'), ('2026-08-01', '2027-05-31'),
                           ('2027-06-01', ''), ('2026-09-01', '2027-06-01'), ('bad', 'bad')):
            self.compare('module_cohort_date_error', 'Module', start, end, cohort)

    @contextmanager
    def candidates(self, rows, counts=None):
        with composition_fixture(views, 'ensure_module_authoring_tables') as setup, \
             composition_fixture(views, 'authoring_component_counts_by_catalogue', return_value=counts or {}) as totals, \
             composition_fixture(views, 'authoring_fetch_all', return_value=deepcopy(rows)) as read:
            yield setup, totals, read

    def test_explicit_catalogue_resolution_short_circuits_all_title_reads(self):
        with self.candidates([]) as mocks, composition_fixture(views, 'resolve_authoring_catalogue_id', return_value='M') as resolve:
            result = self.compare('find_existing_authoring_catalogue_id_for_payload',
                                  {'catalogueId': 'alias', 'isFreeCourse': True}, watched=(*mocks, resolve))
            self.assertEqual(result, ('return', 'M'))
            for mock in mocks:
                mock.assert_not_called()

    def test_free_course_title_never_adopts_unplaced_module(self):
        with self.candidates([{'module_catalogue_id': 'OTHER', 'title': 'Same'}]) as mocks:
            result = self.compare('find_existing_authoring_catalogue_id_for_payload',
                                  {'title': 'Same', 'isFreeCourse': True}, watched=mocks)
            self.assertEqual(result, ('return', ''))
            for mock in mocks:
                mock.assert_not_called()

    def test_create_candidate_ranking_kind_withdrawal_and_stable_ties(self):
        rows = [
            {'module_catalogue_id': 'FREE', 'title': 'Title', 'source_type': 'free_course', 'updated_at': '9'},
            {'module_catalogue_id': 'ARCHIVED', 'title': 'Title', 'updated_at': '9'},
            {'module_catalogue_id': 'A', 'title': 'Title', 'programme_id': 'P', 'updated_at': '2'},
            {'module_catalogue_id': 'B', 'title': 'Title', 'programme_id': 'P', 'updated_at': '2'},
            {'module_catalogue_id': 'WRONG', 'title': 'Other', 'programme_id': 'P', 'updated_at': '9'},
        ]
        with self.candidates(rows, {'FREE': 9, 'ARCHIVED': 9, 'A': 3, 'B': 3}) as mocks, \
             composition_fixture(views, 'module_withdrawn_on_its_own', side_effect=lambda row: row['module_catalogue_id'] == 'ARCHIVED'):
            result = self.compare('find_existing_authoring_catalogue_id_for_payload',
                                  {'title': ' Title ', 'programmeId': 'P'}, watched=mocks)
            self.assertEqual(result, ('return', 'A'))

    def test_attachment_rejects_same_name_different_canonical_cohort_and_group(self):
        rows = [
            {'module_catalogue_id': 'WRONG', 'title': 'Title', 'cohort_id': 'OTHER-C',
             'cohort_name': 'Same', 'group_id': 'OTHER-G', 'group_name': 'Same', 'programme_id': 'P'},
            {'module_catalogue_id': 'RIGHT', 'title': 'Title', 'cohort_id': 'C', 'group_id': 'G', 'programme_id': 'P'},
        ]
        with self.candidates(rows, {'WRONG': 99, 'RIGHT': 1}) as mocks:
            result = self.compare('contentful_catalogue_id_for_attachment', {},
                                  {'id': 'G', 'name': 'Same', 'programmeId': 'P', 'cohortId': 'C'},
                                  {'id': 'C', 'name': 'Same'}, 'Title', watched=mocks)
            self.assertEqual(result, ('return', 'RIGHT'))

    def test_attachment_component_count_ties_keep_current_identity(self):
        for count, expected in ((1, 'CURRENT'), (2, 'CURRENT'), (3, 'CANDIDATE')):
            structures = {'CURRENT': {'weekStructure': [{'components': [{}, {}]}]},
                          'CANDIDATE': {'weekStructure': [{'components': [{}] * count}]}}
            with self.candidates([{'module_catalogue_id': 'CANDIDATE', 'title': 'Title'}], {'CANDIDATE': 9}) as mocks, \
                 composition_fixture(views, 'authoring_module_exists', return_value=True) as exists, \
                 composition_fixture(views, 'get_authoring_structure_payload', side_effect=structures.get) as structure:
                result = self.compare('contentful_catalogue_id_for_attachment', {}, {}, {}, 'Title', 'CURRENT',
                                      watched=(*mocks, exists, structure))
                self.assertEqual(result, ('return', expected))

    def test_candidate_read_failures_keep_existing_fallback_and_structure_errors_propagate(self):
        with self.candidates([]) as mocks:
            mocks[2].side_effect = ValueError('synthetic candidate failure')
            self.assertEqual(self.compare('contentful_catalogue_id_for_attachment', {}, {}, {}, 'Title', 'CURRENT',
                                          watched=mocks), ('return', 'CURRENT'))
            self.assertEqual(self.compare('find_existing_authoring_catalogue_id_for_payload', {'title': 'Title'},
                                          watched=mocks), ('return', ''))
        with self.candidates([{'module_catalogue_id': 'NEXT', 'title': 'Title'}]), \
             composition_fixture(views, 'authoring_module_exists', return_value=True), \
             composition_fixture(views, 'get_authoring_structure_payload', side_effect=ValueError('synthetic structure failure')):
            self.assertEqual(self.compare('contentful_catalogue_id_for_attachment', {}, {}, {}, 'Title', 'CURRENT')[0:2],
                             ('raise', ValueError))

    def test_component_count_query_predicates_parameters_and_error_contract(self):
        events = Mock()
        with composition_fixture(views, 'ensure_module_authoring_tables', events.setup), \
             composition_fixture(views, 'deleted_sql_condition', return_value='deleted_at is not null'), \
             composition_fixture(views, 'learning_read_table', return_value='synthetic_components'), \
             composition_fixture(views, 'fetch_all', events.read):
            events.read.return_value = [{'catalogue_id': ' M ', 'total': '3'}, {'catalogue_id': '', 'total': 10}]
            result = self.compare('authoring_component_counts_by_catalogue', watched=(events,))
            self.assertEqual(dict(result[1]), {'M': 3})
            sql, params = events.read.call_args.args
            self.assertIn('group by "module_catalogue_id"', sql)
            self.assertIn('not (deleted_at is not null)', sql)
            self.assertEqual(params, sorted(views.RETIRED_COMPONENT_TYPES))
            events.read.side_effect = ValueError('synthetic aggregate failure')
            # The approved count-reader fix deliberately stopped disguising a
            # failed query as zero counts. Keep the frozen pre-fix oracle honest.
            events.reset_mock()
            with original_attachment_preparation():
                self.assertEqual(dict(views.authoring_component_counts_by_catalogue()), {})
            original_calls = list(events.mock_calls)
            events.reset_mock()
            owner = importlib.import_module(SNAPSHOT['authoring_component_counts_by_catalogue']['owner'])
            with observe_export(views, owner, 'authoring_component_counts_by_catalogue',
                                wraps=owner.authoring_component_counts_by_catalogue) as called:
                with self.assertRaisesRegex(ValueError, 'synthetic aggregate failure'):
                    views.authoring_component_counts_by_catalogue()
            called.assert_called_once()
            self.assertEqual(list(events.mock_calls), original_calls)

    def test_structure_delta_reorders_components_without_mutating_stored_input(self):
        stored = {'title': 'Old', 'weekStructure': [
            {'id': 'W1', 'title': 'First', 'components': [{'id': 'C1', 'settings': {'keep': True}}]},
            {'id': 'W2', 'title': 'Second', 'components': [{'id': 'C2'}]}]}
        payload = {'title': 'New', 'expectedRevision': 'R', 'saveMode': 'partial', 'structureDelta': {
            'weekOrder': ['W2', 'W1'], 'componentOrder': {'W2': ['C1'], 'W1': ['C2']},
            'weeks': {'W2': {'id': 'W2', 'title': 'Edited'}}, 'components': {'C2': {'id': 'C2', 'title': 'Edited'}}}}
        result = self.compare('merge_partial_module_structure', stored, payload)
        self.assertEqual(result[0], 'return')
        self.assertEqual([w['id'] for w in result[1]['weekStructure']], ['W2', 'W1'])
        self.assertNotIn('expectedRevision', result[1])
        self.assertEqual(result[1]['title'], 'New')

    def test_structure_delta_missing_conflicting_and_empty_states(self):
        for payload in ({}, {'structureDelta': []}, {'structureDelta': {}},
                        {'structureDelta': {'weekOrder': ['missing']}},
                        {'structureDelta': {'weekOrder': ['W'], 'componentOrder': {'W': ['missing']}}}):
            self.compare('merge_partial_module_structure', {'weekStructure': [{'id': 'W'}]}, payload)

    def test_assurance_absent_false_and_null_are_distinct(self):
        for payload in ({}, {'reflectionRequired': False}, {'reflectionRequired': None},
                        {'reflection_required': True}, {'reflectionRequired': False, 'reflection_required': True}):
            for stored in (None, {}, {'reflection_required': False}, {'reflection_required': True}):
                for default in (False, True):
                    self.compare('component_assurance_flag', payload, stored, 'reflectionRequired', 'reflection_required', default)

    def test_free_course_copy_maps_preserve_content_and_do_not_reuse_ids(self):
        rows = [{'weekNumber': 2, 'displayOrder': 1, 'weekTitle': 'Later', 'components': []},
                {'weekNumber': 1, 'displayOrder': 0, 'weekTitle': 'First', 'id': 'FREE-W', 'components': [
                    {'id': 'FREE-C', 'type': 'quiz', 'expectedOtjh': 2, 'settings': {'linkedQuizId': 'Q'}}]}]
        result = self.compare('build_free_course_week_structure', rows)
        self.assertEqual(result[0], 'return')
        weeks = result[1]
        self.assertEqual(weeks[0]['title'], 'First')
        self.assertNotIn('id', weeks[0]['components'][0])
        self.compare('build_module_free_course_weeks', {'title': 'Course', 'weekStructure': weeks}, 'FREE')
        self.compare('_free_module_response_to_input', {'id': 'FREE-W', 'courseName': 'Course',
                     'components': [{'id': 'FREE-C', 'settings': {'linkedQuizId': 'Q'}}]})
        self.compare('module_structure_component_count', {'weekStructure': weeks})
        self.assertEqual(views.module_structure_component_count({'weekStructure': weeks}), 1)

    def test_empty_and_malformed_conversion_shapes_keep_existing_outcomes(self):
        for rows in ([], [{}], [{'components': [{'settings': None}]}], [None]):
            self.compare('build_free_course_week_structure', rows)
        for value in ({}, {'weekStructure': []}, {'weekStructure': [None]}):
            self.compare('build_module_free_course_weeks', value, 'FREE')
        self.compare('_free_module_response_to_input', {})
