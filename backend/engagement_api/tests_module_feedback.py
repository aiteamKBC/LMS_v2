"""Module checkpoint timing, assignment and ownership without live services."""
import json
from contextlib import nullcontext
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import feedback, module_feedback as modules
from .tests import _account, _patched


class ModuleFeedbackDateTests(SimpleTestCase):
    def test_midpoint_and_end_are_independent_of_session_count(self):
        self.assertEqual(modules.module_feedback_date('2026-10-01', '2026-10-21', 'mid_module').isoformat(),
                         '2026-10-11T00:00:00+01:00')
        self.assertEqual(modules.module_feedback_date('2026-10-01', '2026-10-21', 'end_module').isoformat(),
                         '2026-10-21T00:00:00+01:00')

    def test_odd_length_retains_the_half_day(self):
        self.assertEqual(modules.module_feedback_date('2026-10-01', '2026-10-04', 'mid_module').isoformat(),
                         '2026-10-02T12:00:00+01:00')

    def test_business_calendar_arithmetic_across_both_dst_changes(self):
        for start, end, expected in (
            ('2026-03-27', '2026-03-31', '2026-03-29T00:00:00+00:00'),
            ('2026-10-23', '2026-10-27', '2026-10-25T00:00:00+01:00'),
        ):
            with self.subTest(start=start):
                self.assertEqual(modules.module_feedback_date(start, end, 'mid_module').isoformat(), expected)

    def test_missing_invalid_reversed_dates_never_invent_an_opening(self):
        for start, end in ((None, None), ('invalid', '2026-10-21'), ('2026-10-21', None),
                           ('2026-10-21', '2026-10-01')):
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                modules.module_feedback_date(start, end, 'mid_module')

    def test_one_day_module_opens_both_phases_on_its_date(self):
        self.assertEqual(modules.module_feedback_date('2026-10-21', '2026-10-21', 'mid_module'),
                         modules.module_feedback_date('2026-10-21', '2026-10-21', 'end_module'))


class ModuleMembershipTests(SimpleTestCase):
    def test_staff_sync_uses_explicit_cleared_inherited_and_legacy_assignment_facts(self):
        from curriculum_api import learner_assignment_counts_sql as directory
        base = {'programme': 'Data', 'grp': 'Group', 'ambiguous': False, 'has_plan': True,
                'id_count': 1, 'has_explicit': True, 'matched': ['M1']}
        facts = [
            {**base, 'learner_id': 7},
            {**base, 'learner_id': 8, 'id_count': 0, 'matched': []},
            {**base, 'learner_id': 9, 'has_plan': False, 'matched': []},
            {**base, 'learner_id': 10, 'ambiguous': True},
        ]
        legacy = SimpleNamespace(learning_plan=[{'moduleId': 'M1', 'assignmentMode': 'explicit'}], training_plan=None)
        with (
            mock.patch.object(directory, 'fetch_plan_facts', return_value=facts),
            mock.patch.object(modules.plans, 'group_module_ids_bulk', return_value={('Data', 'Group'): ['M2']}),
            mock.patch.object(modules.EnrolmentUser.all_learners, 'get', return_value=legacy),
        ):
            self.assertEqual(modules.module_memberships({'M1', 'M2'}),
                             {'7': {'M1'}, '8': set(), '9': {'M2'}, '10': {'M1'}})

    def test_cleared_explicit_commercial_and_apprenticeship_plans_use_existing_rules(self):
        for kind, plan, training, expected in (
            ('apprenticeship', [], None, set()),
            ('apprenticeship', [{'moduleId': 'M1', 'assignmentMode': 'explicit'}], None, {'M1'}),
            ('commercial', [{'moduleId': 'OTHER'}], [{'moduleId': 'M2', 'assignmentMode': 'explicit'}], {'M2'}),
            ('apprenticeship', [{'moduleId': 'M1'}], None, {'M1', 'M2'}),
            ('apprenticeship', None, None, {'M2'}),
        ):
            learner = SimpleNamespace(pk=7, programme='Data', group='Group', learner_type=kind,
                                      learning_plan=plan, training_plan=training)
            query = mock.Mock()
            query.first.return_value = learner
            with (
                self.subTest(kind=kind, plan=plan),
                mock.patch.object(modules.EnrolmentUser.all_learners, 'filter', return_value=query),
                mock.patch.object(modules.plans, '_preset_ids_for', return_value=['M2']),
            ):
                self.assertEqual(modules.module_memberships({'M1', 'M2'}, '7'), {'7': expected})

    def test_removed_or_inactive_module_cannot_be_opened(self):
        delivery = SimpleNamespace(module_catalogue_id='M1')
        with mock.patch.object(modules, 'active_modules', return_value=[]):
            self.assertFalse(modules.module_delivery_accessible(delivery, '7'))
        with (
            mock.patch.object(modules, 'active_modules', return_value=[{'module_catalogue_id': 'M1'}]),
            mock.patch.object(modules, 'module_memberships', return_value={'7': {'OTHER'}}),
        ):
            self.assertFalse(modules.module_delivery_accessible(delivery, '7'))


class ModuleDeliveryTests(SimpleTestCase):
    def setUp(self):
        self.module = {
            'module_catalogue_id': 'M1', 'title': 'Foundations',
            'start_date': '2026-10-01', 'end_date': '2026-10-21',
            'programme_id': 'P1', 'programme_name': 'Data', 'cohort_id': 'C1',
            'cohort_name': 'October', 'group_id': 'G1', 'group_name': 'Group',
        }
        self.forms = [self.form(1, 'mid_module'), self.form(2, 'end_module')]
        self.forms_query = mock.Mock()
        self.forms_query.filter.return_value.order_by.return_value = self.forms
        self.delivery_manager = mock.Mock()
        self.recipient_manager = mock.MagicMock()
        self.recipient_manager.select_for_update.return_value = self.recipient_manager
        self.deliveries = {}
        self.recipients = {}
        recipient_query = self.recipient_manager.filter.return_value
        self.recipient_manager.filter.side_effect = lambda **kw: (
            list(self.recipients.values()) if 'delivery_id__in' in kw else recipient_query
        )
        self.delivery_manager.select_related.return_value.filter.side_effect = lambda **kw: list(self.deliveries.values())

        def create_delivery(*, occurrence_key, defaults):
            created = occurrence_key not in self.deliveries
            if created:
                self.deliveries[occurrence_key] = SimpleNamespace(
                    id=len(self.deliveries) + 1, occurrence_key=occurrence_key, status='open', **defaults)
            return self.deliveries[occurrence_key], created

        def create_recipient(*, delivery, learner_id, defaults):
            key = (delivery.id, learner_id)
            created = key not in self.recipients
            if created:
                self.recipients[key] = SimpleNamespace(delivery_id=delivery.id, learner_id=learner_id,
                                                       revoked_at=None, save=mock.Mock(), **defaults)
            return self.recipients[key], created

        self.delivery_manager.get_or_create.side_effect = create_delivery
        self.recipient_manager.get_or_create.side_effect = create_recipient
        learner_query = mock.Mock()
        learner_query.only.return_value = [SimpleNamespace(pk=7, username='Synthetic learner', email='', programme='Data')]
        patches = (
            mock.patch.object(modules.transaction, 'atomic', side_effect=nullcontext),
            mock.patch.object(modules.FeedbackForm.objects, 'select_for_update', return_value=self.forms_query),
            mock.patch.object(modules, 'active_modules', side_effect=lambda: [self.module]),
            mock.patch.object(modules, 'module_memberships', return_value={'7': {'M1'}}),
            mock.patch.object(modules.EnrolmentUser.all_learners, 'filter', return_value=learner_query),
            mock.patch.object(modules, 'FeedbackDelivery', SimpleNamespace(objects=self.delivery_manager)),
            mock.patch.object(modules, 'FeedbackDeliveryRecipient', SimpleNamespace(objects=self.recipient_manager)),
            mock.patch.object(modules.FeedbackResponse.objects, 'filter',
                              return_value=SimpleNamespace(exists=lambda: False)),
        )
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def form(self, pk, phase, **kwargs):
        return SimpleNamespace(id=pk, form_type=phase, delivery_scope='all_modules', module_catalogue_id='',
                               start_date=None, due_date=None,
                               published_at=datetime(2026, 10, 1, tzinfo=timezone.utc), **kwargs)

    def sync_at(self, when):
        with mock.patch.object(modules.timezone, 'now', return_value=datetime.fromisoformat(when)):
            modules.sync_module_feedback('7')

    def test_only_midpoint_opens_at_the_exact_boundary_then_end_opens(self):
        self.sync_at('2026-10-10T22:59:59+00:00')
        self.assertEqual(self.deliveries, {})
        self.sync_at('2026-10-10T23:00:00+00:00')
        self.assertEqual(list(self.deliveries), ['module:mid_module:M1'])
        self.sync_at('2026-10-20T23:00:00+00:00')
        self.assertEqual(set(self.deliveries), {'module:mid_module:M1', 'module:end_module:M1'})
        self.assertEqual(len(self.recipients), 2)

    def test_retry_and_version_edit_preserve_one_delivery_and_its_original_template(self):
        self.sync_at('2026-10-12T00:00:00+00:00')
        first = self.deliveries['module:mid_module:M1']
        self.forms_query.filter.return_value.order_by.return_value = [self.form(9, 'mid_module')]
        self.module['end_date'] = '2026-12-31'
        self.sync_at('2026-10-12T00:00:00+00:00')
        self.assertEqual(len(self.deliveries), 1)
        self.assertEqual(len(self.recipients), 1)
        self.assertEqual(first.form.id, 1)
        self.assertEqual(first.available_at.isoformat(), '2026-10-11T00:00:00+01:00')
        self.assertEqual(self.recipients[(first.id, '7')].available_at.isoformat(), '2026-11-15T12:00:00+00:00')

    def test_started_response_preserves_its_own_date_after_a_schedule_change(self):
        self.sync_at('2026-10-12T00:00:00+00:00')
        first = self.deliveries['module:mid_module:M1']
        self.module['end_date'] = '2026-12-31'
        with mock.patch.object(modules.FeedbackResponse.objects, 'filter', return_value=SimpleNamespace(exists=lambda: True)):
            self.sync_at('2026-10-12T00:00:00+00:00')
        self.assertEqual(self.recipients[(first.id, '7')].available_at.isoformat(), '2026-10-11T00:00:00+01:00')

    def test_schedule_moves_unanswered_learners_without_moving_started_learners(self):
        learners = [SimpleNamespace(pk=key, username=f'Synthetic {key}', email='', programme='Data') for key in (7, 8)]
        query = mock.Mock()
        query.only.return_value = learners
        with (
            mock.patch.object(modules, 'module_memberships', return_value={'7': {'M1'}, '8': {'M1'}}),
            mock.patch.object(modules.EnrolmentUser.all_learners, 'filter', return_value=query),
        ):
            self.sync_at('2026-10-12T00:00:00+00:00')
            self.module['end_date'] = '2026-12-31'
            with mock.patch.object(modules.FeedbackResponse.objects, 'filter', side_effect=lambda **kw: SimpleNamespace(
                exists=lambda: kw['learner_id'] == '7',
            )):
                self.sync_at('2026-10-12T00:00:00+00:00')
        self.assertEqual(self.recipients[(1, '7')].available_at.isoformat(), '2026-10-11T00:00:00+01:00')
        self.assertEqual(self.recipients[(1, '8')].available_at.isoformat(), '2026-11-15T12:00:00+00:00')

    def test_ended_modules_are_not_backfilled_but_current_modules_are(self):
        for form in self.forms:
            form.published_at = datetime(2026, 10, 22, tzinfo=timezone.utc)
        self.sync_at('2026-10-22T12:00:00+00:00')
        self.assertEqual(self.deliveries, {})
        for form in self.forms:
            form.published_at = datetime(2026, 10, 15, tzinfo=timezone.utc)
        self.sync_at('2026-10-15T12:00:00+00:00')
        self.assertEqual(list(self.deliveries), ['module:mid_module:M1'])

    def test_invalid_schedule_hides_only_unstarted_recipients(self):
        self.sync_at('2026-10-12T00:00:00+00:00')
        self.module['start_date'] = None
        self.sync_at('2026-10-12T00:00:00+00:00')
        self.assertIsNone(self.recipients[(1, '7')].available_at)

    def test_unopened_checkpoint_tracks_a_schedule_change(self):
        self.module['end_date'] = '2026-12-01'
        self.sync_at('2026-10-12T00:00:00+00:00')
        self.assertEqual(self.deliveries, {})

    def test_module_override_wins_without_delivering_twice(self):
        specific = self.form(9, 'mid_module')
        specific.delivery_scope, specific.module_catalogue_id = 'module', 'M1'
        self.forms.append(specific)
        self.sync_at('2026-10-12T00:00:00+00:00')
        self.assertIs(self.deliveries['module:mid_module:M1'].form, specific)
        self.assertEqual(len(self.recipients), 1)

    def test_a_template_for_another_module_does_not_match(self):
        for form in self.forms:
            form.delivery_scope, form.module_catalogue_id = 'module', 'OTHER'
        self.sync_at('2026-10-22T00:00:00+00:00')
        self.assertEqual(self.deliveries, {})

    def test_missing_module_dates_and_template_start_do_not_unlock_early(self):
        self.module['start_date'] = None
        self.sync_at('2026-10-22T00:00:00+00:00')
        self.assertEqual(self.deliveries, {})
        self.module['start_date'] = '2026-10-01'
        for form in self.forms:
            form.start_date = datetime(2027, 1, 1, tzinfo=timezone.utc)
        self.sync_at('2026-10-22T00:00:00+00:00')
        self.assertEqual(self.deliveries, {})

    def test_learner_sync_revocation_is_limited_to_that_learner(self):
        self.sync_at('2026-10-12T00:00:00+00:00')
        self.recipient_manager.filter.return_value.filter.assert_called_with(learner_id='7')
        self.recipient_manager.filter.return_value.filter.return_value.exclude.assert_called_with(learner_id__in=['7'])


@override_settings(DEBUG=True)
class ModuleFeedbackAccessTests(SimpleTestCase):
    def test_module_metadata_has_no_manual_opening_or_deadline(self):
        for phase in modules.MODULE_FORM_TYPES:
            form = feedback.FeedbackForm(title='Module feedback', form_type=phase, delivery_scope='all_modules')
            feedback._apply_metadata(form, {
                'startDate': '2026-11-01T00:00:00Z', 'dueDate': '2026-12-01T00:00:00Z',
            })
            self.assertIsNone(form.start_date)
            self.assertIsNone(form.due_date)

    def test_closing_current_template_closes_its_deliveries_across_versions(self):
        form = feedback.FeedbackForm(id=4, title='Module feedback', form_type='mid_module', is_current=True)
        queryset = mock.Mock()
        queryset.get.return_value = form
        with (
            _patched(_account(role='staff', subject_type='staff')),
            mock.patch.object(feedback, '_forms_queryset', return_value=queryset),
            mock.patch.object(form, 'save'),
            mock.patch.object(feedback, 'form_dict', return_value={}),
            mock.patch.object(feedback.transaction, 'atomic', side_effect=nullcontext),
            mock.patch.object(feedback.FeedbackForm.objects, 'filter') as versions,
            mock.patch.object(feedback.FeedbackDelivery.objects, 'filter') as deliveries,
        ):
            response = feedback.form_status(RequestFactory().post(
                '/', data=json.dumps({'status': 'closed'}), content_type='application/json'), pk=4)
        self.assertEqual(response.status_code, 200)
        deliveries.assert_called_once_with(form__template_key=form.template_key, status__in=['open', 'closed'])
        deliveries.return_value.update.assert_called_once_with(status='closed')
        versions.assert_called_once_with(template_key=form.template_key)
        versions.return_value.exclude.assert_called_once_with(pk=4)
        versions.return_value.exclude.return_value.update.assert_called_once_with(status='closed')

    def test_direct_link_rechecks_rescheduled_recipient_before_exposing_questions(self):
        form = SimpleNamespace(form_type='mid_module', start_date=None)
        recipient = SimpleNamespace(delivery=SimpleNamespace(form=form), revoked_at=None,
                                    available_at=datetime(2020, 1, 1, tzinfo=timezone.utc))
        recipient.refresh_from_db = mock.Mock(side_effect=lambda **kw: setattr(
            recipient, 'available_at', datetime(2099, 1, 1, tzinfo=timezone.utc)))
        query = mock.Mock()
        query.get.return_value = recipient
        with (
            mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related', return_value=query),
            mock.patch.object(feedback, 'module_delivery_accessible', return_value=True),
            mock.patch.object(feedback, 'sync_module_feedback') as sync,
        ):
            self.assertEqual(feedback._learner_feedback_context('7', delivery_id=4), (None, None, None))
            sync.assert_called_once_with('7')

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=True)
    def test_explicitly_enabled_module_response_saves_against_the_delivery_and_locked_recipient(self):
        for phase in modules.MODULE_FORM_TYPES:
            form = SimpleNamespace(form_type=phase, allow_save_continue=True, allow_edit_after_submission=False)
            delivery = SimpleNamespace(id=4)
            recipient = SimpleNamespace(pk=8, revoked_at=None, available_at=datetime(2020, 1, 1, tzinfo=timezone.utc))
            response = SimpleNamespace(id=9, status='in_progress', updated_at=None, save=mock.Mock())
            question = feedback.FeedbackQuestion(id=1, question_type='short_text', required=True)
            existing = mock.Mock()
            existing.prefetch_related.return_value.first.return_value = None
            with (
                self.subTest(phase=phase),
                _patched(_account(role='learner', subject_type='learner')),
                mock.patch.object(feedback, '_learner_feedback_context', return_value=(form, delivery, recipient)),
                mock.patch.object(feedback.FeedbackResponse.objects, 'filter', return_value=existing),
                mock.patch.object(feedback.FeedbackQuestion.objects, 'filter', return_value=[question]),
                mock.patch.object(feedback.EnrolmentUser.all_learners, 'get', return_value=SimpleNamespace(username='Learner', programme='Data')),
                mock.patch.object(feedback.transaction, 'atomic', side_effect=nullcontext),
                mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_for_update') as locked,
                mock.patch.object(feedback.FeedbackResponse.objects, 'select_for_update') as responses,
                mock.patch.object(feedback.FeedbackAnswer.objects, 'update_or_create') as answers,
            ):
                locked.return_value.get.return_value = recipient
                responses.return_value.get_or_create.return_value = (response, True)
                result = feedback.learner_response_save(RequestFactory().post(
                    '/', data=json.dumps({'answers': {'1': 'Helpful module'}, 'submit': True}),
                    content_type='application/json'), delivery_id=4)
                self.assertEqual(result.status_code, 200)
                locked.return_value.get.assert_called_once_with(pk=8)
                self.assertEqual(responses.return_value.get_or_create.call_args.kwargs['learner_id'], '61')
                self.assertIs(responses.return_value.get_or_create.call_args.kwargs['delivery'], delivery)
                answers.assert_called_once_with(response=response, question_id=1, defaults={'answer': 'Helpful module'})
                self.assertEqual(response.status, 'completed')

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=False, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_explicitly_disabled_release_blocks_module_forms_alongside_lectures(self):
        request = RequestFactory().get('/')
        with mock.patch.object(feedback, 'learner_identity', return_value='7'):
            for phase in modules.MODULE_FORM_TYPES:
                form = SimpleNamespace(form_type=phase)
                self.assertEqual(feedback._learner_feedback_disabled_response(request, form=form, delivery=object()).status_code, 404)
                self.assertEqual(feedback._learner_feedback_disabled_response(request, form=form).status_code, 404)
            for phase in ('general', 'post_event', 'post_mcm_review', 'post_progress_review'):
                self.assertEqual(feedback._learner_feedback_disabled_response(
                    request, form=SimpleNamespace(form_type=phase), delivery=object()).status_code, 404)

    def test_unassigned_learner_cannot_read_or_submit_an_old_delivery(self):
        form = SimpleNamespace(form_type='mid_module', start_date=None)
        delivery = SimpleNamespace(form=form)
        recipient = SimpleNamespace(delivery=delivery)
        query = mock.Mock()
        query.get.return_value = recipient
        with (
            _patched(_account(role='learner', subject_type='learner')),
            mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related', return_value=query),
            mock.patch.object(feedback, 'module_delivery_accessible', return_value=False),
            mock.patch.object(feedback, 'ensure_delivery_questions') as lecture_draw,
        ):
            self.assertEqual(feedback.learner_form_detail(RequestFactory().get('/'), delivery_id=4).status_code, 404)
            self.assertEqual(feedback.learner_response_save(RequestFactory().post(
                '/', data=json.dumps({'answers': {}, 'submit': True}), content_type='application/json'), delivery_id=4).status_code, 404)
            self.assertEqual(query.get.call_args.kwargs['learner_id'], '61')
            lecture_draw.assert_not_called()

    def test_module_sources_are_not_reported_as_lecture_attendance(self):
        self.assertEqual(feedback._recipient_lecture_summaries([
            {'deliveryId': 4, 'sourceType': 'module', 'responseStatus': 'completed'},
        ]), [])
