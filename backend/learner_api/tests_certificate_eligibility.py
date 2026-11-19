"""Progress-only certificates across course sources; all database I/O mocked."""
import json
import inspect
import os
from contextlib import nullcontext
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from old_otjh.service import ServiceError

from . import certificates, certificate_progress, free_courses_view, my_learning
from .journal_sources import enabled


class CertificateEligibilityTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=7, id=7, username='Synthetic Learner', free_courses=[])
        self.template = dict(id=1, version=2, title='Achievement', bodyText='Progress', layoutConfig={},
                             minimumProgress=80, requireFinalTest=True)
        self.progress = dict(moduleRef='legacy:50', moduleTitle='Course', progressPercent=80,
                             trackableTotal=5, trackableDone=4, finalTestPassed=False)
        self.enterContext(patch.object(certificates, '_load_source', return_value=self.source))
        self.read = self.enterContext(patch.object(certificates, 'course_progress', return_value=self.progress))

    def test_threshold_applies_to_all_course_sources_without_exam(self):
        for kind in ('commercial', 'apprenticeship'):
            for ref in ('current:M1', 'unlinked:Course', 'legacy:50', 'free:FC-1'):
                for percent, expected in ((79.99, False), (80, True), (100, True)):
                    with self.subTest(kind=kind, ref=ref, percent=percent):
                        self.progress.update(moduleRef=ref, progressPercent=percent,
                                             trackableTotal=10000, trackableDone=round(percent * 100))
                        result = certificates._module_eligibility(kind, 7, ref, self.template)
                        self.assertEqual(result['eligible'], expected)
                        self.assertNotIn('final_test', result['missing'])
                        self.assertEqual(result['learner']['kind'], kind)
                        self.read.assert_called_with(self.source, ref)

    def test_threshold_uses_component_counts_even_if_display_progress_is_rounded_or_stale(self):
        self.progress.update(progressPercent=80, trackableTotal=200, trackableDone=159)
        self.assertFalse(certificates._module_eligibility('commercial', 7, 'legacy:50', self.template)['eligible'])
        self.progress.update(progressPercent=20, trackableDone=160)
        self.assertTrue(certificates._module_eligibility('commercial', 7, 'legacy:50', self.template)['eligible'])
        self.template['minimumProgress'] = 100
        self.progress.update(progressPercent=100, trackableDone=199)
        self.assertFalse(certificates._module_eligibility('commercial', 7, 'legacy:50', self.template)['eligible'])
        self.progress['trackableDone'] = 200
        self.assertTrue(certificates._module_eligibility('commercial', 7, 'legacy:50', self.template)['eligible'])

    def test_empty_and_demonstration_courses_cannot_earn_certificates(self):
        self.template['minimumProgress'] = 0
        for values in (dict(trackableTotal=0), dict(trackableTotal=5, demoProgress=True)):
            with self.subTest(values=values):
                self.progress.update(values)
                self.assertFalse(certificates._module_eligibility('commercial', 7, 'legacy:50', self.template)['eligible'])

    def test_published_exam_flag_is_retired_without_a_template_republish(self):
        template = certificates._template_dict((1, 2, 'Achievement', 'Progress', 80, True, {}))
        self.assertFalse(template['requireFinalTest'])
        self.assertEqual(template['minimumProgress'], 80)

    def test_verification_preserves_issued_identity_when_current_data_is_unavailable(self):
        snapshot = {'learner': {'id': '7', 'name': 'Synthetic Learner'}, 'progressPercent': 80}
        with patch.object(certificates, 'build_learner_detail', side_effect=DatabaseError('Unavailable')):
            result = certificates._snapshot_with_fallbacks(snapshot, 'commercial', 7, 'free:FC-1', 'Course')
        self.assertEqual(result['learner']['name'], 'Synthetic Learner')
        self.assertEqual(result['progressPercent'], 80)
        self.assertEqual(result['moduleTitle'], 'Course')

    def test_course_reference_validation(self):
        self.assertEqual(certificates._subject_ref('free:FC-1'), 'free:FC-1')
        for ref in ('free:', 'unknown:M1', 'free:FC/1', 'free:' + 'X' * 181):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                certificates._subject_ref(ref)


class CourseProgressProjectionTests(SimpleTestCase):
    def test_counts_owned_activities_including_builder_free_courses_independently_of_hours_and_saved_percentages(self):
        source = SimpleNamespace(pk=7)
        owner = {'id': 70}
        metadata = {'current_subjects': [], 'modules': {}, 'free_course_module_ids': ['FREE-MODULE']}
        context = ([], [], [], {}, [], [], set(), set(), {}, metadata, [])
        cards = [dict(id=ref, title=ref, progress=10, activityCount=999, completedActivityCount=0,
                      actualHours=hours, _activityItems=[dict(completed=i < 4) for i in range(5)])
                 for hours in (0, 1000)
                 for ref in ('current:M1', 'current:FREE-MODULE', 'legacy:50', 'unlinked:Course')]
        with patch.object(my_learning.canonical, 'require_profile', return_value=owner) as identity, \
             patch.object(my_learning, 'load_context', return_value=context) as load, \
             patch.object(my_learning, 'assemble_cards', return_value=(cards, {})) as assemble:
            for card in cards:
                assemble.return_value = ([card], {})
                result = certificate_progress.course_progress(source, card['id'])
                self.assertEqual(result['progressPercent'], 80)
                self.assertEqual((result['trackableTotal'], result['trackableDone']), (5, 4))
                self.assertEqual(result['moduleRef'], card['id'])
                identity.assert_called_with(7)
                load.assert_called_with(source, owner)
                self.assertTrue(assemble.call_args.kwargs['show_current_replacements'])
                self.assertTrue(assemble.call_args.kwargs['include_activity_items'])
            with self.assertRaises(ValueError):
                certificate_progress.course_progress(source, 'current:OTHER')


class FreeCourseCertificateProgressTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=7, learner_type='commercial', free_courses=[dict(freeCourseId='FC-1', courseName='Saved title')])
        self.components = [dict(id=f'C{i}', type='reading', free_module_id='W1', settings={'readingContent': '<p>Read</p>'}) for i in range(5)]
        self.rows = self.enterContext(patch.object(free_courses_view, '_scoped_rows', return_value=(
            {'FC-1': {'course_name': 'Current title'}}, [{'id': 'W1', 'course_id': 'FC-1'}], self.components)))
        self.enterContext(patch.object(free_courses_view, 'free_programme_component_response', side_effect=lambda row: row))
        self.owner = self.enterContext(patch('learner_api.free_course_selectors.canonical_learner', return_value=SimpleNamespace(pk=70)))
        self.enterContext(patch('learner_api.free_course_selectors.assigned_course_ids', return_value=['FC-1']))
        self.completed = self.enterContext(patch.object(free_courses_view, '_completed_refs', return_value={('FC-1', ref) for ref in ('C0', 'C1', 'C2', 'C3', 'OTHER')}))

    def test_only_assigned_course_content_and_own_saved_completions_count(self):
        self.components.extend([
            dict(id='EMPTY', type='reading', free_module_id='W1', settings={}),
            dict(id='QUIZ', type='quiz', free_module_id='W1', settings={}),
            dict(id='OTHER', type='reading', free_module_id='W2', settings={'readingContent': '<p>Other</p>'}),
        ])
        result = certificate_progress.course_progress(self.source, 'free:FC-1')
        self.assertEqual((result['progressPercent'], result['trackableDone'], result['trackableTotal']), (80, 4, 5))
        self.assertEqual(result['moduleTitle'], 'Current title')
        self.rows.assert_called_once_with(['FC-1'])
        self.owner.assert_called_once_with('commercial', 7)
        self.completed.assert_called_once_with(70, ['FC-1'])

    def test_other_course_is_rejected_before_reading_content_or_progress(self):
        with self.assertRaises(ValueError):
            certificate_progress.course_progress(self.source, 'free:FC-2')
        self.rows.assert_not_called()
        self.completed.assert_not_called()

    def test_empty_course_has_no_progress(self):
        self.components.clear()
        result = certificate_progress.course_progress(self.source, 'free:FC-1')
        self.assertEqual((result['trackableTotal'], result['progressPercent']), (0, 0))

    def test_free_course_percentage_does_not_round_up_to_the_certificate_threshold(self):
        self.components[:] = [dict(id=f'C{i}', type='reading', free_module_id='W1', settings={'readingContent': '<p>Read</p>'}) for i in range(200)]
        self.completed.return_value = {('FC-1', f'C{i}') for i in range(159)}
        result = certificate_progress.course_progress(self.source, 'free:FC-1')
        self.assertEqual((result['trackableDone'], result['trackableTotal'], result['progressPercent']), (159, 200, 79.5))

    def test_progress_read_failure_cannot_become_a_certificate(self):
        self.completed.side_effect = DatabaseError('Synthetic failure')
        with self.assertRaises(DatabaseError):
            certificate_progress.course_progress(self.source, 'free:FC-1')


class CertificateIssuanceTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, LEARNER_API_REQUIRE_AUTH='1'))
        self.account = SimpleNamespace(role='learner', subject_id=7, email='synthetic@example.invalid')
        def authenticate(request):
            request.login_account = self.account
            return self.account
        self.enterContext(patch('login.permissions.authenticate_request', side_effect=authenticate))
        self.cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        self.enterContext(patch.object(certificates, 'connections', {'enrolment': connection}))
        self.enterContext(patch.object(certificates.transaction, 'atomic', return_value=nullcontext()))
        self.enterContext(patch.object(certificates, '_published_template', return_value=(1, 2, 'Achievement', 'Progress', 80, True, {})))
        self.existing = self.enterContext(patch.object(certificates, '_issued_certificate', return_value=None))
        self.eligibility = dict(eligible=True, moduleRef='free:FC-1', moduleTitle='Course', progressPercent=80,
                               trackableTotal=5, trackableDone=4, minimumProgress=80, finalTestPassed=False,
                               learner=dict(id='7', name='Synthetic', programme='Programme'))
        def eligibility(*args):
            self.assertTrue(enabled())  # Same journal sources as the learner's My Learning.
            return self.eligibility
        self.read = self.enterContext(patch.object(certificates, '_module_eligibility', side_effect=eligibility))
        self.row = (11, 'KBC-TEST', 1, 2, 80, {}, datetime(2026, 11, 18, tzinfo=timezone.utc), '', 'token', 'free:FC-1', 'Course')
        self.cursor.fetchone.return_value = self.row

    def issue(self, kind='commercial', pk=7):
        return certificates.issue_learner_module_certificate(RequestFactory().post('/certificate/'), kind=kind, pk=pk, module_ref='free:FC-1')

    def test_issues_progress_certificate_and_retry_returns_same_record(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.existing.return_value = None
                self.cursor.execute.reset_mock()
                response = self.issue(kind)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(json.loads(response.content)['issued'])
                inserts = [call for call in self.cursor.execute.call_args_list if 'INSERT INTO "Learner".learner_certificates' in call.args[0]]
                self.assertEqual(len(inserts), 1)
                self.assertEqual(inserts[0].args[1][1:3], [kind, 7])
                self.assertEqual(inserts[0].args[1][5], 'free:FC-1')
                self.assertIn('ON CONFLICT', inserts[0].args[0])
                self.existing.return_value = self.row
                self.cursor.execute.reset_mock()
                self.assertFalse(json.loads(self.issue(kind).content)['issued'])
                self.cursor.execute.assert_not_called()

    def test_below_threshold_never_writes(self):
        self.eligibility.update(eligible=False, progressPercent=79)
        self.assertEqual(self.issue().status_code, 409)
        self.cursor.execute.assert_not_called()

    def test_concurrent_retry_never_overwrites_a_corrected_snapshot(self):
        corrected = list(self.row)
        corrected[5] = {'learner': {'name': 'Corrected'}, 'certificateRevision': 2}
        self.existing.side_effect = [None, tuple(corrected)]
        response = self.issue()
        payload = json.loads(response.content)
        self.assertFalse(payload['issued'])
        self.assertEqual(payload['certificate']['snapshot']['learner']['name'], 'Corrected')
        self.assertEqual(payload['certificate']['revision'], 2)
        self.cursor.execute.assert_not_called()

    def test_revoked_unique_record_cannot_report_a_successful_reissue(self):
        self.cursor.fetchone.return_value = None
        response = self.issue()
        self.assertEqual(response.status_code, 409)
        self.assertNotIn('certificate', json.loads(response.content))

    def test_revoked_or_superseded_public_link_does_not_expose_certificate(self):
        for status in ('revoked', 'superseded'):
            self.cursor.fetchone.return_value = (*self.row, 'commercial', 7, 'Achievement', 'Progress', {}, status)
            response = certificates.verify_certificate(RequestFactory().get('/'), 'token')
            self.assertEqual(response.status_code, 410)
            self.assertNotIn('certificate', json.loads(response.content))
            self.assertIn('no-store', response['Cache-Control'])

    def test_unauthorized_users_never_read_or_issue_certificates(self):
        for role, subject_id, status in (('learner', 8, 404), ('employer', 7, 403), ('coach', 7, 403)):
            with self.subTest(role=role):
                self.account.role, self.account.subject_id = role, subject_id
                self.assertEqual(self.issue().status_code, status)
                self.read.assert_not_called()
                self.cursor.execute.assert_not_called()

    def test_unknown_course_or_identity_failure_never_writes(self):
        for failure, status in ((ValueError('Unassigned'), 404), (ServiceError('Identity unavailable', 'identity', 409), 409)):
            with self.subTest(status=status):
                self.read.side_effect = failure
                self.assertEqual(self.issue().status_code, status)
                self.cursor.execute.assert_not_called()

    def test_verification_uses_the_same_progress_projection_and_retains_snapshot_if_unavailable(self):
        row = (*self.row, 'commercial', 7, 'Achievement', 'Progress', {})
        self.cursor.fetchone.return_value = row
        self.enterContext(patch.object(certificates, '_snapshot_with_fallbacks', return_value={}))
        self.enterContext(patch.object(certificates, '_load_source', return_value=SimpleNamespace(pk=7)))
        def read(source, ref):
            self.assertTrue(enabled())
            self.assertEqual(ref, 'free:FC-1')
            return dict(progressPercent=100, trackableDone=5, trackableTotal=5)
        with patch.object(certificates, 'course_progress', side_effect=read) as progress:
            response = certificates.verify_certificate(RequestFactory().get('/verify/'), 'token')
            self.assertEqual(json.loads(response.content)['certificate']['progressPercent'], 100)
            progress.side_effect = ServiceError('Unavailable', 'identity', 409)
            response = certificates.verify_certificate(RequestFactory().get('/verify/'), 'token')
            self.assertEqual(json.loads(response.content)['certificate']['progressPercent'], 80)
        self.assertTrue(all(call.args[0].lstrip().startswith('SELECT') for call in self.cursor.execute.call_args_list))


class CertificateTemplateTests(SimpleTestCase):
    def setUp(self):
        from login import platform_admin
        self.admin = platform_admin
        self.view = inspect.unwrap(platform_admin.certificate_template)
        self.cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        self.enterContext(patch.object(platform_admin, 'connections', {'enrolment': connection}))

    def test_existing_template_reads_keep_the_threshold_but_disable_the_retired_exam_setting(self):
        row = (1, 'Progress', 2, 'published', 'Achievement', 'Body', 80, True, {}, None)
        self.cursor.fetchone.return_value = row
        self.cursor.fetchall.return_value = [row]
        payload = json.loads(self.view(RequestFactory().get('/certificate-template/')).content)
        self.assertFalse(payload['template']['requireFinalTest'])
        self.assertFalse(payload['templates'][0]['requireFinalTest'])
        self.assertEqual(payload['template']['minimumProgress'], 80)
        self.assertTrue(all(call.args[0].lstrip().startswith('SELECT') for call in self.cursor.execute.call_args_list))

    def test_old_clients_cannot_reenable_the_exam_requirement(self):
        request = RequestFactory().post('/certificate-template/', json.dumps(dict(
            title='Achievement', bodyText='Body', minimumProgress=80, requireFinalTest=True,
        )), content_type='application/json')
        request.login_account = SimpleNamespace(email='synthetic@example.invalid')
        self.cursor.fetchone.side_effect = [(3,), (12, None)]
        with patch.object(self.admin, '_reject_cross_site', return_value=None), \
             patch.object(self.admin.transaction, 'atomic', return_value=nullcontext()):
            response = self.view(request)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(json.loads(response.content)['template']['requireFinalTest'])
        insert = next(call for call in self.cursor.execute.call_args_list if 'INSERT INTO "Learner".certificate_templates' in call.args[0])
        self.assertEqual(insert.args[1][6:8], [80, False])
        self.assertFalse(any(call.args[0].lstrip().startswith('UPDATE') for call in self.cursor.execute.call_args_list))
