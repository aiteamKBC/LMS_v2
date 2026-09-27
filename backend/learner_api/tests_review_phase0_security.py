"""Phase 0: Review security, authorization and integrity characterization.

TESTS ONLY. Each ``*Characterization`` test asserts the TARGET secure
behaviour. Where the current code is vulnerable the test FAILS on purpose --
that failure is the evidence for Phase 1 and must not be "fixed" by changing
the assertion, skipping it or mocking the vulnerable path away. Each
``*ValidPath`` test pins a legitimate workflow that Phase 1 must keep working.

    F1   employer object-level authorization on Review Instances
    F2   staff submitting a participant (learner) signature
    F3   Created_users.id vs Learner profile id collision
    F4   signature immutability once a Review is completed
    F5   sign vs reopen (only the SQLite-valid stale-read window; see below)
    F12  impossible signature configurations

Run with ``--settings=config.settings_sqlite_test``. The Neon-mapped learner
tables (enrolment."Created_users", "Learner"."learners", enrolment."Employers")
are unmanaged and never exist in the SQLite test database, so -- exactly like
tests_learner_import_transactions.py -- the 'enrolment' alias is swapped for a
private in-memory SQLite connection and the REAL models are created there.
No learner lookup, calendar-ownership lookup or permission decorator is mocked:
requests go through the real employer_or_staff / learner_self_or_staff gates
with a synthetic ``login_account`` (authenticate_request returns an already
attached account). Coach endpoints are unwrapped with ``request.coach_email``,
the established pattern in coach_api's Review suites.

All data here is synthetic.
"""
import json
from contextlib import ExitStack
from datetime import date, time
from inspect import unwrap
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.db import connection, connections
from django.db.utils import ConnectionHandler
from django.test import RequestFactory, TestCase

from coach_api import views as coach_views
from coach_api.models import CoachCalendarEvent
from curriculum_api import review_instances, review_types, reviews
from curriculum_api import views as curriculum_views
from curriculum_api.review_pdf import pdf_availability

from . import calendar as learner_calendar
from . import employer_portal
from .models import Employer, EnrolmentUser, LearnerProfile

PROGRAMME_ID = 'PROG-PHASE0'
PROGRAMME_NAME = 'Phase Zero Programme'
COACH_EMAIL = 'coach-p0@example.test'
OTHER_COACH_EMAIL = 'other-coach-p0@example.test'
STAFF_EMAIL = 'staff-p0@example.test'
SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
OTHER_SIGNATURE = 'data:image/png;base64,R0lGODlhAQABAIAAAAAAAP8AAAAA'

ALL_SIGNERS = {'advisor': True, 'employer': True, 'participant': True, 'referrer': False}
ALL_VISIBLE = {'advisor': True, 'employer': True, 'participant': True, 'referrer': True}


@skipUnless(getattr(settings, 'USE_SQLITE_FOR_TESTS', False), 'Requires isolated SQLite test settings.')
class Phase0ReviewTestCase(TestCase):
    databases = {'default'}

    # ------------------------------------------------------------ fixtures

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self._isolate_enrolment_database()
        self.stack.enter_context(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))

        curriculum_views.reset_schema_ready_flags()
        curriculum_views.invalidate_curriculum_cache()
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        review_types.provision_review_types_table()
        review_instances.provision_review_instance_tables()
        # Same as coach_api.tests_review_instance_reopen: provision up front and
        # mark the gate satisfied so no CREATE TABLE runs inside a test.
        review_instances._provision_review_instance_reopens_table()
        self.stack.enter_context(patch.object(review_instances, '_REOPENS_TABLE_READY', True))
        with connection.cursor() as cursor:
            cursor.execute(f'delete from {curriculum_views.authoring_table_name(review_types.REVIEW_TYPES_TABLE)}')
            cursor.execute('delete from programmes')
        review_types.seed_system_review_types()
        curriculum_views.insert_row('programmes', {
            'id': PROGRAMME_ID, 'programme_id': PROGRAMME_ID, 'program_id': PROGRAMME_ID,
            'name': PROGRAMME_NAME, 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': curriculum_views.datetime.utcnow(), 'updated_at': curriculum_views.datetime.utcnow(),
        })
        curriculum_views.invalidate_curriculum_cache()
        self._event_counter = 0

    def _isolate_enrolment_database(self):
        """Same isolation as tests_learner_import_transactions: a private
        in-memory database for the unmanaged Neon-mapped models only."""
        config = {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
        # A distinct alias: Django's test guard allows dynamically created
        # connections, and the router still reaches it through 'enrolment'.
        handler = ConnectionHandler({'default': dict(config), 'p0_enrolment': dict(config)})
        database = handler['p0_enrolment']
        self.stack.callback(database.close)
        # Materialise the configured alias first so the patch restores the
        # very object Django's test guard wrapped, not a fresh one.
        connections['enrolment']
        self.stack.enter_context(patch.object(connections._connections, 'enrolment', database))
        self.stack.enter_context(patch.object(connections._connections, 'p0_enrolment', database, create=True))
        for model, table in ((EnrolmentUser, 'p0_created_users'),
                             (LearnerProfile, 'p0_learner_profiles'),
                             (Employer, 'p0_employers')):
            self.stack.enter_context(patch.object(model._meta, 'db_table', table))
        with database.schema_editor() as editor:
            editor.create_model(EnrolmentUser)
            editor.create_model(LearnerProfile)
            editor.create_model(Employer)

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists programmes (
                    id varchar(128) primary key, programme_id varchar(128), program_id varchar(128),
                    name varchar(255), status varchar(32), is_active boolean, is_archived boolean,
                    created_at timestamp, updated_at timestamp
                )
                """
            )

    def _employer(self, employer_id, email):
        return Employer.objects.create(id=employer_id, first_name='Synthetic', surname=f'Employer {employer_id}', email=email)

    def _learner(self, *, created_users_id, profile_id, email, employer_id=None):
        """One learner as it really exists: a Created_users row plus its
        active Learner profile, linked by profile.enrolment_id."""
        source = EnrolmentUser.all_learners.create(
            id=created_users_id, email=email, learner_type='apprenticeship', employer_id=employer_id,
        )
        profile = LearnerProfile.objects.create(
            id=profile_id, email=email, enrolment_id=created_users_id, lifecycle_status='active',
            programme=PROGRAMME_NAME, programme_id=PROGRAMME_ID, coach_email=COACH_EMAIL,
        )
        return source, profile

    def _template(self, *, signatures=None, visible_to=None, type_code='mcm'):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': 'Phase 0 Review',
            'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code(type_code)['id'],
            'recurrence': {'interval': 4, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': signatures or ALL_SIGNERS,
            'visibleTo': visible_to or ALL_VISIBLE,
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [
                {'title': 'Coach notes', 'fieldType': 'text_multiline', 'required': True},
                {'title': 'Learner comment', 'fieldType': 'text', 'required': False,
                 'configuration': {'respondentRoles': ['participant']}},
                {'title': 'Employer comment', 'fieldType': 'text', 'required': False,
                 'configuration': {'respondentRoles': ['employer']}},
            ]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _scheduled_review(self, profile, *, template_id=None, owner_email=COACH_EMAIL, **template_kwargs):
        """A scheduled MCM linked in both directions to its Review Instance.
        The calendar row and the instance carry the PROFILE id as learner_id,
        which is what coach scheduling writes."""
        self._event_counter += 1
        template_id = template_id or self._template(**template_kwargs)
        record = CoachCalendarEvent.objects.create(
            event_key=f'mcr:{profile.id}:{self._event_counter}:2026-10-01', event_type='mcr',
            owner_email=owner_email, owner_name='Coach',
            learner_id=profile.id, learner_name='Synthetic Learner', learner_email=profile.email,
            scheduled_date=date(2026, 10, 1), scheduled_time=time(10, 0),
            target_date=date(2026, 10, 1), duration_minutes=30,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link=f'https://teams.microsoft.com/meet/p0-{self._event_counter}',
            review_template_id=template_id,
        )
        coach_views.ensure_review_instance_for_calendar_record(record, {
            'eventKey': record.event_key, 'source': 'mcr', 'targetDate': '2026-10-01', 'learnerId': profile.id,
        })
        record.refresh_from_db()
        self.assertTrue(record.review_instance_id)
        return record

    def _instance(self, record):
        return review_instances.get_review_instance(record.review_instance_id)

    def _field_ids(self, record):
        definition = review_instances.review_instance_form_definition(self._instance(record))
        return {field['title']: field['id'] for field in definition['sections'][0]['fields']}

    def _to_in_progress(self, record):
        """The real Teams attendance transition (already-fetched records; no Graph call)."""
        changed = coach_views.apply_teams_attendance_status_transition(record, [{
            'email': record.owner_email, 'displayName': 'Coach',
            'intervals': [{'joinDateTime': '2026-10-01T10:01:00Z', 'leaveDateTime': '2026-10-01T10:30:00Z'}],
        }])
        self.assertTrue(changed)
        record.refresh_from_db()
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    def _coach_complete(self, record):
        """The real coach complete endpoint: saves the coach's answer, moves the
        instance on, and projects the status onto the calendar row."""
        status, payload = self._coach_call(
            coach_views.coach_review_instance_complete, record.review_instance_id, owner_email=record.owner_email,
            body={'answers': {self._field_ids(record)['Coach notes']: 'Synthetic coach notes.'}},
        )
        self.assertEqual(status, 200, payload)
        record.refresh_from_db()

    def _to_awaiting_signature(self, record):
        self._to_in_progress(record)
        self._coach_complete(record)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_AWAITING_SIGNATURE)

    def _signature_rows(self, record):
        return review_instances.get_review_instance_signatures(record.review_instance_id)

    # -------------------------------------------------------- request helpers

    def _account(self, role, subject_id, email):
        return SimpleNamespace(role=role, subject_id=subject_id, email=email, is_active=True, subject_type=role)

    def _call(self, view, method, path, account, body=None, **kwargs):
        factory = RequestFactory()
        if method == 'GET':
            request = factory.get(path)
        else:
            request = factory.post(path, data=json.dumps(body or {}), content_type='application/json')
        request.login_account = account
        response = view(request, **kwargs)
        try:
            payload = json.loads(response.content.decode() or '{}')
        except ValueError:
            payload = {}
        return response.status_code, payload

    def _employer_call(self, account, method, *, employer_id, learner_id, event_key, body=None):
        return self._call(
            employer_portal.employer_review_instance, method,
            f'/learner_api/employer-portal/{employer_id}/learner/apprenticeship/{learner_id}/events/{event_key}/review/',
            account, body, employer_id=employer_id, kind='apprenticeship', learner_id=learner_id, event_key=event_key,
        )

    def _learner_review_call(self, account, method, *, pk, event_key, body=None):
        return self._call(
            learner_calendar.learner_calendar_event_review, method,
            f'/learner_api/calendar/apprenticeship/{pk}/events/{event_key}/review/',
            account, body, kind='apprenticeship', pk=pk, event_key=event_key,
        )

    def _learner_sign_call(self, account, *, pk, event_key, signature=SIGNATURE, name='Synthetic Learner'):
        return self._call(
            learner_calendar.learner_progress_review_sign, 'POST',
            f'/learner_api/calendar/apprenticeship/{pk}/events/{event_key}/sign/',
            account, {'signature': signature, 'name': name}, kind='apprenticeship', pk=pk, event_key=event_key,
        )

    def _coach_call(self, view, instance_id, *, owner_email=COACH_EMAIL, body=None):
        factory = RequestFactory()
        if body is None:
            request = factory.get(f'/coach_api/coach/reviews/{instance_id}')
        else:
            request = factory.post(f'/coach_api/coach/reviews/{instance_id}', data=json.dumps(body), content_type='application/json')
        request.coach_email = owner_email
        response = unwrap(view)(request, instance_id)
        return response.status_code, json.loads(response.content.decode() or '{}')

    def _coach_sign(self, instance_id, *, signature=SIGNATURE, owner_email=COACH_EMAIL):
        return self._coach_call(
            coach_views.coach_review_instance_signature, instance_id, owner_email=owner_email,
            body={'role': 'advisor', 'signedName': 'Synthetic Coach', 'signature': signature},
        )

    def assertRefused(self, status, payload, what):
        self.assertIn(status, (403, 404), f'{what}: expected 403/404, got {status} {payload}')


# =============================================================================
# F1  Employer object-level authorization
# =============================================================================

class F1EmployerAuthorizationTests(Phase0ReviewTestCase):
    """Employer A owns Learner A; Employer B owns Learner B. Employer A names
    their OWN learner in the URL (so every URL-level gate passes) and Review
    B's raw REVI-... id as the event key. employer_review_instance finds no
    calendar row for that key and falls back to get_review_instance(event_key)
    without checking the instance belongs to Learner A (employer_portal.py
    around line 509)."""

    def setUp(self):
        super().setUp()
        self._employer(7001, 'employer-a@example.test')
        self._employer(7002, 'employer-b@example.test')
        self.learner_a, self.profile_a = self._learner(created_users_id=5101, profile_id=6101, email='learner-a@example.test', employer_id=7001)
        self.learner_b, self.profile_b = self._learner(created_users_id=5102, profile_id=6102, email='learner-b@example.test', employer_id=7002)
        template_id = self._template()
        self.review_a = self._scheduled_review(self.profile_a, template_id=template_id)
        self.review_b = self._scheduled_review(self.profile_b, template_id=template_id)
        self.employer_a = self._account('employer', 7001, 'employer-a@example.test')

    def test_f1_employer_a_cannot_view_review_b_by_instance_id_characterization(self):
        status, payload = self._employer_call(
            self.employer_a, 'GET', employer_id=7001, learner_id=self.learner_a.id, event_key=self.review_b.review_instance_id,
        )
        self.assertRefused(status, payload, 'F1 GET Review B as Employer A')

    def test_f1_employer_a_cannot_answer_review_b_by_instance_id_characterization(self):
        self._to_in_progress(self.review_b)
        field_id = self._field_ids(self.review_b)['Employer comment']
        status, payload = self._employer_call(
            self.employer_a, 'POST', employer_id=7001, learner_id=self.learner_a.id,
            event_key=self.review_b.review_instance_id, body={'answers': {field_id: 'Written by Employer A'}},
        )
        self.assertRefused(status, payload, 'F1 answer Review B as Employer A')
        answers = review_instances.review_instance_form_definition(self._instance(self.review_b))
        stored = [f.get('answer') for f in answers['sections'][0]['fields'] if f['id'] == field_id]
        self.assertNotIn('Written by Employer A', stored)

    def test_f1_employer_a_cannot_sign_review_b_by_instance_id_characterization(self):
        self._to_awaiting_signature(self.review_b)
        status, payload = self._employer_call(
            self.employer_a, 'POST', employer_id=7001, learner_id=self.learner_a.id,
            event_key=self.review_b.review_instance_id, body={'signature': SIGNATURE, 'name': 'Employer A'},
        )
        self.assertRefused(status, payload, 'F1 sign Review B as Employer A')
        self.assertFalse(self._signature_rows(self.review_b).get('employer', {}).get('signed_at'))

    def test_f1_employer_a_cannot_reach_review_b_by_its_calendar_event_key(self):
        """The calendar-row path IS guarded (learner id/email mismatch drops the row)."""
        status, payload = self._employer_call(
            self.employer_a, 'GET', employer_id=7001, learner_id=self.learner_a.id, event_key=self.review_b.event_key,
        )
        self.assertRefused(status, payload, 'Employer A via Review B calendar key')

    def test_f1_employer_a_cannot_name_learner_b_in_the_url(self):
        status, payload = self._employer_call(
            self.employer_a, 'GET', employer_id=7001, learner_id=self.learner_b.id, event_key=self.review_b.review_instance_id,
        )
        self.assertRefused(status, payload, 'Employer A naming Learner B')

    def test_f1_employer_calendar_key_lookup_ignores_id_collision_characterization(self):
        """Found in Phase 1A (same id-space mix as F3, in the employer endpoint):
        employer_review_instance keeps a calendar row when row.learner_id equals
        the URL learner's Created_users.id -- but Review rows store the PROFILE
        id. Employer A owns Learner Q (Created_users 6102); Learner B's profile
        id is also 6102, so Employer A opens Review B through its calendar key.
        Left for the F1 fix."""
        learner_q, _ = self._learner(created_users_id=self.profile_b.id, profile_id=6201,
                                     email='learner-q@example.test', employer_id=7001)
        status, payload = self._employer_call(
            self.employer_a, 'GET', employer_id=7001, learner_id=learner_q.id, event_key=self.review_b.event_key,
        )
        self.assertRefused(status, payload, 'F1/F3 Employer A via Created_users/profile collision')

    def test_f1_employer_a_cannot_use_employer_b_id(self):
        status, payload = self._employer_call(
            self.employer_a, 'GET', employer_id=7002, learner_id=self.learner_b.id, event_key=self.review_b.review_instance_id,
        )
        self.assertRefused(status, payload, 'Employer A using Employer B id')

    # -- valid paths ---------------------------------------------------------

    def test_valid_path_employer_a_views_review_a_by_calendar_event_key(self):
        status, payload = self._employer_call(
            self.employer_a, 'GET', employer_id=7001, learner_id=self.learner_a.id, event_key=self.review_a.event_key,
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload['instance']['id'], self.review_a.review_instance_id)

    def test_valid_path_employer_a_views_review_a_by_instance_id(self):
        status, payload = self._employer_call(
            self.employer_a, 'GET', employer_id=7001, learner_id=self.learner_a.id, event_key=self.review_a.review_instance_id,
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload['instance']['id'], self.review_a.review_instance_id)

    def test_valid_path_employer_a_answers_and_signs_review_a(self):
        self._to_in_progress(self.review_a)
        field_id = self._field_ids(self.review_a)['Employer comment']
        status, payload = self._employer_call(
            self.employer_a, 'POST', employer_id=7001, learner_id=self.learner_a.id,
            event_key=self.review_a.event_key, body={'answers': {field_id: 'Employer A comment'}},
        )
        self.assertEqual(status, 200, payload)
        self._coach_complete(self.review_a)
        status, payload = self._employer_call(
            self.employer_a, 'POST', employer_id=7001, learner_id=self.learner_a.id,
            event_key=self.review_a.event_key, body={'signature': SIGNATURE, 'name': 'Employer A'},
        )
        self.assertEqual(status, 200, payload)
        self.assertTrue(self._signature_rows(self.review_a)['employer']['signed_at'])


# =============================================================================
# F2  Staff signing as Learner
# =============================================================================

class F2StaffSigningAsLearnerTests(Phase0ReviewTestCase):
    """learner_progress_review_sign is gated by learner_self_or_staff, and it
    writes signed_by/actor from the calendar row's learner email -- never from
    the authenticated account (calendar.py learner_progress_review_sign)."""

    def setUp(self):
        super().setUp()
        self.learner, self.profile = self._learner(created_users_id=5111, profile_id=6111, email='learner-f2@example.test')
        self.review = self._scheduled_review(
            self.profile, signatures={'advisor': False, 'employer': False, 'participant': True, 'referrer': False},
        )
        self._to_awaiting_signature(self.review)
        self.staff = self._account('staff', 9001, STAFF_EMAIL)

    def test_valid_path_learner_signs_own_review(self):
        account = self._account('learner', self.learner.id, self.learner.email)
        status, payload = self._learner_sign_call(account, pk=self.learner.id, event_key=self.review.event_key)
        self.assertEqual(status, 200, payload)
        row = self._signature_rows(self.review)['participant']
        self.assertTrue(row['signed_at'])
        self.assertEqual(row['signed_by'], self.learner.email)
        self.assertEqual(self._instance(self.review)['status'], review_instances.STATUS_COMPLETED)

    def test_f2_staff_cannot_submit_participant_signature_characterization(self):
        status, payload = self._learner_sign_call(self.staff, pk=self.learner.id, event_key=self.review.event_key)
        self.assertRefused(status, payload, 'F2 staff signing as participant')
        self.assertFalse(self._signature_rows(self.review).get('participant', {}).get('signed_at'))
        self.assertEqual(self._instance(self.review)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

    def test_f2_persisted_signature_distinguishes_actor_from_learner_characterization(self):
        """If a staff-submitted participant signature is persisted at all, the
        stored record must name the staff actor rather than claim the learner."""
        self._learner_sign_call(self.staff, pk=self.learner.id, event_key=self.review.event_key)
        row = self._signature_rows(self.review).get('participant')
        if not row or not row.get('signed_at'):
            return
        instance = self._instance(self.review)
        persisted = {row.get('signed_by'), row.get('signed_name'), instance.get('updated_by')}
        self.assertIn(
            STAFF_EMAIL, persisted,
            f'F2 staff-submitted participant signature is indistinguishable from the learner: '
            f'signed_by={row.get("signed_by")!r} updated_by={instance.get("updated_by")!r}',
        )

    def test_valid_path_staff_can_still_read_learner_review(self):
        """Staff read access on the learner endpoint is legitimate (learner_self_or_staff)."""
        status, payload = self._learner_review_call(self.staff, 'GET', pk=self.learner.id, event_key=self.review.event_key)
        self.assertEqual(status, 200, payload)

    def test_other_learner_cannot_sign_through_url(self):
        other, _ = self._learner(created_users_id=5112, profile_id=6112, email='learner-f2-other@example.test')
        account = self._account('learner', other.id, other.email)
        status, payload = self._learner_sign_call(account, pk=self.learner.id, event_key=self.review.event_key)
        self.assertRefused(status, payload, 'other learner naming this learner id')


# =============================================================================
# F3  Created_users.id vs profile id collision
# =============================================================================

class F3IdentityCollisionTests(Phase0ReviewTestCase):
    """Learner A: Created_users.id = 5201, profile.id = 5301.
    Learner B: Created_users.id = 5301, profile.id = 5401.
    Learner A's PROFILE id equals Learner B's CREATED_USERS id.

    Review A's calendar row/instance carry learner_id = 5301 (A's profile).
    _learner_calendar_record builds learner_ids = {str(pk), str(mirror.id)}
    from TWO independent id spaces and matches record.learner_id against the
    set -- so Learner B (pk 5301) matches Review A. The generated-occurrence
    path in learner_calendar_event_review has the same shape (candidate_ids).
    Nothing here is mocked."""

    A_CREATED_USERS_ID, A_PROFILE_ID = 5201, 5301
    B_CREATED_USERS_ID, B_PROFILE_ID = 5301, 5401

    def setUp(self):
        super().setUp()
        self.learner_a, self.profile_a = self._learner(
            created_users_id=self.A_CREATED_USERS_ID, profile_id=self.A_PROFILE_ID, email='learner-f3-a@example.test')
        self.learner_b, self.profile_b = self._learner(
            created_users_id=self.B_CREATED_USERS_ID, profile_id=self.B_PROFILE_ID, email='learner-f3-b@example.test')
        self.assertEqual(self.profile_a.id, self.learner_b.id)  # the collision
        self.review_a = self._scheduled_review(
            self.profile_a, signatures={'advisor': False, 'employer': False, 'participant': True, 'referrer': False},
        )
        self.account_a = self._account('learner', self.learner_a.id, self.learner_a.email)
        self.account_b = self._account('learner', self.learner_b.id, self.learner_b.email)

    def test_f3_real_lookup_resolves_review_a_for_its_owner(self):
        self.assertEqual(
            learner_calendar._learner_calendar_record('apprenticeship', self.learner_a.id, self.review_a.event_key),
            self.review_a,
        )

    def test_f3_real_lookup_does_not_resolve_review_a_for_learner_b_characterization(self):
        record = learner_calendar._learner_calendar_record('apprenticeship', self.learner_b.id, self.review_a.event_key)
        self.assertIsNone(record, 'F3 _learner_calendar_record returned Learner A\'s calendar row for Learner B')

    def test_f3_learner_b_cannot_view_review_a_characterization(self):
        status, payload = self._learner_review_call(self.account_b, 'GET', pk=self.learner_b.id, event_key=self.review_a.event_key)
        self.assertRefused(status, payload, 'F3 Learner B GET Review A')

    def test_f3_learner_b_cannot_answer_review_a_characterization(self):
        self._to_in_progress(self.review_a)
        field_id = self._field_ids(self.review_a)['Learner comment']
        status, payload = self._learner_review_call(
            self.account_b, 'POST', pk=self.learner_b.id, event_key=self.review_a.event_key,
            body={'answers': {field_id: 'Written by Learner B'}},
        )
        self.assertRefused(status, payload, 'F3 Learner B answer Review A')

    def test_f3_learner_b_cannot_sign_review_a_characterization(self):
        self._to_awaiting_signature(self.review_a)
        status, payload = self._learner_sign_call(self.account_b, pk=self.learner_b.id, event_key=self.review_a.event_key)
        self.assertRefused(status, payload, 'F3 Learner B sign Review A')
        self.assertFalse(self._signature_rows(self.review_a).get('participant', {}).get('signed_at'))

    def test_f3_generated_occurrence_candidate_ids_do_not_cross_learners_characterization(self):
        """The no-calendar-row path: find_review_instance is tried with
        candidate_ids = [str(pk), str(mirror.pk)]. An instance for Learner A
        (learner_id = A's profile id = 5301) is found for Learner B's pk 5301."""
        template_id = self.review_a.review_template_id
        template = reviews.get_review_template_row(template_id)
        instance_a = review_instances.ensure_review_instance(
            template, learner_id=self.profile_a.id, learner_kind='', programme_id=PROGRAMME_ID,
            occurrence_number=99, target_date=date(2026, 12, 1), coach_email=COACH_EMAIL,
        )
        generated = {'eventKey': 'generated-p0-key', 'reviewTemplateId': template_id, 'occurrenceNumber': 99}
        with patch.object(learner_calendar, '_generated_cycle_events', return_value=[generated]):
            status, payload = self._learner_review_call(self.account_b, 'GET', pk=self.learner_b.id, event_key='generated-p0-key')
        exposed = (payload.get('instance') or {}).get('id') == instance_a['id']
        self.assertFalse(exposed, f'F3 generated-occurrence path returned Learner A\'s instance to Learner B ({status})')

    # -- valid paths ---------------------------------------------------------

    def test_valid_path_learner_a_views_answers_and_signs_own_review(self):
        status, payload = self._learner_review_call(self.account_a, 'GET', pk=self.learner_a.id, event_key=self.review_a.event_key)
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload['instance']['id'], self.review_a.review_instance_id)
        self._to_in_progress(self.review_a)
        field_id = self._field_ids(self.review_a)['Learner comment']
        status, payload = self._learner_review_call(
            self.account_a, 'POST', pk=self.learner_a.id, event_key=self.review_a.event_key,
            body={'answers': {field_id: 'Learner A comment'}},
        )
        self.assertEqual(status, 200, payload)
        self._coach_complete(self.review_a)
        status, payload = self._learner_sign_call(self.account_a, pk=self.learner_a.id, event_key=self.review_a.event_key)
        self.assertEqual(status, 200, payload)

    def test_valid_path_learner_b_own_review_still_resolves(self):
        review_b = self._scheduled_review(self.profile_b, template_id=self.review_a.review_template_id)
        self.assertEqual(
            learner_calendar._learner_calendar_record('apprenticeship', self.learner_b.id, review_b.event_key),
            review_b,
        )

    # -- Phase 1A regression: the rule is per id space, not per number -------

    def _row(self, event_key, *, learner_id, email, event_type, idempotency_key=None):
        return CoachCalendarEvent.objects.create(
            event_key=event_key, event_type=event_type, owner_email=COACH_EMAIL, owner_name='Coach',
            learner_id=learner_id, learner_name='Synthetic Learner', learner_email=email,
            target_date=date(2026, 10, 1), status=CoachCalendarEvent.STATUS_SCHEDULED,
            idempotency_key=idempotency_key or f'p0:{event_key}',
        )

    def test_f3_review_row_resolves_for_owner_by_profile_id_alone(self):
        """The profile id really is the ownership key: with the email on the
        row out of date, the owner still resolves their Review row."""
        CoachCalendarEvent.objects.filter(pk=self.review_a.pk).update(learner_email='old-address@example.test')
        record = learner_calendar._learner_calendar_record('apprenticeship', self.learner_a.id, self.review_a.event_key)
        self.assertEqual(record, self.review_a)

    def test_f3_onboarding_row_is_matched_on_created_users_id_only(self):
        """The reverse collision. Onboarding rows store Created_users.id:
        Learner A's onboarding row carries 5201. Learner C's PROFILE id is
        5201, so C must not match it -- and A still does."""
        self._learner(created_users_id=5601, profile_id=self.A_CREATED_USERS_ID, email='learner-f3-c@example.test')
        row = self._row('eligibility-review:p0-a', learner_id=self.A_CREATED_USERS_ID,
                        email=self.learner_a.email, event_type='eligibility-review')
        self.assertIsNone(learner_calendar._learner_calendar_record('apprenticeship', 5601, row.event_key))
        self.assertEqual(learner_calendar._learner_calendar_record('apprenticeship', self.learner_a.id, row.event_key), row)

    def test_valid_path_legacy_learner_bookings_resolve_in_either_id_space(self):
        """Learner bookings stored Created_users.id before 2026-09-08 and the
        profile id since; both still belong to their owner (by id, email aside)."""
        before = self._row('catch-up:p0-legacy', learner_id=self.A_CREATED_USERS_ID, email='old-address@example.test',
                           event_type='catch-up', idempotency_key='learner-book:p0-legacy')
        since = self._row('catch-up:p0-current', learner_id=self.A_PROFILE_ID, email='old-address@example.test',
                          event_type='catch-up', idempotency_key='learner-book:p0-current')
        for row in (before, since):
            with self.subTest(event_key=row.event_key):
                self.assertEqual(learner_calendar._learner_calendar_record('apprenticeship', self.learner_a.id, row.event_key), row)


# =============================================================================
# F4  Completed Review signature immutability
# =============================================================================

class F4CompletedSignatureImmutabilityTests(Phase0ReviewTestCase):
    """A completed MCM with advisor, participant and employer signatures.

    record_review_instance_signature accepts status completed and overwrites
    the existing role row. The coach endpoint passes the signature through
    unchecked (blank allowed); the learner and employer endpoints require a
    data:image value. NOTE: coach_api.tests_review_instance_lifecycle_state_
    machine.test_signing_again_after_completed_is_the_existing_documented_
    idempotent_behaviour pins a 200 for a repeat advisor signature -- the
    "repeat" cases below contradict that pinned behaviour on purpose; Phase 1
    needs a business decision on it."""

    def setUp(self):
        super().setUp()
        self._employer(7101, 'employer-f4@example.test')
        self.learner, self.profile = self._learner(created_users_id=5121, profile_id=6121, email='learner-f4@example.test', employer_id=7101)
        self.review = self._scheduled_review(self.profile)
        self._to_awaiting_signature(self.review)
        self.learner_account = self._account('learner', self.learner.id, self.learner.email)
        self.employer_account = self._account('employer', 7101, 'employer-f4@example.test')
        self._sign_all()
        self.review.refresh_from_db()
        self.assertEqual(self._instance(self.review)['status'], review_instances.STATUS_COMPLETED)
        self.before = self._signature_rows(self.review)

    def _sign_all(self):
        status, payload = self._coach_sign(self.review.review_instance_id)
        self.assertEqual(status, 200, payload)
        status, payload = self._learner_sign_call(self.learner_account, pk=self.learner.id, event_key=self.review.event_key)
        self.assertEqual(status, 200, payload)
        status, payload = self._employer_sign(SIGNATURE)
        self.assertEqual(status, 200, payload)

    def _employer_sign(self, signature):
        return self._employer_call(
            self.employer_account, 'POST', employer_id=7101, learner_id=self.learner.id,
            event_key=self.review.event_key, body={'signature': signature, 'name': 'Synthetic Employer'},
        )

    def _assert_immutable(self, role, status, payload, what):
        after = self._signature_rows(self.review)[role]
        self.assertEqual(
            (after['signature'], after['signed_at'], after['signed_name']),
            (self.before[role]['signature'], self.before[role]['signed_at'], self.before[role]['signed_name']),
            f'F4 {what}: completed {role} signature was changed (HTTP {status})',
        )
        self.assertGreaterEqual(status, 400, f'F4 {what}: expected rejection, got {status} {payload}')
        self.assertEqual(self._instance(self.review)['status'], review_instances.STATUS_COMPLETED)

    def _definition(self):
        return review_instances.review_instance_form_definition(self._instance(self.review))

    # -- advisor (coach endpoint) -------------------------------------------

    def test_f4_advisor_replace_characterization(self):
        status, payload = self._coach_sign(self.review.review_instance_id, signature=OTHER_SIGNATURE)
        self._assert_immutable('advisor', status, payload, 'advisor replace')

    def test_f4_advisor_blank_characterization(self):
        status, payload = self._coach_sign(self.review.review_instance_id, signature='')
        self._assert_immutable('advisor', status, payload, 'advisor blank')

    def test_f4_advisor_repeat_characterization(self):
        status, payload = self._coach_sign(self.review.review_instance_id, signature=SIGNATURE)
        self._assert_immutable('advisor', status, payload, 'advisor repeat')

    # -- participant (learner endpoint) -------------------------------------

    def test_f4_participant_replace_characterization(self):
        status, payload = self._learner_sign_call(
            self.learner_account, pk=self.learner.id, event_key=self.review.event_key, signature=OTHER_SIGNATURE)
        self._assert_immutable('participant', status, payload, 'participant replace')

    def test_f4_participant_blank_characterization(self):
        status, payload = self._learner_sign_call(
            self.learner_account, pk=self.learner.id, event_key=self.review.event_key, signature='')
        self._assert_immutable('participant', status, payload, 'participant blank')

    def test_f4_participant_repeat_characterization(self):
        status, payload = self._learner_sign_call(self.learner_account, pk=self.learner.id, event_key=self.review.event_key)
        self._assert_immutable('participant', status, payload, 'participant repeat')

    # -- employer (employer endpoint) ---------------------------------------

    def test_f4_employer_replace_characterization(self):
        status, payload = self._employer_sign(OTHER_SIGNATURE)
        self._assert_immutable('employer', status, payload, 'employer replace')

    def test_f4_employer_blank_characterization(self):
        status, payload = self._employer_sign('')
        self._assert_immutable('employer', status, payload, 'employer blank')

    def test_f4_employer_repeat_characterization(self):
        status, payload = self._employer_sign(SIGNATURE)
        self._assert_immutable('employer', status, payload, 'employer repeat')

    # -- PDF eligibility ----------------------------------------------------

    def test_f4_pdf_stays_available_after_blank_attempt_characterization(self):
        self.assertTrue(pdf_availability(self._definition())['available'])
        self._coach_sign(self.review.review_instance_id, signature='')
        after = pdf_availability(self._definition())
        self.assertTrue(after['available'], f'F4 blanking the advisor signature made the completed PDF unavailable: {after}')

    # -- valid paths --------------------------------------------------------

    def test_valid_path_completed_review_is_readable_and_pdf_available(self):
        definition = self._definition()
        self.assertEqual(definition['instance']['status'], review_instances.STATUS_COMPLETED)
        self.assertTrue(pdf_availability(definition)['available'])
        status, payload = self._learner_review_call(self.learner_account, 'GET', pk=self.learner.id, event_key=self.review.event_key)
        self.assertEqual(status, 200, payload)
        status, payload = self._employer_call(
            self.employer_account, 'GET', employer_id=7101, learner_id=self.learner.id, event_key=self.review.event_key)
        self.assertEqual(status, 200, payload)
        status, payload = self._coach_call(coach_views.coach_review_instance_detail, self.review.review_instance_id)
        self.assertEqual(status, 200, payload)


# =============================================================================
# F5  Sign vs reopen
# =============================================================================

class F5SignReopenTests(Phase0ReviewTestCase):
    """What SQLite CAN prove: record_review_instance_signature checks the
    status of the row its CALLER read and never re-reads it under a lock,
    while reopen_review_instance_for_editing locks and re-checks. So a sign
    request that read the instance before a reopen committed still writes its
    signature afterwards. This test replays exactly that ordering
    deterministically (Request A reads -> Request B reopens and commits ->
    Request A writes); it does not need concurrent connections.

    What SQLite CANNOT prove: get_review_instance(for_update=True) is a no-op
    on SQLite (no SELECT ... FOR UPDATE), so true in-flight interleaving and
    lock waits are not represented here. See the Phase 1 Postgres test spec
    in the Phase 0 report."""

    def setUp(self):
        super().setUp()
        self.learner, self.profile = self._learner(created_users_id=5131, profile_id=6131, email='learner-f5@example.test')
        self.review = self._scheduled_review(
            self.profile, signatures={'advisor': True, 'employer': False, 'participant': True, 'referrer': False},
        )
        self._to_awaiting_signature(self.review)
        status, payload = self._coach_sign(self.review.review_instance_id)
        self.assertEqual(status, 200, payload)

    def test_f5_stale_sign_after_committed_reopen_leaves_no_signature_characterization(self):
        stale_read_by_request_a = self._instance(self.review)
        self.assertEqual(stale_read_by_request_a['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        ok, result = review_instances.reopen_review_instance_for_editing(
            self._instance(self.review), reason_code='correction-required', note='Phase 0 correction', actor=COACH_EMAIL,
        )
        self.assertTrue(ok, result)
        self.assertEqual(self._instance(self.review)['status'], review_instances.STATUS_IN_PROGRESS)

        error = None
        try:
            review_instances.record_review_instance_signature(
                stale_read_by_request_a, 'participant',
                signed_by=self.learner.email, signed_name='Synthetic Learner', signature=SIGNATURE,
                actor=self.learner.email,
            )
        except ValueError as exc:
            error = exc

        instance = self._instance(self.review)
        signed = sorted(role for role, row in self._signature_rows(self.review).items() if row.get('signed_at'))
        self.review.refresh_from_db()
        observed = (instance['status'], self.review.status, signed)
        self.assertEqual(
            observed, (review_instances.STATUS_IN_PROGRESS, CoachCalendarEvent.STATUS_IN_PROGRESS, []),
            f'F5 after a committed reopen, a sign request that read the review earlier left '
            f'(instance status, calendar status, signed roles) = {observed} (raised={error!r})',
        )

    def test_valid_path_reopen_clears_signatures_and_allows_recompletion(self):
        ok, result = review_instances.reopen_review_instance_for_editing(
            self._instance(self.review), reason_code='correction-required', note='Phase 0 correction', actor=COACH_EMAIL,
        )
        self.assertTrue(ok, result)
        self.assertFalse(any(row.get('signed_at') for row in self._signature_rows(self.review).values()))
        self._coach_complete(self.review)
        self.assertEqual(self._instance(self.review)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

    def test_valid_path_fresh_sign_after_reopen_is_rejected(self):
        review_instances.reopen_review_instance_for_editing(
            self._instance(self.review), reason_code='correction-required', note='Phase 0 correction', actor=COACH_EMAIL,
        )
        with self.assertRaises(ValueError):
            review_instances.record_review_instance_signature(
                self._instance(self.review), 'participant',
                signed_by=self.learner.email, signed_name='Synthetic Learner', signature=SIGNATURE,
            )


# =============================================================================
# F12  Impossible signature configurations
# =============================================================================

class F12SignatureConfigurationTests(Phase0ReviewTestCase):
    """A role that must sign but cannot see the Review. The Referrer-only guard
    from the previous change is covered by curriculum_api.tests_reviews
    .ReviewReferrerSignatureGuardTests; it is re-asserted here only as a
    regression anchor, not re-implemented."""

    def _payload(self, role, *, signature, visible):
        signatures = {'advisor': False, 'employer': False, 'participant': False, 'referrer': False, role: signature}
        visible_to = dict(ALL_VISIBLE, **{role: visible})
        return {
            'name': f'F12 {role}', 'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code('progress_review')['id'],
            'recurrence': {'interval': 12, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [], 'signatures': signatures, 'visibleTo': visible_to,
            'sections': [{'title': 'General', 'fields': [{'title': 'Notes', 'fieldType': 'text', 'required': False}]}],
        }

    def _post(self, payload):
        response = self.client.post(
            f'/curriculum_api/curriculum/programmes/{PROGRAMME_ID}/reviews/',
            data=json.dumps(payload), content_type='application/json',
        )
        return response.status_code, response.json()

    def _assert_rejected(self, role):
        status, body = self._post(self._payload(role, signature=True, visible=False))
        self.assertEqual(status, 400, f'F12 template requiring a {role} signature while hidden from {role} was accepted: {status}')
        self.assertIn('signatures', body.get('fields', {}))

    def test_f12_advisor_required_but_not_visible_characterization(self):
        self._assert_rejected('advisor')

    def test_f12_employer_required_but_not_visible_characterization(self):
        self._assert_rejected('employer')

    def test_f12_participant_required_but_not_visible_characterization(self):
        self._assert_rejected('participant')

    def test_f12_referrer_new_required_signature_is_rejected(self):
        status, body = self._post(self._payload('referrer', signature=True, visible=True))
        self.assertEqual(status, 400, body)
        self.assertEqual(body['fields']['signatures'], 'Referrer signatures are not currently supported.')

    def test_f12_employer_required_but_hidden_review_cannot_be_signed_characterization(self):
        """End to end: the hidden-but-required employer can never sign, so the
        Review would sit in awaiting-signature forever. Target: such a template
        can never reach a Review Instance (creation rejected above)."""
        self._employer(7201, 'employer-f12@example.test')
        learner, profile = self._learner(created_users_id=5141, profile_id=6141, email='learner-f12@example.test', employer_id=7201)
        payload = self._payload('employer', signature=True, visible=False)
        payload['reviewTypeId'] = review_types.get_review_type_by_code('mcm')['id']
        payload['sections'] = [{'title': 'General', 'fields': [
            {'title': 'Coach notes', 'fieldType': 'text_multiline', 'required': True}]}]
        template_id, errors = reviews.create_review(PROGRAMME_ID, payload, actor='test')
        if errors:
            return  # target behaviour: the impossible template never exists
        review = self._scheduled_review(profile, template_id=template_id)
        self._to_awaiting_signature(review)
        status, body = self._employer_call(
            self._account('employer', 7201, 'employer-f12@example.test'), 'POST', employer_id=7201,
            learner_id=learner.id, event_key=review.event_key, body={'signature': SIGNATURE, 'name': 'Employer'},
        )
        self.assertEqual(
            status, 200,
            f'F12 the only required signer (employer) cannot sign: HTTP {status} {body}; '
            f'review left in {self._instance(review)["status"]!r}',
        )

    # -- valid paths --------------------------------------------------------

    def test_valid_path_required_and_visible_roles_are_accepted(self):
        for role in ('advisor', 'employer', 'participant'):
            with self.subTest(role=role):
                status, body = self._post(self._payload(role, signature=True, visible=True))
                self.assertEqual(status, 200, body)
                self.assertTrue(body['review']['signatures'][role])

    def test_valid_path_hidden_role_that_need_not_sign_is_accepted(self):
        for role in ('employer', 'participant'):
            with self.subTest(role=role):
                status, body = self._post(self._payload(role, signature=False, visible=False))
                self.assertEqual(status, 200, body)


# =============================================================================
# Coach ownership (valid-path guard for Phase 1)
# =============================================================================

class CoachOwnershipValidPathTests(Phase0ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.learner, self.profile = self._learner(created_users_id=5151, profile_id=6151, email='learner-coach@example.test')
        self.review = self._scheduled_review(
            self.profile, signatures={'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
        )

    def test_valid_path_owning_coach_reads_and_signs(self):
        status, payload = self._coach_call(coach_views.coach_review_instance_detail, self.review.review_instance_id)
        self.assertEqual(status, 200, payload)
        self._to_awaiting_signature(self.review)
        status, payload = self._coach_sign(self.review.review_instance_id)
        self.assertEqual(status, 200, payload)
        self.assertEqual(self._instance(self.review)['status'], review_instances.STATUS_COMPLETED)

    def test_other_coach_cannot_read_or_sign(self):
        status, payload = self._coach_call(
            coach_views.coach_review_instance_detail, self.review.review_instance_id, owner_email=OTHER_COACH_EMAIL)
        self.assertEqual(status, 404, payload)
        self._to_awaiting_signature(self.review)
        status, payload = self._coach_sign(self.review.review_instance_id, owner_email=OTHER_COACH_EMAIL)
        self.assertEqual(status, 404, payload)
        self.assertFalse(self._signature_rows(self.review).get('advisor', {}).get('signed_at'))
