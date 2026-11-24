"""Activity projection guards; all persistence and network work is mocked."""
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from django.db import DatabaseError
from old_otjh.service import ServiceError
from . import learner_detail as reader


class ActivityViewerProjectionTests(SimpleTestCase):
    def test_sidebar_learning_schedule_does_not_read_unused_programme_targets(self):
        from . import training_plan_dashboard as schedule
        source = SimpleNamespace(pk=7, email='', _canonical_profile={'id': 1})
        connection = MagicMock()
        with patch.object(schedule, 'connections', {'enrolment': connection}), \
             patch.object(schedule, 'plan_module_ids', return_value=([], {})), \
             patch.object(schedule.canonical_learning, 'targets_for') as targets, \
             patch.object(schedule.canonical_learning, 'entries_for') as ledger, \
             patch.object(schedule, 'plan_sessions') as sessions:
            result = schedule.read_dashboard(source, section='learning')
        self.assertEqual(result['modules'], [])
        self.assertEqual(result['moduleLinks'], {})
        for unused in (targets, ledger, sessions):
            unused.assert_not_called()

    def test_read_only_profile_resolution_does_not_heal_identity_links(self):
        source = SimpleNamespace()
        with patch.object(reader, 'learner_profile_for_source', return_value=None) as identity:
            self.assertIsNone(reader._active_profile_for_source(source, 7, heal=False))
        identity.assert_called_once_with(source, 7, heal=False)

    def test_legacy_title_does_not_select_a_native_module_with_the_same_title(self):
        legacy = {'componentId': 'OLD', 'module': 'Same title'}
        native = {'componentId': 'NEW', 'module': 'Same title', 'moduleId': 'M1'}
        self.assertEqual(reader._activity_module_components([legacy, native], 'OLD'), [legacy])

    def project(self, selected='LIVE', fail_content=False, plan=None):
        components = [
            {'componentId': 'LIVE', 'moduleId': 'M1', 'module': 'First', 'weekId': 'W1', 'week': 'Week 1', 'type': 'live_session'},
            {'componentId': 'READ', 'moduleId': 'M1', 'module': 'First', 'weekId': 'W2', 'week': 'Week 2', 'type': 'reading'},
            {'componentId': 'OTHER', 'moduleId': 'M2', 'module': 'Second', 'weekId': 'W3', 'week': 'Week 1', 'type': 'live_session'},
        ]
        plan = plan if plan is not None else [
            {'moduleId': 'M1', 'moduleTitle': 'First', 'weeks': [
                {'weekId': 'W1', 'components': [{'componentId': 'LIVE'}]},
                {'weekId': 'W2', 'components': [{'componentId': 'READ'}]},
            ]},
            {'moduleId': 'M2', 'moduleTitle': 'Second', 'weeks': [
                {'weekId': 'W3', 'components': [{'componentId': 'OTHER'}]},
            ]},
        ]
        detail = {'id': '7', 'modules': ['First', 'Second'], 'week': [], 'components': components,
                  'componentProgress': [{'componentId': 'READ', 'kind': 'component'}]}
        source = SimpleNamespace(pk=7, id=7, programme='Programme')
        with ExitStack() as stack:
            def mock(name, **kwargs):
                return stack.enter_context(patch(name, **kwargs))
            prefix = 'learner_api.learner_detail.'
            writes = [mock(prefix + name) for name in ('advance_learner', 'hydrate_source_training_plan', 'persist_live_otjh_snapshot')]
            snapshot = mock(prefix + '_live_otjh_snapshot')
            mock(prefix + 'effective_training_plan', return_value=plan)
            profile_read = mock(prefix + '_active_profile_for_source', return_value=SimpleNamespace(
                pk=9, enrolment_id=7, ksbs=['K1']))
            mock(prefix + 'install_canonical_training_plan', side_effect=lambda selected_source, _profile: (
                setattr(selected_source, '_canonical_training_plan', plan) or plan
            ))
            mock(prefix + '_activity_plan_assignments', side_effect=lambda _source, _profile, identity: (
                plan, reader._activity_plan_module(plan, identity)
            ))
            mock(prefix + '_linked_profile_ids', return_value=(9,))
            mock(prefix + 'to_learner_detail', return_value=detail)
            mock(prefix + 'access_gate', return_value={})
            mock(prefix + 'learning_access', return_value={})
            mock(prefix + '_apply_cohort_schedule')
            mock(prefix + 'read_sql', side_effect=lambda sql, *_args: sql)
            if fail_content:
                connection = MagicMock()
                connection.cursor.return_value.__enter__.return_value.execute.side_effect = DatabaseError('Content read timed out')
                mock(prefix + 'connections', new={'enrolment': connection})
            else:
                def resolve(_modules, _weeks, _components, *, assigned_modules, **_kwargs):
                    module_ids = {row['moduleId'] for row in assigned_modules}
                    selected_components = [row for row in components if row['moduleId'] in module_ids]
                    selected_weeks = [
                        {'moduleId': row['moduleId'], 'module': row['module'],
                         'weekId': row['weekId'], 'week': row['week']}
                        for row in selected_components
                    ]
                    selected_modules = list(dict.fromkeys(row['module'] for row in selected_components))
                    return selected_modules, selected_weeks, selected_components
                mock(prefix + '_resolve_from_master', side_effect=resolve)
            mock(prefix + '_apply_programme_assignment_template', side_effect=lambda rows, programme: rows)
            mock(prefix + '_annotate_otjh', side_effect=lambda rows: (rows, 0))
            mock(prefix + '_append_week_quizzes', side_effect=lambda weeks, rows, **kwargs: (weeks, rows))
            mock(prefix + 'retain_quiz_progress')
            attendance = mock('learner_api.teams_attendance.annotate_attendance_completion',
                              side_effect=lambda rows, profile, **kwargs: [
                                  {**row, 'attendanceCompleted': True} for row in rows])
            manual_context = ({}, [], [])
            manual = mock('learner_api.manual_attendance_completion.read_manual_context',
                          return_value=manual_context)
            replacement = mock('learner_api.replacement_learning.annotate_replacement_learning',
                               side_effect=lambda rows, pk, **kwargs: rows)
            transfer_state = mock('learner_api.progress_transfer_store.read_state',
                                  return_value={'items': []})
            credits = mock('learner_api.live_session_progress.read_live_credits', return_value=[])
            mock('learner_api.live_session_progress.supplement_component_progress', side_effect=lambda rows, credits: rows)
            result = reader.build_learner_detail(source, 7, compact=True, read_only=True,
                                                activity_component_id=selected)
            for operation in [*writes, snapshot]:
                operation.assert_not_called()
            profile_read.assert_called_once_with(source, 7, heal=False)
            expected = ['OTHER'] if selected == 'OTHER' else ['LIVE', 'READ']
            self.assertEqual([row['componentId'] for row in attendance.call_args.args[0]], expected)
            self.assertEqual([row['componentId'] for row in credits.call_args.kwargs['components']], expected)
            self.assertIs(credits.call_args.kwargs['manual_context'], manual_context)
            self.assertEqual(credits.call_args.args[0]._canonical_profile, {'id': 9})
            self.assertIs(credits.call_args.args[0]._case_file_profile,
                          profile_read.return_value)
            self.assertIs(manual.call_args.args[0], attendance.call_args.args[0])
            self.assertIs(attendance.call_args.kwargs['manual_context'], manual_context)
            transfer_state.assert_called_once_with(7)
            self.assertEqual(replacement.call_args.kwargs, {'items': []})
            self.assertEqual([row['componentId'] for row in result['components']], expected)
            self.assertTrue(result['components'][0]['attendanceCompleted'])
            return result

    def test_only_selected_module_attendance_and_no_programme_totals_or_writes(self):
        result = self.project()
        self.assertEqual(result['modules'], ['First'])
        self.assertEqual([row['weekId'] for row in result['week']], ['W1', 'W2'])
        self.assertEqual(result['componentProgress'], [{'componentId': 'READ', 'kind': 'component'}])

    def test_component_in_later_cross_programme_assignment_selects_its_actual_module(self):
        result = self.project('OTHER')
        self.assertEqual(result['modules'], ['Second'])
        self.assertEqual([row['weekId'] for row in result['week']], ['W3'])

    def test_historical_plan_placement_wins_over_current_programme_parentage(self):
        historical = {'moduleId': 'CROSS-PROGRAMME', 'moduleTitle': 'Historical placement', 'weeks': [
            {'weekId': 'OLD-WEEK', 'components': [{'componentId': 'MOVED-COMPONENT'}]},
        ]}
        current = {'moduleId': 'CURRENT-PROGRAMME', 'moduleTitle': 'Current placement', 'weeks': []}
        self.assertIs(reader._activity_plan_module([current, historical], 'MOVED-COMPONENT'), historical)

    def test_normalized_owner_query_keeps_all_module_identities_but_only_owner_children(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            (11, 'M1', False, None, None, None, None),
            (22, 'CROSS-PROGRAMME', True, 220, 'OLD-WEEK', 2200, 'MOVED-COMPONENT'),
            (22, 'CROSS-PROGRAMME', True, 221, 'NEXT-WEEK', 2201, 'NEXT-COMPONENT'),
        ]
        source = SimpleNamespace(pk=7)
        profile = SimpleNamespace(pk=9, enrolment_id=7)
        with patch.object(reader, 'connections', {'enrolment': connection}):
            assignments, owner = reader._activity_plan_assignments(source, profile, 'MOVED-COMPONENT')
        self.assertEqual(assignments, [
            {'moduleId': 'M1', 'weeks': []},
            {'moduleId': 'CROSS-PROGRAMME', 'weeks': [
                {'weekId': 'OLD-WEEK', 'components': [{'componentId': 'MOVED-COMPONENT'}]},
                {'weekId': 'NEXT-WEEK', 'components': [{'componentId': 'NEXT-COMPONENT'}]},
            ]},
        ])
        self.assertIs(owner, assignments[1])
        _sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [9, 'MOVED-COMPONENT', 9])

    def test_owner_query_rejects_a_profile_not_owned_by_the_requested_learner(self):
        connection = MagicMock()
        source = SimpleNamespace(pk=7)
        other_learner_profile = SimpleNamespace(pk=9, enrolment_id=8)
        with patch.object(reader, 'connections', {'enrolment': connection}), \
             self.assertRaises(ServiceError) as caught:
            reader._activity_plan_assignments(source, other_learner_profile, 'LIVE')
        self.assertEqual(caught.exception.status, 404)
        connection.cursor.assert_not_called()

    def test_empty_plan_does_not_fall_back_to_unassigned_curriculum_content(self):
        with self.assertRaises(ServiceError) as caught:
            self.project('LIVE', plan=[])
        self.assertEqual(caught.exception.status, 404)

    def test_ambiguous_duplicate_component_assignment_is_not_authorized(self):
        duplicate = [
            {'moduleId': 'M1', 'weeks': [{'components': [{'componentId': 'LIVE'}]}]},
            {'moduleId': 'M2', 'weeks': [{'components': [{'componentId': 'LIVE'}]}]},
        ]
        with self.assertRaises(ServiceError) as caught:
            self.project('LIVE', plan=duplicate)
        self.assertEqual(caught.exception.status, 404)

    def test_activity_content_failure_is_not_replaced_by_the_saved_outline(self):
        with self.assertRaisesMessage(DatabaseError, 'Content read timed out'):
            self.project(fail_content=True)

    def test_detailed_plan_reads_preserve_each_module_and_bound_content_transfers(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        rows = {
            'M1': ('R1', 'W1', 'M1', 'reading', 'First reading', '',
                   {'_readingContentAvailable': True, 'pointNumber': 2}, None, 1, None, False, None, False),
            'M2': ('R2', 'W2', 'M2', 'reading', 'Second reading', '',
                   {'_readingContentAvailable': True, 'pointNumber': 3}, None, 1, None, False, None, False),
        }

        def fetch_rows():
            sql, params = cursor.execute.call_args.args
            if 'SELECT m.module_catalogue_id, m.title' in sql:
                return [('M1', 'First module'), ('M2', 'Second module')]
            if 'FROM curriculum.weeks WHERE' in sql:
                return [('W1', 'M1', 'Week 1', 1, 1), ('W2', 'M2', 'Week 1', 1, 1)]
            if 'AS settings_json' in sql:
                return [rows[mid] for mid in params[0]]
            return []

        cursor.fetchall.side_effect = fetch_rows
        with patch.object(reader, 'connections', {'enrolment': connection}), \
             patch.object(reader, 'read_sql', side_effect=lambda sql, *_args: sql):
            modules, weeks, components = reader._resolve_from_master([], [], [],
                assigned_modules=[{'moduleId': 'M2'}, {'moduleId': 'M1'}], compact=True, strict=True)
        self.assertEqual(modules, ['Second module', 'First module'])
        self.assertEqual([week['weekId'] for week in weeks], ['W2', 'W1'])
        self.assertEqual([(row['componentId'], row['moduleId'], row['weekId'], row['pointNumber'], row['hasReadingContent'])
                          for row in components], [('R2', 'M2', 'W2', 3, True), ('R1', 'M1', 'W1', 2, True)])
        content_reads = [call.args for call in cursor.execute.call_args_list if 'AS settings_json' in call.args[0]]
        self.assertEqual([params for _, params in content_reads], [[['M2']], [['M1']]])

    def test_shared_projection_uses_exact_plan_components_and_saved_historical_placement(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        assigned = [{'moduleId': 'M1', 'moduleTitle': 'Assigned module', 'weeks': [
            {'weekId': 'W-OLD', 'weekTitle': 'Saved week', 'components': [
                {'componentId': 'C-OWNED'}, {'componentId': 'C-MOVED'},
            ]},
        ]}]
        component_rows = [
            ('C-OWNED', 'W-CURRENT', 'M1', 'reading', 'Owned', '', {}, None,
             1, None, False, None, False),
            # Curriculum currently places this activity under another module;
            # the learner's saved placement must still win.
            ('C-MOVED', 'W-NEW', 'M2', 'quiz', 'Moved', '', {}, None,
             2, None, False, None, False),
        ]

        def fetch_rows():
            sql, params = cursor.execute.call_args.args
            if 'SELECT m.module_catalogue_id, m.title' in sql:
                return [('M1', 'Assigned module')]
            if 'FROM curriculum.weeks WHERE' in sql:
                return [('W-OLD', 'M1', 'Current saved-week title', 1, 1)]
            if 'FROM curriculum.components WHERE' in sql:
                self.assertEqual(params, [['C-OWNED', 'C-MOVED']])
                return component_rows
            if 'FROM curriculum.quiz_component_links link' in sql:
                self.assertEqual(params, [['C-OWNED', 'C-MOVED']])
                return [('C-MOVED', 7)]
            if 'FROM curriculum.quizzes' in sql:
                return [(7, 'Quiz', [], 10, 'minutes')]
            if 'FROM curriculum.ksb_mappings mapping' in sql:
                self.assertEqual(params, [['C-OWNED', 'C-MOVED']])
                return [('C-MOVED', 'K1', 'Knowledge', 'knowledge', 1, None)]
            return []

        cursor.fetchall.side_effect = fetch_rows
        with patch.object(reader, 'connections', {'enrolment': connection}), \
             patch.object(reader, 'read_sql', side_effect=lambda sql, *_args: sql):
            modules, weeks, components = reader._resolve_from_master(
                [], [], [], assigned_modules=assigned, compact=True, strict=True,
                plan_owned_only=True,
            )

        self.assertEqual(modules, ['Assigned module'])
        self.assertEqual([(row['moduleId'], row['weekId'], row['week']) for row in weeks],
                         [('M1', 'W-OLD', 'Saved week')])
        self.assertEqual(
            [(row['componentId'], row['moduleId'], row['weekId']) for row in components],
            [('C-OWNED', 'M1', 'W-OLD'), ('C-MOVED', 'M1', 'W-OLD')],
        )
        self.assertEqual(components[1]['ksbMappings'][0]['code'], 'K1')
        component_sql = next(call.args[0] for call in cursor.execute.call_args_list
                             if 'FROM curriculum.components WHERE' in call.args[0])
        self.assertIn('id = ANY(%s)', component_sql)
        self.assertNotIn('module_catalogue_id = ANY(%s)', component_sql)

    def test_unknown_component_is_not_replaced_with_another_activity(self):
        with self.assertRaises(ServiceError) as caught:
            self.project('MISSING')
        self.assertEqual(caught.exception.status, 404)

    def test_activity_read_returns_selected_reading_in_the_same_response(self):
        source = SimpleNamespace()
        model = SimpleNamespace(all_learners=SimpleNamespace(get=lambda **kwargs: source), DoesNotExist=LookupError)
        detail = {'id': '7', 'components': [{'componentId': 'R1', 'type': 'reading'}]}
        request = RequestFactory().get('/learner_api/learner-detail/commercial/7/',
                                       {'content': 'activity', 'component_id': 'R1'})
        with patch.dict(reader.SOURCE_MODELS, {'commercial': model}), \
             patch.object(reader, 'build_learner_detail', return_value=detail) as build, \
             patch.object(reader, '_reading_content', return_value={'componentId': 'R1', 'contentHtml': '<p>Reading</p>'}):
            response = reader.learner_detail.__wrapped__(request, 'commercial', 7)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '<p>Reading</p>')
        self.assertEqual(build.call_args.kwargs, {'compact': True, 'read_only': True, 'activity_component_id': 'R1'})

    def test_activity_read_reports_content_failure_for_both_learner_types(self):
        model = SimpleNamespace(all_learners=SimpleNamespace(get=lambda **kwargs: SimpleNamespace()),
                                DoesNotExist=LookupError)
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                request = RequestFactory().get(f'/learner_api/learner-detail/{kind}/7/',
                                               {'content': 'activity', 'component_id': 'R1'})
                with patch.dict(reader.SOURCE_MODELS, {kind: model}), \
                     patch.object(reader, 'build_learner_detail', side_effect=DatabaseError('Content read timed out')):
                    response = reader.learner_detail.__wrapped__(request, kind, 7)
                self.assertEqual(response.status_code, 502)
                self.assertContains(response, 'Could not load learner details', status_code=502)
                self.assertNotContains(response, 'Content read timed out', status_code=502)
