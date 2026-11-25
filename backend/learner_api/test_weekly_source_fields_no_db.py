"""Learner Dashboard Weekly Learning: the source queryset uses concrete columns only.

Database and network are prohibited. The real EnrolmentUser queryset, with the
real assignment_projection annotations, is compiled to SQL without connecting
(the step that raised FieldDoesNotExist). The weekly reader is mocked, so the
view contract and source shape are checked, not curriculum data.
"""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import FieldDoesNotExist
from django.db.models.query import QuerySet
from django.test import RequestFactory, SimpleTestCase

from . import dashboard_weekly as weekly
from .models import EnrolmentUser, LearnerProfile
from .identity_placement.public import CACHE, placement_ids
from .identity_placement.tests.parity.test_orm_placement_fields_no_db import CompilingGet

PK = 101
CONCRETE = {f.attname for f in EnrolmentUser._meta.concrete_fields} | {
    f.name for f in EnrolmentUser._meta.concrete_fields}


def source_row(kind, **ids):
    row = EnrolmentUser(pk=PK, learner_type=kind, aptem_id=None, username='Synthetic', email='l@example.test',
                        programme_id=ids.get('programme_id', 'PROG-1'), cohort_id=ids.get('cohort_id', 'COH-1'),
                        group_id=ids.get('group_id', 'GRP-1'))
    return row


class SourceFieldTests(SimpleTestCase):
    def test_every_weekly_source_field_is_a_concrete_column(self):
        self.assertEqual([name for name in weekly.WEEKLY_SOURCE_FIELDS if name not in CONCRETE], [])
        self.assertTrue({'programme_id', 'cohort_id', 'group_id'} <= set(weekly.WEEKLY_SOURCE_FIELDS))
        self.assertTrue({'programme', 'cohort', 'group'}.isdisjoint(weekly.WEEKLY_SOURCE_FIELDS))

    def test_the_real_canonical_source_queryset_compiles_without_plan_json(self):
        sql = str(EnrolmentUser.all_learners.only(*weekly.WEEKLY_SOURCE_FIELDS)
                  .filter(pk=PK).query)
        for column in ('"programme_id"', '"cohort_id"', '"group_id"'):
            self.assertIn(column, sql)
        self.assertNotIn('Learning_plan', sql)
        self.assertNotIn('Training_plan', sql)

    def test_the_previous_tuple_reproduces_the_reported_error(self):
        old = ('id', 'aptem_id', 'learner_type', 'username', 'email', 'programme', 'cohort', 'group')
        with self.assertRaises(FieldDoesNotExist):
            str(EnrolmentUser.all_learners.only(*old).filter(pk=PK).query)


class WeeklyViewTests(SimpleTestCase):
    payload = {'schedule': {'weeks': []}, 'selectedWeek': None}

    def call(self, kind, account, row=None):
        get = CompilingGet(row=row or source_row(kind))
        request = RequestFactory().get(f'/learner_api/dashboard/{kind}/{PK}/weekly/plan/')
        request.login_account = account
        with patch('login.permissions.authenticate_request', return_value=account), \
                patch('login.permissions._auth_gate_enabled', return_value=True), \
                patch('login.permissions.session_unreadable', return_value=False), \
                patch.object(QuerySet, 'get', autospec=True, side_effect=get), \
                patch.object(weekly, 'read_dashboard_weekly', return_value=dict(self.payload)) as read:
            response = weekly.dashboard_weekly(request, kind=kind, pk=PK)
        return response, read, get

    def test_learner_and_staff_get_the_unchanged_contract_for_both_kinds(self):
        learner = SimpleNamespace(role='learner', subject_id=PK, subject_type='learner', is_active=True)
        staff = SimpleNamespace(role='staff', subject_id=9, subject_type='staff', is_active=True)
        for kind in ('commercial', 'apprenticeship'):
            for account in (learner, staff):
                with self.subTest(kind=kind, role=account.role):
                    response, read, get = self.call(kind, account)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content), self.payload)
                    self.assertEqual(get.loaded_fields(), set(weekly.WEEKLY_SOURCE_FIELDS))
                    source = read.call_args.args[0]
                    self.assertNotIn('training_plan', get.loaded_fields())
                    self.assertNotIn('learning_plan', get.loaded_fields())
                    self.assertEqual(read.call_args.args[1], PK)

    def test_other_learners_are_still_refused_before_the_read(self):
        other = SimpleNamespace(role='learner', subject_id=PK + 1, subject_type='learner', is_active=True)
        response, read, get = self.call('commercial', other)
        self.assertEqual(response.status_code, 404)
        read.assert_not_called()
        self.assertEqual(get.querysets, [])


class PlacementTests(SimpleTestCase):
    """The loaded ids feed placement resolution; names still come from the properties."""

    def test_cached_profile_ids_resolve_without_another_lookup(self):
        row = source_row('commercial')
        row.__dict__[CACHE] = SimpleNamespace(
            programme_id='PROG-1', cohort_id='COH-1', group_id='GRP-1'
        )
        with patch('learner_api.models.LearnerProfile.objects') as profiles:
            self.assertEqual(placement_ids(row),
                             {'programme_id': 'PROG-1', 'cohort_id': 'COH-1', 'group_id': 'GRP-1'})
        profiles.using.assert_not_called()

    def test_null_and_missing_ids_use_only_an_agreeing_linked_profile(self):
        for rows, expected in (([('PROG-1', 'COH-2', 'GRP-2')], ('COH-2', 'GRP-2')), ([], ('', ''))):
            with self.subTest(rows=rows), patch('learner_api.models.LearnerProfile.objects') as profiles:
                query = profiles.using.return_value.select_related.return_value.only.return_value
                if rows:
                    query.get.return_value = SimpleNamespace(
                        programme_id=rows[0][0], cohort_id=rows[0][1], group_id=rows[0][2]
                    )
                else:
                    query.get.side_effect = LearnerProfile.DoesNotExist
                ids = placement_ids(source_row('apprenticeship', cohort_id=None, group_id=None))
            self.assertEqual((ids['cohort_id'], ids['group_id']), expected)

    def test_programme_name_for_the_assignment_template_still_comes_from_the_property(self):
        with patch('learner_api.models._learner_placement_names', return_value=('Programme', None, None)):
            row = source_row('commercial')
            self.assertEqual(row.programme, 'Programme')
            self.assertIsNone(row.group)
