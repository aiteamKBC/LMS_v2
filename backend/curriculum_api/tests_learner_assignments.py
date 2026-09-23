import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError, connections
from django.test import RequestFactory, SimpleTestCase, TransactionTestCase

from . import learner_assignments as assignments
from learner_api.learning_plan import _effective_plan_ids, _serialize


def learner(plan=None, **overrides):
    return SimpleNamespace(**{
        'id': 1, 'pk': 1, 'username': 'Ahmed', 'email': 'ahmed@example.com',
        'programme': 'Original programme', 'cohort': 'Original cohort', 'group': 'Original group',
        'employer': 'Al Fanar', 'organization': '', 'programme_status': 'Active',
        'learner_type': 'commercial', 'learning_plan': plan, 'training_plan': None,
        'save': Mock(), **overrides,
    })


MODULE = {'id': 'MOD-1', 'name': 'Leadership', 'scope': 'module', 'programmeName': 'Business', 'programmeId': 'PROG-1', 'moduleIds': ['MOD-1']}
COHORT = {**MODULE, 'id': 'COHORT-1', 'name': 'September', 'scope': 'cohort', 'moduleIds': ['MOD-1', 'MOD-2'], 'groupNames': {'Group A'}}
CATALOGUE = {key: {'moduleId': key, 'moduleTitle': key, 'hours': 1, 'programmeId': 'PROG-1', 'programmeName': 'Business'} for key in ('MOD-1', 'MOD-2', 'OLD')}


class AssignmentTests(SimpleTestCase):
    def setUp(self):
        self.mirror = self.enterContext(patch.object(assignments.plans, 'sync_learning_plan_mirror'))
        self.enterContext(patch.object(assignments.plans, '_group_module_ids', return_value=[]))
        self.enterContext(patch.object(assignments, 'hydrate_training_plan', side_effect=lambda plan, **kw: [dict(m, weeks=[]) for m in plan]))
        self.profiles = self.enterContext(patch.object(assignments, 'LearnerProfile'))

    def test_module_assignment_preserves_placement_and_detailed_existing_plan(self):
        old = {'moduleId': 'OLD', 'weeks': [{'weekId': 'W1', 'components': [{'componentId': 'C1'}]}]}
        row = learner([old])
        self.assertTrue(assignments._assign(row, MODULE, CATALOGUE, {}))
        self.assertEqual([entry['moduleId'] for entry in row.learning_plan], ['OLD', 'MOD-1'])
        self.assertEqual(row.learning_plan[0]['weeks'], old['weeks'])
        self.assertEqual((row.programme, row.cohort, row.group, row.employer), ('Original programme', 'Original cohort', 'Original group', 'Al Fanar'))
        row.save.assert_called_once_with(update_fields=['learning_plan'])
        self.profiles.objects.filter.assert_not_called()
        self.mirror.assert_called_once_with(row, strict=True)

    def test_single_module_after_empty_plan_never_inherits_group_siblings(self):
        row = learner([])
        with patch.object(assignments.plans, '_group_module_ids', return_value=['MOD-2']):
            assignments._assign(row, MODULE, CATALOGUE, {})
            self.assertEqual(_effective_plan_ids(row, {}), ['MOD-1'])
            with patch.object(assignments.plans, '_programme_modules', return_value=list(CATALOGUE.values())), \
                    patch.object(assignments.plans, '_all_modules', return_value=list(CATALOGUE.values())), \
                    patch.object(assignments.plans, '_meetings', return_value=([], '')):
                data = _serialize(row)
            self.assertEqual([entry['moduleId'] for entry in data['plan']], ['MOD-1'])
            self.assertEqual(data['inheritedCount'], 0)

    def test_unsaved_learner_keeps_modules_they_already_inherit(self):
        row = learner()
        with patch.object(assignments.plans, '_group_module_ids', return_value=['OLD']):
            assignments._assign(row, MODULE, CATALOGUE, {})
        self.assertEqual([entry['moduleId'] for entry in row.learning_plan], ['OLD', 'MOD-1'])

    def test_commercial_plan_column_is_used_even_when_explicitly_empty(self):
        row = learner([{'moduleId': 'OLD'}], training_plan=[])
        assignments._assign(row, MODULE, CATALOGUE, {})
        self.assertEqual([entry['moduleId'] for entry in row.training_plan], ['MOD-1'])
        self.assertEqual(row.learning_plan, [{'moduleId': 'OLD'}])
        row.save.assert_called_once_with(update_fields=['training_plan'])

    def test_cohort_includes_every_target_module_and_preserves_other_modules(self):
        row = learner([{'moduleId': 'OLD'}])
        assignments._assign(row, COHORT, CATALOGUE, {})
        self.assertEqual([entry['moduleId'] for entry in row.learning_plan], ['OLD', 'MOD-1', 'MOD-2'])
        self.assertEqual((row.programme, row.cohort, row.group), ('Business', 'September', ''))
        self.profiles.objects.filter.return_value.update.assert_called_once_with(
            programme='Business', programme_id='PROG-1', cohort='September', cohort_id='COHORT-1', group_name='', group_id=None)

    def test_repeat_assignment_does_not_write_or_duplicate_modules(self):
        row = learner([{'moduleId': 'MOD-1', 'assignmentMode': 'explicit'}])
        self.assertFalse(assignments._assign(row, MODULE, CATALOGUE, {}))
        row.save.assert_not_called()

    def test_existing_cohort_member_missing_modules_can_be_assigned(self):
        row = learner([{'moduleId': 'MOD-1'}], programme='Business', cohort='September', group='Group A')
        self.assertFalse(assignments._payload(COHORT, [row])['learners'][0]['assigned'])
        assignments._assign(row, COHORT, CATALOGUE, {})
        self.assertEqual(row.group, 'Group A')
        self.assertTrue(assignments._payload(COHORT, [row])['learners'][0]['assigned'])

    def test_directory_includes_company_and_accurate_assignment_state(self):
        data = assignments._payload(MODULE, [learner([]), learner([{'moduleId': 'MOD-1'}], pk=2)])
        self.assertEqual(data['totals'], {'learnerCount': 2, 'assignedCount': 1})
        self.assertEqual(data['learners'][0]['company'], 'Al Fanar')

    def test_target_collects_modules_in_all_cohort_groups(self):
        from . import views
        cohort = {'cohort_id': 'COHORT-1', 'cohort_name': 'September', 'programme_name': 'Business'}
        def rows(table, *args):
            if table == views.GROUPS_TABLE:
                return [{'group_id': 'G1'}, {'group_id': 'G2'}]
            return [
                {'module_catalogue_id': 'MOD-1', 'cohort_id': 'COHORT-1'},
                {'module_catalogue_id': 'MOD-2', 'group_id': 'G2'},
                {'module_catalogue_id': 'OUTSIDE', 'cohort_id': 'COHORT-2'},
                {'module_catalogue_id': 'ARCHIVED', 'cohort_id': 'COHORT-1', 'deleted_at': '2026-01-01'},
            ]
        with patch.object(views, 'resolve_cohort_row', return_value=cohort), \
                patch.object(views, 'authoring_fetch_all', side_effect=rows), \
                patch.object(views, 'curriculum_row_effectively_deleted', side_effect=lambda row: bool(row.get('deleted_at'))):
            self.assertEqual(assignments._target('cohort', 'COHORT-1')['moduleIds'], ['MOD-1', 'MOD-2'])

    def test_module_target_prefers_stored_catalogue_identifier(self):
        from . import views
        row = {'module_catalogue_id': 'MOD-1', 'title': 'Leadership'}
        with patch.object(views, 'resolve_stored_module_catalogue_id', return_value='MOD-1') as resolve, \
                patch.object(views, 'authoring_fetch_all', return_value=[row]), \
                patch.object(views, 'curriculum_row_effectively_deleted', return_value=False):
            target = assignments._target('module', 'MOD-1')
        resolve.assert_called_once_with('MOD-1')
        self.assertEqual(target['moduleIds'], ['MOD-1'])


class AssignmentEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='admin')))
        self.enterContext(patch.object(assignments, '_target', return_value=MODULE))
        self.enterContext(patch.object(assignments.plans, '_all_modules', return_value=list(CATALOGUE.values())))
        self.atomic = self.enterContext(patch.object(assignments.transaction, 'atomic', side_effect=lambda **kw: nullcontext()))
        self.model = self.enterContext(patch.object(assignments, 'EnrolmentUser'))
        self.model.all_learners.db = 'enrolment'
        self.model.all_learners.select_for_update.return_value.filter.return_value.order_by.return_value = [learner([])]
        self.invalidate = self.enterContext(patch('curriculum_api.views.invalidate_curriculum_cache'))

    def post(self, data):
        return assignments.module_learner_assignments(self.factory.post('/', json.dumps(data), content_type='application/json'), 'MOD-1')

    def delete(self, data):
        request = self.factory.delete('/', json.dumps(data), content_type='application/json')
        return assignments.module_learner_assignments(request, 'MOD-1')

    def test_post_adds_only_selected_learners_with_row_locks(self):
        with patch.object(assignments, '_assign', return_value=True) as assign:
            response = self.post({'learnerIds': ['1', '1']})
        self.assertEqual(response.status_code, 200)
        assign.assert_called_once()
        self.atomic.assert_called_once_with(using='enrolment')
        self.model.all_learners.select_for_update.return_value.filter.assert_called_once_with(pk__in=[1])
        self.invalidate.assert_called_once()

    def test_delete_removes_only_selected_learners(self):
        with patch.object(assignments, '_unassign', return_value=True) as unassign:
            response = self.delete({'learnerIds': ['1']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(unassign.call_args.args), 3)
        self.assertEqual(unassign.call_args.args[1], MODULE)
        self.atomic.assert_called_once_with(using='enrolment')
        self.invalidate.assert_called_once()

    def test_malformed_or_empty_ids_do_not_write(self):
        with patch.object(assignments, '_assign') as assign:
            for ids in ([], [True], ['abc'], [0], [{}], ['²'], ['99999999999999999999'], '1'):
                with self.subTest(ids=ids):
                    self.assertEqual(self.post({'learnerIds': ids}).status_code, 400)
        assign.assert_not_called()

    def test_unknown_id_aborts_whole_selection_before_writing(self):
        with patch.object(assignments, '_assign') as assign:
            self.assertEqual(self.post({'learnerIds': ['1', '2']}).status_code, 400)
        assign.assert_not_called()

    def test_database_error_does_not_report_success(self):
        with patch.object(assignments, '_assign', side_effect=DatabaseError('failed')):
            self.assertEqual(self.post({'learnerIds': ['1']}).status_code, 503)
        self.invalidate.assert_not_called()

    def test_delete_removes_only_selected_learner(self):
        request = self.factory.delete('/', json.dumps({'learnerIds': ['1']}), content_type='application/json')
        # autospec: a bare Mock accepts any arity, which is how _unassign
        # shipped taking one fewer argument than _handle passes it.
        with patch.object(assignments, '_unassign', return_value=True, autospec=True) as unassign:
            response = assignments.module_learner_assignments(request, 'MOD-1')
        self.assertEqual(response.status_code, 200)
        unassign.assert_called_once()
        self.invalidate.assert_called_once()

    def test_learners_cannot_read_or_write_directory(self):
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner')):
            self.assertEqual(self.post({'learnerIds': ['1']}).status_code, 403)
            response = assignments.module_learner_assignments(self.factory.get('/'), 'MOD-1')
            self.assertEqual(response.status_code, 403)

    def test_retired_target_is_rejected(self):
        with patch.object(assignments, '_target', return_value=None):
            self.assertEqual(self.post({'learnerIds': ['1']}).status_code, 404)


class ModuleRosterTests(SimpleTestCase):
    def test_direct_assignment_is_visible_without_changing_other_scope_membership(self):
        profile = SimpleNamespace(
            pk=2, full_name='Direct learner', email='direct@example.com',
            programme='Other programme', programme_status='Active', cohort='Other cohort',
            cohort_id='COHORT-OTHER', group_name='Other group', group_id='GROUP-OTHER',
            lifecycle_status='active', coach_name='', coach_email='', progress_variance=None, otjh_status='',
            learning_plan=[{'moduleId': 'MOD-1', 'assignmentMode': 'explicit'}],
        )
        with patch.object(assignments, 'LearnerProfile') as model:
            model.objects.filter.return_value = [profile]
            roster = assignments.module_assignment_roster('MOD-1', [])
        self.assertEqual([row['id'] for row in roster], [2])
        self.assertEqual(roster[0]['programme'], 'Other programme')
        self.assertEqual(roster[0]['cohortId'], 'COHORT-OTHER')
        from .views import learner_authored_plan
        assigned_plan = learner_authored_plan(
            {'scopeOtjh': 12, 'scopeKsbWeights': {'K1': 2}}, roster[0], unmatched='none')
        self.assertEqual(assigned_plan, {'otjh': 12, 'ksbWeights': {'K1': 2}, 'basis': 'module'})

    def test_explicit_module_only_plan_is_excluded_from_sibling_roster(self):
        profile = SimpleNamespace(pk=1, learning_plan=[{'moduleId': 'MOD-1', 'assignmentMode': 'explicit'}])
        with patch.object(assignments, 'LearnerProfile') as model:
            model.objects.filter.return_value = [profile]
            self.assertEqual(assignments.module_assignment_roster('MOD-2', [{'id': 1, 'name': 'Same group'}]), [])


class AssignmentTransactionTests(TransactionTestCase):
    """Exercise a real transaction on isolated SQLite, never the configured server."""
    databases = {'default'}

    def setUp(self):
        self.assertEqual(connections['default'].vendor, 'sqlite')
        with connections['default'].cursor() as cursor:
            cursor.execute('CREATE TABLE assignment_atomic_probe (learner_id integer)')
        self.enterContext(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='admin')))
        self.enterContext(patch.object(assignments, '_target', return_value=MODULE))
        self.enterContext(patch.object(assignments.plans, '_all_modules', return_value=list(CATALOGUE.values())))
        self.enterContext(patch('curriculum_api.views.invalidate_curriculum_cache'))
        model = self.enterContext(patch.object(assignments, 'EnrolmentUser'))
        model.all_learners.db = 'default'
        model.all_learners.select_for_update.return_value.filter.return_value.order_by.return_value = [learner([]), learner([], pk=2)]

    def tearDown(self):
        with connections['default'].cursor() as cursor:
            cursor.execute('DROP TABLE assignment_atomic_probe')
        super().tearDown()

    def test_failure_on_second_learner_rolls_back_first_learner(self):
        def save(row, *_):
            if row.pk == 2:
                raise DatabaseError('Second learner failed')
            with connections['default'].cursor() as cursor:
                cursor.execute('INSERT INTO assignment_atomic_probe (learner_id) VALUES (%s)', [row.pk])
            return True
        request = RequestFactory().post('/', json.dumps({'learnerIds': ['1', '2']}), content_type='application/json')
        with patch.object(assignments, '_assign', side_effect=save):
            response = assignments.module_learner_assignments(request, 'MOD-1')
        self.assertEqual(response.status_code, 503)
        with connections['default'].cursor() as cursor:
            cursor.execute('SELECT COUNT(*) FROM assignment_atomic_probe')
            self.assertEqual(cursor.fetchone()[0], 0)
