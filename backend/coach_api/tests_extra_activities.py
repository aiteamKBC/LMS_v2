"""Read-only extra activity caseload and revoked coach-creation regression tests.

List SQL runs only against private in-memory SQLite. Identity is mocked; no
application database, file storage, mail or Microsoft service is contacted.
"""
import json
import re
import sqlite3
from datetime import datetime, timezone as utc
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.middleware.csrf import get_token
from django.test import RequestFactory, SimpleTestCase
from learner_api.canonical_hours import extra_activity_hour_records
from . import extra_activities as extras


class CoachExtraActivitiesTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.create_function('btrim', 1, lambda value: str(value or '').strip())
        self.addCleanup(self.db.close)
        self.db.executescript("""ATTACH DATABASE ':memory:' AS Learner;
            ATTACH DATABASE ':memory:' AS enrolment;
            CREATE TABLE enrolment.Created_users(id INTEGER PRIMARY KEY,Email);
            CREATE TABLE Learner.learners(id INTEGER PRIMARY KEY,enrolment_id,learner_type,full_name,programme,coach_email,email);
            CREATE TABLE Learner.learning_reflection_submissions(id,learner_id,learner_kind,learner_name,activity_title,
                activity_type,status,actual_time_hours,reviewed_by,submitted_at,full_submission);
        """)
        self.owner = dict(id=70, enrolment_id=7, learner_type='apprenticeship', coach_email='coach@example.test')
        for pk, kind, coach in [(7, 'apprenticeship', 'coach@example.test'),
                                 (8, 'commercial', 'coach@example.test'),
                                 (9, 'apprenticeship', 'another@example.test')]:
            email = f'learner{pk}@example.test'
            self.db.execute('INSERT INTO enrolment.Created_users VALUES(?,?)', [pk, email])
            self.db.execute('INSERT INTO Learner.learners VALUES(?,?,?,?,?,?,?)',
                            [pk * 10, pk, kind, 'Synthetic learner', 'Programme', coach, email])
            origin = {'submissionOrigin': 'coach', 'coachCreation': {'name': 'Original Coach', 'actorId': '3'}} if pk == 7 else {}
            self.seed(f'activity-{pk}', pk, kind, 'accepted', origin)
        self.seed('draft', 7, 'apprenticeship', 'draft')
        self.seed('assignment', 7, 'apprenticeship', 'accepted', activity_type='assignment')
        self.seed('pending', 7, 'apprenticeship', 'submitted_for_tutor_review')
        self.enterContext(patch.object(extras, 'query', side_effect=self.query))
        self.request = RequestFactory().get('/coach/extra-activities')
        self.request.coach_email = 'coach@example.test'

    def seed(self, sid, learner_id, kind, status, origin=None, activity_type='extra_activity'):
        document = {'monthlyAssignment': {'month': '2026-10'}, **(origin or {})}
        self.db.execute('INSERT INTO Learner.learning_reflection_submissions VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                        [sid, str(learner_id), kind, 'Synthetic learner', 'External training', activity_type,
                         status, '2', 'Original Coach' if origin else None, '2026-10-14T12:00:00Z', json.dumps(document)])

    def query(self, sql, params=()):
        sql = re.sub(r'(\w+\.\w+)::text', r'CAST(\1 AS TEXT)', sql)
        if '=ANY(%s)' in sql:
            index = sql[:sql.index('=ANY(%s)')].count('%s')
            values = params[index]
            sql = sql.replace('=ANY(%s)', ' IN (' + ','.join('%s' for _ in values) + ')')
            params = [*params[:index], *values, *params[index + 1:]]
        return [dict(row) for row in self.db.execute(sql.replace('%s', '?'), params).fetchall()]

    def list(self, **filters):
        self.request.GET = RequestFactory().get('/', filters).GET
        return json.loads(unwrap(extras.activities)(self.request).content)

    def test_caseload_excludes_other_coach_drafts_and_assignments_for_both_learner_kinds(self):
        data = self.list()
        self.assertEqual({row['id'] for row in data['items']}, {'activity-7', 'activity-8', 'pending'})
        self.assertEqual({row['learnerKind'] for row in data['items']}, {'commercial', 'apprenticeship'})
        people = json.loads(unwrap(extras.learners)(self.request).content)['learners']
        self.assertEqual({row['id'] for row in people}, {7, 8})

    def test_filters_and_historical_attribution_remain_without_mutating_saved_records(self):
        before = self.query('SELECT * FROM Learner.learning_reflection_submissions')
        data = self.list(month='2026-10', learner='7', status='accepted')
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['items'][0]['addedBy'], 'Original Coach')
        self.assertEqual(data['items'][0]['reviewedBy'], 'Original Coach')
        self.assertEqual(self.list(month='2026-09')['total'], 0)
        self.assertEqual(self.list(status='pending')['items'][0]['id'], 'pending')
        self.assertEqual(self.query('SELECT * FROM Learner.learning_reflection_submissions'), before)

    def test_pagination_preserves_other_learners(self):
        for index in range(26):
            self.seed(f'more-{index}', 8, 'commercial', 'accepted')
        first = self.list(learner='8')
        second = self.list(learner='8', page='2')
        self.assertEqual((first['total'], len(first['items']), first['hasNext']), (27, 25, True))
        self.assertEqual((len(second['items']), second['hasNext']), (2, False))
        self.assertFalse({row['id'] for row in first['items']} & {row['id'] for row in second['items']})

    def test_historical_accepted_coach_record_still_counts_without_a_learner_signature(self):
        from learner_api import canonical_learning
        record = {**self.query("SELECT * FROM Learner.learning_reflection_submissions WHERE id='activity-7'")[0],
                  'profile_id': 70, 'activity_month': '2026-10', 'submitted_at': datetime(2026, 10, 14, tzinfo=utc.utc)}
        with patch.object(canonical_learning, 'query', return_value=[record]):
            rows = extra_activity_hour_records([self.owner])[70]
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]['accepted'])
        self.assertEqual(rows[0]['actual_seconds'], 7200)


class CoachExtraActivitiesBoundaryTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory(enforce_csrf_checks=True)
        self.account = SimpleNamespace(subject_type='staff', subject_id=3, role='staff')
        self.staff = SimpleNamespace(id=3, username='Actual Coach', email='coach@example.test', access='coach')
        self.enterContext(patch('login.permissions.authenticate_request', side_effect=self.authenticate))
        self.access = self.enterContext(patch('login.permissions._accesses_of', return_value={'coach'}))
        self.enterContext(patch('coach_api.auth.StaffUser.objects', new=MagicMock()))
        from .auth import StaffUser
        StaffUser.objects.filter.return_value.only.return_value.first.return_value = self.staff
        self.enterContext(patch('coach_api.auth._staff_access', side_effect=lambda staff: staff.access))
        self.enterContext(patch('coach_api.auth._invalidate_dashboard_after_mutation', side_effect=lambda view, request, response, identity: response))

    def authenticate(self, request):
        request.login_account = self.account
        return self.account

    def test_unauthenticated_learner_and_other_staff_roles_are_refused(self):
        request = self.factory.get('/coach/extra-activities')
        with patch('login.permissions.authenticate_request', return_value=None):
            self.assertEqual(extras.activities(request).status_code, 401)
        self.account.role = 'learner'
        self.assertEqual(extras.activities(request).status_code, 403)
        self.account.role = 'staff'; self.access.return_value = {'tutor'}
        self.assertEqual(extras.activities(request).status_code, 403)

    def test_csrf_boundary_is_preserved_for_unsafe_requests(self):
        request = self.factory.post('/coach/extra-activities', '{}', content_type='application/json')
        self.assertEqual(extras.activities(request).status_code, 403)

    def test_coach_read_and_forged_owner_assertion(self):
        with patch.object(extras, 'query', side_effect=[[{'count': 0}], []]):
            self.assertEqual(extras.activities(self.factory.get('/coach/extra-activities')).status_code, 200)
        request = self.factory.get('/coach/extra-activities', {'ownerEmail': 'other@example.test'})
        self.assertEqual(extras.activities(request).status_code, 403)

    def test_creation_is_refused_even_with_valid_csrf_and_spoofed_approved_payload(self):
        for kind in ('apprenticeship', 'commercial'):
            with self.subTest(kind=kind), patch.object(extras, 'query') as query:
                request = self.factory.post('/coach/extra-activities', json.dumps({
                    'learnerKind': kind, 'learnerId': '7', 'activityId': 'extra:existing',
                    'status': 'accepted', 'coachAttestation': True, 'coachCreation': {'actorId': '3'},
                }), content_type='application/json')
                request.META['HTTP_X_CSRFTOKEN'] = get_token(request)
                request.COOKIES['csrftoken'] = request.META['CSRF_COOKIE']
                response = extras.activities(request)
                self.assertEqual(response.status_code, 405)
                self.assertEqual(response['Allow'], 'GET')
                query.assert_not_called()

    def test_all_unsafe_methods_are_refused_before_payload_parsing(self):
        for method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            with self.subTest(method=method), patch.object(extras, 'query') as query:
                request = self.factory.generic(method, '/coach/extra-activities', b'invalid json', content_type='application/json')
                request.coach_email = self.staff.email
                self.assertEqual(unwrap(extras.activities)(request).status_code, 405)
                self.assertEqual(unwrap(extras.learners)(request).status_code, 405)
                query.assert_not_called()

    def test_admin_view_as_cannot_restore_coach_creation(self):
        self.staff.access = 'super-admin'
        self.access.return_value = {'super-admin'}
        request = self.factory.post('/coach/extra-activities?viewAsCoach=coach@example.test', '{}', content_type='application/json')
        request.META['HTTP_X_CSRFTOKEN'] = get_token(request)
        with patch.object(extras, 'query') as query:
            self.assertEqual(extras.activities(request).status_code, 403)
            query.assert_not_called()

    def test_coach_cannot_bypass_the_removed_form_using_learner_upload_or_submission(self):
        from learner_api import evidence, reflection_submissions
        self.enterContext(patch('login.permissions.coach_owns_learner', return_value=True))
        self.enterContext(patch('login.permissions.audit_admin_learner_action'))
        for kind in ('apprenticeship', 'commercial'):
            with self.subTest(kind=kind):
                upload = self.factory.post('/learner_api/evidence/upload/', {'section_ref': 'extra:existing'})
                self.assertEqual(evidence.upload_evidence(upload, kind=kind, pk=7).status_code, 403)
                submit = self.factory.post('/learner_api/reflection/submissions/',
                    json.dumps({'learnerKind': kind, 'learnerId': '7', 'activityType': 'extra_activity'}), content_type='application/json')
                self.assertEqual(reflection_submissions.create_reflection_submission(submit).status_code, 403)

    def test_learner_admin_and_staff_learning_on_own_record_keep_extra_upload_access(self):
        from learner_api import evidence
        self.enterContext(patch('login.permissions.coach_owns_learner', return_value=False))
        self.enterContext(patch('login.permissions.staff_owns_learner', return_value=True))
        self.enterContext(patch('login.permissions.audit_admin_learner_action'))
        for role in ('learner', 'admin', 'staff'):
            with self.subTest(role=role), patch.object(evidence, 'azure_configured', return_value=False) as storage:
                self.account.role = role
                self.account.subject_id = 7
                request = self.factory.post('/learner_api/evidence/upload/', {'section_ref': 'extra:own'})
                self.assertEqual(evidence.upload_evidence(request, kind='apprenticeship', pk=7).status_code, 503)
                storage.assert_called_once()

    def test_coach_upload_for_other_learning_keeps_existing_permission(self):
        from learner_api import evidence
        self.enterContext(patch('login.permissions.coach_owns_learner', return_value=True))
        self.enterContext(patch('login.permissions.audit_admin_learner_action'))
        with patch.object(evidence, 'azure_configured', return_value=False) as storage:
            request = self.factory.post('/learner_api/evidence/upload/', {'section_ref': 'existing-curriculum-component'})
            self.assertEqual(evidence.upload_evidence(request, kind='apprenticeship', pk=7).status_code, 503)
            storage.assert_called_once()
