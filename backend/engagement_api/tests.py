"""Tests for the engagement points economy: authorisation, wallet math, the
claim state machine, and the progress -> points award mapping.

Nothing here reaches the database — same rationale as
``login.tests_api_gate``: every unit under test reads only
``authenticate_request(request)``'s return value plus whatever ORM managers
are mocked out, so a stub account/queryset proves the logic without any
dependency on the unmanaged, cross-schema tables these apps sit on. Real
concurrency behaviour (the advisory-lock claim path, two claims racing one
reward) is exercised by the "End-to-end smoke" steps in the build plan
instead, since that needs real rows against the live Engagement schema.
"""
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from . import feedback, feedback_delivery, hooks, permissions, services, views


class FeedbackValidationTests(SimpleTestCase):
    def test_post_lecture_delivery_requires_finalized_attendance(self):
        occurrence = feedback_delivery.LectureOccurrence(key='OCC-1', module_catalogue_id='MOD-1')
        with self.assertRaisesMessage(ValueError, 'finalized'):
            feedback_delivery.sync_post_lecture_feedback(occurrence, [], attendance_finalized=False)

    def test_post_lecture_delivery_contract_is_idempotent_by_occurrence_and_learner(self):
        occurrence = feedback_delivery.LectureOccurrence(
            key='OCC-1', module_catalogue_id='MOD-1', title='Lecture 1',
        )
        learner = SimpleNamespace(id=7, username='Synthetic Learner', email='', programme='Data')
        form = SimpleNamespace(id=3, due_date=None)
        delivery = SimpleNamespace(id=11)
        atomic = mock.MagicMock()
        atomic.__enter__.return_value = atomic
        stale_recipients = mock.MagicMock()
        stale_recipients.exclude.return_value.update.return_value = 0
        with (
            mock.patch.object(feedback_delivery.EnrolmentUser.all_learners, 'filter', return_value=[learner]),
            mock.patch.object(feedback_delivery, '_form_for_occurrence', return_value=form),
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'update_or_create', return_value=(delivery, True)) as delivery_upsert,
            mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'update_or_create', return_value=(mock.Mock(), True)) as recipient_upsert,
            mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'filter', return_value=stale_recipients),
            mock.patch.object(feedback_delivery.transaction, 'atomic', return_value=atomic),
        ):
            result = feedback_delivery.sync_post_lecture_feedback(
                occurrence, [feedback_delivery.Attendee('7', 'ATT-7')], attendance_finalized=True,
            )

        delivery_upsert.assert_called_once_with(occurrence_key='OCC-1', defaults=mock.ANY)
        self.assertIs(delivery_upsert.call_args.kwargs['defaults']['form'], form)
        recipient_upsert.assert_called_once_with(delivery=delivery, learner_id='7', defaults=mock.ANY)
        self.assertEqual(result['deliveryIds'], [11])
        self.assertEqual(result['recipientsMatched'], 1)

    def test_finalized_curriculum_attendance_delivers_only_to_present_learners(self):
        rows = [
            ('OCC-1', 'MOD-1', 'Foundations', 'PROG-1', 'Data', 'COHORT-1', 'September', 'GROUP-1', 'Group A', 2,
             datetime(2026, 9, 23, 9), datetime(2026, 9, 23, 10),
             'REPORT-1', 41, 'Present Learner', 'present', 7),
            ('OCC-1', 'MOD-1', 'Foundations', 'PROG-1', 'Data', 'COHORT-1', 'September', 'GROUP-1', 'Group A', 2,
             datetime(2026, 9, 23, 9), datetime(2026, 9, 23, 10),
             'REPORT-1', 42, 'Absent Learner', 'absent', 8),
        ]
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.description = [(name,) for name in (
            'occurrence_id', 'module_catalogue_id', 'module_title', 'programme_id', 'programme_name',
            'cohort_id', 'cohort_name', 'group_id', 'group_name',
            'session_number', 'scheduled_start', 'session_end', 'attendance_report_id',
            'attendance_id', 'learner_name', 'attendance_status', 'learner_id',
        )]
        cursor.fetchall.return_value = rows
        sync_result = {
            'deliveryIds': [11], 'formsMatched': 1, 'recipientsMatched': 1,
            'recipientsRevoked': 0, 'missingLearnerIds': [],
        }
        fake_connection = SimpleNamespace(cursor=mock.Mock(return_value=cursor))
        with (
            mock.patch.object(feedback_delivery, 'connection', fake_connection),
            mock.patch.object(feedback_delivery, 'sync_post_lecture_feedback', return_value=sync_result) as sync,
        ):
            result = feedback_delivery.sync_post_lecture_feedback_from_attendance(occurrence_ids=['OCC-1'])

        occurrence, attendees = sync.call_args.args
        self.assertEqual(occurrence.key, 'OCC-1')
        self.assertEqual(occurrence.module_catalogue_id, 'MOD-1')
        self.assertEqual(occurrence.title, 'Foundations - Session 2')
        self.assertEqual(occurrence.programme_id, 'PROG-1')
        self.assertEqual(occurrence.cohort_name, 'September')
        self.assertEqual(occurrence.group_name, 'Group A')
        self.assertEqual([item.learner_id for item in attendees], ['7'])
        self.assertEqual(attendees[0].learner_name, 'Present Learner')
        self.assertEqual(attendees[0].programme, 'Data')
        self.assertTrue(sync.call_args.kwargs['attendance_finalized'])
        self.assertEqual(result['recipientsMatched'], 1)
        self.assertIn('o.id = ANY(%s)', cursor.execute.call_args.args[0])

    def test_attendance_sync_reports_unmatched_present_email_without_creating_recipient(self):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.description = [(name,) for name in (
            'occurrence_id', 'module_catalogue_id', 'module_title', 'programme_id', 'programme_name',
            'cohort_id', 'cohort_name', 'group_id', 'group_name',
            'session_number', 'scheduled_start', 'session_end', 'attendance_report_id',
            'attendance_id', 'learner_name', 'attendance_status', 'learner_id',
        )]
        cursor.fetchall.return_value = [(
            'OCC-2', 'MOD-2', 'Analytics', 'PROG-1', 'Data', 'COHORT-1', 'September', 'GROUP-1', 'Group A', 1,
            datetime(2026, 9, 23, 9), datetime(2026, 9, 23, 10),
            'REPORT-2', 55, 'Unknown Learner', 'present', None,
        )]
        sync_result = {
            'deliveryIds': [], 'formsMatched': 0, 'recipientsMatched': 0,
            'recipientsRevoked': 0, 'missingLearnerIds': [],
        }
        fake_connection = SimpleNamespace(cursor=mock.Mock(return_value=cursor))
        with (
            mock.patch.object(feedback_delivery, 'connection', fake_connection),
            mock.patch.object(feedback_delivery, 'sync_post_lecture_feedback', return_value=sync_result) as sync,
        ):
            result = feedback_delivery.sync_post_lecture_feedback_from_attendance()

        self.assertEqual(sync.call_args.args[1], [])
        self.assertEqual(result['unmatchedPresentAttendees'], 1)

    def test_curriculum_scope_options_reads_only_the_linked_hierarchy(self):
        rows = [
            ('PROG-1', 'Data', 'COHORT-1', 'September', 'GROUP-1', 'Group A', 'MOD-1', 'Foundations'),
            ('PROG-1', 'Data', 'COHORT-1', 'September', 'GROUP-1', 'Group A', 'MOD-2', 'Analytics'),
        ]
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = rows
        fake_connection = SimpleNamespace(cursor=mock.Mock(return_value=cursor))
        with mock.patch.object(feedback, 'connection', fake_connection):
            options = feedback._curriculum_scope_options()

        self.assertEqual(options['programmes'], [{'id': 'PROG-1', 'name': 'Data'}])
        self.assertEqual(options['cohorts'], [{'id': 'COHORT-1', 'name': 'September', 'programmeId': 'PROG-1'}])
        self.assertEqual(len(options['modules']), 2)
        sql = cursor.execute.call_args.args[0].lower()
        self.assertIn('from "curriculum"."modules"', sql)
        self.assertNotIn('build_curriculum_payload', sql)

    def test_post_lecture_scope_requires_a_valid_linked_hierarchy(self):
        form = SimpleNamespace(
            pk=None, form_type='general', delivery_scope='manual', programme_id='', programme_name='',
            cohort_id='', cohort_name='', group_id='', group_name='',
            module_catalogue_id='', module_name='',
        )
        options = {
            'programmes': [{'id': 'PROG-1', 'name': 'Data'}],
            'cohorts': [{'id': 'COHORT-1', 'name': 'September', 'programmeId': 'PROG-1'}],
            'groups': [{'id': 'GROUP-1', 'name': 'Group A', 'programmeId': 'PROG-1', 'cohortId': 'COHORT-1'}],
            'modules': [{'id': 'MOD-1', 'name': 'Foundations', 'programmeId': 'PROG-1', 'cohortId': 'COHORT-1', 'groupId': 'GROUP-1'}],
        }
        with mock.patch.object(feedback, '_curriculum_scope_options', return_value=options):
            feedback._apply_curriculum_scope(form, {
                'formType': 'post_lecture', 'programmeId': 'PROG-1',
                'deliveryScope': 'module',
                'cohortId': 'COHORT-1', 'groupId': 'GROUP-1', 'moduleCatalogueId': 'MOD-1',
            })
        self.assertEqual(form.form_type, 'post_lecture')
        self.assertEqual(form.module_catalogue_id, 'MOD-1')
        self.assertEqual(form.module_name, 'Foundations')

    def test_post_lecture_scope_rejects_a_module_from_another_group(self):
        form = SimpleNamespace(pk=None, form_type='general', delivery_scope='manual')
        options = {
            'programmes': [{'id': 'PROG-1', 'name': 'Data'}],
            'cohorts': [{'id': 'COHORT-1', 'name': 'September', 'programmeId': 'PROG-1'}],
            'groups': [{'id': 'GROUP-1', 'name': 'Group A', 'programmeId': 'PROG-1', 'cohortId': 'COHORT-1'}],
            'modules': [{'id': 'MOD-1', 'name': 'Foundations', 'programmeId': 'PROG-1', 'cohortId': 'COHORT-1', 'groupId': 'GROUP-2'}],
        }
        with mock.patch.object(feedback, '_curriculum_scope_options', return_value=options):
            with self.assertRaisesMessage(ValueError, 'no longer valid'):
                feedback._apply_curriculum_scope(form, {
                    'formType': 'post_lecture', 'programmeId': 'PROG-1',
                    'deliveryScope': 'module',
                    'cohortId': 'COHORT-1', 'groupId': 'GROUP-1', 'moduleCatalogueId': 'MOD-1',
                })

    def test_unchanged_scope_payload_is_not_treated_as_a_retarget(self):
        form = SimpleNamespace(
            form_type='post_lecture', delivery_scope='module', programme_id='PROG-1', cohort_id='COHORT-1',
            group_id='GROUP-1', module_catalogue_id='MOD-1',
        )
        self.assertFalse(feedback._curriculum_scope_changed(form, {
            'formType': 'post_lecture', 'programmeId': 'PROG-1',
            'deliveryScope': 'module',
            'cohortId': 'COHORT-1', 'groupId': 'GROUP-1', 'moduleCatalogueId': 'MOD-1',
        }))

    def test_all_modules_scope_does_not_require_curriculum_selection(self):
        form = SimpleNamespace(
            pk=None, form_type='general', delivery_scope='manual',
            programme_id='OLD', programme_name='Old', cohort_id='OLD', cohort_name='Old',
            group_id='OLD', group_name='Old', module_catalogue_id='OLD', module_name='Old',
        )
        with mock.patch.object(feedback, '_curriculum_scope_options') as options:
            feedback._apply_curriculum_scope(form, {
                'formType': 'post_lecture', 'deliveryScope': 'all_modules',
            })
        options.assert_not_called()
        self.assertEqual(form.delivery_scope, 'all_modules')
        self.assertEqual(form.module_catalogue_id, '')

    def test_existing_delivery_keeps_the_template_version_used_by_that_lecture(self):
        historical = SimpleNamespace(id=4, version=1)
        existing = SimpleNamespace(form=historical)
        with mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_related') as selected:
            selected.return_value.filter.return_value.first.return_value = existing
            chosen = feedback_delivery._form_for_occurrence('OCC-1', 'MOD-1')
        self.assertIs(chosen, historical)

    def test_module_template_overrides_all_modules_template(self):
        module_form = SimpleNamespace(id=8)
        global_form = SimpleNamespace(id=7)
        module_query = mock.MagicMock()
        module_query.order_by.return_value.first.return_value = module_form
        global_query = mock.MagicMock()
        global_query.order_by.return_value.first.return_value = global_form
        available = mock.MagicMock()
        available.filter.side_effect = [module_query, global_query]
        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_related') as selected,
            mock.patch.object(feedback_delivery.FeedbackForm.objects, 'filter', return_value=available),
        ):
            selected.return_value.filter.return_value.first.return_value = None
            chosen = feedback_delivery._form_for_occurrence('OCC-2', 'MOD-1')
        self.assertIs(chosen, module_form)
        self.assertEqual(available.filter.call_count, 1)

    def test_all_modules_template_is_used_when_module_has_no_override(self):
        global_form = SimpleNamespace(id=7)
        module_query = mock.MagicMock()
        module_query.order_by.return_value.first.return_value = None
        global_query = mock.MagicMock()
        global_query.order_by.return_value.first.return_value = global_form
        available = mock.MagicMock()
        available.filter.side_effect = [module_query, global_query]
        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_related') as selected,
            mock.patch.object(feedback_delivery.FeedbackForm.objects, 'filter', return_value=available),
        ):
            selected.return_value.filter.return_value.first.return_value = None
            chosen = feedback_delivery._form_for_occurrence('OCC-3', 'MOD-2')
        self.assertIs(chosen, global_form)
        self.assertEqual(available.filter.call_count, 2)

    def test_editing_a_used_post_lecture_form_creates_the_next_version(self):
        previous = feedback.FeedbackForm(
            id=10, title='Lecture feedback', form_type='post_lecture',
            delivery_scope='all_modules', template_key='5e60c23d-36c7-4d3c-ada4-0fe47dc9bbee',
            version=1, is_current=True, description='', instructions='', status='published',
            created_by='Staff', anonymous_responses=False, allow_save_continue=True,
            allow_edit_after_submission=False,
        )
        saved = []

        def save(instance, *args, **kwargs):
            if instance is not previous:
                instance.pk = instance.id = 11
                saved.append(instance)

        query = mock.MagicMock()
        query.get.side_effect = lambda **kwargs: previous if not saved else saved[0]
        atomic = mock.MagicMock()
        atomic.__enter__.return_value = atomic
        request = RequestFactory().patch(
            '/', data=json.dumps({'title': 'Updated feedback', 'sections': []}),
            content_type='application/json',
        )
        with (
            mock.patch.object(feedback, '_forms_queryset', return_value=query),
            mock.patch.object(feedback, '_form_has_history', return_value=True),
            mock.patch.object(feedback, '_apply_metadata', side_effect=lambda form, payload: setattr(form, 'title', payload['title'])),
            mock.patch.object(feedback, '_replace_structure') as replace_structure,
            mock.patch.object(feedback, '_post_lecture_publish_conflict', return_value=False),
            mock.patch.object(feedback, 'actor_name', return_value='Editor'),
            mock.patch.object(feedback, 'form_dict', return_value={'id': 11, 'version': 2}),
            mock.patch.object(feedback.FeedbackForm, 'save', autospec=True, side_effect=save),
            mock.patch.object(feedback.transaction, 'atomic', return_value=atomic),
        ):
            response = feedback.form_detail.__wrapped__(request, pk=10)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(previous.is_current)
        self.assertEqual(saved[0].version, 2)
        self.assertEqual(saved[0].template_key, previous.template_key)
        self.assertIs(saved[0].previous_version, previous)
        self.assertEqual(saved[0].status, 'published')
        replace_structure.assert_called_once_with(saved[0], [])

    def test_feedback_csrf_endpoint_issues_a_token(self):
        response = feedback.csrf_token(RequestFactory().get('/engagement_api/feedback/csrf/'))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.content)['csrfToken'])

    def test_recipient_rows_show_attendance_learner_lecture_and_response(self):
        form = SimpleNamespace(id=19, form_type='post_lecture', template_key='template-1')
        delivery_form = SimpleNamespace(version=1)
        delivery = SimpleNamespace(
            id=3, session_title='Martech - Thur - Session 1', module_name='Martech - Thur',
            form=delivery_form,
        )
        recipient = SimpleNamespace(
            id=5, delivery=delivery, delivery_id=3, learner_id='7', learner_name='Synthetic Learner',
            programme='Marketing', assigned_at=datetime(2026, 9, 24, tzinfo=timezone.utc), due_date=None,
        )
        learner = SimpleNamespace(id=7, username='Synthetic Learner', email='learner@example.test', programme='Marketing')
        response = SimpleNamespace(delivery_id=3, learner_id='7', status='completed')
        family_query = mock.MagicMock()
        family_query.values_list.return_value = [19]
        recipient_query = mock.MagicMock()
        recipient_query.filter.return_value.order_by.return_value = [recipient]
        assignment_query = mock.MagicMock()
        assignment_query.order_by.return_value = []
        learner_query = mock.MagicMock()
        learner_query.filter.return_value = [learner]
        with (
            mock.patch.object(feedback.FeedbackForm.objects, 'filter', return_value=family_query),
            mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related', return_value=recipient_query),
            mock.patch.object(feedback.FeedbackAssignment.objects, 'filter', return_value=assignment_query),
            mock.patch.object(feedback.EnrolmentUser.all_learners, 'all', return_value=learner_query),
            mock.patch.object(feedback.FeedbackResponse.objects, 'filter', return_value=[response]),
        ):
            rows = feedback._form_recipient_rows(form)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['learnerName'], 'Synthetic Learner')
        self.assertEqual(rows[0]['email'], 'learner@example.test')
        self.assertEqual(rows[0]['sessionTitle'], 'Martech - Thur - Session 1')
        self.assertEqual(rows[0]['source'], 'attendance')
        self.assertEqual(rows[0]['responseStatus'], 'completed')

    def test_learner_cannot_view_form_recipient_names(self):
        with _patched(_account(role='learner')):
            response = feedback.form_recipients(RequestFactory().get('/'), pk=19)
        self.assertEqual(response.status_code, 403)

    def test_staff_view_as_sees_attendance_recipient_delivery(self):
        form = SimpleNamespace(
            id=19, title='Lecture feedback', description='Tell us about the lecture',
            due_date=None,
        )
        delivery = SimpleNamespace(
            id=21, form=form, session_title='Martech - Thur - Session 1',
            starts_at=datetime(2026, 9, 17, 9, tzinfo=timezone.utc),
        )
        recipient = SimpleNamespace(
            delivery=delivery, delivery_id=21,
            assigned_at=datetime(2026, 9, 17, 10, tzinfo=timezone.utc),
            due_date=None,
        )
        forms_query = mock.MagicMock()
        forms_query.filter.return_value = forms_query
        forms_query.distinct.return_value = forms_query
        forms_query.__iter__.return_value = iter([])
        recipient_query = mock.MagicMock()
        recipient_query.filter.return_value = recipient_query
        recipient_query.order_by.return_value = [recipient]
        with (
            _patched(_account(role='staff', subject_type='staff')),
            mock.patch.object(feedback, '_forms_queryset', return_value=forms_query),
            mock.patch.object(feedback.FeedbackResponse.objects, 'filter', side_effect=[[], []]),
            mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related', return_value=recipient_query),
        ):
            response = feedback.learner_forms(RequestFactory().get('/?learnerId=61'))

        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(len(body['forms']), 1)
        self.assertEqual(body['forms'][0]['deliveryId'], 21)
        self.assertEqual(body['forms'][0]['sessionTitle'], 'Martech - Thur - Session 1')

    def test_staff_feedback_preview_requires_an_explicit_learner(self):
        with _patched(_account(role='staff', subject_type='staff')):
            response = feedback.learner_forms(RequestFactory().get('/'))
        self.assertEqual(response.status_code, 400)

    def test_staff_feedback_preview_cannot_submit_for_the_learner(self):
        with _patched(_account(role='staff', subject_type='staff')):
            response = feedback.learner_response_save(RequestFactory().post('/'), delivery_id=21)
        self.assertEqual(response.status_code, 403)

    def test_structure_rejects_unknown_question_type(self):
        with self.assertRaisesMessage(ValueError, 'unsupported type'):
            feedback._validated_sections([{
                'title': 'Learning',
                'questions': [{'type': 'executable_code', 'text': 'Run this?', 'config': {}}],
            }])

    def test_choice_question_requires_two_options(self):
        with self.assertRaisesMessage(ValueError, 'at least two options'):
            feedback._validated_sections([{
                'title': 'Learning',
                'questions': [{'type': 'single_choice', 'text': 'Choose', 'config': {'options': ['Only']}}],
            }])

    def test_answer_validation_enforces_question_configuration(self):
        question = SimpleNamespace(question_type='rating', config={'min': 1, 'max': 5})
        self.assertTrue(feedback._valid_answer(question, 5))
        self.assertFalse(feedback._valid_answer(question, 6))
        question = SimpleNamespace(question_type='dropdown', config={'options': ['Good', 'Poor']})
        self.assertTrue(feedback._valid_answer(question, 'Good'))
        self.assertFalse(feedback._valid_answer(question, 'Injected option'))

    def test_contact_and_photo_answer_types_are_validated(self):
        name = SimpleNamespace(question_type='name', config={})
        email = SimpleNamespace(question_type='email', config={})
        photo = SimpleNamespace(question_type='photo_upload', config={})
        self.assertTrue(feedback._valid_answer(name, {'firstName': 'Ava', 'lastName': 'Jones'}))
        self.assertFalse(feedback._valid_answer(email, 'not-an-email'))
        self.assertTrue(feedback._valid_answer(email, 'ava@example.com'))
        self.assertTrue(feedback._valid_answer(photo, {'uploadId': '5e60c23d-36c7-4d3c-ada4-0fe47dc9bbee'}))


def _account(*, role="learner", subject_type="learner", subject_id=61, display_name="Daniel Walsh", email="daniel@kbc.test"):
    """A stand-in LoginAccount — these helpers read only these five attributes."""
    return SimpleNamespace(role=role, subject_type=subject_type, subject_id=subject_id, display_name=display_name, email=email)


def _patched(account):
    """Patch authenticate_request as it's imported into permissions.py."""
    return mock.patch.object(permissions, "authenticate_request", return_value=account)


class RequireStaffTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_unauthenticated_is_401(self):
        with _patched(None):
            view = permissions.require_staff(lambda request: "ok")
            response = view(self.factory.get("/"))
        self.assertEqual(response.status_code, 401)

    def test_learner_is_403(self):
        with _patched(_account(role="learner")):
            view = permissions.require_staff(lambda request: "ok")
            response = view(self.factory.get("/"))
        self.assertEqual(response.status_code, 403)

    def test_staff_passes_through(self):
        with _patched(_account(role="staff")):
            view = permissions.require_staff(lambda request: "ok")
            response = view(self.factory.get("/"))
        self.assertEqual(response, "ok")

    def test_admin_passes_through(self):
        with _patched(_account(role="admin")):
            view = permissions.require_staff(lambda request: "ok")
            response = view(self.factory.get("/"))
        self.assertEqual(response, "ok")


class RequireLearnerIdentityTests(SimpleTestCase):
    """The core fix for the impersonation bug: identity is always session-derived."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_learner_gets_own_session_id_never_a_client_supplied_one(self):
        request = self.factory.post("/", data={"learnerId": "999999", "learnerName": "Someone Else"}, content_type="application/json")
        with _patched(_account(role="learner", subject_type="learner", subject_id=61, display_name="Daniel Walsh")):
            learner_id, learner_name, error = permissions.require_learner_identity(request)
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")
        self.assertEqual(learner_name, "Daniel Walsh")

    def test_staff_cannot_use_a_learner_self_endpoint(self):
        with _patched(_account(role="staff", subject_type="staff")):
            learner_id, learner_name, error = permissions.require_learner_identity(self.factory.post("/"))
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 403)

    def test_employer_cannot_use_a_learner_self_endpoint(self):
        with _patched(_account(role="employer", subject_type="employer")):
            learner_id, learner_name, error = permissions.require_learner_identity(self.factory.post("/"))
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 403)

    def test_unauthenticated_is_401(self):
        with _patched(None):
            learner_id, learner_name, error = permissions.require_learner_identity(self.factory.post("/"))
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 401)


class LearnerReadScopeTests(SimpleTestCase):
    """A GET's ?learnerId must never let one learner read another's data."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_learner_is_scoped_to_self_even_with_a_different_query_param(self):
        request = self.factory.get("/?learnerId=999999")
        with _patched(_account(role="learner", subject_id=61)):
            learner_id, error = permissions.learner_read_scope(request)
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")

    def test_learner_omitting_the_param_still_gets_only_self_never_everyone(self):
        request = self.factory.get("/")
        with _patched(_account(role="learner", subject_id=61)):
            learner_id, error = permissions.learner_read_scope(request)
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")  # not None — None would mean "everyone" for staff

    def test_staff_omitting_the_param_sees_everyone(self):
        request = self.factory.get("/")
        with _patched(_account(role="staff")):
            learner_id, error = permissions.learner_read_scope(request)
        self.assertIsNone(error)
        self.assertIsNone(learner_id)  # None -> the view applies no filter

    def test_staff_may_scope_to_a_named_learner(self):
        request = self.factory.get("/?learnerId=61")
        with _patched(_account(role="staff")):
            learner_id, error = permissions.learner_read_scope(request)
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")

    def test_unauthenticated_is_401(self):
        with _patched(None):
            learner_id, error = permissions.learner_read_scope(self.factory.get("/"))
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 401)


class RequireSelfOrStaffTests(SimpleTestCase):
    """A learner probing another learner's record id must get 404, not 403."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_owning_learner_passes(self):
        with _patched(_account(role="learner", subject_id=61)):
            error = permissions.require_self_or_staff(self.factory.get("/"), owner_learner_id="61")
        self.assertIsNone(error)

    def test_non_owning_learner_gets_404_not_403(self):
        with _patched(_account(role="learner", subject_id=61)):
            error = permissions.require_self_or_staff(self.factory.get("/"), owner_learner_id="999999")
        self.assertEqual(error.status_code, 404)

    def test_staff_may_view_any_learners_record(self):
        with _patched(_account(role="staff")):
            error = permissions.require_self_or_staff(self.factory.get("/"), owner_learner_id="999999")
        self.assertIsNone(error)


class LearnerTargetIdentityTests(SimpleTestCase):
    """Flash-card flip: staff may target a chosen learner; a learner never can."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_learner_is_always_self_even_if_payload_names_someone_else(self):
        with _patched(_account(role="learner", subject_id=61, display_name="Daniel Walsh")):
            learner_id, learner_name, error = permissions.learner_target_identity(
                self.factory.post("/"), {"learnerId": "999999", "learnerName": "Someone Else"},
            )
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")
        self.assertEqual(learner_name, "Daniel Walsh")

    def test_staff_may_target_a_named_learner(self):
        with _patched(_account(role="staff")):
            learner_id, learner_name, error = permissions.learner_target_identity(
                self.factory.post("/"), {"learnerId": "61", "learnerName": "Daniel Walsh"},
            )
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")
        self.assertEqual(learner_name, "Daniel Walsh")

    def test_staff_without_a_target_gets_400(self):
        with _patched(_account(role="staff")):
            learner_id, learner_name, error = permissions.learner_target_identity(self.factory.post("/"), {})
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 400)

    def test_employer_is_forbidden(self):
        with _patched(_account(role="employer", subject_type="employer")):
            learner_id, learner_name, error = permissions.learner_target_identity(self.factory.post("/"), {})
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 403)


class StaffErrorTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_staff_gets_no_error(self):
        with _patched(_account(role="staff")):
            self.assertIsNone(permissions.staff_error(self.factory.post("/")))

    def test_learner_is_403(self):
        with _patched(_account(role="learner")):
            self.assertEqual(permissions.staff_error(self.factory.post("/")).status_code, 403)

    def test_unauthenticated_is_401(self):
        with _patched(None):
            self.assertEqual(permissions.staff_error(self.factory.post("/")).status_code, 401)


class IsStaffTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_staff_and_admin_are_staff(self):
        for role in ("staff", "admin"):
            with _patched(_account(role=role)):
                self.assertTrue(permissions.is_staff(self.factory.get("/")))

    def test_learner_and_unauthenticated_are_not_staff(self):
        with _patched(_account(role="learner")):
            self.assertFalse(permissions.is_staff(self.factory.get("/")))
        with _patched(None):
            self.assertFalse(permissions.is_staff(self.factory.get("/")))


class ActorNameTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_falls_back_to_email_when_display_name_is_blank(self):
        with _patched(_account(display_name=None, email="daniel@kbc.test")):
            self.assertEqual(permissions.actor_name(self.factory.post("/")), "daniel@kbc.test")

    def test_none_when_unauthenticated(self):
        with _patched(None):
            self.assertIsNone(permissions.actor_name(self.factory.post("/")))


class GrantPointsTests(SimpleTestCase):
    """services.grant_points — the single entry point every points-worthy
    event goes through, so its clamping and de-dup rules are the whole
    integrity backstop for the wallet."""

    def _rule(self, points=10):
        return SimpleNamespace(points=points)

    def test_negative_points_clamped_to_zero_for_hook_source(self):
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule()), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = None
            services.grant_points("some_rule", "61", "Daniel", points=-50, source_type="hook")
        self.assertEqual(mock_create.call_args.kwargs["points"], 0)

    def test_negative_points_kept_for_explicit_adjustment(self):
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule()), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = None
            services.grant_points("adj_rule", "61", "Daniel", points=-50, source_type="adjustment")
        self.assertEqual(mock_create.call_args.kwargs["points"], -50)

    def test_rule_points_used_when_points_not_given(self):
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule(points=25)), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = None
            services.grant_points("some_rule", "61", "Daniel")
        self.assertEqual(mock_create.call_args.kwargs["points"], 25)

    def test_existing_event_reference_short_circuits_create(self):
        existing = SimpleNamespace(id=1)
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule()), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = existing
            result = services.grant_points("some_rule", "61", "Daniel", event_reference="quiz:1:learner:61")
        self.assertIs(result, existing)
        mock_create.assert_not_called()

    def test_provenance_fields_pass_through_to_create(self):
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule()), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = None
            services.grant_points(
                "manual_rule", "61", "Daniel", points=15,
                awarded_by="Rewan", source_type="manual", source_id="42", reason="Great effort",
            )
        kwargs = mock_create.call_args.kwargs
        self.assertEqual(kwargs["awarded_by"], "Rewan")
        self.assertEqual(kwargs["source_type"], "manual")
        self.assertEqual(kwargs["source_id"], "42")
        self.assertEqual(kwargs["reason"], "Great effort")


class PointsSummaryTests(SimpleTestCase):
    """services.points_summary — the one authoritative balance formula."""

    def test_balance_is_earned_minus_committed(self):
        with mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_grants, \
             mock.patch("engagement_api.models.VoucherClaim.objects.filter") as mock_claims:
            mock_grants.return_value.aggregate.return_value = {"total": 100}
            mock_claims.return_value.exclude.return_value.aggregate.return_value = {"total": 30}
            result = services.points_summary("61")
        self.assertEqual(result, {"learnerId": "61", "earned": 100, "committed": 30, "balance": 70})

    def test_rejected_claims_are_excluded_from_committed(self):
        with mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_grants, \
             mock.patch("engagement_api.models.VoucherClaim.objects.filter") as mock_claims:
            mock_grants.return_value.aggregate.return_value = {"total": 50}
            mock_claims.return_value.exclude.return_value.aggregate.return_value = {"total": 0}
            services.points_summary("61")
        # exclude(status='rejected') is what keeps a rejected claim's points
        # in the spendable balance — assert the formula actually calls it.
        mock_claims.return_value.exclude.assert_called_once_with(status="rejected")

    def test_no_grants_or_claims_defaults_to_zero_not_none(self):
        with mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_grants, \
             mock.patch("engagement_api.models.VoucherClaim.objects.filter") as mock_claims:
            mock_grants.return_value.aggregate.return_value = {"total": None}
            mock_claims.return_value.exclude.return_value.aggregate.return_value = {"total": None}
            result = services.points_summary("999")
        self.assertEqual(result, {"learnerId": "999", "earned": 0, "committed": 0, "balance": 0})


class ClaimStateMachineTests(SimpleTestCase):
    """The pure transition table voucher_claim_detail enforces — a claim
    only ever moves forward, and only 'fulfilled' is terminal."""

    def test_pending_may_move_to_approved_or_rejected(self):
        self.assertEqual(views._CLAIM_TRANSITIONS["pending"], {"approved", "rejected"})

    def test_approved_may_move_to_fulfilled_or_rejected(self):
        self.assertEqual(views._CLAIM_TRANSITIONS["approved"], {"fulfilled", "rejected"})

    def test_fulfilled_and_rejected_are_terminal(self):
        self.assertNotIn("fulfilled", views._CLAIM_TRANSITIONS)
        self.assertNotIn("rejected", views._CLAIM_TRANSITIONS)


class VoucherClaimDetailTransitionTests(SimpleTestCase):
    """Exercises the real voucher_claim_detail view with a mocked queryset —
    the state-machine guard and the idempotent-fulfilment guard are exactly
    the kind of off-by-one that's cheap to break silently."""

    def setUp(self):
        self.factory = RequestFactory()

    def _claim(self, status):
        reward = SimpleNamespace(id=7, name="Costa Voucher", total_claimed=0, save=mock.MagicMock())
        return SimpleNamespace(
            id=1, learner_id="61", learner_name="Daniel Walsh", reward=reward, reward_id=7,
            points=50, requested_at=datetime.now(timezone.utc), status=status,
            reviewed_by=None, reviewed_at=None, delivery_type="digital", delivery_method="Email",
            delivery_detail=None, delivery_instructions=None, save=mock.MagicMock(),
        )

    def _patch_get(self, claim):
        # The view does .objects.select_related('reward').get(pk=pk) — mock
        # the select_related() call, not .get() directly, so the chain resolves.
        patcher = mock.patch("engagement_api.models.VoucherClaim.objects.select_related")
        mocked = patcher.start()
        mocked.return_value.get.return_value = claim
        self.addCleanup(patcher.stop)

    def test_illegal_transition_returns_409(self):
        claim = self._claim("rejected")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "approved"}), content_type="application/json")
        with _patched(_account(role="staff")):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(claim.status, "rejected")  # unchanged

    def test_pending_to_approved_records_reviewer_from_session(self):
        claim = self._claim("pending")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "approved"}), content_type="application/json")
        with _patched(_account(role="staff", display_name="Rewan Yasser")):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(claim.status, "approved")
        self.assertEqual(claim.reviewed_by, "Rewan Yasser")

    def test_repeated_fulfilled_patch_does_not_reincrement_total_claimed(self):
        claim = self._claim("fulfilled")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "fulfilled"}), content_type="application/json")
        with _patched(_account(role="staff")):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(claim.reward.total_claimed, 0)
        claim.reward.save.assert_not_called()

    def test_learner_cannot_patch_a_claim(self):
        claim = self._claim("pending")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "approved"}), content_type="application/json")
        with _patched(_account(role="learner")):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(claim.status, "pending")  # unchanged

    def test_unauthenticated_is_401(self):
        claim = self._claim("pending")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "approved"}), content_type="application/json")
        with _patched(None):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 401)


class AwardForProgressTests(SimpleTestCase):
    """hooks.award_for_progress — the source -> rule mapping every quiz/
    video/component completion is scored against. Never touches the DB:
    grant_points itself is mocked out at the module it's imported from."""

    def _patched_grant(self):
        return mock.patch("engagement_api.services.grant_points")

    def test_first_attempt_passed_quiz_awards_quiz_passed(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 1, "passed": True, "quizId": 9})
        mock_grant.assert_called_once_with(
            "quiz_passed", "61", "Daniel",
            event_reference="quiz:9:learner:61", source_type="hook", source_id="9",
        )

    def test_first_attempt_failed_quiz_awards_nothing(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 1, "passed": False, "quizId": 9})
        mock_grant.assert_not_called()

    def test_second_attempt_never_awards_even_if_passed(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 2, "passed": True, "quizId": 9})
        mock_grant.assert_not_called()

    def test_video_first_watch_awards_recorded_session_attended(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "video", "attempt": 1, "componentId": 5})
        mock_grant.assert_called_once_with(
            "recorded_session_attended", "61", "Daniel",
            event_reference="video:5:learner:61", source_type="hook", source_id="5",
        )

    def test_reading_component_awards_pdf_viewed(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "component", "attempt": 1, "componentType": "reading", "componentId": 3})
        mock_grant.assert_called_once_with(
            "pdf_viewed", "61", "Daniel",
            event_reference="component:3:learner:61", source_type="hook", source_id="3",
        )

    def test_powerpoint_component_awards_powerpoint_viewed(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "component", "attempt": 1, "componentType": "powerpoint", "componentId": 4})
        mock_grant.assert_called_once_with(
            "powerpoint_viewed", "61", "Daniel",
            event_reference="component:4:learner:61", source_type="hook", source_id="4",
        )

    def test_podcast_component_awards_podcast_attended(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "component", "attempt": 1, "componentType": "podcast", "componentId": 6})
        mock_grant.assert_called_once_with(
            "podcast_attended", "61", "Daniel",
            event_reference="component:6:learner:61", source_type="hook", source_id="6",
        )

    def test_component_type_not_in_map_awards_nothing(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "component", "attempt": 1, "componentType": "reflection", "componentId": 1})
        mock_grant.assert_not_called()

    def test_none_learner_id_awards_nothing(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress(None, "Daniel", {"kind": "quiz", "attempt": 1, "passed": True, "quizId": 9})
        mock_grant.assert_not_called()

    def test_missing_active_rule_is_swallowed_not_raised(self):
        with mock.patch("engagement_api.services.grant_points", side_effect=services.PointsRule.DoesNotExist):
            # Must not raise — a dropped grant can never surface as a progress-save failure.
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 1, "passed": True, "quizId": 9})

    def test_unexpected_error_is_swallowed_not_raised(self):
        with mock.patch("engagement_api.services.grant_points", side_effect=RuntimeError("db down")):
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 1, "passed": True, "quizId": 9})


class ComputeEngagementScoreTests(SimpleTestCase):
    """services.compute_engagement_score — 30/30/20/20 weighted composite of
    attendance/KSB/OTJH/quiz. A missing signal (None) must not zero the
    learner out — the weight redistributes across whatever data exists."""

    def test_all_signals_present(self):
        # (90*.3 + 80*.3 + 70*.2 + 60*.2) / 1.0 = 51+14+12 = 77
        self.assertEqual(services.compute_engagement_score(90, 80, 70, 60), 77)

    def test_missing_signal_redistributes_weight_not_zeroes_it(self):
        # No quiz data: (90*.3 + 80*.3 + 70*.2) / 0.8 = (27+24+14)/0.8 = 81.25 -> 81
        self.assertEqual(services.compute_engagement_score(90, 80, 70, None), 81)

    def test_only_one_signal_present(self):
        self.assertEqual(services.compute_engagement_score(None, None, None, 88), 88)

    def test_no_signals_present_returns_none(self):
        self.assertIsNone(services.compute_engagement_score(None, None, None, None))

    def test_all_zero_is_a_real_score_not_none(self):
        self.assertEqual(services.compute_engagement_score(0, 0, 0, 0), 0)


class ClubMembersViewTests(SimpleTestCase):
    """Staff-assigned club membership — learners never join themselves."""

    def setUp(self):
        self.factory = RequestFactory()

    def _club(self):
        return SimpleNamespace(id=1)

    def test_learner_cannot_assign_a_member(self):
        request = self.factory.post("/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel"}), content_type="application/json")
        with mock.patch("engagement_api.models.Club.objects.get", return_value=self._club()), _patched(_account(role="learner")):
            response = views.club_members_collection(request, club_id=1)
        self.assertEqual(response.status_code, 403)

    def test_assigning_an_existing_active_member_is_idempotent(self):
        existing = SimpleNamespace(
            id=5, learner_id="61", learner_name="Daniel Walsh", assigned_by="Rewan",
            assigned_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        )
        request = self.factory.post("/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel Walsh"}), content_type="application/json")
        with mock.patch("engagement_api.models.Club.objects.get", return_value=self._club()), \
             mock.patch("engagement_api.models.ClubMembership.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.ClubMembership.objects.create") as mock_create, \
             _patched(_account(role="staff")):
            mock_filter.return_value.first.return_value = existing
            response = views.club_members_collection(request, club_id=1)
        self.assertEqual(response.status_code, 200)
        mock_create.assert_not_called()

    def test_staff_may_assign_a_new_member(self):
        created = SimpleNamespace(
            id=6, learner_id="61", learner_name="Daniel Walsh", assigned_by="Rewan Yasser",
            assigned_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
        )
        request = self.factory.post("/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel Walsh"}), content_type="application/json")
        with mock.patch("engagement_api.models.Club.objects.get", return_value=self._club()), \
             mock.patch("engagement_api.models.ClubMembership.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.ClubMembership.objects.create", return_value=created) as mock_create, \
             _patched(_account(role="staff", display_name="Rewan Yasser")):
            mock_filter.return_value.first.return_value = None
            response = views.club_members_collection(request, club_id=1)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(mock_create.call_args.kwargs["assigned_by"], "Rewan Yasser")

    def test_removing_a_membership_soft_deletes(self):
        request = self.factory.delete("/")
        with mock.patch("engagement_api.models.ClubMembership.objects.filter") as mock_filter, _patched(_account(role="staff")):
            mock_filter.return_value.update.return_value = 1
            response = views.club_member_detail(request, club_id=1, learner_id="61")
        self.assertEqual(response.status_code, 200)
        mock_filter.return_value.update.assert_called_once_with(status="removed")

    def test_removing_a_nonexistent_membership_is_404(self):
        request = self.factory.delete("/")
        with mock.patch("engagement_api.models.ClubMembership.objects.filter") as mock_filter, _patched(_account(role="staff")):
            mock_filter.return_value.update.return_value = 0
            response = views.club_member_detail(request, club_id=1, learner_id="999")
        self.assertEqual(response.status_code, 404)


class AttendanceInterventionViewTests(SimpleTestCase):
    """The attendance-risk page's "Take Action" endpoint."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_learner_cannot_log_an_intervention(self):
        request = self.factory.post("/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel", "action": "Call"}), content_type="application/json")
        with _patched(_account(role="learner")):
            response = views.attendance_interventions_collection(request)
        self.assertEqual(response.status_code, 403)

    def test_staff_logs_an_intervention_with_session_actor(self):
        created = SimpleNamespace(
            id=1, learner_id="61", learner_name="Daniel Walsh", action="Called learner", employer_notified=True,
            intervention_date=None, created_by="Rewan Yasser", created_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
            resolved=False, resolved_at=None,
        )
        request = self.factory.post(
            "/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel Walsh", "action": "Called learner", "employerNotified": True}),
            content_type="application/json",
        )
        with mock.patch("engagement_api.models.AttendanceIntervention.objects.create", return_value=created) as mock_create, \
             _patched(_account(role="staff", display_name="Rewan Yasser")):
            response = views.attendance_interventions_collection(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(mock_create.call_args.kwargs["created_by"], "Rewan Yasser")

    def test_resolving_sets_resolved_at(self):
        intervention = SimpleNamespace(
            id=1, learner_id="61", learner_name="Daniel Walsh", action="Called learner", employer_notified=False,
            intervention_date=None, created_by="Rewan", created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
            resolved=False, resolved_at=None, save=mock.MagicMock(),
        )
        request = self.factory.patch("/", data=json.dumps({"resolved": True}), content_type="application/json")
        with mock.patch("engagement_api.models.AttendanceIntervention.objects.get", return_value=intervention), _patched(_account(role="staff")):
            response = views.attendance_intervention_detail(request, pk=1)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(intervention.resolved)
        self.assertIsNotNone(intervention.resolved_at)


class ComputeMessageResponseRatesTests(SimpleTestCase):
    """The identity bridge (Created_users <-> Learner.learners via email) and
    the 24h reply-pairing math — the hardest part of the analytics build."""

    def test_learner_who_replies_within_24h_scores_100(self):
        coach_msg_time = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
        reply_time = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter") as mock_users, \
             mock.patch("chat.models.ChatLearner.objects.all") as mock_chat_learners, \
             mock.patch("chat.models.Conversation.objects.filter") as mock_conversations, \
             mock.patch("chat.models.Message.objects.filter") as mock_messages:
            mock_users.return_value.values.return_value = [{"id": 61, "email": "daniel@kbc.test"}]
            mock_chat_learners.return_value.values.return_value = [{"id": 501, "email": "daniel@kbc.test"}]
            mock_conversations.return_value.values.return_value = [{"id": 9001, "learner_id": 501}]
            mock_messages.return_value.order_by.return_value.values.return_value = [
                {"conversation_id": 9001, "sender_type": "coach", "created_at": coach_msg_time},
                {"conversation_id": 9001, "sender_type": "learner", "created_at": reply_time},
            ]
            rates = services.compute_message_response_rates(["61"])
        self.assertEqual(rates, {"61": 100})

    def test_learner_who_never_replies_scores_zero_not_absent(self):
        coach_msg_time = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter") as mock_users, \
             mock.patch("chat.models.ChatLearner.objects.all") as mock_chat_learners, \
             mock.patch("chat.models.Conversation.objects.filter") as mock_conversations, \
             mock.patch("chat.models.Message.objects.filter") as mock_messages:
            mock_users.return_value.values.return_value = [{"id": 62, "email": "amir@kbc.test"}]
            mock_chat_learners.return_value.values.return_value = [{"id": 502, "email": "amir@kbc.test"}]
            mock_conversations.return_value.values.return_value = [{"id": 9002, "learner_id": 502}]
            mock_messages.return_value.order_by.return_value.values.return_value = [
                {"conversation_id": 9002, "sender_type": "coach", "created_at": coach_msg_time},
            ]
            rates = services.compute_message_response_rates(["62"])
        self.assertEqual(rates, {"62": 0})

    def test_reply_outside_24h_does_not_count(self):
        coach_msg_time = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
        late_reply = datetime(2026, 8, 3, 9, 0, tzinfo=timezone.utc)  # 48h later
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter") as mock_users, \
             mock.patch("chat.models.ChatLearner.objects.all") as mock_chat_learners, \
             mock.patch("chat.models.Conversation.objects.filter") as mock_conversations, \
             mock.patch("chat.models.Message.objects.filter") as mock_messages:
            mock_users.return_value.values.return_value = [{"id": 61, "email": "daniel@kbc.test"}]
            mock_chat_learners.return_value.values.return_value = [{"id": 501, "email": "daniel@kbc.test"}]
            mock_conversations.return_value.values.return_value = [{"id": 9001, "learner_id": 501}]
            mock_messages.return_value.order_by.return_value.values.return_value = [
                {"conversation_id": 9001, "sender_type": "coach", "created_at": coach_msg_time},
                {"conversation_id": 9001, "sender_type": "learner", "created_at": late_reply},
            ]
            rates = services.compute_message_response_rates(["61"])
        self.assertEqual(rates, {"61": 0})

    def test_no_matching_email_between_engagement_and_chat_returns_empty(self):
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter") as mock_users, \
             mock.patch("chat.models.ChatLearner.objects.all") as mock_chat_learners:
            mock_users.return_value.values.return_value = [{"id": 61, "email": "daniel@kbc.test"}]
            mock_chat_learners.return_value.values.return_value = [{"id": 999, "email": "someone-else@kbc.test"}]
            rates = services.compute_message_response_rates(["61"])
        self.assertEqual(rates, {})

    def test_empty_learner_list_returns_empty_without_querying(self):
        self.assertEqual(services.compute_message_response_rates([]), {})

    def test_any_failure_is_swallowed_and_returns_empty(self):
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter", side_effect=RuntimeError("db down")):
            rates = services.compute_message_response_rates(["61"])
        self.assertEqual(rates, {})


class RewardDigitalOnlyTests(SimpleTestCase):
    """No physical vouchers — a reward is always digital, regardless of what
    a client sends, and it isn't editable after creation."""

    def setUp(self):
        self.factory = RequestFactory()

    def _reward(self, **overrides):
        defaults = dict(
            id=1, name="Costa Voucher", description="A £5 voucher", points=100, category="Food",
            delivery_type="digital", stock=10, total_claimed=0, image="", popular=False, active=True,
            save=mock.MagicMock(),
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def test_create_ignores_a_client_supplied_delivery_type(self):
        request = self.factory.post(
            "/", data=json.dumps({"name": "Costa Voucher", "points": 100, "deliveryType": "physical"}),
            content_type="application/json",
        )
        with mock.patch("engagement_api.models.Reward.objects.create", return_value=self._reward()) as mock_create, \
             _patched(_account(role="staff")):
            response = views.rewards_collection(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(mock_create.call_args.kwargs["delivery_type"], "digital")

    def test_create_does_not_require_a_delivery_type_in_the_payload(self):
        request = self.factory.post("/", data=json.dumps({"name": "Costa Voucher", "points": 100}), content_type="application/json")
        with mock.patch("engagement_api.models.Reward.objects.create", return_value=self._reward()), _patched(_account(role="staff")):
            response = views.rewards_collection(request)
        self.assertEqual(response.status_code, 201)

    def test_patch_cannot_change_delivery_type(self):
        reward = self._reward()
        request = self.factory.patch("/", data=json.dumps({"deliveryType": "physical"}), content_type="application/json")
        with mock.patch("engagement_api.models.Reward.objects.get", return_value=reward), _patched(_account(role="staff")):
            response = views.reward_detail(request, pk=1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(reward.delivery_type, "digital")  # unchanged


class LearnerAnalyticsCacheTests(SimpleTestCase):
    """The endpoint measured at several seconds per call on a real roster —
    Django's ConditionalGetMiddleware answering a repeat with 304 does NOT
    save that cost (the view still runs to build the ETag first), so this
    caches server-side instead. Guards the cache actually short-circuits the
    expensive path, and that it's scoped per programme/cohort filter."""

    def setUp(self):
        self.factory = RequestFactory()
        from django.core.cache import cache
        cache.clear()
        self.addCleanup(cache.clear)

    def test_cache_hit_skips_the_roster_fetch_entirely(self):
        with mock.patch("engagement_api.views.cache") as mock_cache, \
             mock.patch("coach_api.views.fetch_all_learner_profiles") as mock_fetch, \
             _patched(_account(role="staff")):
            mock_cache.get.return_value = [{"id": "61", "name": "Daniel Walsh"}]
            response = views.learner_analytics(self.factory.get("/"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["learners"], [{"id": "61", "name": "Daniel Walsh"}])
        mock_fetch.assert_not_called()

    def test_cache_miss_computes_and_stores_for_next_time(self):
        with mock.patch("engagement_api.views.cache") as mock_cache, \
             mock.patch("coach_api.views.fetch_all_learner_profiles", return_value=[]) as mock_fetch, \
             _patched(_account(role="staff")):
            mock_cache.get.return_value = None
            response = views.learner_analytics(self.factory.get("/"))
        self.assertEqual(response.status_code, 200)
        mock_fetch.assert_called_once()
        mock_cache.set.assert_called_once_with(mock.ANY, [], views.CACHE_TTL_SECONDS)

    def test_cache_key_is_scoped_per_programme_and_cohort(self):
        with mock.patch("engagement_api.views.cache") as mock_cache, \
             mock.patch("coach_api.views.fetch_all_learner_profiles", return_value=[]), \
             _patched(_account(role="staff")):
            mock_cache.get.return_value = None
            views.learner_analytics(self.factory.get("/?programme=MSN&cohort=Sept+2025"))
        cache_key = mock_cache.get.call_args[0][0]
        self.assertIn("MSN", cache_key)
        self.assertIn("Sept 2025", cache_key)

    def test_learner_cannot_read_analytics(self):
        with _patched(_account(role="learner")):
            response = views.learner_analytics(self.factory.get("/"))
        self.assertEqual(response.status_code, 403)


class StatsOverviewAuthTests(SimpleTestCase):
    """stats_overview is staff-only — same gate as every other staff
    mutation/report, checked before any ORM aggregate runs."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_unauthenticated_is_401(self):
        with _patched(None):
            response = views.stats_overview(self.factory.get("/"))
        self.assertEqual(response.status_code, 401)

    def test_learner_is_403(self):
        with _patched(_account(role="learner")):
            response = views.stats_overview(self.factory.get("/"))
        self.assertEqual(response.status_code, 403)

    def test_non_get_is_405(self):
        with _patched(_account(role="staff")):
            response = views.stats_overview(self.factory.post("/"))
        self.assertEqual(response.status_code, 405)
