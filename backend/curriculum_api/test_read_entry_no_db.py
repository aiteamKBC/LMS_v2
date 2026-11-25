"""Real Django/entry bindings, executed only in the isolated test image."""
import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.api import overview
from curriculum_api.directory.application import assignment_counts
from curriculum_api.reporting.api import achievement_reads, coverage_reads
from curriculum_api.reporting.api import achievement_composition, coverage_composition


class ReadEntryBindings(SimpleTestCase):
    def test_overview_invokes_extracted_adapter_and_preserves_method_guard(self):
        request = RequestFactory().get('/curriculum/overview/')
        with patch.object(overview, 'curriculum_overview', return_value='extracted') as read:
            self.assertEqual(views.curriculum_overview(request), 'extracted')
            self.assertIs(read.call_args.kwargs['build_curriculum_overview'], views.build_curriculum_overview)
        with patch.object(overview, 'curriculum_overview') as read:
            self.assertEqual(views.curriculum_overview(RequestFactory().post('/')).status_code, 405)
            read.assert_not_called()

    def test_assignment_readers_are_lazy_and_preserve_identity_modes(self):
        with patch.object(assignment_counts, 'attach_module_assignment_counts', wraps=assignment_counts.attach_module_assignment_counts) as app, \
             patch('curriculum_api.learner_assignment_counts_sql.bulk_assigned_learner_counts_sql', return_value={'M':7}) as legacy, \
             patch('curriculum_api.directory.infrastructure.membership_runtime.status_counts', return_value={'M':{'total':3}}) as profiles:
            module={'id':'M'}
            self.assertIsNone(views.attach_module_assignment_counts([module]))
            self.assertEqual(module['assignments'],7); profiles.assert_not_called()
            views.attach_module_assignment_counts([module], learner_profiles=True)
            self.assertEqual(module['assignments'],3)
            legacy.assert_called_once_with({'M'}); profiles.assert_called_once_with('module',['M'])
            self.assertEqual(app.call_count,2)

    def test_achievement_adapter_preserves_projection_and_order(self):
        request=RequestFactory().get('/',{'page':'2','page_size':'2'})
        with patch.object(achievement_composition,'_achievement_projection',return_value=({'consumptions':[1,2,3],'items':[]},None)), \
             patch.object(achievement_reads,'curriculum_programme_ksb_achievement',wraps=achievement_reads.curriculum_programme_ksb_achievement) as read:
            response=views.curriculum_programme_ksb_achievement(request,'P')
        self.assertEqual(json.loads(response.content)['consumptionLog']['items'],[3])
        read.assert_called_once()

    def test_readiness_uses_domain_weights_without_inventing_percentage_target(self):
        request=RequestFactory().get('/')
        from django.http import JsonResponse
        with patch.object(coverage_composition,'coverage_response',return_value=JsonResponse({'items':[{'code':'K1','raw_total_weight':0.2}]})), \
             patch.object(coverage_reads,'curriculum_readiness_validation',wraps=coverage_reads.curriculum_readiness_validation) as read:
            response=views.curriculum_readiness_validation(request)
        self.assertEqual(json.loads(response.content),{'ready':True,'canSaveDraft':True,'issues':[],'summary':None})
        read.assert_called_once()
