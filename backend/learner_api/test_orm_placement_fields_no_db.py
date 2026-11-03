"""Stale ORM field names after programme/cohort/group became placement properties.

Database and network are prohibited. Each real queryset is compiled to SQL
(``str(queryset.query)`` builds SQL without connecting); that compile step is
where ``FieldDoesNotExist`` was raised. Rows are synthetic.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.exceptions import FieldDoesNotExist
from django.db import DatabaseError
from django.db.models.query import QuerySet
from django.test import SimpleTestCase

from . import module_progress, programme_access, student_activity
from .models import EnrolmentUser
from .placement_links import placement_ids

LEARNER_ID = 101


class CompilingGet:
    """Stands in for QuerySet.get: compiles the real query, returns a synthetic row."""

    def __init__(self, row=None, error=None):
        self.row, self.error, self.querysets = row, error, []

    def __call__(self, queryset, *args, **kwargs):
        str(queryset.filter(*args, **kwargs).query)        # raises FieldDoesNotExist for a stale name
        self.querysets.append(queryset)
        if self.error is not None:
            raise self.error
        return self.row

    def loaded_fields(self):
        names, deferred = self.querysets[-1].query.deferred_loading
        assert deferred is False
        return set(names)


def learner(kind='commercial', **ids):
    return EnrolmentUser(pk=LEARNER_ID, learner_type=kind, programme_id=ids.get('programme_id', 'PROG-1'),
                         cohort_id=ids.get('cohort_id', 'COH-1'), group_id=ids.get('group_id', 'GRP-1'),
                         learning_plan=None, training_plan=[{'moduleId': 'M1'}])


class StaleNameCharacterisationTests(SimpleTestCase):
    def test_the_removed_names_are_properties_not_columns(self):
        for name in ('programme', 'cohort', 'group'):
            with self.subTest(name=name), self.assertRaises(FieldDoesNotExist):
                str(EnrolmentUser.all_learners.only(name).query)


class EffectiveCurrentSubjectsTests(SimpleTestCase):
    def read(self, kind='commercial', plan_ids=('M1',)):
        get = CompilingGet(row=learner(kind))
        cursor = MagicMock()
        cursor.fetchall.return_value = [('M1', 'Module One')]
        with patch.object(QuerySet, 'get', autospec=True, side_effect=get), \
                patch.object(student_activity, '_effective_plan_ids', return_value=list(plan_ids)) as plan:
            result = student_activity._effective_current_subjects(cursor, LEARNER_ID)
        return result, get, cursor, plan

    def test_selects_only_concrete_columns_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                _, get, cursor, plan = self.read(kind)
                self.assertEqual(get.loaded_fields(),
                                 {'programme_id', 'group_id', 'learning_plan', 'training_plan'})
                self.assertEqual(plan.call_args.args[0].learner_type, kind)
                # Read-only: the only statement is the module-title SELECT.
                self.assertTrue(all(call.args[0].strip().startswith('SELECT')
                                    for call in cursor.execute.call_args_list))

    def test_empty_effective_plan_still_returns_empty_without_querying_modules(self):
        result, _, cursor, _ = self.read(plan_ids=())
        self.assertEqual(result, [])
        cursor.execute.assert_not_called()


class StartRefusalTests(SimpleTestCase):
    account = SimpleNamespace(subject_id=LEARNER_ID, role='learner')

    def refuse(self, *, error=None, blocked=False):
        get = CompilingGet(row=learner(), error=error)
        with patch.object(QuerySet, 'get', autospec=True, side_effect=get), \
                patch.object(programme_access, 'learning_access',
                             return_value={'blocked': blocked, 'startDate': '2026-12-01'}) as access:
            response = programme_access._start_refusal(self.account)
        return response, get, access

    def test_selects_only_concrete_columns_and_allows_a_started_learner(self):
        response, get, access = self.refuse()
        self.assertIsNone(response)
        self.assertEqual(get.loaded_fields(), {'programme_id', 'cohort_id', 'start_date'})
        self.assertEqual(access.call_args.args[0].pk, LEARNER_ID)

    def test_not_started_learner_is_still_refused(self):
        response, _, _ = self.refuse(blocked=True)
        self.assertEqual(response.status_code, 403)

    def test_existing_missing_and_database_error_responses_are_unchanged(self):
        missing, _, _ = self.refuse(error=EnrolmentUser.DoesNotExist())
        self.assertEqual(missing.status_code, 404)
        unavailable, _, _ = self.refuse(error=DatabaseError('down'))
        self.assertEqual(unavailable.status_code, 503)
        self.assertNotIn(b'down', unavailable.content)


class PlacementResolutionTests(SimpleTestCase):
    """The loaded id columns feed placement_ids exactly as before; names stay properties."""

    def test_loaded_ids_are_used_without_a_profile_lookup(self):
        with patch('learner_api.placement_links.LearnerProfile.objects') as profiles:
            ids = placement_ids(learner())
        self.assertEqual(ids, {'programme_id': 'PROG-1', 'cohort_id': 'COH-1', 'group_id': 'GRP-1'})
        profiles.using.assert_not_called()

    def test_null_ids_fall_back_only_to_an_agreeing_linked_profile(self):
        source = learner(cohort_id=None, group_id=None)
        with patch('learner_api.placement_links.LearnerProfile.objects') as profiles:
            profiles.using.return_value.filter.return_value.values_list.return_value.__getitem__.return_value = [
                ('PROG-1', 'COH-9', 'GRP-9')]
            ids = placement_ids(source)
        self.assertEqual(ids, {'programme_id': 'PROG-1', 'cohort_id': 'COH-9', 'group_id': 'GRP-9'})
        profiles.using.return_value.filter.assert_called_once_with(enrolment_id=LEARNER_ID)

    def test_missing_or_conflicting_placements_stay_blank(self):
        for rows in ([], [('PROG-1', 'COH-1', 'GRP-1'), ('PROG-1', 'COH-2', 'GRP-2')]):
            with self.subTest(rows=rows), patch('learner_api.placement_links.LearnerProfile.objects') as profiles:
                profiles.using.return_value.filter.return_value.values_list.return_value.__getitem__.return_value = rows
                ids = placement_ids(learner(cohort_id=None, group_id=None))
            self.assertEqual((ids['cohort_id'], ids['group_id']), ('', ''))

    def test_programme_and_group_names_still_resolve_through_the_property(self):
        with patch('learner_api.models._learner_placement_names', return_value=('Programme', 'Cohort', 'Group')) as names:
            source = learner()
            self.assertEqual((source.programme, source.cohort, source.group), ('Programme', 'Cohort', 'Group'))
        names.assert_called_once_with(source, by_enrolment=True)           # cached per instance

    def test_null_placement_names_are_returned_as_none(self):
        with patch('learner_api.models._learner_placement_names', return_value=(None, None, None)):
            source = learner()
            self.assertEqual((source.programme, source.group), (None, None))


class ModuleProgressReachesCompletionTests(SimpleTestCase):
    """read_native_progress gets past _effective_current_subjects (the Home 500)."""

    def test_native_progress_completes_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                source = learner(kind)
                profile = MagicMock()
                profile.progress_entries.using.return_value.filter.return_value.exclude.return_value.values.return_value = []
                cursor = MagicMock()
                cursor.fetchall.return_value = [('M1', 'Module One')]
                connection = MagicMock()
                connection.cursor.return_value.__enter__.return_value = cursor
                get = CompilingGet(row=source)
                with patch.object(QuerySet, 'get', autospec=True, side_effect=get), \
                        patch('learner_api.learning_plan.effective_training_plan', return_value=[{'moduleId': 'M1'}]), \
                        patch('learner_api.mappers.get_training_plan', return_value=[]), \
                        patch('learner_api.mappers.flatten_training_plan', return_value=([], [], [])), \
                        patch('learner_api.learner_detail._resolve_from_master', return_value=([], [], [])), \
                        patch('learner_api.learner_detail._apply_programme_assignment_template', side_effect=lambda c, p: c), \
                        patch('learner_api.learner_detail._append_week_quizzes', return_value=([], [])), \
                        patch('learner_api.teams_attendance.annotate_attendance_completion', side_effect=lambda c, p: c), \
                        patch('learner_api.retained_quiz_progress.retain_quiz_progress'), \
                        patch.object(student_activity, '_effective_plan_ids', return_value=['M1']), \
                        patch.object(student_activity, '_builder_subject_metadata', return_value=(None, {})), \
                        patch('learner_api.models._learner_placement_names',
                              return_value=('Programme', 'Cohort', 'Group')), \
                        patch('django.db.connections', {'enrolment': connection}):
                    detail, current, progress, titles = module_progress.read_native_progress(source, profile)
                # Reached past _effective_current_subjects: the current module came back.
                self.assertEqual(len(current), 1)
                self.assertEqual(get.loaded_fields(), {'programme_id', 'group_id', 'learning_plan', 'training_plan'})
                self.assertEqual(progress, [])
