"""Learner My Learning: the source queryset uses concrete Created_users columns only.

Database and network are prohibited. The real EnrolmentUser queryset is compiled
to SQL without connecting (the step that raised FieldDoesNotExist for 'cohort'),
and the catalogue reader is mocked, so the view contract, access gate and source
shape are checked, not curriculum data.
"""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import FieldDoesNotExist
from django.db.models.query import QuerySet
from django.test import RequestFactory, SimpleTestCase

from . import canonical_learning as canonical
from . import my_learning as learning
from .models import EnrolmentUser
from .placement_links import placement_ids
from .test_orm_placement_fields_no_db import CompilingGet

PK = 285
CONCRETE = {f.attname for f in EnrolmentUser._meta.concrete_fields} | {
    f.name for f in EnrolmentUser._meta.concrete_fields}
OLD_FIELDS = ('id', 'aptem_id', 'email', 'programme', 'cohort', 'group', 'learning_plan', 'training_plan',
              'modules', 'weeks', 'components', 'learner_type', 'username')


def loaded_row(kind='commercial', **ids):
    """A row exactly as Django builds it from `.only(*SOURCE_FIELDS)`: unlisted columns deferred."""
    values = {'id': PK, 'aptem_id': None, 'email': 'l@example.test', 'programme_id': 'PROG-1',
              'cohort_id': 'COH-1', 'group_id': 'GRP-1', 'learning_plan': None,
              'training_plan': [{'moduleId': 'M1'}], 'modules': None, 'weeks': None, 'components': None,
              'learner_type': kind, 'username': 'Synthetic', **ids}
    wanted = {EnrolmentUser._meta.get_field(name).attname for name in learning.SOURCE_FIELDS}
    # from_db takes the loaded values in concrete-field order, as the SQL compiler emits them.
    names = [f.attname for f in EnrolmentUser._meta.concrete_fields if f.attname in wanted]
    return EnrolmentUser.from_db('enrolment', names, [values[name] for name in names])


class SourceFieldTests(SimpleTestCase):
    def test_every_source_field_is_a_concrete_column(self):
        self.assertEqual([name for name in learning.SOURCE_FIELDS if name not in CONCRETE], [])
        self.assertTrue({'programme_id', 'cohort_id', 'group_id'} <= set(learning.SOURCE_FIELDS))
        self.assertTrue({'programme', 'cohort', 'group'}.isdisjoint(learning.SOURCE_FIELDS))

    def test_structured_projection_does_not_load_wide_csv_plan_snapshots(self):
        kept = set(OLD_FIELDS) - {'programme', 'cohort', 'group', 'modules', 'weeks', 'components'}
        self.assertEqual(set(learning.SOURCE_FIELDS), kept | {'programme_id', 'cohort_id', 'group_id'})
        self.assertTrue({'modules', 'weeks', 'components'}.isdisjoint(learning.SOURCE_FIELDS))

    def test_the_real_queryset_compiles(self):
        sql = str(EnrolmentUser.all_learners.only(*learning.SOURCE_FIELDS).filter(pk=PK).query)
        for column in ('"programme_id"', '"cohort_id"', '"group_id"', '"Training_plan"', '"Learner_type"'):
            self.assertIn(column, sql)

    def test_the_previous_tuple_reproduces_the_reported_error(self):
        with self.assertRaises(FieldDoesNotExist):
            str(EnrolmentUser.all_learners.only(*OLD_FIELDS).filter(pk=PK).query)
        for name in ('programme', 'cohort', 'group'):
            with self.subTest(name=name), \
                    self.assertRaisesMessage(FieldDoesNotExist, f"EnrolmentUser has no field named '{name}'"):
                str(EnrolmentUser.all_learners.only(name).query)

    def test_shared_consumers_compile_the_same_projection(self):
        # progress_transfer.source_owner and curriculum learner_directory_details.progress
        # import SOURCE_FIELDS; both querysets must compile with the corrected tuple.
        str(EnrolmentUser.all_learners.only(*learning.SOURCE_FIELDS).filter(pk=PK).query)
        str(EnrolmentUser.all_learners.only(*learning.SOURCE_FIELDS).filter(pk__in=[PK, PK + 1]).query)

    def test_legacy_plan_columns_are_hydrated_in_one_fallback_query(self):
        source = loaded_row()
        source.training_plan = None
        source.learning_plan = None
        queryset = EnrolmentUser.all_learners
        with patch.object(queryset, 'filter') as filtered:
            filtered.return_value.values.return_value.get.return_value = {
                'modules':'M1', 'weeks':'Week 1', 'components':'Lesson 1',
            }
            learning.hydrate_legacy_plan_fields(source, SimpleNamespace(all_learners=queryset))
        filtered.return_value.values.assert_called_once_with('modules', 'weeks', 'components')
        self.assertEqual((source.modules, source.weeks, source.components),
                         ('M1', 'Week 1', 'Lesson 1'))


class MyLearningViewTests(SimpleTestCase):
    payload = {'modules': [], 'summary': {}}

    def call(self, kind, account, resource=None, query=''):
        get = CompilingGet(row=loaded_row(kind))
        request = RequestFactory().get(f'/learner_api/my-learning/{kind}/{PK}/{query}')
        with patch('login.permissions.authenticate_request', return_value=account), \
                patch('login.permissions._auth_gate_enabled', return_value=True), \
                patch('login.permissions.session_unreadable', return_value=False), \
                patch.object(QuerySet, 'get', autospec=True, side_effect=get), \
                patch.object(canonical, 'require_profile', return_value={'id': 9}) as owner, \
                patch.object(learning, 'read_catalogue', return_value=dict(self.payload)) as read, \
                patch.object(learning, 'read_search', return_value={'matches': [], 'nextOffset': None}) as search:
            response = learning.my_learning(request, kind=kind, pk=PK, resource=resource)
        return response, get, owner, read, search

    def test_learner_and_staff_get_the_unchanged_contract_for_both_kinds(self):
        learner = SimpleNamespace(role='learner', subject_id=PK, subject_type='learner', is_active=True)
        staff = SimpleNamespace(role='staff', subject_id=9, subject_type='staff', is_active=True)
        for kind in ('commercial', 'apprenticeship'):
            for account in (learner, staff):
                with self.subTest(kind=kind, role=account.role):
                    response, get, owner, read, _ = self.call(kind, account)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content), self.payload)
                    self.assertEqual(response['Cache-Control'], 'private, no-store')
                    self.assertEqual(get.loaded_fields(), set(learning.SOURCE_FIELDS))
                    owner.assert_called_once_with(PK)
                    source = read.call_args.args[0]
                    self.assertEqual((source.pk, source.programme_id, source.group_id), (PK, 'PROG-1', 'GRP-1'))
                    self.assertEqual(read.call_args.args[1], kind)

    def test_upcoming_and_search_use_the_same_source(self):
        learner = SimpleNamespace(role='learner', subject_id=PK, subject_type='learner', is_active=True)
        response, get, _, read, _ = self.call('commercial', learner, resource='upcoming')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(read.call_args.kwargs, {'upcoming_only': True})
        response, get, _, _, search = self.call('commercial', learner, resource='search', query='?q=lesson')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get.loaded_fields(), set(learning.SOURCE_FIELDS))
        search.assert_called_once()

    def test_other_learners_are_still_refused_before_the_read(self):
        other = SimpleNamespace(role='learner', subject_id=PK + 1, subject_type='learner', is_active=True)
        response, get, owner, read, _ = self.call('commercial', other)
        self.assertEqual(response.status_code, 404)
        read.assert_not_called()
        owner.assert_not_called()
        self.assertEqual(get.querysets, [])


class PlacementTests(SimpleTestCase):
    """Loaded ids feed placement resolution; displayed names still come from the properties."""

    def test_placement_ids_are_loaded_not_deferred(self):
        row = loaded_row()
        self.assertTrue({'programme_id', 'cohort_id', 'group_id'}.isdisjoint(row.get_deferred_fields()))

    def test_valid_ids_resolve_without_a_profile_lookup(self):
        with patch('learner_api.placement_links.LearnerProfile.objects') as profiles:
            self.assertEqual(placement_ids(loaded_row()),
                             {'programme_id': 'PROG-1', 'cohort_id': 'COH-1', 'group_id': 'GRP-1'})
        profiles.using.assert_not_called()

    def test_null_ids_use_only_an_agreeing_linked_profile(self):
        for rows, expected in (([('PROG-1', 'COH-2', 'GRP-2')], ('COH-2', 'GRP-2')), ([], ('', ''))):
            with self.subTest(rows=rows), patch('learner_api.placement_links.LearnerProfile.objects') as profiles:
                profiles.using.return_value.filter.return_value.values_list.return_value.__getitem__.return_value = rows
                ids = placement_ids(loaded_row(cohort_id=None, group_id=None))
            self.assertEqual((ids['cohort_id'], ids['group_id']), expected)

    def test_response_cohort_and_group_names_still_come_from_the_properties(self):
        with patch('learner_api.models._learner_placement_names', return_value=('Programme', 'Cohort A', 'Group 1')):
            row = loaded_row()
            self.assertEqual((row.programme, row.cohort, row.group), ('Programme', 'Cohort A', 'Group 1'))
