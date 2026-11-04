"""Remaining placement readers use real columns or canonical placement lookups.

Database and network are prohibited. ORM querysets are compiled to SQL without
connecting (the step that raised FieldDoesNotExist for the programme/cohort/
group name properties). Raw SQL is captured through a fake cursor. Names keep
coming from the profile's own placement ids; enrolment placement is never
substituted, and the coach_rag projections are not touched here.
"""
import ast
import re
import json
import pathlib
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.exceptions import EmptyResultSet, FieldDoesNotExist
from django.test import RequestFactory, SimpleTestCase

from learner_api.models import EnrolmentUser, LearnerProfile
from . import support_tickets, views
from .caseload_placement import placement_ids_named
from .test_placement_query_compat_no_db import concrete, run_recorded

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PROFILE_NAMES = {'programme', 'cohort', 'group_name'}
SOURCE_NAMES = {'programme', 'cohort', 'group'}


def fake_connection(rows=(), description=None):
    cursor = MagicMock()
    cursor.fetchall.return_value = list(rows)
    cursor.description = description
    connection = MagicMock(vendor='postgresql')
    connection.cursor.return_value.__enter__.return_value = cursor
    return connection, cursor


class CoachProfileProjectionTests(SimpleTestCase):
    """Each fixed LearnerProfile projection compiles and loads the placement ids."""

    def assert_projection(self, call, ids=('programme_id', 'cohort_id', 'group_id')):
        recorder, _ = run_recorded(call)
        fields = set(recorder.calls[0])
        self.assertEqual(fields - concrete(LearnerProfile), set())
        self.assertTrue(PROFILE_NAMES.isdisjoint(fields))
        self.assertTrue(set(ids) <= fields)
        self.assertEqual(recorder.errors, [])

    def test_timetable_attendance_and_active_owner_loaders(self):
        self.assert_projection(lambda: views.fetch_caseload_timetable_profiles('coach@example.test'))
        self.assert_projection(lambda: views.fetch_attendance_caseload_rows('coach@example.test', include_plan=False))
        self.assert_projection(lambda: views.fetch_owner_active_learner_profiles('coach@example.test'))

    def test_imported_review_date_repair_reads_owned_profiles_only(self):
        recorder, _ = run_recorded(lambda: views.dashboard_imported_completed_review_dates(
            [1, 2], owner_email='coach@example.test', owner_name='Coach'))
        self.assertEqual(set(recorder.calls[0]) - concrete(LearnerProfile), set())
        self.assertTrue(PROFILE_NAMES.isdisjoint(recorder.calls[0]))
        self.assertEqual(recorder.errors, [])

    def test_support_ticket_caseload(self):
        self.assert_projection(lambda: support_tickets.caseload_learners('coach@example.test'))

    def test_review_instance_definition_identity(self):
        with patch.object(views.curriculum_review_instances, 'review_instance_form_definition', return_value={}), \
                patch.object(views, '_review_learner_identity', return_value={}) as identity, \
                patch.object(views, '_review_instance_meeting_summary_source', return_value=None):
            recorder, _ = run_recorded(lambda: views._coach_review_instance_definition({'learner_id': 5}))
        self.assertEqual(set(recorder.calls[0]), {'full_name', 'email', 'programme_id'})
        self.assertEqual(recorder.errors, [])
        identity.assert_called_once_with(None)

    def test_case_file_shell_source_projection_is_concrete(self):
        source_fields = ast.literal_eval(_only_args_after(BACKEND / 'coach_api/views.py', 'EnrolmentUser.all_learners.filter(pk=profile.enrolment_id)'))
        self.assertEqual(set(source_fields) - concrete(EnrolmentUser), set())
        self.assertTrue(SOURCE_NAMES.isdisjoint(source_fields))
        str(EnrolmentUser.all_learners.filter(pk=1).only(*source_fields).query)


class FetchAllLearnerProfilesTests(SimpleTestCase):
    def call(self, programme=None, cohort=None, ids=None):
        with patch('coach_api.caseload_placement.placement_ids_named', side_effect=lambda field, name, using: ids[field]) as named, \
                patch.object(views, 'learner_ksbs_relation_exists', return_value=False), \
                patch.object(views, 'learner_activity_events_relation_exists', return_value=False):
            captured = []
            from django.db.models.query import QuerySet

            def fetch_all(queryset):
                if queryset._result_cache is None:
                    try:
                        captured.append(queryset.query.sql_with_params())
                    except EmptyResultSet:                       # Django returns [] without a query
                        captured.append('EMPTY')
                    queryset._result_cache, queryset._prefetch_done = [], True
            with patch.object(QuerySet, '_fetch_all', autospec=True, side_effect=fetch_all):
                rows = views.fetch_all_learner_profiles(programme=programme, cohort=cohort)
        return rows, captured, named

    def test_name_filters_match_curriculum_names_then_filter_the_profiles_ids(self):
        rows, captured, named = self.call('Level 3 Business', 'october 2026',
                                          {'programme_id': ['P1'], 'cohort_id': ['C1', 'C2']})
        self.assertEqual(rows, [])
        sql, params = captured[0]
        self.assertIn('"programme_id" IN', sql)
        self.assertIn('"cohort_id" IN', sql)
        self.assertEqual([p for p in params if p in ('P1', 'C1', 'C2')], ['P1', 'C1', 'C2'])
        self.assertEqual([c.args[:2] for c in named.call_args_list],
                         [('programme_id', 'Level 3 Business'), ('cohort_id', 'october 2026')])

    def test_unmatched_name_still_returns_no_learners_and_no_filter_means_all(self):
        rows, captured, _ = self.call('Unknown', None, {'programme_id': []})
        self.assertEqual((rows, captured), ([], ['EMPTY']))           # unmatched name: no learners, as before
        _, captured, named = self.call(None, None, {})
        named.assert_not_called()
        self.assertNotIn('programme_id" IN', captured[0][0])

    def test_placement_ids_named_is_one_case_insensitive_read(self):
        connection, cursor = fake_connection([('C1',), (' C2 ',), (None,)])
        with patch('coach_api.caseload_placement.connections', {'default': connection}):
            self.assertEqual(placement_ids_named('cohort_id', 'October 2026', 'default'), ['C1', 'C2'])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(sql, 'SELECT cohort_id::text FROM curriculum.cohorts WHERE upper(cohort_name::text) = upper(%s)')
        self.assertEqual(params, ['October 2026'])


class OtherReaderProjectionTests(SimpleTestCase):
    def test_learner_and_enrolment_field_constants_are_concrete(self):
        from learner_api.attendance_lectures import ATTENDANCE_SOURCE_FIELDS
        from learner_api.mobile_coach import PROFILE_FIELDS
        for model, fields, names in ((LearnerProfile, PROFILE_FIELDS, PROFILE_NAMES),
                                     (EnrolmentUser, ATTENDANCE_SOURCE_FIELDS, SOURCE_NAMES)):
            with self.subTest(fields=fields):
                self.assertEqual(set(fields) - concrete(model), set())
                self.assertTrue(names.isdisjoint(fields))
                str(model.objects.only(*fields).query)
        self.assertTrue({'programme_id', 'cohort_id', 'group_id'} <= set(ATTENDANCE_SOURCE_FIELDS))
        self.assertIn('cohort_id', PROFILE_FIELDS)

    def test_previous_names_reproduce_the_error(self):
        for model, name in ((LearnerProfile, 'group_name'), (LearnerProfile, 'cohort'), (EnrolmentUser, 'group')):
            with self.subTest(name=name), self.assertRaises(FieldDoesNotExist):
                str(model.objects.only('id', name).query)

    def test_remaining_reader_files_name_no_placement_property_in_orm_calls(self):
        files = {
            'coach_api/views.py': PROFILE_NAMES | SOURCE_NAMES, 'coach_api/support_tickets.py': PROFILE_NAMES,
            'coach_api/management/commands/audit_review_anchor_dates.py': PROFILE_NAMES,
            'progress_reviews_api/views.py': PROFILE_NAMES, 'login/advanced_admin.py': PROFILE_NAMES,
            'learner_api/mobile_coach.py': PROFILE_NAMES, 'engagement_api/module_feedback.py': SOURCE_NAMES,
            'learner_api/first_session_bookings.py': SOURCE_NAMES,
        }
        for relative, names in files.items():
            with self.subTest(file=relative):
                self.assertEqual(_orm_placement_names(BACKEND / relative, names), [])

    def test_curriculum_assignment_readers(self):
        from curriculum_api import learner_assignments
        for relative in ('curriculum_api/learner_assignments.py', 'curriculum_api/learner_assignment_counts_sql.py'):
            hits = _orm_placement_names(BACKEND / relative, SOURCE_NAMES)
            with self.subTest(file=relative):
                # Only the bulk cohort *assignment write* remains (left unchanged, reported).
                self.assertTrue(all(call == 'save' or 'update' in call for call in hits), hits)
        recorder, _ = run_recorded(lambda: learner_assignments.bulk_assigned_learner_counts(set()) or
                                   list(EnrolmentUser.all_learners.only('id', 'programme_id', 'group_id',
                                                                        'learning_plan', 'training_plan')))
        self.assertEqual(recorder.errors, [])


class AssignmentCountRelationTests(SimpleTestCase):
    def test_relation_resolves_names_through_profile_placement_and_keeps_column_names(self):
        from curriculum_api import learner_assignment_counts_sql as counts
        relation = ' '.join(counts.LEARNER_RELATION.split())
        self.assertNotIn('cu."Programme"', relation)
        self.assertNotIn('cu."Group"', relation)
        for fragment in ('placement.programme AS "Programme"', 'placement.group_name AS "Group"',
                         'FROM enrolment."Created_users" cu', 'WHERE l.enrolment_id = cu.id',
                         'LEFT JOIN curriculum.programmes p ON p.programme_id = l.programme_id',
                         'LEFT JOIN curriculum.groups g ON g.group_id = l.group_id', 'LIMIT 1', ') u'):
            self.assertIn(fragment, relation)
        sql = counts.PLAN_FACTS_SQL.format(source=counts.LEARNER_RELATION)
        self.assertIn('u."Programme"     AS programme', sql)                     # CTE unchanged
        connection, cursor = fake_connection([], description=[])
        with patch.object(counts, 'connections', {'enrolment': connection}):
            self.assertEqual(counts.fetch_plan_facts({'M1'}, using='enrolment'), [])
        self.assertTrue(cursor.execute.call_args.args[0].lstrip().upper().startswith('WITH'))


class LeaderboardTests(SimpleTestCase):
    def call(self, query=''):
        from engagement_api import views as engagement
        connection, cursor = fake_connection([('101', 'Learner A', 30, 'October 2026')])
        with patch.object(engagement, 'connection', connection):
            response = engagement.leaderboard(RequestFactory().get(f'/engagement/leaderboard/{query}'))
        return response, cursor

    def test_cohort_name_comes_from_the_profile_placement_with_the_same_response(self):
        response, cursor = self.call('?cohort=October%202026')
        sql, params = cursor.execute.call_args.args
        self.assertNotIn('cu."Cohort"', sql)
        self.assertIn('LEFT JOIN curriculum.cohorts c ON c.cohort_id = l.cohort_id', sql)
        self.assertIn('WHERE l.enrolment_id = cu.id', sql)
        self.assertIn('placement.cohort_name = %s', sql)
        self.assertEqual(params, ['October 2026'])
        self.assertEqual(json.loads(response.content), {'scope': 'all-time', 'cohort': 'October 2026', 'entries': [
            {'rank': 1, 'learnerId': '101', 'learner': 'Learner A', 'points': 30, 'cohort': 'October 2026'}]})

    def test_without_cohort_no_filter_parameter(self):
        _, cursor = self.call()
        sql, params = cursor.execute.call_args.args
        self.assertNotIn('placement.cohort_name = %s', sql)
        self.assertEqual(params, [])


class LearnerStatusCountsTests(SimpleTestCase):
    def facts(self, columns):
        from curriculum_api import learner_status_counts as counts, views as curriculum_views
        description = [(name,) for name in ('id', 'programme', 'cohort', 'group_name', 'programme_id', 'cohort_id',
                                            'group_id', 'status', 'explicit', 'module_ids', 'ambiguous')]
        connection, cursor = fake_connection([(1, 'Prog', 'Coh', 'Grp', 'P1', 'C1', 'G1', 'active', False, [], False)],
                                             description=description)
        with patch.object(curriculum_views, 'connection', connection), \
                patch.object(curriculum_views, 'learner_schema_table_exists', return_value=True), \
                patch.object(curriculum_views, 'learner_schema_columns', return_value=columns):
            rows = counts.learner_facts(set())
        return rows, cursor.execute.call_args.args[0]

    def test_names_are_joined_through_the_profiles_own_ids(self):
        rows, sql = self.facts({'id', 'lifecycle_status', 'programme_status', 'programme_id', 'cohort_id', 'group_id'})
        flat = ' '.join(sql.split())
        self.assertIsNone(re.search(r'(?<![\w.])p\.(programme|cohort|group_name)\b', flat))
        for fragment in ('placement_programme.name AS programme', 'placement_cohort.cohort_name AS cohort',
                         'placement_group.group_name AS group_name',
                         'LEFT JOIN curriculum.programmes placement_programme ON placement_programme.programme_id = p.programme_id',
                         'LEFT JOIN curriculum.cohorts placement_cohort ON placement_cohort.cohort_id = p.cohort_id',
                         'LEFT JOIN curriculum.groups placement_group ON placement_group.group_id = p.group_id'):
            self.assertIn(fragment, flat)
        self.assertEqual((rows[0]['programme'], rows[0]['cohort'], rows[0]['group_name']), ('Prog', 'Coh', 'Grp'))

    def test_missing_id_column_reads_as_no_name_and_previous_precheck_no_longer_blocks(self):
        _, sql = self.facts({'id', 'lifecycle_status'})
        flat = ' '.join(sql.split())
        self.assertIn('NULL AS programme', flat)
        self.assertIn('NULL AS cohort', flat)
        self.assertIn('NULL AS group_name', flat)
        self.assertNotIn('curriculum.', flat)


def _only_args_after(path, marker):
    text = path.read_text(encoding='utf-8')
    start = text.index('.only(', text.index(marker)) + len('.only(')
    end = text.index(')', start)
    return '(' + text[start:end] + ')'


def _orm_placement_names(path, names):
    """``method(name)`` for ORM calls in ``path`` whose string args/kwargs name a placement property."""
    methods = {'only', 'defer', 'values', 'values_list', 'order_by', 'filter', 'exclude', 'update', 'create', 'save'}
    hits = []
    for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in methods:
            receiver = ast.unparse(node.func.value)
            if node.func.attr in {'filter', 'exclude', 'update', 'create'} and not any(
                    model in receiver for model in ('LearnerProfile', 'EnrolmentUser', 'queryset', 'all_learners', 'learners')):
                continue
            strings = [a.value for a in node.args if isinstance(a, ast.Constant) and isinstance(a.value, str)]
            strings += [k.arg for k in node.keywords if k.arg]
            for keyword in node.keywords:
                if keyword.arg == 'update_fields' and isinstance(keyword.value, (ast.List, ast.Name)):
                    strings.append('update_fields')
            for value in strings:
                if value.lstrip('-').split('__')[0] in names:
                    hits.append(f'{node.func.attr}({value})@{node.lineno}')
    return hits
