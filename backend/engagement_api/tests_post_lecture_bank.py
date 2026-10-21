"""Question selection and response ownership without external databases or mail."""
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import feedback, feedback_delivery


class PostLectureBankTests(SimpleTestCase):
    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_production_learner_gate_only_accepts_a_lecture_delivery(self):
        request = RequestFactory().get('/')
        with mock.patch.object(feedback, 'learner_identity', return_value='7'):
            lecture = SimpleNamespace(form_type='post_lecture')
            general = SimpleNamespace(form_type='general')
            event = SimpleNamespace(form_type='post_event')
            self.assertIsNone(feedback._learner_feedback_disabled_response(
                request, form=lecture, delivery=SimpleNamespace(id=30),
            ))
            for form, delivery in ((lecture, None), (general, None), (event, None), (event, SimpleNamespace(id=31))):
                self.assertEqual(feedback._learner_feedback_disabled_response(
                    request, form=form, delivery=delivery,
                ).status_code, 404)

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_production_learner_cannot_read_or_save_a_non_lecture_form(self):
        form = SimpleNamespace(form_type='general')
        with (
            mock.patch.object(feedback, 'learner_identity', return_value='7'),
            mock.patch.object(feedback, 'learner_read_scope', return_value=('7', None)),
            mock.patch.object(feedback, 'require_learner_identity', return_value=('7', 'Learner', None)),
            mock.patch.object(feedback, '_learner_feedback_context', return_value=(form, None, None)),
        ):
            detail = feedback.learner_form_detail(RequestFactory().get('/'), pk=4)
            save = feedback.learner_response_save(RequestFactory().post(
                '/', data=json.dumps({'answers': {}, 'submit': True}), content_type='application/json',
            ), pk=4)
        self.assertEqual(detail.status_code, 404)
        self.assertEqual(save.status_code, 404)

    def test_existing_deliveries_keep_their_original_full_question_set(self):
        self.assertIsNone(feedback._selected_delivery_question_ids(
            SimpleNamespace(question_set_pinned=False),
        ))

    def test_unstarted_bank_delivery_from_an_older_worker_is_pinned_once(self):
        delivery = feedback.FeedbackDelivery(id=30, form_id=4, question_set_pinned=False)
        bank_sections = mock.Mock()
        bank_sections.filter.return_value.exists.return_value = True
        form = SimpleNamespace(sections=bank_sections)
        stored = SimpleNamespace(id=30, form=form, question_set_pinned=False)
        locked = mock.Mock()
        locked.select_related.return_value.get.return_value = stored

        def pin(row, template):
            self.assertIs(template, form)
            row.question_set_pinned = True

        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_for_update', return_value=locked),
            mock.patch.object(feedback_delivery.FeedbackResponse.objects, 'filter') as responses,
            mock.patch.object(feedback_delivery, '_pin_delivery_questions', side_effect=pin) as draw,
            mock.patch.object(feedback_delivery.transaction, 'atomic'),
        ):
            responses.return_value.exists.return_value = False
            self.assertTrue(feedback_delivery.ensure_delivery_questions(delivery))
            self.assertTrue(delivery.question_set_pinned)
            self.assertFalse(feedback_delivery.ensure_delivery_questions(delivery))
        draw.assert_called_once_with(stored, form)

    def test_unpinned_bank_with_a_started_response_keeps_its_historical_questions(self):
        delivery = feedback.FeedbackDelivery(id=30, form_id=4, question_set_pinned=False)
        form = SimpleNamespace(sections=mock.Mock())
        form.sections.filter.return_value.exists.return_value = True
        stored = SimpleNamespace(id=30, form=form, question_set_pinned=False)
        locked = mock.Mock()
        locked.select_related.return_value.get.return_value = stored
        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_for_update', return_value=locked),
            mock.patch.object(feedback_delivery.FeedbackResponse.objects, 'filter') as responses,
            mock.patch.object(feedback_delivery, '_pin_delivery_questions') as draw,
            mock.patch.object(feedback_delivery.transaction, 'atomic'),
        ):
            responses.return_value.exists.return_value = True
            self.assertFalse(feedback_delivery.ensure_delivery_questions(delivery))
        draw.assert_not_called()
        self.assertFalse(delivery.question_set_pinned)

    def test_fixed_legacy_form_is_not_converted_into_a_random_bank(self):
        delivery = feedback.FeedbackDelivery(id=30, form_id=4, question_set_pinned=False)
        form = SimpleNamespace(sections=mock.Mock())
        form.sections.filter.return_value.exists.return_value = False
        stored = SimpleNamespace(id=30, form=form, question_set_pinned=False)
        locked = mock.Mock()
        locked.select_related.return_value.get.return_value = stored
        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_for_update', return_value=locked),
            mock.patch.object(feedback_delivery, '_pin_delivery_questions') as draw,
            mock.patch.object(feedback_delivery.transaction, 'atomic'),
        ):
            self.assertFalse(feedback_delivery.ensure_delivery_questions(delivery))
        draw.assert_not_called()

    def test_a_second_reader_uses_the_question_set_saved_by_the_first(self):
        delivery = feedback.FeedbackDelivery(id=30, form_id=4, question_set_pinned=False)
        locked = mock.Mock()
        locked.select_related.return_value.get.return_value = SimpleNamespace(question_set_pinned=True)
        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_for_update', return_value=locked),
            mock.patch.object(feedback_delivery, '_pin_delivery_questions') as draw,
            mock.patch.object(feedback_delivery.transaction, 'atomic'),
        ):
            self.assertFalse(feedback_delivery.ensure_delivery_questions(delivery))
        self.assertTrue(delivery.question_set_pinned)
        draw.assert_not_called()

    def test_learner_context_initializes_the_bank_before_exposing_the_form(self):
        form = SimpleNamespace(start_date=None, form_type='post_lecture')
        delivery = SimpleNamespace(form=form, available_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        recipient = SimpleNamespace(delivery=delivery)
        recipient_query = mock.Mock()
        recipient_query.get.return_value = recipient
        with (
            mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related', return_value=recipient_query),
            mock.patch.object(feedback, 'ensure_delivery_questions') as ensure,
        ):
            self.assertEqual(feedback._learner_feedback_context('7', delivery_id=30), (form, delivery, recipient))
        ensure.assert_called_once_with(delivery)

    def test_attendance_retry_initializes_an_unpinned_existing_bank(self):
        occurrence = feedback_delivery.LectureOccurrence(key='lecture-30', module_catalogue_id='module-1')
        delivery = SimpleNamespace(id=30)
        form = SimpleNamespace(due_date=None)
        with (
            mock.patch.object(feedback_delivery, '_form_for_occurrence', return_value=form),
            mock.patch.object(feedback_delivery.EnrolmentUser.all_learners, 'filter', return_value=[]),
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'update_or_create', return_value=(delivery, False)),
            mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'filter') as recipients,
            mock.patch.object(feedback_delivery, 'ensure_delivery_questions') as ensure,
            mock.patch.object(feedback_delivery.transaction, 'atomic'),
        ):
            recipients.return_value.exclude.return_value.update.return_value = 0
            feedback_delivery.sync_post_lecture_feedback(occurrence, [], attendance_finalized=True)
        ensure.assert_called_once_with(delivery)

    def test_reconciling_attendance_does_not_draw_again_for_an_existing_lecture(self):
        occurrence = feedback_delivery.LectureOccurrence(key='lecture-30', module_catalogue_id='module-1')
        delivery = SimpleNamespace(id=30, question_set_pinned=True)
        form = SimpleNamespace(due_date=None)
        with (
            mock.patch.object(feedback_delivery, '_form_for_occurrence', return_value=form),
            mock.patch.object(feedback_delivery.EnrolmentUser.all_learners, 'filter', return_value=[]),
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'update_or_create', return_value=(delivery, False)),
            mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'filter') as recipients,
            mock.patch.object(feedback_delivery, '_pin_delivery_questions') as pin_questions,
            mock.patch.object(feedback_delivery.transaction, 'atomic'),
        ):
            recipients.return_value.exclude.return_value.update.return_value = 0
            feedback_delivery.sync_post_lecture_feedback(occurrence, [], attendance_finalized=True)
        pin_questions.assert_not_called()

    def test_section_quota_is_limited_to_the_post_lecture_bank_size(self):
        section = {
            'title': 'Teaching', 'questionsPerDelivery': 2,
            'questions': [{'type': 'short_text', 'text': 'One'}],
        }
        with self.assertRaisesRegex(ValueError, 'between 1 and 1'):
            feedback._validated_sections([section], form_type='post_lecture')
        section['questionsPerDelivery'] = 1
        self.assertEqual(feedback._validated_sections([section], form_type='post_lecture')[0]['questionsPerDelivery'], 1)
        with self.assertRaisesRegex(ValueError, 'only for Post-lecture'):
            feedback._validated_sections([section], form_type='general')

    def test_lecture_draws_from_each_category_and_avoids_previous_questions_when_possible(self):
        def question(identifier, text, order):
            return feedback.FeedbackQuestion(
                id=identifier, section_id=10, question_type='short_text',
                question_text=text, sort_order=order,
            )

        teaching = [question(1, 'Clarity A', 0), question(2, 'Clarity B', 1), question(3, 'Clarity C', 2)]
        practice = [question(4, 'Exercise A', 0), question(5, 'Exercise B', 1)]
        sections = [
            SimpleNamespace(title='Teaching', questions_per_delivery=1, questions=mock.Mock(all=mock.Mock(return_value=teaching))),
            SimpleNamespace(title='Practice', questions_per_delivery=1, questions=mock.Mock(all=mock.Mock(return_value=practice))),
        ]
        form = SimpleNamespace(template_key='template-1', sections=mock.Mock())
        form.sections.prefetch_related.return_value.all.return_value = sections
        delivery = feedback.FeedbackDelivery(
            id=30, pk=30, module_catalogue_id='module-1',
            available_at=datetime(2026, 10, 19, tzinfo=timezone.utc),
            question_set_pinned=False,
        )
        delivery.save = mock.Mock()
        previous = SimpleNamespace(selected_questions=mock.Mock())
        previous.selected_questions.select_related.return_value.all.return_value = [
            SimpleNamespace(question=teaching[0]), SimpleNamespace(question=practice[0]),
        ]
        recent_query = mock.MagicMock()
        recent_query.exclude.return_value.order_by.return_value.first.return_value = previous

        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'filter', return_value=recent_query),
            mock.patch.object(feedback_delivery.FeedbackDeliveryQuestion.objects, 'bulk_create') as bulk_create,
        ):
            feedback_delivery._pin_delivery_questions(delivery, form)

        selected = [item.question.id for item in bulk_create.call_args.args[0]]
        self.assertEqual(len(selected), 2)
        self.assertIn(selected[0], {2, 3})
        self.assertEqual(selected[1], 5)
        self.assertTrue(delivery.question_set_pinned)
        delivery.save.assert_called_once_with(update_fields=['question_set_pinned', 'updated_at'])

    @override_settings(LEARNER_FEEDBACK_ENABLED=True)
    def test_learner_cannot_submit_a_bank_question_not_selected_for_the_lecture(self):
        form = SimpleNamespace(allow_save_continue=True)
        delivery = SimpleNamespace(question_set_pinned=True)
        questions = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
        request = RequestFactory().post(
            '/engagement_api/feedback/my-deliveries/30/response/',
            data=json.dumps({'answers': {'2': 'Attempted'}, 'submit': True}),
            content_type='application/json',
        )
        with (
            mock.patch.object(feedback, 'require_learner_identity', return_value=('7', 'Learner', None)),
            mock.patch.object(feedback, '_learner_feedback_context', return_value=(form, delivery, None)),
            mock.patch.object(feedback, '_selected_delivery_question_ids', return_value={1}),
            mock.patch.object(feedback.FeedbackQuestion.objects, 'filter', return_value=questions),
        ):
            response = feedback.learner_response_save(request, delivery_id=30)
        self.assertEqual(response.status_code, 400)
        self.assertIn(b'do not belong', response.content)

    @override_settings(LEARNER_FEEDBACK_ENABLED=True)
    def test_learner_detail_shows_only_questions_pinned_to_the_delivery(self):
        form = SimpleNamespace(form_type='post_lecture')
        delivery = SimpleNamespace(
            id=30, occurrence_key='lecture-30', session_title='Lecture 30',
            starts_at=None, ends_at=None, question_set_pinned=True,
        )
        form_data = {'sections': [{
            'id': 10, 'title': 'Teaching', 'questions': [{'id': 1}, {'id': 2}],
        }]}
        response_query = mock.MagicMock()
        response_query.prefetch_related.return_value.first.return_value = None
        with (
            mock.patch.object(feedback, 'learner_read_scope', return_value=('7', None)),
            mock.patch.object(feedback, '_learner_feedback_context', return_value=(form, delivery, None)),
            mock.patch.object(feedback, '_selected_delivery_question_ids', return_value={1}),
            mock.patch.object(feedback, 'form_dict', return_value=form_data),
            mock.patch.object(feedback.FeedbackResponse.objects, 'filter', return_value=response_query),
        ):
            response = feedback.learner_form_detail(RequestFactory().get('/'), delivery_id=30)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['form']['sections'][0]['questions'], [{'id': 1}])
