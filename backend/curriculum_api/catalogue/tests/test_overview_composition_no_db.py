"""Actual imports and read composition under isolated synthetic Django settings."""
from contextlib import nullcontext
import importlib
from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api import learner_status_counts, read_model, video_uploads, views
from curriculum_api.catalogue.infrastructure import home_read_model, video_paths, content_validation_runtime
from curriculum_api.directory.infrastructure import membership_runtime
from curriculum_api.directory.domain import membership_values


class OverviewCompositionRuntimeTests(SimpleTestCase):
    def test_legacy_exports_are_the_same_objects_as_concrete_owners(self):
        for legacy, owner, names in (
            (learner_status_counts, membership_runtime, ('learner_facts', 'placement_lineages', 'members_for_lineages',
                'counts_for_lineages', 'status_counts', 'module_member_enrolment_ids', 'module_member_enrolment_ids_by_module')),
            (learner_status_counts, membership_values, ('status_key', 'plan_membership')),
            (read_model, home_read_model, ('get_curriculum_home', 'enqueue_curriculum_home_refresh', 'enqueue_all_curriculum_home_refreshes')),
            (video_uploads, video_paths, ('stored_video_path',)),
            (views, content_validation_runtime, ('validate_component_authoring_payload', 'validate_module_authoring_payload', 'component_context_for_payload')),
        ):
            for name in names:
                self.assertIs(getattr(legacy, name), getattr(owner, name), name)

    def test_membership_call_uses_concrete_read_ports_and_preserves_bridges(self):
        from learner_api.learning_plans.application import module_membership
        target = dict(found=True, programmeId='P', cohortId='C', groupId='G', moduleCatalogueId='M', learnerRosterMode='inherited')
        rows = [dict(id=1, enrolment_id=101, programme_id='P', cohort_id='C', group_id='G', explicit=False, module_ids=[]),
                dict(id=2, enrolment_id=0, programme_id='P', cohort_id='C', group_id='G', explicit=False, module_ids=[])]
        with patch.object(membership_runtime, 'curriculum_read_scope', return_value=nullcontext()) as scope, \
             patch.object(membership_runtime, 'placement_lineages', return_value={'M': target}) as lineages, \
             patch.object(membership_runtime, 'learner_facts', return_value=rows) as facts, \
             patch.object(membership_runtime, 'scope_programme_identifier', return_value='P'), \
             patch.object(membership_runtime, 'programme_identity_candidates', return_value=['P']), \
             patch.object(module_membership, 'module_member_enrolment_ids', wraps=module_membership.module_member_enrolment_ids) as application:
            self.assertEqual(learner_status_counts.module_member_enrolment_ids('M'), {'101'})
        application.assert_called_once()
        scope.assert_called_once_with(targeted_child_reads=True)
        lineages.assert_called_once_with('module', ['M'])
        facts.assert_called_once_with({'M'})

    def test_read_facts_uses_existing_connection_and_schema_capabilities(self):
        from learner_api.learning_plans.infrastructure import membership_facts
        with patch.object(membership_facts, 'learner_facts', return_value=[]) as read:
            self.assertEqual(learner_status_counts.learner_facts({'M'}, [2]), [])
        read.assert_called_once_with({'M'}, [2], connection=membership_runtime.connection,
            table_exists=membership_runtime.learner_schema_table_exists, columns_for=membership_runtime.learner_schema_columns)

    def test_home_events_keep_both_visibilities_and_default_alias(self):
        with patch.object(home_read_model, 'enqueue_read_model_event', side_effect=[True, False]) as enqueue:
            self.assertTrue(read_model.enqueue_all_curriculum_home_refreshes(reason='synthetic'))
        self.assertEqual([call.kwargs['scope_id'] for call in enqueue.call_args_list], ['operational', 'all'])
        self.assertEqual([call.kwargs['using'] for call in enqueue.call_args_list], ['default', 'default'])

    def test_validation_uses_existing_application_implementation(self):
        application = importlib.import_module('curriculum_api.catalogue.application.content_validation')
        with patch.object(application, 'validate_component_authoring_payload', return_value=['synthetic']) as validate:
            self.assertEqual(views.validate_component_authoring_payload({'id': 'C'}, 'weeks.0'), ['synthetic'])
        self.assertEqual(validate.call_args.args, ({'id': 'C'}, 'weeks.0'))
        reader = validate.call_args.kwargs['stored_video_path']
        with patch.object(video_paths, 'stored_video_path', return_value='valid') as path:
            self.assertEqual(reader('synthetic'), 'valid')
        path.assert_called_once_with('synthetic')
