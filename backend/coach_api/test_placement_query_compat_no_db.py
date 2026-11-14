"""Coach API placement queries use LearnerProfile/EnrolmentUser columns, not name properties.

Database and network are prohibited. The real querysets are compiled to SQL
without connecting (the step that raised FieldDoesNotExist for 'programme',
'cohort' and 'group_name'). Where the same projection also names the removed
'coach_rag' column, the test pins that as the single remaining failure: that
field and its feature are deliberately out of scope (BLOCKED).
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.exceptions import FieldDoesNotExist
from django.db.models import Q
from django.db.models.functions import Lower, Trim
from django.db.models.query import QuerySet
from django.test import RequestFactory, SimpleTestCase

from learner_api.models import EnrolmentUser, LearnerProfile
from learner_api import learner_coach_columns
from . import case_file, views
from .caseload_placement import annotate_placement_labels, filter_options, placement_names

PROPERTY_NAMES = {'programme', 'cohort', 'group_name', 'group'}


def concrete(model):
    return {f.attname for f in model._meta.concrete_fields} | {f.name for f in model._meta.concrete_fields}


class RecordedOnly:
    """Record every .only() field list and compile instead of executing."""

    def __init__(self):
        self.calls, self.errors = [], []
        self._only = QuerySet.only

    def only(self, queryset, *fields):
        self.calls.append(fields)
        return self._only(queryset, *fields)

    def fetch_all(self, queryset):
        if queryset._result_cache is None:
            try:
                str(queryset.query)
            except FieldDoesNotExist as error:
                self.errors.append(str(error))
            queryset._result_cache = []
            queryset._prefetch_done = True


def run_recorded(call):
    recorder = RecordedOnly()
    with patch.object(QuerySet, 'only', autospec=True, side_effect=recorder.only), \
            patch.object(QuerySet, '_fetch_all', autospec=True, side_effect=recorder.fetch_all):
        result = call()
    return recorder, result


class CaseloadDashboardProjectionTests(SimpleTestCase):
    def test_placement_names_are_replaced_by_ids_and_only_coach_rag_remains_blocked(self):
        with patch.object(views, 'learner_ksbs_relation_exists', return_value=False):
            recorder, rows = run_recorded(lambda: views.fetch_caseload_dashboard_profiles('Coach@Example.test'))
        fields = set(recorder.calls[0])
        self.assertTrue({'programme_id', 'cohort_id', 'group_id'} <= fields)
        self.assertTrue(PROPERTY_NAMES.isdisjoint(fields))
        self.assertEqual(fields - concrete(LearnerProfile), {'coach_rag'})          # BLOCKED, out of scope
        self.assertEqual(recorder.errors, ["LearnerProfile has no field named 'coach_rag'"])
        self.assertEqual(rows, [])

    def test_the_projection_compiles_once_coach_rag_is_set_aside(self):
        with patch.object(views, 'learner_ksbs_relation_exists', return_value=False):
            recorder, _ = run_recorded(lambda: views.fetch_caseload_dashboard_profiles('coach@example.test'))
        fields = [name for name in recorder.calls[0] if name != 'coach_rag']
        with patch.object(learner_coach_columns, 'learner_coach_keyed', return_value=True):
            sql = str(LearnerProfile.objects.annotate(coach_email_key=Lower(Trim('coach_email')))
                      .filter(coach_email_key='coach@example.test').only(*fields).query)
        for column in ('"programme_id"', '"cohort_id"', '"group_id"'):
            self.assertIn(column, sql)
        self.assertIn('curriculum.coaches', sql)
        self.assertNotIn('learners.coach_email', sql)


class CaseFileShellProjectionTests(SimpleTestCase):
    def test_owner_scoped_shell_uses_ids_and_only_coach_rag_remains_blocked(self):
        recorder, result = run_recorded(lambda: views.fetch_case_file_shell('coach@example.test', 101))
        fields = set(recorder.calls[0])
        self.assertTrue({'programme_id', 'cohort_id', 'group_id'} <= fields)
        self.assertNotIn('coach_email', fields)  # derived query alias, never a physical column
        self.assertTrue(PROPERTY_NAMES.isdisjoint(fields))
        self.assertEqual(fields - concrete(LearnerProfile), {'coach_rag'})
        self.assertEqual(recorder.errors, ["LearnerProfile has no field named 'coach_rag'"])
        self.assertEqual(result, (None, None))                                       # unchanged not-found shape

    def test_shell_still_filters_by_learner_and_owning_coach(self):
        with patch.object(learner_coach_columns, 'learner_coach_keyed', return_value=True):
            query = (LearnerProfile.objects.annotate(coach_email_key=Lower(Trim('coach_email')))
                     .filter(id=101, coach_email_key='coach@example.test').only('id', 'programme_id').query)
            sql = str(query)
        self.assertIn('LOWER(TRIM((SELECT learner_coach.email FROM curriculum.coaches',
                      sql.replace('\n', ' '))
        self.assertNotIn('learners.coach_email', sql)


class CaseFileContextProjectionTests(SimpleTestCase):
    def context(self, path, profile_only, recorder_calls):
        request = RequestFactory().get(path)
        with patch.object(case_file, 'authenticated_coach_email', return_value='coach@example.test'):
            recorder, ctx = run_recorded(lambda: case_file.CaseFileContext(request, 101, profile_only=profile_only))
        recorder_calls.extend(recorder.calls)
        return ctx, recorder

    def test_profile_only_mode_uses_concrete_columns_and_compiles(self):
        calls = []
        ctx, recorder = self.context('/coach_api/coach/case-file/101/profile', True, calls)
        self.assertEqual(set(calls[0]), set(case_file.PROFILE_FIELDS))
        self.assertEqual([name for name in case_file.PROFILE_FIELDS if name not in concrete(LearnerProfile)], [])
        self.assertTrue({'programme_id', 'group_id'} <= set(case_file.PROFILE_FIELDS))
        self.assertEqual(recorder.errors, [])
        self.assertIsNone(ctx.profile)

    def test_full_mode_uses_ids_and_only_coach_rag_remains_blocked(self):
        calls = []
        _, recorder = self.context('/coach_api/coach/case-file/101/overview', False, calls)
        fields = set(calls[0])
        self.assertTrue({'programme_id', 'cohort_id', 'group_id'} <= fields)
        self.assertTrue(PROPERTY_NAMES.isdisjoint(fields))
        self.assertEqual(fields - concrete(LearnerProfile), {'coach_rag'})
        self.assertEqual(recorder.errors, ["LearnerProfile has no field named 'coach_rag'"])

    def source_fields(self, path, profile_only):
        ctx = object.__new__(case_file.CaseFileContext)
        ctx.request, ctx.profile_only = RequestFactory().get(path), profile_only
        ctx.profile = SimpleNamespace(enrolment_id=201)
        ctx._source_loaded, ctx._source = False, None
        recorder, _ = run_recorded(lambda: ctx.source)
        return set(recorder.calls[0]), recorder

    def test_every_source_projection_uses_concrete_enrolment_columns(self):
        for path, profile_only in (('/coach_api/coach/case-file/101/profile', True),
                                   ('/coach_api/coach/case-file/101/support', False),
                                   ('/coach_api/coach/case-file/101/weekly-learning', False),
                                   ('/coach_api/coach/case-file/101/learning-plan', False),
                                   ('/coach_api/coach/case-file/101/overview', False)):
            with self.subTest(path=path, profile_only=profile_only):
                fields, recorder = self.source_fields(path, profile_only)
                self.assertEqual(fields - concrete(EnrolmentUser), set())
                self.assertTrue(PROPERTY_NAMES.isdisjoint(fields))
                self.assertEqual(recorder.errors, [])

    def test_names_are_still_read_through_the_unchanged_properties(self):
        with patch('learner_api.models._learner_placement_names', return_value=('Programme', 'Cohort A', 'Group 1')):
            profile = LearnerProfile(id=101, programme_id='P1', cohort_id='C1', group_id='G1')
            source = EnrolmentUser(pk=201, programme_id='P1', cohort_id='C1', group_id='G1')
            self.assertEqual((profile.programme, profile.cohort, profile.group_name), ('Programme', 'Cohort A', 'Group 1'))
            self.assertEqual((source.programme, source.cohort, source.group), ('Programme', 'Cohort A', 'Group 1'))


NAMES = {'programme_id': {'P1': 'Level 3 Business'},
         'cohort_id': {'C2': 'October 2026', 'C1': 'april 2026', 'C3': 'May 2026'},
         'group_id': {'G1': 'Group One'}}


def caseload_queryset():
    return LearnerProfile.objects.annotate(coach_email_key=Lower(Trim('coach_email'))).filter(
        coach_email_key='coach@example.test').exclude(full_name__regex=r'^\s*$')


class CaseloadFilterQueryTests(SimpleTestCase):
    """The view's search, cohort/group filters and sorts compile against the annotations."""

    def compiled(self, search='', cohort='', group='', sort='name'):
        queryset = annotate_placement_labels(caseload_queryset(), NAMES)
        if search:
            queryset = queryset.filter(Q(full_name__icontains=search) | Q(email__icontains=search)
                                       | Q(programme_label__icontains=search) | Q(cohort_label__icontains=search)
                                       | Q(group_label__icontains=search))
        if cohort:
            queryset = queryset.filter(Q(cohort_id=cohort) | Q(cohort_label__iexact=cohort))
        if group:
            queryset = queryset.filter(Q(group_id=group) | Q(group_label__iexact=group))
        order = {'name': 'full_name', 'programme': 'programme_label', 'cohort': 'cohort_label', 'group': 'group_label'}[sort]
        return str(queryset.order_by(order, 'full_name', 'id').values_list('id', flat=True).query)

    def test_previous_name_filters_reproduce_the_reported_error(self):
        for lookup in ({'cohort__iexact': 'x'}, {'group_name__iexact': 'x'}, {'programme__icontains': 'x'}):
            with self.subTest(lookup=lookup), self.assertRaises(Exception):
                str(caseload_queryset().filter(**lookup).query)
        with self.assertRaises(Exception):
            str(caseload_queryset().exclude(cohort='').values_list('cohort_id', 'cohort').query)

    def test_search_filters_and_every_sort_compile_on_profile_placement_ids(self):
        for sort in ('name', 'programme', 'cohort', 'group'):
            with self.subTest(sort=sort):
                sql = self.compiled(search='oct', cohort='October 2026', group='G1', sort=sort)
                self.assertIn('"Learner"."learners"."cohort_id"', sql)
                self.assertIn('"Learner"."learners"."group_id"', sql)
                self.assertNotIn('"Created_users"', sql)                              # no enrolment substitution

    def test_cohort_filter_keeps_id_or_name_meaning(self):
        queryset = annotate_placement_labels(caseload_queryset(), NAMES).filter(
            Q(cohort_id='October 2026') | Q(cohort_label__iexact='October 2026'))
        sql, params = queryset.query.sql_with_params()
        self.assertIn('October 2026', params)
        self.assertIn('C2', params)                                                  # id -> name mapping is in the CASE
        self.assertIn('CASE WHEN', sql)

    def test_unknown_ids_read_as_empty_like_the_properties(self):
        queryset = annotate_placement_labels(caseload_queryset(), {'programme_id': {}, 'cohort_id': {}, 'group_id': {}})
        sql, params = queryset.order_by('cohort_label').values_list('id', flat=True).query.sql_with_params()
        self.assertEqual(sql.count('CASE WHEN'), 0)
        self.assertIn('', params)


class PlacementNameReadTests(SimpleTestCase):
    def read(self, id_rows, name_rows):
        queryset = MagicMock(db='default')
        queryset.order_by.return_value.values_list.return_value.distinct.return_value = id_rows
        cursor = MagicMock()
        cursor.fetchall.return_value = name_rows
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch('coach_api.caseload_placement.connections', {'default': connection}):
            names = placement_names(queryset)
        return names, cursor, queryset

    def test_one_read_only_lookup_through_the_profiles_own_ids(self):
        names, cursor, queryset = self.read(
            [('P1', 'C1', 'G1'), ('P1', 'C2', None), (None, None, None)],
            [('programme_id', 'P1', 'Level 3 Business'), ('cohort_id', 'C1', 'April 2026'),
             ('cohort_id', 'C2', '  '), ('group_id', 'G1', 'Group One')])
        queryset.order_by.return_value.values_list.assert_called_once_with('programme_id', 'cohort_id', 'group_id')
        self.assertEqual(cursor.execute.call_count, 1)
        sql, params = cursor.execute.call_args.args
        self.assertTrue(sql.startswith('SELECT'))
        for table in ('curriculum.programmes', 'curriculum.cohorts', 'curriculum.groups'):
            self.assertIn(table, sql)
        self.assertEqual(params, ['programme_id', ['P1'], 'cohort_id', ['C1', 'C2'], 'group_id', ['G1']])
        self.assertEqual(names, {'programme_id': {'P1': 'Level 3 Business'}, 'cohort_id': {'C1': 'April 2026'},
                                 'group_id': {'G1': 'Group One'}})                   # unnamed C2 omitted

    def test_no_placement_ids_issue_no_curriculum_query(self):
        names, cursor, _ = self.read([(None, '', None)], [])
        cursor.execute.assert_not_called()
        self.assertEqual(names, {'programme_id': {}, 'cohort_id': {}, 'group_id': {}})


class FilterOptionTests(SimpleTestCase):
    def test_options_keep_the_value_label_shape_sorted_by_label(self):
        self.assertEqual(filter_options(NAMES, 'cohort_id'), [
            {'value': 'C1', 'label': 'april 2026'},
            {'value': 'C3', 'label': 'May 2026'},
            {'value': 'C2', 'label': 'October 2026'},
        ])
        self.assertEqual(filter_options(NAMES, 'group_id'), [{'value': 'G1', 'label': 'Group One'}])

    def test_unnamed_placements_are_not_offered(self):
        self.assertEqual(filter_options({'cohort_id': {'C1': ''}}, 'cohort_id'), [])
