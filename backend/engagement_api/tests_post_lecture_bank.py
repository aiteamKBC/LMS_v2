"""Question selection and response ownership without external databases or mail."""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import feedback, feedback_delivery
from .tests import _account, _patched


@override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
class PostLectureCreationBoundaryTests(SimpleTestCase):
    created_at = datetime(2026, 10, 27, 11, tzinfo=timezone.utc)

    def test_repeated_session_result_jobs_do_not_recreate_old_lecture_assignments(self):
        from curriculum_api.management.commands.process_session_results import sync_post_lecture_feedback as result_hook

        # The worker scans ALL finalized occurrences in a series, including
        # old attendance whose feedback delivery has already been deleted.
        # Exercise the actual hook, SQL adapter, UTC conversion and matcher.
        columns = (
            'occurrence_id', 'module_catalogue_id', 'module_title', 'programme_id', 'programme_name',
            'cohort_id', 'cohort_name', 'group_id', 'group_name', 'session_number', 'scheduled_start',
            'session_end', 'attendance_report_id', 'attendance_id', 'learner_name', 'attendance_status', 'learner_id',
        )
        rows = []
        for index, (key, starts_at) in enumerate((
            ('OLD-6', datetime(2026, 10, 6, 10)),
            ('OLD-13', datetime(2026, 10, 13, 10)),
            ('TODAY-1', datetime(2026, 10, 27, 11)),
            ('TODAY-2', datetime(2026, 10, 27, 12)),
        ), start=1):
            rows.append((key, 'MOD-1', 'Synthetic module', '', '', '', '', '', '', index,
                         starts_at, starts_at + timedelta(hours=1), f'REPORT-{index}', index,
                         'Synthetic Learner', 'present', 7))
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.description = [(name,) for name in columns]
        cursor.fetchall.return_value = rows
        form = SimpleNamespace(id=4, created_at=self.created_at, due_date=None)
        saved = {}

        def upsert_delivery(*, occurrence_key, defaults):
            created = occurrence_key not in saved
            if created:
                saved[occurrence_key] = SimpleNamespace(id=len(saved) + 1, **defaults)
            return saved[occurrence_key], created

        selected = mock.Mock()
        selected.filter.side_effect = lambda *, occurrence_key: SimpleNamespace(first=lambda: saved.get(occurrence_key))
        available = mock.Mock()
        available.filter.return_value.order_by.return_value.first.return_value = form
        recipients = mock.Mock()
        recipients.exclude.return_value.update.return_value = 0
        learner = SimpleNamespace(id=7, username='Synthetic Learner', email='', programme='')
        with (
            mock.patch.object(feedback_delivery, 'connection', SimpleNamespace(cursor=lambda: cursor)),
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_related', return_value=selected),
            mock.patch.object(feedback_delivery.FeedbackForm.objects, 'filter', return_value=available),
            mock.patch.object(feedback_delivery.EnrolmentUser.all_learners, 'filter', return_value=[learner]),
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'update_or_create', side_effect=upsert_delivery) as upsert,
            mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'filter', return_value=recipients),
            mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'update_or_create') as assign,
            mock.patch.object(feedback_delivery, '_pin_delivery_questions') as pin,
            mock.patch.object(feedback_delivery, 'ensure_delivery_questions') as ensure,
            mock.patch.object(feedback_delivery.transaction, 'atomic'),
        ):
            for _ in range(2):
                result_hook('SERIES-1')
                self.assertEqual(set(saved), {'TODAY-1', 'TODAY-2'})
            self.assertEqual([call.kwargs['occurrence_key'] for call in upsert.call_args_list],
                             ['TODAY-1', 'TODAY-2', 'TODAY-1', 'TODAY-2'])
            self.assertEqual(assign.call_count, 4)
            self.assertEqual(pin.call_count, 2)
            self.assertEqual(ensure.call_count, 2)
        self.assertEqual(cursor.execute.call_count, 2)
        self.assertIn('o.live_session_id = ANY(%s)', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], [['SERIES-1']])
        self.assertEqual(saved['TODAY-1'].starts_at, self.created_at)
        self.assertEqual(saved['TODAY-1'].available_at, self.created_at + timedelta(hours=1))

    def test_finalized_attendance_only_assigns_lectures_starting_at_or_after_form_creation(self):
        for scope in ('module', 'all_modules'):
            for offset in (-3600, -1, 0, 1, 86400, None):
                with self.subTest(scope=scope, offset=offset):
                    starts_at = None if offset is None else self.created_at + timedelta(seconds=offset)
                    occurrence = feedback_delivery.LectureOccurrence(
                        key='OCC-BOUNDARY', module_catalogue_id='MOD-1', starts_at=starts_at,
                        # Finalization after creation must not make an earlier lecture eligible.
                        ends_at=self.created_at + timedelta(days=2),
                    )
                    form = SimpleNamespace(id=4, created_at=self.created_at, due_date=None,
                                           published_at=self.created_at + timedelta(days=1))
                    available = mock.Mock()
                    available.filter.return_value.order_by.return_value.first.side_effect = (
                        [form] if scope == 'module' else [None, form]
                    )
                    selected = mock.Mock()
                    selected.filter.return_value.first.return_value = None
                    stale = mock.Mock()
                    stale.exclude.return_value.update.return_value = 0
                    learner = SimpleNamespace(id=7, username='Synthetic Learner', email='', programme='')
                    delivery = SimpleNamespace(id=30)
                    with (
                        mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_related', return_value=selected),
                        mock.patch.object(feedback_delivery.FeedbackForm.objects, 'filter', return_value=available),
                        mock.patch.object(feedback_delivery.EnrolmentUser.all_learners, 'filter', return_value=[learner]),
                        mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'update_or_create', return_value=(delivery, True)) as upsert,
                        mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'filter', return_value=stale),
                        mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'update_or_create') as assign,
                        mock.patch.object(feedback_delivery, '_pin_delivery_questions') as pin,
                        mock.patch.object(feedback_delivery.FeedbackResponse.objects, 'filter') as responses,
                        mock.patch.object(feedback_delivery.transaction, 'atomic'),
                    ):
                        result = feedback_delivery.sync_post_lecture_feedback(
                            occurrence, [feedback_delivery.Attendee('7')], attendance_finalized=True,
                        )
                    if offset is not None and offset >= 0:
                        self.assertEqual(result['deliveryIds'], [30])
                        self.assertEqual(result['recipientsMatched'], 1)
                        upsert.assert_called_once()
                        self.assertEqual(upsert.call_args.kwargs['defaults']['available_at'], occurrence.ends_at)
                        assign.assert_called_once_with(delivery=delivery, learner_id='7', defaults=mock.ANY)
                        pin.assert_called_once_with(delivery, form)
                    else:
                        self.assertEqual(result['deliveryIds'], [])
                        self.assertEqual(result['recipientsMatched'], 0)
                        upsert.assert_not_called()
                        assign.assert_not_called()
                        stale.exclude.assert_not_called()
                        pin.assert_not_called()
                    responses.assert_not_called()

    def test_retry_keeps_original_version_and_does_not_reassign_a_pre_creation_lecture(self):
        original = SimpleNamespace(id=4, version=1, created_at=self.created_at)
        selected = mock.Mock()
        selected.filter.return_value.first.return_value = SimpleNamespace(form=original)
        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_related', return_value=selected),
            mock.patch.object(feedback_delivery.FeedbackForm.objects, 'filter') as candidates,
        ):
            self.assertIs(feedback_delivery._form_for_occurrence(
                'ORIGINAL', 'MOD-1', self.created_at + timedelta(days=1),
            ), original)
            self.assertIsNone(feedback_delivery._form_for_occurrence(
                'OLD-BACKFILL', 'MOD-1', self.created_at - timedelta(seconds=1),
            ))
        candidates.assert_not_called()

    def test_boundary_compares_instants_instead_of_calendar_days_or_local_time(self):
        form = SimpleNamespace(created_at=self.created_at)
        cairo_time = timezone(timedelta(hours=3))
        same_instant = self.created_at.astimezone(cairo_time)
        self.assertTrue(feedback_delivery.lecture_after_form_creation(form, same_instant))
        self.assertFalse(feedback_delivery.lecture_after_form_creation(form, same_instant - timedelta(microseconds=1)))

    def test_queue_hides_existing_backfills_without_hiding_other_valid_lectures_or_mutating_responses(self):
        for learner_type in ('apprenticeship', 'commercial'):
            account = _account(role='learner', subject_type='learner')
            account.learner_type = learner_type
            form = SimpleNamespace(id=4, title='Live Sessions', description='', due_date=None,
                                   form_type='post_lecture', created_at=self.created_at)
            recipients = []
            for identifier, offset in ((21, -86400), (22, -1), (23, 0), (24, 3600), (25, None)):
                delivery = SimpleNamespace(id=identifier, form=form, module_name='Synthetic module',
                                           session_title=f'Session {identifier}',
                                           starts_at=None if offset is None else self.created_at + timedelta(seconds=offset))
                recipients.append(SimpleNamespace(delivery=delivery, delivery_id=identifier,
                                                  assigned_at=self.created_at + timedelta(days=1), due_date=None))
            query = mock.Mock()
            query.filter.return_value = query
            query.order_by.return_value = recipients
            completed = SimpleNamespace(id=9, delivery_id=21, status='completed')
            completed_before = vars(completed).copy()
            with (
                self.subTest(learner_type=learner_type), _patched(account),
                mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related', return_value=query),
                mock.patch.object(feedback.FeedbackResponse.objects, 'filter', return_value=[completed]),
            ):
                response = feedback.learner_forms(RequestFactory().get('/'))
            self.assertEqual(response.status_code, 200)
            self.assertEqual([item['deliveryId'] for item in json.loads(response.content)['forms']], [23, 24])
            self.assertEqual(vars(completed), completed_before)
            self.assertEqual(query.filter.call_args_list[0].kwargs['learner_id'], '61')

    def test_pre_creation_direct_links_cannot_read_save_or_upload_and_do_not_touch_history(self):
        form = SimpleNamespace(form_type='post_lecture', start_date=None, created_at=self.created_at)
        delivery = SimpleNamespace(form=form, available_at=self.created_at,
                                   starts_at=self.created_at - timedelta(seconds=1))
        query = mock.Mock()
        query.get.return_value = SimpleNamespace(delivery=delivery)
        factory = RequestFactory()
        with (
            _patched(_account(role='learner', subject_type='learner')),
            mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related', return_value=query),
            mock.patch.object(feedback, 'ensure_delivery_questions') as pin,
            mock.patch.object(feedback.FeedbackResponse.objects, 'filter') as responses,
            mock.patch.object(feedback.FeedbackResponse.objects, 'get_or_create') as create_response,
            mock.patch.object(feedback.FeedbackAnswer.objects, 'update_or_create') as save_answer,
            mock.patch.object(feedback.FeedbackUpload.objects, 'update_or_create') as upload,
        ):
            self.assertEqual(feedback.learner_form_detail(factory.get('/'), delivery_id=21).status_code, 404)
            self.assertEqual(feedback.learner_response_save(factory.post(
                '/', json.dumps({'answers': {}, 'submit': True}), content_type='application/json',
            ), delivery_id=21).status_code, 404)
            self.assertEqual(feedback.learner_photo_upload(factory.post('/'), delivery_id=21, question_id=1).status_code, 404)
        pin.assert_not_called()
        responses.assert_not_called()
        create_response.assert_not_called()
        save_answer.assert_not_called()
        upload.assert_not_called()


@override_settings(DEBUG=True)
class PostLectureBankTests(SimpleTestCase):
    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=False, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_explicitly_disabled_release_blocks_lecture_deliveries_too(self):
        request = RequestFactory().get('/')
        with mock.patch.object(feedback, 'learner_identity', return_value='7'):
            lecture = SimpleNamespace(form_type='post_lecture')
            general = SimpleNamespace(form_type='general')
            event = SimpleNamespace(form_type='post_event')
            self.assertEqual(feedback._learner_feedback_disabled_response(
                request, form=lecture, delivery=SimpleNamespace(id=30),
            ).status_code, 404)
            for form, delivery in ((lecture, None), (general, None), (event, None), (event, SimpleNamespace(id=31))):
                self.assertEqual(feedback._learner_feedback_disabled_response(
                    request, form=form, delivery=delivery,
                ).status_code, 404)

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=False, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_explicitly_disabled_release_cannot_read_or_save_a_non_lecture_form(self):
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

    def test_each_new_occurrence_draws_exact_category_quotas_and_retains_the_fixed_closing_question(self):
        def question(identifier, category):
            return feedback.FeedbackQuestion(id=identifier, question_text=f'{category} {identifier}', sort_order=identifier)

        teaching = [question(identifier, 'Teaching') for identifier in range(1, 5)]
        practice = [question(identifier, 'Practice') for identifier in range(5, 10)]
        closing = question(10, 'Comments')
        sections = [
            SimpleNamespace(questions_per_delivery=1, questions=mock.Mock(all=mock.Mock(return_value=teaching))),
            SimpleNamespace(questions_per_delivery=2, questions=mock.Mock(all=mock.Mock(return_value=practice))),
            SimpleNamespace(questions_per_delivery=None, questions=mock.Mock(all=mock.Mock(return_value=[closing]))),
        ]
        form = SimpleNamespace(template_key='synthetic-bank', sections=mock.Mock())
        form.sections.prefetch_related.return_value.all.return_value = sections
        previous_query = mock.Mock()
        recent = previous_query.exclude.return_value.order_by.return_value
        recent.first.return_value = None
        saved_sets = []
        with (
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'filter', return_value=previous_query),
            mock.patch.object(feedback_delivery.FeedbackDeliveryQuestion.objects, 'bulk_create') as create,
        ):
            for identifier in (101, 102):
                delivery = feedback.FeedbackDelivery(id=identifier, module_catalogue_id='module-1', available_at=datetime(2026, 10, identifier - 100, tzinfo=timezone.utc))
                delivery.save = mock.Mock()
                feedback_delivery._pin_delivery_questions(delivery, form)
                selected = create.call_args.args[0]
                selected_ids = {item.question.id for item in selected}
                self.assertEqual(len(selected), 4)
                self.assertEqual(len(selected_ids.intersection(range(1, 5))), 1)
                self.assertEqual(len(selected_ids.intersection(range(5, 10))), 2)
                self.assertIn(10, selected_ids)
                self.assertTrue(delivery.question_set_pinned)
                saved_sets.append(selected_ids)
                previous = SimpleNamespace(selected_questions=mock.Mock())
                previous.selected_questions.select_related.return_value.all.return_value = selected
                recent.first.return_value = previous
        self.assertEqual(saved_sets[0].intersection(saved_sets[1]), {10})

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
        moment = datetime(2026, 1, 1, tzinfo=timezone.utc)
        form = SimpleNamespace(start_date=None, form_type='post_lecture', created_at=moment)
        delivery = SimpleNamespace(form=form, available_at=moment, starts_at=moment)
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
        with self.assertRaisesRegex(ValueError, 'only for Live Sessions Feedback'):
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
