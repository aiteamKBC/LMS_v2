import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch, Mock
from django.test import SimpleTestCase, RequestFactory, override_settings
from . import company_training as api

@override_settings(BREATHE_INTEGRATIONS_ENABLED=True)
class CompanyTrainingTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.actor = SimpleNamespace(role='employer', id=8, subject_id=340)
        self.enterContext(patch('integrations.permissions.authenticate_request', return_value=self.actor))
        self.enterContext(patch('integrations.permissions._employer_is_hr', return_value=True))
        self.connection = SimpleNamespace(id='connection')
        self.enterContext(patch.object(api, '_connection', return_value=self.connection))
        self.visible = self.enterContext(patch.object(api, '_in_actor_tenant', return_value=True))

    def request(self, **overrides):
        body = {'departmentId':'7','moduleIds':['demo-m1'],'confirmed':True, **overrides}
        return self.factory.post('/', json.dumps(body), content_type='application/json')

    def test_other_company_is_rejected_before_read_or_write(self):
        self.visible.return_value = False
        with patch.object(api.CompanyTrainingRule.objects, 'update_or_create') as write:
            self.assertEqual(api.save_rule(self.request(), 'id').status_code, 404)
            self.assertEqual(api.training(self.factory.get('/'), 'id').status_code, 404)
            write.assert_not_called()

    def test_manager_cannot_change_rules(self):
        with patch('integrations.permissions._employer_is_hr', return_value=False):
            self.assertEqual(api.save_rule(self.request(), 'id').status_code, 403)

    def test_requires_explicit_confirmation_valid_module_and_company_department(self):
        with patch.object(api.DepartmentMapping.objects, 'filter') as departments:
            departments.return_value.exists.return_value = False
            for body in ({'confirmed':False}, {'moduleIds':['unknown']}, {'departmentId':'other'}):
                self.assertEqual(api.save_rule(self.request(**body), 'id').status_code, 400)

    def test_hr_confirmation_saves_rule_and_applies_allocations(self):
        with patch.object(api.DepartmentMapping.objects, 'filter') as departments, patch.object(api.CompanyTrainingRule.objects, 'update_or_create') as save, patch.object(api, 'apply_rules') as apply, patch.object(api.transaction, 'atomic', return_value=nullcontext()):
            departments.return_value.exists.return_value = True
            self.assertEqual(api.save_rule(self.request(), 'id').status_code, 200)
            self.assertEqual(save.call_args.kwargs['connection_id'], 'connection')
            self.assertEqual(save.call_args.kwargs['defaults']['confirmed_by'],8)
            apply.assert_called_once_with(self.connection)

    def test_apply_is_idempotent_and_does_not_replace_existing_progress(self):
        rule = SimpleNamespace(department_id='7',module_ids=['demo-m1'])
        person = SimpleNamespace(id='person')
        with patch.object(api.CompanyTrainingRule.objects,'filter',return_value=[rule]), patch.object(api.ExternalPersonLink.objects,'filter',return_value=[person]) as people, patch.object(api.CompanyTrainingAllocation.objects,'get_or_create') as allocate:
            api.apply_rules(self.connection)
            people.assert_called_once_with(connection_id='connection',department_external_id='7')
            allocate.assert_called_once_with(person_link_id='person',module_id='demo-m1',defaults={'connection_id':'connection'})
