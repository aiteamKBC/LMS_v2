"""Synthetic attendance links: pure projections, real isolated ORM, and role/CSRF gates.

Database tests require the two Coach tables in a verified disposable database.
Never run schema setup against a business database.
"""
import json
from copy import deepcopy
from datetime import date, time
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.test import RequestFactory, SimpleTestCase, TestCase
from django.utils import timezone

from . import review_attendance_links as api
from .models import CoachCalendarEvent, ReviewAttendanceLink


def snapshot():
    person = {'id': 'person-1', 'reportId': 'report-1', 'email': 'alternate@example.invalid',
              'displayName': 'Alternate account', 'attended': True, 'totalAttendanceSeconds': 1200,
              'intervals': [{'joinDateTime': '2026-10-27T10:00:00Z', 'leaveDateTime': '2026-10-27T10:20:00Z'}]}
    learner = {'id': 'learner:student@example.invalid', 'role': 'learner', 'name': 'Synthetic learner',
               'displayName': 'Synthetic learner', 'email': 'student@example.invalid', 'expected': True,
               'attended': False, 'status': 'absent', 'totalAttendanceSeconds': 0}
    extra = {**person, 'role': 'attendee', 'name': person['displayName'], 'expected': False, 'status': 'extra',
             'actualRecordIds': ['person-1'], 'reportIds': ['report-1']}
    attendance = {'reports': [{'id': 'report-1', 'meetingStartDateTime': '2026-10-27T10:00:00Z',
                              'meetingEndDateTime': '2026-10-27T11:00:00Z', 'records': [person]}],
                  'records': [person], 'tracker': [learner, extra], 'reportCount': 1,
                  'expectedAttendees': [learner], 'expectedCount': 1, 'expectedAttendedCount': 0,
                  'expectedAbsentCount': 1, 'extraCount': 1}
    return {'attendance': attendance, 'storage': {'stored': True}, 'partial': False, 'artifacts': []}


def booking(**overrides):
    return CoachCalendarEvent(pk=1, event_key='mcr:21:1', learner_id=21, owner_email='coach@example.invalid',
        learner_name='Synthetic learner', learner_email='student@example.invalid', event_type='mcr',
        target_date=date(2026, 10, 27), scheduled_date=date(2026, 10, 27), scheduled_time=time(10),
        graph_event_id='graph-event-1', graph_organizer_email='coach@example.invalid',
        status=overrides.pop('status', 'scheduled'), **overrides)


def link_for(record, attendance, **overrides):
    evidence = api.participant_evidence(attendance, attendance['tracker'][1])
    return SimpleNamespace(**({'pk': 1, 'learner_id': record.learner_id,
        'session_key': api.session_key(record, attendance), 'participant_key': api.digest(evidence),
        'evidence': evidence, 'reason': 'Joined with alternate account',
        'confirmed_by': 'coach@example.invalid', 'confirmed_at': timezone.now(),
        'revoked_at': None, 'revoked_by': '', 'revoke_reason': ''} | overrides))


class AttendanceLinkProjectionTests(SimpleTestCase):
    def test_links_without_changing_raw_report_and_counts_person_once(self):
        record, attendance = booking(), snapshot()['attendance']
        original = deepcopy(attendance)
        result = api.project_attendance(record, attendance, [link_for(record, attendance)])
        self.assertEqual(attendance, original)
        self.assertEqual(result['reports'], original['reports'])
        self.assertEqual(result['records'], original['records'])
        self.assertEqual(result['expectedAttendedCount'], 1)
        self.assertEqual(result['expectedAbsentCount'], 0)
        self.assertEqual(result['extraCount'], 0)
        self.assertEqual(result['tracker'][0]['totalAttendanceSeconds'], 1200)
        self.assertEqual(result['tracker'][0]['coachVerification']['confirmedBy'], 'coach@example.invalid')

    def test_other_learner_or_rebooked_session_cannot_inherit_link(self):
        record, attendance = booking(), snapshot()['attendance']
        link = link_for(record, attendance)
        for field, value in [('learner_id', 22), ('graph_event_id', 'replacement'), ('scheduled_date', date(2026, 11, 1))]:
            other = booking(); setattr(other, field, value)
            self.assertFalse(api.project_attendance(other, attendance, [link])['tracker'][0]['attended'])

    def test_undo_restores_original_absence_and_extra(self):
        record, attendance = booking(), snapshot()['attendance']
        result = api.project_attendance(record, attendance, [link_for(record, attendance, revoked_at=timezone.now())])
        self.assertEqual(result['extraCount'], 1)
        self.assertEqual(result['expectedAbsentCount'], 1)

    def test_changed_evidence_is_flagged_instead_of_silently_crediting(self):
        record, attendance = booking(), snapshot()['attendance']
        link = link_for(record, attendance)
        attendance['reports'][0]['records'][0]['email'] = 'different@example.invalid'
        result = api.project_attendance(record, attendance, [link])
        self.assertIn('linkWarning', result)
        self.assertFalse(result['tracker'][0]['attended'])

    def test_positive_duration_and_unambiguous_report_required(self):
        for change in ({'attended': False}, {'intervals': [], 'totalAttendanceSeconds': 0}):
            attendance = snapshot()['attendance']; attendance['reports'][0]['records'][0].update(change)
            with self.assertRaises(api.LinkConflict):
                api.participant_evidence(attendance, attendance['tracker'][1])
        attendance = snapshot()['attendance']; attendance['tracker'][1]['reportIds'].append('different-session')
        with self.assertRaises(api.LinkConflict):
            api.participant_evidence(attendance, attendance['tracker'][1])

    def test_overlapping_reconnects_are_unioned(self):
        person = snapshot()['attendance']['records'][0]
        other = deepcopy(person)
        other['intervals'] = [{'joinDateTime': '2026-10-27T10:10:00Z', 'leaveDateTime': '2026-10-27T10:30:00Z'}]
        self.assertEqual(api.attendance_seconds([person, other]), 1800)
        other['intervals'] = []
        with self.assertRaises(api.LinkConflict): api.attendance_seconds([person, other])

    def test_missing_or_duplicate_identity_never_becomes_a_candidate(self):
        snap = snapshot(); snap['attendance']['tracker'][1]['actualRecordIds'] = ['missing']
        self.assertEqual(api.context_payload(booking(), snap, [])['candidates'], [])

    def test_imported_link_uses_existing_ownership_and_locked_booking_resolution(self):
        request = RequestFactory().get('/'); request.coach_email = 'coach@example.invalid'
        record, overlay = booking(), SimpleNamespace(meeting_intelligence={})
        with patch('coach_api.migrated_intelligence_views._association', return_value=(overlay, record, {})) as resolve:
            self.assertEqual(api.owned_context(request, 'imported-review:synthetic', lock=True), (record, overlay))
            resolve.assert_called_once_with(request, 'imported-review:synthetic', lock=True)
        record.owner_email = 'other@example.invalid'
        with patch('coach_api.migrated_intelligence_views._association', return_value=(overlay, record, {})):
            self.assertEqual(api.owned_context(request, 'imported-review:synthetic'), (None, None))

    def test_imported_snapshot_preserves_bound_session_selection(self):
        record, overlay = booking(), SimpleNamespace(meeting_intelligence={'actualSession': {'id': 'saved-call'}})
        raw, scoped, context = snapshot(), snapshot(), {'reportId': 'report-1'}
        with patch('coach_api.views.stored_coach_meeting_snapshot', return_value=raw), \
             patch('coach_api.migrated_session_scope.has_verified_meeting_evidence', return_value=False), \
             patch('coach_api.bound_actual_session.bound_session', return_value=SimpleNamespace(context=context)), \
             patch('coach_api.migrated_session_scope.scope_snapshot', return_value=scoped) as scope:
            self.assertIs(api.scoped_snapshot(record, overlay), scoped)
            scope.assert_called_once_with(record, raw, session=context, meeting_scoped=False)
        with patch('coach_api.views.stored_coach_meeting_snapshot', return_value=raw), \
             patch('coach_api.migrated_session_scope.has_verified_meeting_evidence', return_value=False), \
             patch('coach_api.bound_actual_session.bound_session', return_value=None):
            with self.assertRaises(api.LinkConflict): api.scoped_snapshot(record, overlay)
        snap = snapshot(); snap['attendance']['tracker'].append(deepcopy(snap['attendance']['tracker'][0]))
        self.assertEqual(api.context_payload(booking(), snap, [])['candidates'], [])


class AttendanceLinkStorageTests(TestCase):
    databases = {'default'}

    def setUp(self):
        self.record = booking(); self.record.save(force_insert=True)
        self.snap = snapshot()
        self.factory = RequestFactory()
        self.raw_snapshot = patch('coach_api.views.stored_coach_meeting_snapshot', side_effect=lambda _: deepcopy(self.snap))
        self.raw_snapshot.start(); self.addCleanup(self.raw_snapshot.stop)

    def request(self, payload=None, owner='coach@example.invalid'):
        request = self.factory.get('/') if payload is None else self.factory.post('/', json.dumps(payload), content_type='application/json')
        request.coach_email = owner
        return unwrap(api.review_attendance_links)(request, self.record.event_key)

    def body(self):
        return json.loads(self.request().content)

    def change(self, **overrides):
        data = self.body()
        return {'action': 'link', 'version': data['version'], 'participantKey': data['candidates'][0]['key'],
                'learnerId': 21, 'reason': 'Learner used another account', **overrides}

    def test_get_has_no_persistence_or_provider_requests(self):
        before = list(CoachCalendarEvent.objects.values())
        with patch('coach_api.views.microsoft_graph_request', side_effect=AssertionError('No Graph')):
            self.assertEqual(self.request().status_code, 200)
        self.assertEqual(before, list(CoachCalendarEvent.objects.values()))
        self.assertEqual(ReviewAttendanceLink.objects.count(), 0)

    def test_link_reload_and_undo_keep_audit_and_original_business_fields(self):
        before = list(CoachCalendarEvent.objects.values()); original = deepcopy(self.snap)
        self.assertEqual(self.request(self.change()).status_code, 200)
        data = self.body()
        self.assertTrue(data['attendance']['tracker'][0]['attended'])
        link = ReviewAttendanceLink.objects.get()
        self.assertEqual(link.confirmed_by, 'coach@example.invalid')
        evidence = deepcopy(link.evidence)
        response = self.request({'action': 'undo', 'linkId': link.pk, 'version': data['version'], 'reason': 'Incorrect participant selected'})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.body()['attendance']['tracker'][0]['attended'])
        link.refresh_from_db(); self.assertIsNotNone(link.revoked_at)
        self.assertEqual(link.evidence, evidence)
        self.assertEqual(link.revoke_reason, 'Incorrect participant selected')
        self.assertEqual(self.snap, original)
        self.assertEqual(before, list(CoachCalendarEvent.objects.values()))

    def test_portal_resource_reader_uses_same_saved_link_without_writes(self):
        from learner_api.imported_meeting_resources import stored_resources
        self.assertEqual(self.request(self.change()).status_code, 200)
        before = list(ReviewAttendanceLink.objects.values())
        original = deepcopy(self.snap)
        self.snap.update(errors=[])
        with patch('learner_api.imported_meeting_resources._bound_resources', side_effect=lambda record, snap: snap):
            response = stored_resources(self.record, include_attendance=True)
        result = json.loads(response.content)
        self.assertTrue(result['attendance']['tracker'][0]['attended'])
        self.assertEqual(result['attendance']['tracker'][0]['totalAttendanceSeconds'], 1200)
        self.assertEqual(result['attendance']['reports'], original['attendance']['reports'])
        self.assertEqual(before, list(ReviewAttendanceLink.objects.values()))

    def test_duplicate_click_or_stale_report_does_not_create_second_link(self):
        data = self.change()
        self.assertEqual(self.request(data).status_code, 200)
        self.assertEqual(self.request(data).status_code, 409)
        self.assertEqual(ReviewAttendanceLink.objects.count(), 1)

    def test_snapshot_changed_before_confirm_is_conflict(self):
        data = self.change(); self.snap['attendance']['reports'][0]['records'][0]['totalAttendanceSeconds'] = 1000
        self.assertEqual(self.request(data).status_code, 409)
        self.assertEqual(ReviewAttendanceLink.objects.count(), 0)

    def test_wrong_employer_identity_tampering_and_missing_reason_are_rejected(self):
        self.assertEqual(self.request(self.change(), owner='another-coach@example.invalid').status_code, 404)
        self.assertEqual(self.request(self.change(learnerId=22)).status_code, 400)
        self.assertEqual(self.request(self.change(reason='')).status_code, 400)
        self.assertEqual(self.request(self.change(participantKey='forged')).status_code, 409)
        self.assertEqual(ReviewAttendanceLink.objects.count(), 0)

    def test_database_unique_constraint_prevents_duplicate_active_links(self):
        self.request(self.change()); link = ReviewAttendanceLink.objects.get()
        values = {field: getattr(link, field) for field in ['calendar_event_id', 'learner_id', 'session_key', 'participant_key', 'evidence', 'reason', 'confirmed_by']}
        with self.assertRaises(IntegrityError), transaction.atomic():
            ReviewAttendanceLink.objects.create(**values)

    def test_completed_review_signatures_and_status_remain_unchanged(self):
        self.record.status = 'completed'; self.record.manager_signed_at = timezone.now(); self.record.save()
        before = list(CoachCalendarEvent.objects.values())
        self.assertEqual(self.request(self.change()).status_code, 200)
        self.assertEqual(before, list(CoachCalendarEvent.objects.values()))

    def test_partial_storage_is_not_accepted(self):
        self.snap['partial'] = True
        self.assertEqual(self.request().status_code, 409)
        self.assertEqual(ReviewAttendanceLink.objects.count(), 0)

    def add_employer(self):
        learner = deepcopy(self.snap['attendance']['tracker'][0])
        learner.update(id='employer:manager@example.invalid', role='employer',
                       email='manager@example.invalid', name='Example employer', displayName='Example employer')
        self.snap['attendance']['tracker'].append(learner)
        return next(t['key'] for t in self.body()['targets'] if t['role'] == 'employer')

    def test_employer_link_reload_and_undo_leave_learner_and_raw_evidence_unchanged(self):
        key = self.add_employer(); raw = deepcopy(self.snap)
        self.assertEqual(self.request(self.change(targetKey=key)).status_code, 200)
        data = self.body(); rows = data['attendance']['tracker']
        self.assertFalse(next(r for r in rows if r['role'] == 'learner')['attended'])
        self.assertTrue(next(r for r in rows if r['role'] == 'employer')['attended'])
        link = ReviewAttendanceLink.objects.get()
        self.assertEqual((link.target_role, link.target_name), ('employer', 'Example employer'))
        self.assertEqual(link.learner_id, self.record.learner_id)
        self.assertEqual(data['activeLinks'][0]['targetRole'], 'employer')
        self.assertEqual(self.snap, raw)
        response = self.request({'action': 'undo', 'linkId': link.pk, 'version': data['version'], 'reason': 'Incorrect account'})
        self.assertEqual(response.status_code, 200)
        restored = self.body()
        self.assertIn(key, [t['key'] for t in restored['targets']])
        self.assertFalse(next(r for r in restored['attendance']['tracker'] if r['role'] == 'employer')['attended'])
        self.assertEqual(restored['history'][0]['targetRole'], 'employer')

    def test_learner_and_employer_can_link_distinct_participants_but_cannot_reuse_one(self):
        employer = self.add_employer()
        raw = self.snap['attendance']
        person = deepcopy(raw['reports'][0]['records'][0]); person['id'] = 'person-2'
        person['email'] = 'second@example.invalid'
        raw['reports'][0]['records'].append(person); raw['records'].append(person)
        extra = deepcopy(raw['tracker'][1]); extra.update(id='extra-2', actualRecordIds=['person-2'])
        raw['tracker'].append(extra)
        first = self.change()
        self.assertEqual(self.request(first).status_code, 200)  # old learner-only client remains supported
        data = self.body()
        self.assertEqual([t['role'] for t in data['targets']], ['employer'])
        forged = {**first, 'targetKey': employer, 'version': data['version']}
        self.assertEqual(self.request(forged).status_code, 409)
        self.assertEqual(self.request(self.change(targetKey=employer)).status_code, 200)
        data = self.body()
        self.assertEqual(data['attendance']['expectedAttendedCount'], 2)
        self.assertEqual(data['attendance']['extraCount'], 0)
        self.assertEqual(data['targets'], [])
        self.assertEqual(ReviewAttendanceLink.objects.count(), 2)
        employer_link = ReviewAttendanceLink.objects.get(target_role='employer')
        self.request({'action': 'undo', 'linkId': employer_link.pk, 'version': data['version'], 'reason': 'Wrong manager'})
        rows = self.body()['attendance']['tracker']
        self.assertTrue(next(r for r in rows if r['role'] == 'learner')['attended'])
        self.assertFalse(next(r for r in rows if r['role'] == 'employer')['attended'])

    def test_unknown_attended_or_changed_employer_is_not_silently_credited(self):
        self.assertEqual(self.request(self.change(targetKey='another-employer')).status_code, 409)
        key = self.add_employer()
        self.snap['attendance']['tracker'][-1]['attended'] = True
        self.assertEqual(self.request(self.change(targetKey=key)).status_code, 409)
        self.snap['attendance']['tracker'][-1]['attended'] = False
        self.assertEqual(self.request(self.change(targetKey=key)).status_code, 200)
        self.snap['attendance']['tracker'][-1]['email'] = 'replacement@example.invalid'
        data = self.body()
        self.assertIn('linkWarning', data['attendance'])
        self.assertFalse(next(r for r in data['attendance']['tracker'] if r['role'] == 'employer')['attended'])

    def test_database_prevents_reusing_participant_for_second_target(self):
        key = self.add_employer()
        self.request(self.change()); link = ReviewAttendanceLink.objects.get()
        link.pk = None; link.target_key = key; link.target_role = 'employer'
        with self.assertRaises(IntegrityError), transaction.atomic():
            link.save(force_insert=True)


class AttendanceLinkAuthorizationTests(SimpleTestCase):
    def call(self, role='staff', access='coach', csrf=True, query='', method='POST'):
        request = RequestFactory().generic(method, '/' + query, '{}', content_type='application/json')
        if csrf:
            request.META['HTTP_X_CSRFTOKEN'] = get_token(request)
            request.COOKIES['csrftoken'] = request.META['CSRF_COOKIE']
        account = SimpleNamespace(role=role, subject_type='staff' if role in {'admin', 'staff'} else role, subject_id=1)
        request.login_account = account
        staff = SimpleNamespace(id=1, email='coach@example.invalid', access=access, username='Synthetic coach')
        with patch('login.permissions.authenticate_request', return_value=account if role else None), \
             patch('login.permissions._accesses_of', return_value={access}), \
             patch('coach_api.auth.StaffUser.objects') as people, \
             patch('coach_api.auth._staff_access', return_value=access), \
             patch.object(api, 'owned_context', return_value=(None, None)) as context:
            people.filter.return_value.only.return_value.first.return_value = staff
            response = api.review_attendance_links(request, 'mcr:21:1')
        return response.status_code, context.called

    def test_unauthenticated_learner_and_employer_are_refused(self):
        for role, status in [(None, 401), ('learner', 403), ('employer', 403)]:
            self.assertEqual(self.call(role=role), (status, False))

    def test_view_as_cannot_write(self):
        self.assertEqual(self.call(role='admin', access='super-admin', query='?viewAsCoach=coach@example.invalid'), (403, False))

    def test_csrf_is_required_for_authorised_coach(self):
        self.assertEqual(self.call(csrf=False), (403, False))
        self.assertEqual(self.call(csrf=True), (404, True))

    def test_other_staff_role_is_refused(self):
        self.assertEqual(self.call(access='tutor'), (403, False))
