"""Issued-certificate administration; use validate_certificates_no_io.py."""
from copy import deepcopy
from contextlib import nullcontext
from datetime import datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import admin_certificates as api
from learner_api import certificates


class IssuedCertificateAdminTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role='admin', email='admin@example.invalid')
        def authenticate(request):
            request.login_account = self.account
            return self.account
        self.enterContext(patch('login.permissions.authenticate_request', side_effect=authenticate))
        self.cursor = MagicMock()
        self.connection = MagicMock()
        self.connection.cursor.return_value.__enter__.return_value = self.cursor
        self.enterContext(patch.object(api, 'connections', {'enrolment': self.connection}))
        self.atomic = self.enterContext(patch.object(api.transaction, 'atomic', side_effect=lambda **kwargs: nullcontext()))
        self.at = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
        self.enterContext(patch.object(api.timezone, 'now', return_value=self.at))
        self.snapshot = dict(learner=dict(id='7', name='Original name', email='learner@example.invalid', programme='Programme'),
                             moduleTitle='Original course', certificateTitle='Achievement', bodyText='Original text',
                             layoutConfig=dict(instructorName='Tutor', primaryColor='#112233', backgroundImageUrl='data:image/png;base64,AAAA'),
                             trackableDone=4, trackableTotal=5, minimumProgress=80, customField='keep')
        self.row = (11, 'KBC-TEST', 1, 3, 80, self.snapshot, self.at, 'old-pdf', 'stable-token', 'free:FC-1', 'Original course',
                    'issued', 'commercial', 'Template title', 'Template body', {}, None, '', 7)
        self.cursor.fetchone.return_value = self.row
        self.cursor.fetchall.return_value = []
        self.source = self.enterContext(patch.object(certificates, '_load_source', return_value=SimpleNamespace(
            id=7, pk=7, username='Original name', programme='Programme')))
        self.template = self.enterContext(patch.object(certificates, '_published_template', return_value=(
            1, 3, 'Achievement', 'Original text', 80, False, deepcopy(self.snapshot['layoutConfig']))))
        self.progress = self.enterContext(patch.object(certificates, 'course_progress', return_value=dict(
            moduleTitle='Original course', progressPercent=80, trackableDone=4, trackableTotal=5)))
        self.enterContext(patch.object(certificates, 'build_learner_detail', return_value={
            'name': 'Original name', 'programme': 'Programme'}))

    def request(self, body=None, method='POST', header=True, pk=11):
        req = self.factory.generic(method, '/', data=json.dumps(body or {}), content_type='application/json',
                                   **({'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'} if header else {}))
        return api.issued_certificate(req, certificate_id=pk)

    def body(self, **overrides):
        return dict(action='correct', revision=1, reason='Spelling correction', changes={'learnerName': 'Corrected name'}, **overrides)

    def writes(self):
        return [c for c in self.cursor.execute.call_args_list if c.args[0].lstrip().startswith(('UPDATE', 'INSERT'))]

    def test_only_admin_may_read_list_detail_or_mutate(self):
        for role in ('learner', 'staff', 'coach', 'employer', None):
            self.account = SimpleNamespace(role=role) if role else None
            for method in ('GET', 'POST'):
                self.assertIn(self.request(self.body(), method=method).status_code, (401, 403))
            self.assertIn(api.issued_certificates(self.factory.get('/')).status_code, (401, 403))
        self.connection.cursor.assert_not_called()

    def test_requires_csrf_header_and_refuses_uneditable_values_before_database(self):
        self.assertEqual(self.request(self.body(), header=False).status_code, 403)
        for changes in ({'progressPercent': 100}, {'otjHours': 100}, {'issuedAt': '2030-01-01'}, {'learnerId': 8},
                        {'verificationToken': 'replacement'}, {'layoutConfig': {}}, {'learnerName': ''}, {'title': 'X' * 201}):
            body = self.body(); body['changes'] = changes
            self.assertEqual(self.request(body).status_code, 400)
        for reason in ('', '   ', None, 'x' * 1001):
            body = self.body(); body['reason'] = reason
            self.assertEqual(self.request(body).status_code, 400)
        for revision in (None, 0, True, '1'):
            body = self.body(); body['revision'] = revision
            self.assertEqual(self.request(body).status_code, 400)
        self.connection.cursor.assert_not_called()

    def test_get_returns_original_copy_and_history_without_mutation(self):
        response = self.request(method='GET')
        cert = json.loads(response.content)['certificate']
        self.assertEqual(cert['editable']['learnerName'], 'Original name')
        self.assertEqual(cert['revision'], 1)
        self.assertEqual(cert['verificationUrl'], '/verify-certificate/stable-token')
        self.assertEqual(self.writes(), [])
        self.assertIn('no-store', response['Cache-Control'])

    def test_correction_is_scoped_keeps_history_and_preserves_identity_dates_and_progress(self):
        after = list(deepcopy(self.row))
        after[5].update(certificateRevision=2, correctedAt=self.at.isoformat())
        after[5]['certificateOverrides'] = {'learnerName': 'Corrected name'}
        after[5]['learner']['name'] = 'Corrected name'
        after[7] = ''
        self.cursor.fetchone.side_effect = [self.row, tuple(after)]
        response = self.request(self.body())
        self.assertEqual(response.status_code, 200)
        result = json.loads(response.content)['certificate']
        self.assertEqual(result['revision'], 2)
        self.assertEqual(result['issuedAt'], self.at.isoformat())
        self.assertEqual(result['verificationToken'], 'stable-token')
        self.assertEqual(result['progressPercent'], 80)
        writes = self.writes()
        self.assertEqual(len(writes), 2)
        sql, values = writes[0].args
        self.assertIn('WHERE id=%s', sql)
        self.assertEqual(values[-1], 11)
        saved = json.loads(values[0])
        self.assertEqual(saved['learner']['name'], 'Corrected name')
        for key in ('trackableDone', 'trackableTotal', 'minimumProgress', 'customField', 'layoutConfig'):
            self.assertEqual(saved[key], self.snapshot[key])
        self.assertEqual(saved['learner']['email'], self.snapshot['learner']['email'])
        audit = json.loads(writes[1].args[1][-1])
        self.assertEqual(audit['storedBefore']['snapshot'], self.snapshot)
        self.assertEqual(audit['after']['editable']['learnerName'], 'Corrected name')
        self.assertEqual(audit['reason'], 'Spelling correction')
        self.assertEqual(writes[1].args[1][0], 'admin@example.invalid')
        self.assertEqual(audit['changedFields'], ['learnerName'])
        self.assertEqual(saved['certificateOverrides'], {'learnerName': 'Corrected name'})
        self.assertIn('FOR UPDATE OF lc', self.cursor.execute.call_args_list[0].args[0])
        self.atomic.assert_called_once_with(using='enrolment')
        self.assertNotIn('certificate_templates', sql)
        self.assertNotIn('correctedBy', saved)  # Private actor/reason live only in the admin audit log.

    def test_partial_course_and_signatory_correction_preserves_artwork_and_other_fields(self):
        body = self.body(); body['changes'] = {'courseTitle': 'Correct course', 'instructorName': ''}
        self.assertEqual(self.request(body).status_code, 200)
        values = self.writes()[0].args[1]
        saved = json.loads(values[0])
        self.assertEqual(values[1], 'Correct course')
        self.assertEqual(saved['moduleTitle'], 'Correct course')
        self.assertEqual(saved['layoutConfig']['instructorName'], '')
        self.assertEqual(saved['layoutConfig']['backgroundImageUrl'], self.snapshot['layoutConfig']['backgroundImageUrl'])
        self.assertEqual(saved['learner']['name'], 'Original name')
        self.assertEqual(saved['bodyText'], 'Original text')

    def test_programme_certificate_corrects_display_without_changing_module_identity(self):
        row = list(deepcopy(self.row)); row[9] = ''; row[10] = ''; row[5].pop('moduleTitle')
        self.cursor.fetchone.return_value = tuple(row)
        body = self.body(); body['changes'] = {'courseTitle': 'Correct programme'}
        self.assertEqual(self.request(body).status_code, 200)
        saved = json.loads(self.writes()[0].args[1][0])
        self.assertEqual(saved['learner']['programme'], 'Correct programme')
        self.assertNotIn('moduleTitle', saved)
        self.assertEqual(self.writes()[0].args[1][1], '')

    def test_missing_inactive_and_stale_copies_never_write(self):
        cases = [(None, 404)]
        for status in ('revoked', 'superseded'):
            row = list(deepcopy(self.row)); row[11] = status
            cases.append((tuple(row), 409))
        row = list(deepcopy(self.row)); row[5]['certificateRevision'] = 2
        cases.append((tuple(row), 409))
        for row, expected in cases:
            self.cursor.fetchone.return_value = row
            self.assertEqual(self.request(self.body()).status_code, expected)
        self.assertEqual(self.writes(), [])

    def test_unchanged_request_never_creates_a_revision(self):
        body = self.body(); body['changes'] = {'learnerName': 'Original name'}
        self.assertEqual(self.request(body).status_code, 400)
        self.assertEqual(self.writes(), [])

    def test_revocation_records_reason_actor_and_previous_copy_without_deleting(self):
        response = self.request(dict(action='revoke', revision=1, reason='Issued in error'))
        self.assertEqual(response.status_code, 200)
        writes = self.writes()
        sql, values = writes[0].args
        self.assertIn("status='revoked'", sql)
        self.assertEqual(values[:3], ['admin@example.invalid', self.at, 'Issued in error'])
        self.assertEqual(values[-1], 11)
        self.assertEqual(writes[1].args[1][1], 'certificate-revoked')
        self.assertEqual(json.loads(writes[1].args[1][-1])['storedBefore']['snapshot'], self.snapshot)

    def test_revocation_does_not_depend_on_refreshing_live_display_sources(self):
        revoked = list(deepcopy(self.row)); revoked[11] = 'revoked'
        self.cursor.fetchone.side_effect = [self.row, tuple(revoked)]
        with patch.object(api, '_current_certificate', side_effect=DatabaseError('Refresh unavailable')) as refresh:
            response = self.request(dict(action='revoke', revision=1, reason='Issued in error'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['certificate']['status'], 'revoked')
        refresh.assert_not_called()

    def test_admin_views_current_details_and_a_single_edit_does_not_pin_unedited_fields(self):
        self.source.return_value.username = 'Updated profile name'
        self.template.return_value = (2, 4, 'New title', 'New body', 80, False, {'primaryColor': '#445566'})
        self.progress.return_value.update(moduleTitle='Updated course', progressPercent=100, trackableDone=5, otjHours=2.5)
        response = self.request(method='GET')
        current = json.loads(response.content)['certificate']
        self.assertEqual(current['editable']['learnerName'], 'Updated profile name')
        self.assertEqual(current['editable']['courseTitle'], 'Updated course')
        self.assertEqual(current['layoutConfig'], {'primaryColor': '#445566'})
        self.assertEqual((current['progressPercent'], current['progressAtIssue']), (100, 80))
        self.assertEqual(current['otjHours'], 2.5)
        self.assertEqual(self.writes(), [])
        self.assertEqual(self.request(self.body()).status_code, 200)
        snapshot = json.loads(self.writes()[0].args[1][0])
        self.assertEqual(snapshot['certificateOverrides'], {'learnerName': 'Corrected name'})
        self.assertEqual(snapshot['layoutConfig'], self.snapshot['layoutConfig'])
        audit = json.loads(self.writes()[1].args[1][-1])
        self.assertEqual(audit['before']['editable']['learnerName'], 'Updated profile name')
        self.assertEqual(audit['before']['otjHours'], 2.5)
        self.assertEqual(audit['storedBefore']['snapshot'], self.snapshot)

    def test_database_failure_is_visible_and_not_reported_as_saved(self):
        self.cursor.execute.side_effect = DatabaseError('Private connection detail')
        response = self.request(self.body())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('Private connection detail', response.content.decode())

    def test_list_is_paged_searchable_and_does_not_send_embedded_artwork(self):
        self.cursor.fetchone.return_value = (41,)
        self.cursor.fetchall.return_value = [(11, 'KBC-TEST', 'Original name', 'Course', 'commercial', 'issued', 80, self.at, 'stable-token', '2', self.at.isoformat())]
        response = api.issued_certificates(self.factory.get('/', dict(q="Name %_'", page=2, status='issued')))
        data = json.loads(response.content)
        self.assertEqual(data['count'], 41)
        self.assertEqual(data['page'], 2)
        self.assertEqual(data['results'][0]['revision'], 2)
        sql, values = self.cursor.execute.call_args.args
        self.assertNotIn("Name %_'", sql)
        self.assertEqual(values[-2:], [20, 20])
        self.assertIn("%Name \\%\\_'%", values)
        self.assertNotIn('snapshot', data['results'][0])
        self.assertEqual(self.writes(), [])
