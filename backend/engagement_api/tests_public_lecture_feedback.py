"""Public lecture QR ownership and delivery contracts without database writes."""
import json
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from login.api_gate import rule_for

from . import lecture_public_feedback as public


def lecture(identifier=31):
    form = SimpleNamespace(
        id=8, form_type='post_lecture', status='published', start_date=None,
        title='Synthetic feedback', description='', instructions='',
        due_date=None,
        allow_save_continue=True, allow_edit_after_submission=False,
        sections=mock.MagicMock(),
    )
    return SimpleNamespace(
        pk=identifier, id=identifier, form_id=form.id, form=form,
        occurrence_key=f'OCC-{identifier}', status='open',
        attendance_source='attendance', group_id='GROUP-1',
        available_at=public.timezone.now() - timedelta(hours=1),
        starts_at=public.timezone.now() - timedelta(hours=2),
        session_title='Synthetic lecture', module_name='Synthetic module',
        module_catalogue_id='MOD-1',
    )


class PublicLectureFeedbackTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_only_public_lecture_prefix_is_ungated(self):
        self.assertIsNone(rule_for('/engagement_api/feedback/public-lecture/'))
        self.assertIsNone(rule_for('/engagement_api/feedback/public-lecture/csrf/'))
        self.assertIsNotNone(rule_for('/engagement_api/feedback/my-deliveries/31/'))

    def test_token_is_specific_to_one_lecture_and_tampering_is_denied(self):
        target = lecture()
        other = lecture(32)
        query = mock.Mock()
        query.filter.return_value.first.return_value = target
        with (mock.patch.object(public.FeedbackDelivery.objects, 'select_related', return_value=query),
              mock.patch.object(public, 'lecture_after_form_creation', return_value=True)):
            self.assertIs(public._delivery_for_token(public.lecture_token(target)), target)
            self.assertIsNone(public._delivery_for_token(public.lecture_token(other)))
            self.assertIsNone(public._delivery_for_token('31.invalid'))
            self.assertIsNone(public._delivery_for_token('9' * 100 + '.' + 'a' * 64))
            target.status = 'closed'
            self.assertIsNone(public._delivery_for_token(public.lecture_token(target)))

    def test_email_matches_either_lms_or_aptem_but_rejects_ambiguity(self):
        learner = SimpleNamespace(pk=17, id=17)
        direct_query = mock.Mock()
        profile_query = mock.Mock()
        direct_query.filter.return_value.values_list.return_value = [17]
        profile_query.filter.return_value.values_list.return_value = []
        with (mock.patch.object(public.EnrolmentUser.all_learners, 'annotate', return_value=direct_query),
              mock.patch.object(public.LearnerProfile.objects, 'annotate', return_value=profile_query),
              mock.patch.object(public.EnrolmentUser.all_learners, 'filter', return_value=mock.Mock(first=lambda: learner))):
            self.assertIs(public._learner_for_email(' LMS@EXAMPLE.TEST '), learner)
            direct_query.filter.return_value.values_list.return_value = []
            profile_query.filter.return_value.values_list.return_value = [17]
            self.assertIs(public._learner_for_email('aptem@example.test'), learner)
            direct_query.filter.return_value.values_list.return_value = [18]
            self.assertIsNone(public._learner_for_email('aptem@example.test'))
            self.assertIsNone(public._learner_for_email('not-an-email'))

    def test_latest_available_lecture_is_selected_across_all_live_session_forms(self):
        modules = {'MOD-1': SimpleNamespace(group_id='GROUP-1')}
        newest = lecture(33)
        newest.form.start_date = public.timezone.now() + timedelta(hours=1)
        latest_open = lecture(32)
        oldest = lecture(31)
        latest_open.starts_at += timedelta(minutes=30)
        query = mock.Mock()
        query.filter.return_value.filter.return_value.order_by.return_value = [newest, latest_open, oldest]
        with (mock.patch.object(public.FeedbackDelivery.objects, 'select_related', return_value=query),
              mock.patch.object(public, 'lecture_after_form_creation', return_value=True)):
            self.assertIs(public._latest_available_delivery(modules), latest_open)
        filters = query.filter.call_args.kwargs
        self.assertEqual(filters['module_catalogue_id__in'], modules)
        self.assertEqual(filters['form__form_type'], 'post_lecture')
        self.assertEqual(filters['form__status'], 'published')
        query.filter.return_value.filter.return_value.order_by.assert_called_once_with('-starts_at', '-id')

    def test_static_link_discovers_a_signed_selection_for_the_matched_email(self):
        target = lecture()
        request = self.factory.post('/engagement_api/feedback/public-lecture/',
                                    data=json.dumps({'action': 'discover', 'email': 'learner@example.test'}),
                                    content_type='application/json')
        learner = SimpleNamespace(pk=17)
        with (mock.patch.object(public, '_learner_for_email', return_value=learner),
              mock.patch.object(public, '_eligible_modules', return_value={'MOD-1': SimpleNamespace(group_id='GROUP-1')}) as modules,
              mock.patch.object(public, '_current_lecture', return_value=None),
              mock.patch.object(public, '_latest_available_delivery', return_value=target) as latest):
            result = public.public_lecture_access(request)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(json.loads(result.content)['token'], public.lecture_token(target))
        modules.assert_called_once_with(learner)
        latest.assert_called_once_with({'MOD-1': mock.ANY})

    def test_read_rejects_email_outside_the_selected_lecture_module(self):
        request = self.factory.post('/engagement_api/feedback/public-lecture/',
                                    data=json.dumps({'action': 'read', 'token': 'selected', 'email': 'other@example.test'}),
                                    content_type='application/json')
        with (mock.patch.object(public, '_delivery_for_token', return_value=lecture()),
              mock.patch.object(public, '_learner_for_email', return_value=SimpleNamespace(pk=17)),
              mock.patch.object(public, '_eligible_modules', return_value={'MOD-2': SimpleNamespace(group_id='GROUP-1')}),
              mock.patch.object(public.FeedbackResponse.objects, 'filter') as responses):
            result = public.public_lecture_access(request)
        self.assertEqual(result.status_code, 404)
        responses.assert_not_called()

    def test_unknown_email_is_rejected_before_any_response_is_read_or_saved(self):
        request = self.factory.post('/engagement_api/feedback/public-lecture/',
                                    data=json.dumps({'action': 'read', 'token': 'link', 'email': 'other@example.test'}),
                                    content_type='application/json')
        with (mock.patch.object(public, '_delivery_for_token', return_value=lecture()),
              mock.patch.object(public, '_learner_for_email', return_value=None),
              mock.patch.object(public.FeedbackResponse.objects, 'filter') as responses,
              mock.patch.object(public, '_claim_recipient') as claim):
            result = public.public_lecture_access(request)
        self.assertEqual(result.status_code, 404)
        self.assertIn('Invalid email', result.content.decode())
        responses.assert_not_called()
        claim.assert_not_called()

    def test_save_uses_canonical_learner_and_existing_delivery(self):
        target = lecture()
        learner = SimpleNamespace(pk=17, username='Synthetic Learner')
        recipient = SimpleNamespace(pk=4)
        request = self.factory.post('/engagement_api/feedback/public-lecture/',
                                    data=json.dumps({'action': 'save', 'token': 'link', 'email': 'a@example.test',
                                                     'answers': {'12': 5}, 'submit': True}),
                                    content_type='application/json')
        with (mock.patch.object(public, '_delivery_for_token', return_value=target),
              mock.patch.object(public, '_learner_for_email', return_value=learner),
              mock.patch.object(public, '_eligible_modules', return_value={'MOD-1': SimpleNamespace(group_id='GROUP-1')}),
              mock.patch.object(public, '_claim_recipient', return_value=recipient) as claim,
              mock.patch.object(public, 'save_owned_response', return_value=JsonResponse({'response': {'status': 'completed'}})) as save):
            result = public.public_lecture_access(request)
        self.assertEqual(result.status_code, 200)
        claim.assert_called_once_with(target, learner)
        self.assertEqual(save.call_args.kwargs['learner_id'], '17')
        self.assertIs(save.call_args.kwargs['delivery'], target)
        self.assertIs(save.call_args.kwargs['recipient'], recipient)

    def test_module_member_without_attendance_gets_a_persistent_lecture_recipient(self):
        target = lecture()
        learner = SimpleNamespace(pk=17, username='Synthetic Learner', email='learner@example.test', programme='Synthetic')
        recipient = SimpleNamespace(public_claimed_at=None, revoked_at=None)
        recipient.save = mock.Mock()
        query = mock.Mock()
        query.get_or_create.return_value = (recipient, True)
        with (mock.patch.object(public.transaction, 'atomic', return_value=nullcontext()),
              mock.patch.object(public.FeedbackDeliveryRecipient.objects, 'select_for_update', return_value=query)):
            self.assertIs(public._claim_recipient(target, learner), recipient)
        self.assertIsNotNone(recipient.public_claimed_at)
        query.get_or_create.assert_called_once()
        self.assertEqual(query.get_or_create.call_args.kwargs['learner_id'], '17')
        self.assertEqual(query.get_or_create.call_args.kwargs['delivery'], target)
        recipient.save.assert_called_once_with(update_fields=['public_claimed_at', 'revoked_at'])

    def test_final_hour_begins_at_sixty_minutes_and_never_before_lecture_start(self):
        start = datetime(2026, 11, 4, 10, 0, tzinfo=timezone.utc)
        occurrence = SimpleNamespace(scheduled_start=start, scheduled_end=start + timedelta(hours=2),
                                     actual_end=None, status='scheduled')
        self.assertFalse(public._window_open(occurrence, start + timedelta(minutes=59, seconds=59)))
        self.assertTrue(public._window_open(occurrence, start + timedelta(minutes=60)))
        self.assertFalse(public._window_open(occurrence, start + timedelta(hours=2)))
        occurrence.scheduled_end = start + timedelta(minutes=30)
        self.assertFalse(public._window_open(occurrence, start - timedelta(seconds=1)))
        self.assertTrue(public._window_open(occurrence, start))
        occurrence.actual_end = start + timedelta(minutes=5)
        self.assertFalse(public._window_open(occurrence, start + timedelta(minutes=6)))

    def test_final_hour_accepts_curriculum_naive_utc_timestamps(self):
        now = datetime(2026, 11, 5, 11, 30, tzinfo=timezone.utc)
        occurrence = SimpleNamespace(
            scheduled_start=datetime(2026, 11, 5, 10, 0),
            scheduled_end=datetime(2026, 11, 5, 12, 0),
            actual_end=None, status='scheduled',
        )
        self.assertTrue(public._window_open(occurrence, now))
        self.assertFalse(public._window_open(occurrence, now - timedelta(hours=1)))

    def test_public_token_rechecks_live_schedule_and_cancellation(self):
        start = datetime(2026, 11, 4, 10, 0, tzinfo=timezone.utc)
        occurrence = SimpleNamespace(live_session_id='LIVE-1', scheduled_start=start.replace(tzinfo=None),
                                     scheduled_end=(start + timedelta(hours=2)).replace(tzinfo=None), actual_end=None,
                                     status='scheduled')
        parent = SimpleNamespace(module_catalogue_id='MOD-1', status='active')
        delivery = SimpleNamespace(occurrence_key='OCC-1', module_catalogue_id='MOD-1')
        occurrences = mock.Mock()
        occurrences.filter.return_value.first.return_value = occurrence
        sessions = mock.Mock()
        sessions.filter.return_value.first.return_value = parent
        with (mock.patch.object(public.LiveSessionOccurrence.objects, 'filter', side_effect=occurrences.filter),
              mock.patch.object(public.LiveSession.objects, 'filter', side_effect=sessions.filter)):
            self.assertFalse(public._provisional_delivery_open(delivery, start + timedelta(minutes=59)))
            self.assertTrue(public._provisional_delivery_open(delivery, start + timedelta(minutes=60)))
            occurrence.status = 'cancelled'
            self.assertFalse(public._provisional_delivery_open(delivery, start + timedelta(minutes=61)))
            occurrence.status = 'scheduled'
            occurrence.scheduled_end = (start + timedelta(hours=3)).replace(tzinfo=None)
            self.assertFalse(public._provisional_delivery_open(delivery, start + timedelta(minutes=61)))
            occurrence.actual_end = (start + timedelta(minutes=62)).replace(tzinfo=None)
            self.assertTrue(public._provisional_delivery_open(delivery, start + timedelta(minutes=63)))

    def test_group_mismatch_denies_lecture_even_when_module_id_matches(self):
        target = lecture()
        learner = SimpleNamespace(pk=17)
        with (mock.patch.object(public, '_delivery_for_token', return_value=target),
              mock.patch.object(public, '_learner_for_email', return_value=learner),
              mock.patch.object(public, '_eligible_modules', return_value={
                  'MOD-1': SimpleNamespace(group_id='OTHER-GROUP'),
              })):
            delivery, matched, error = public._access('token', 'learner@example.test')
        self.assertIsNone(delivery)
        self.assertIsNone(matched)
        self.assertEqual(error.status_code, 404)

    def test_qr_uses_exact_module_assignment_when_home_group_differs(self):
        learner = SimpleNamespace(pk=17, group='Home group')
        own = SimpleNamespace(module_catalogue_id='MOD-1', group_id='GROUP-1')
        other = SimpleNamespace(module_catalogue_id='MOD-2', group_id='GROUP-2')
        missing_group = SimpleNamespace(module_catalogue_id='MOD-3', group_id='')
        with (mock.patch.object(public, 'assigned_active_module_ids', return_value={'MOD-1', 'MOD-2'}),
              mock.patch.object(public.ModuleAuthoringModule.objects, 'filter', return_value=[own, other, missing_group]) as modules):
            self.assertEqual(public._eligible_modules(learner), {'MOD-1': own, 'MOD-2': other})
        self.assertEqual(modules.call_args.kwargs['module_catalogue_id__in'], {'MOD-1', 'MOD-2'})
        self.assertNotIn('group_id', modules.call_args.kwargs)

    def test_cross_group_assigned_lecture_opens_in_final_hour(self):
        now = datetime(2026, 11, 5, 10, 30, tzinfo=timezone.utc)
        learner = SimpleNamespace(pk=17, group='Home group')
        module = SimpleNamespace(module_catalogue_id='MOD-1', group_id='DELIVERY-GROUP')
        occurrence = SimpleNamespace(scheduled_start=now - timedelta(hours=1),
                                     scheduled_end=now + timedelta(minutes=30), actual_end=None,
                                     status='scheduled')
        target = lecture()
        target.group_id = module.group_id
        request = self.factory.post('/engagement_api/feedback/public-lecture/',
                                    data=json.dumps({'action': 'discover', 'email': 'learner@example.test'}),
                                    content_type='application/json')
        with (mock.patch.object(public.timezone, 'now', return_value=now),
              mock.patch.object(public, '_learner_for_email', return_value=learner),
              mock.patch.object(public, 'assigned_active_module_ids', return_value={'MOD-1'}),
              mock.patch.object(public.ModuleAuthoringModule.objects, 'filter', return_value=[module]),
              mock.patch.object(public, '_current_lecture', return_value=(occurrence, SimpleNamespace(), module)),
              mock.patch.object(public, '_ensure_current_delivery', return_value=target)):
            result = public.public_lecture_access(request)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(json.loads(result.content)['token'], public.lecture_token(target))

    def test_cross_group_assigned_lecture_remains_available_after_attendance(self):
        learner = SimpleNamespace(pk=17, group='Home group')
        module = SimpleNamespace(module_catalogue_id='MOD-1', group_id='DELIVERY-GROUP')
        target = lecture()
        target.group_id = module.group_id
        deliveries = mock.Mock()
        deliveries.filter.return_value.filter.return_value.order_by.return_value = [target]
        request = self.factory.post('/engagement_api/feedback/public-lecture/',
                                    data=json.dumps({'action': 'discover', 'email': 'learner@example.test'}),
                                    content_type='application/json')
        with (mock.patch.object(public, '_learner_for_email', return_value=learner),
              mock.patch.object(public, 'assigned_active_module_ids', return_value={'MOD-1'}),
              mock.patch.object(public.ModuleAuthoringModule.objects, 'filter', return_value=[module]),
              mock.patch.object(public, '_current_lecture', return_value=None),
              mock.patch.object(public.FeedbackDelivery.objects, 'select_related', return_value=deliveries),
              mock.patch.object(public, 'lecture_after_form_creation', return_value=True)):
            result = public.public_lecture_access(request)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(json.loads(result.content)['token'], public.lecture_token(target))

    def test_current_lecture_selection_uses_only_matched_modules_and_ongoing_occurrences(self):
        now = datetime(2026, 11, 4, 11, 0, tzinfo=timezone.utc)
        module = SimpleNamespace(module_catalogue_id='MOD-1', group_id='GROUP-1')
        parent = SimpleNamespace(pk='LIVE-1', module_catalogue_id='MOD-1', status='active')
        occurrence = SimpleNamespace(live_session_id='LIVE-1', scheduled_start=now - timedelta(hours=1),
                                     scheduled_end=now + timedelta(hours=1), status='scheduled')
        occurrences = mock.Mock()
        occurrences.order_by.return_value = [occurrence]
        with (mock.patch.object(public.LiveSession.objects, 'filter', return_value=[parent]) as sessions,
              mock.patch.object(public.LiveSessionOccurrence.objects, 'filter', return_value=occurrences) as rows):
            self.assertEqual(public._current_lecture({'MOD-1': module}, now), (occurrence, parent, module))
        sessions.assert_called_once_with(module_catalogue_id__in={'MOD-1': module})
        self.assertEqual(rows.call_args.kwargs['live_session_id__in'], {'LIVE-1': parent})
        self.assertEqual(rows.call_args.kwargs['scheduled_start__lte'], now)
        self.assertEqual(rows.call_args.kwargs['scheduled_end__gt'], now)

    def test_ongoing_lecture_before_final_hour_never_falls_back_to_older_feedback(self):
        now = datetime(2026, 11, 4, 10, 30, tzinfo=timezone.utc)
        occurrence = SimpleNamespace(scheduled_start=now - timedelta(minutes=30),
                                     scheduled_end=now + timedelta(hours=2), actual_end=None,
                                     status='scheduled')
        current = (occurrence, SimpleNamespace(), SimpleNamespace())
        request = self.factory.post('/engagement_api/feedback/public-lecture/',
                                    data=json.dumps({'action': 'discover', 'email': 'learner@example.test'}),
                                    content_type='application/json')
        with (mock.patch.object(public.timezone, 'now', return_value=now),
              mock.patch.object(public, '_learner_for_email', return_value=SimpleNamespace(pk=17)),
              mock.patch.object(public, '_eligible_modules', return_value={'MOD-1': SimpleNamespace()}),
              mock.patch.object(public, '_current_lecture', return_value=current),
              mock.patch.object(public, '_latest_available_delivery') as previous,
              mock.patch.object(public, '_ensure_current_delivery') as create):
            result = public.public_lecture_access(request)
        self.assertEqual(result.status_code, 409)
        self.assertIn('final 60 minutes', result.content.decode())
        previous.assert_not_called()
        create.assert_not_called()

    def test_ongoing_lecture_final_hour_selects_current_pinned_delivery(self):
        now = datetime(2026, 11, 4, 11, 0, tzinfo=timezone.utc)
        occurrence = SimpleNamespace(scheduled_start=(now - timedelta(hours=1)).replace(tzinfo=None),
                                     scheduled_end=(now + timedelta(hours=1)).replace(tzinfo=None), actual_end=None,
                                     status='scheduled')
        module = SimpleNamespace(module_catalogue_id='MOD-1', group_id='GROUP-1')
        target = lecture()
        current = (occurrence, SimpleNamespace(), module)
        request = self.factory.post('/engagement_api/feedback/public-lecture/',
                                    data=json.dumps({'action': 'discover', 'email': 'learner@example.test'}),
                                    content_type='application/json')
        with (mock.patch.object(public.timezone, 'now', return_value=now),
              mock.patch.object(public, '_learner_for_email', return_value=SimpleNamespace(pk=17)),
              mock.patch.object(public, '_eligible_modules', return_value={'MOD-1': module}),
              mock.patch.object(public, '_current_lecture', return_value=current),
              mock.patch.object(public, '_ensure_current_delivery', return_value=target) as ensure,
              mock.patch.object(public, '_latest_available_delivery') as previous):
            result = public.public_lecture_access(request)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(json.loads(result.content)['token'], public.lecture_token(target))
        ensure.assert_called_once_with(occurrence, module, now)
        previous.assert_not_called()

    def test_early_delivery_is_created_once_with_group_snapshot_and_pinned_questions(self):
        now = datetime(2026, 11, 4, 11, 0, tzinfo=timezone.utc)
        occurrence = SimpleNamespace(pk='OCC-1', scheduled_start=(now - timedelta(hours=1)).replace(tzinfo=None),
                                     scheduled_end=(now + timedelta(hours=1)).replace(tzinfo=None), session_number=4)
        module = SimpleNamespace(module_catalogue_id='MOD-1', programme_id='P', programme_name='Programme',
                                 cohort_id='C', cohort_name='Cohort', group_id='GROUP-1', group_name='Group',
                                 title='Module', tutor_name='Tutor')
        form = SimpleNamespace(form_type='post_lecture', status='published', start_date=None)
        delivery = SimpleNamespace(form=form, status='open', module_catalogue_id='MOD-1', group_id='GROUP-1')
        query = mock.Mock()
        query.select_related.return_value.filter.return_value.first.side_effect = [None, delivery]
        with (mock.patch.object(public.transaction, 'atomic', return_value=nullcontext()),
              mock.patch.object(public.FeedbackDelivery.objects, 'select_for_update', return_value=query),
              mock.patch.object(public.FeedbackDelivery.objects, 'get_or_create', return_value=(delivery, True)) as create,
              mock.patch.object(public, '_form_for_occurrence', return_value=form),
              mock.patch.object(public, 'lecture_after_form_creation', return_value=True),
              mock.patch.object(public, 'tag_transaction'),
              mock.patch.object(public, '_pin_delivery_questions') as pin,
              mock.patch.object(public, 'ensure_delivery_questions') as ensure):
            self.assertIs(public._ensure_current_delivery(occurrence, module, now), delivery)
            self.assertIs(public._ensure_current_delivery(occurrence, module, now), delivery)
        defaults = create.call_args.kwargs['defaults']
        self.assertEqual(defaults['attendance_source'], public.QR_SCHEDULE_SOURCE)
        self.assertEqual(defaults['group_id'], 'GROUP-1')
        self.assertEqual(defaults['available_at'], now + timedelta(hours=1))
        self.assertEqual(defaults['starts_at'], now - timedelta(hours=1))
        pin.assert_called_once_with(delivery, form)
        ensure.assert_called_once_with(delivery)

