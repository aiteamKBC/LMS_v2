"""Authorised completed/awaiting-signature -> in-progress reopen.

    python manage.py test coach_api.tests_review_instance_reopen

A reopen edits the SAME review_instances row in place -- no new instance, no
revision -- and clears every signature already collected, because the answers
those signatures were given against are about to change. What the review looked
like immediately beforehand is frozen into
curriculum.review_instance_reopens.previous_state_snapshot, which is the only
surviving copy of the cleared signatures.

Covered here: the status guard in both directions, the signature clear-down and
its snapshot, the Calendar projection, a full edit-and-re-complete cycle, and
the compare-and-swap that rejects a double reopen.

Role-rejection for a learner/employer session is not re-tested (same reasoning
as tests_review_instance_manual_override): @coach_access_required is already
covered by coach_api.tests_security.
"""
import json
from datetime import date, time
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection, transaction
from django.test import RequestFactory, TestCase

from curriculum_api import review_instances, review_types, reviews
from curriculum_api import views as curriculum_views

from . import views as coach_views
from .models import CoachCalendarEvent

COACH_EMAIL = 'coach@example.com'
SIGNATURE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='


class ReopenReviewInstanceTestCase(TestCase):
    databases = {'default'}

    # ------------------------------------------------------------- fixture

    def setUp(self):
        curriculum_views.reset_schema_ready_flags()
        curriculum_views.invalidate_curriculum_cache()
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        review_types.provision_review_types_table()
        review_instances.provision_review_instance_tables()
        review_instances._provision_review_instance_reopens_table()
        # Marks the reopens gate satisfied so ensure_review_instance_reopens_
        # table never runs its first CREATE TABLE partway through a test -- the
        # same hazard mark_review_instance_in_progress_manually documents for
        # the manual-overrides table.
        review_instances._REOPENS_TABLE_READY = True
        self._clear()
        self._programme()

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table = 'curriculum.programmes'
            else:
                table = 'programmes'
            cursor.execute(
                f"""
                create table if not exists {table} (
                    id varchar(128) primary key, programme_id varchar(128), program_id varchar(128),
                    name varchar(255), status varchar(32), is_active boolean, is_archived boolean,
                    created_at timestamp, updated_at timestamp
                )
                """
            )

    def _clear(self):
        for table in (
            review_instances.REVIEW_INSTANCE_REOPENS_TABLE,
            review_instances.REVIEW_INSTANCE_SIGNATURES_TABLE,
            review_instances.REVIEW_INSTANCE_ANSWERS_TABLE,
            review_instances.REVIEW_INSTANCES_TABLE,
            reviews.REVIEW_FIELDS_TABLE, reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE, review_types.REVIEW_TYPES_TABLE, 'programmes',
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {curriculum_views.authoring_table_name(table)}')
        review_types.seed_system_review_types()

    def _programme(self):
        curriculum_views.insert_row('programmes', {
            'id': 'PROG-REOPEN', 'programme_id': 'PROG-REOPEN', 'program_id': 'PROG-REOPEN',
            'name': 'Reopen Programme', 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': curriculum_views.datetime.utcnow(), 'updated_at': curriculum_views.datetime.utcnow(),
        })
        curriculum_views.invalidate_curriculum_cache()

    def _template(self):
        type_id = review_types.get_review_type_by_code('mcm')['id']
        review_id, errors = reviews.create_review('PROG-REOPEN', {
            'name': 'Monthly Coaching Meeting',
            'enabled': True, 'reviewTypeId': type_id,
            'recurrence': {'interval': 4, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [
                {'title': 'How is it going?', 'fieldType': 'text_multiline', 'required': True},
            ]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _linked_row(self, *, learner_id=901):
        """A scheduled, Curriculum-linked calendar row + its review instance."""
        review_id = self._template()
        record = CoachCalendarEvent.objects.create(
            event_key=f'mcr:{learner_id}:1:2026-10-01', event_type='mcr',
            owner_email=COACH_EMAIL, owner_name='Coach',
            learner_id=learner_id, learner_name='Learner', learner_email='learner@example.com',
            scheduled_date=date(2026, 10, 1), scheduled_time=time(10, 0),
            target_date=date(2026, 10, 1), duration_minutes=30,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/reopen-test',
            review_template_id=review_id,
        )
        base_event = {'eventKey': record.event_key, 'source': 'mcr',
                      'targetDate': '2026-10-01', 'learnerId': learner_id}
        coach_views.ensure_review_instance_for_calendar_record(record, base_event)
        record.refresh_from_db()
        return record, review_id

    def _answered_in_progress(self, *, answer='All good.'):
        """Drive a linked review to in-progress with its required field answered.

        force_review_instance_status_for_tests stands in for the real trigger
        (confirmed Teams attendance) exactly as it does in
        curriculum_api.tests_review_instances.
        """
        record, review_id = self._linked_row()
        field_id = reviews.get_review_field_rows(review_id)[0]['id']
        review_instances.force_review_instance_status_for_tests(
            record.review_instance_id, review_instances.STATUS_IN_PROGRESS, actor='test',
        )
        record.status = CoachCalendarEvent.STATUS_IN_PROGRESS
        record.save(update_fields=['status', 'updated_at'])
        instance = review_instances.get_review_instance(record.review_instance_id)
        review_instances.save_review_instance_answers(instance, {field_id: answer}, actor=COACH_EMAIL)
        return record, review_id, field_id

    def _awaiting_signature(self):
        record, review_id, field_id = self._answered_in_progress()
        instance = review_instances.get_review_instance(record.review_instance_id)
        ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL)
        self.assertTrue(ok, errors)
        # complete_review_instance deliberately does not touch Calendar; the
        # real completion endpoint projects it immediately afterwards. Going
        # through the same helper keeps this fixture in the state production is
        # actually in, rather than one only a direct domain call can produce.
        coach_views._sync_calendar_record_to_review_instance_status(
            review_instances.get_review_instance(record.review_instance_id),
        )
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_AWAITING_SIGNATURE)
        return record, review_id, field_id

    def _completed(self):
        record, review_id, field_id = self._awaiting_signature()
        instance = review_instances.get_review_instance(record.review_instance_id)
        review_instances.record_review_instance_signature(
            instance, 'advisor', signed_by=COACH_EMAIL, signed_name='Coach One',
            signature=SIGNATURE_IMAGE, actor=COACH_EMAIL,
        )
        record.refresh_from_db()
        return record, review_id, field_id

    def _instance(self, record):
        return review_instances.get_review_instance(record.review_instance_id)

    def _reopens(self, record):
        return review_instances.list_review_instance_reopens(record.review_instance_id)

    def _call(self, instance_id, *, body=None, coach_email=COACH_EMAIL, view_as=False, admin=None):
        request = RequestFactory().post(
            f'/coach_api/coach/reviews/{instance_id}/reopen',
            data=json.dumps(body or {}), content_type='application/json',
        )
        request.coach_email = coach_email
        request.coach_view_as = view_as
        request.coach_view_as_admin = admin
        return unwrap(coach_views.coach_review_instance_reopen)(request, instance_id)

    # ------------------------------------------------------ (a) completed

    def test_reopening_a_completed_review_clears_signatures_and_completed_at(self):
        record, _review_id, _field_id = self._completed()
        instance = self._instance(record)
        self.assertEqual(instance['status'], review_instances.STATUS_COMPLETED)
        self.assertIsNotNone(instance['completed_at'])
        signed = review_instances.get_review_instance_signatures(instance['id'])
        self.assertIsNotNone(signed['advisor']['signed_at'])

        ok, row = review_instances.reopen_review_instance_for_editing(
            instance, reason_code='correction-required', actor=COACH_EMAIL,
        )
        self.assertTrue(ok, row)
        self.assertEqual(row['status'], review_instances.STATUS_IN_PROGRESS)
        self.assertIsNone(row['completed_at'])

        # The signature row survives, blanked to the unsigned shape -- not deleted.
        cleared = review_instances.get_review_instance_signatures(instance['id'])
        self.assertEqual(set(cleared), {'advisor'})
        self.assertIsNone(cleared['advisor']['signed_at'])
        self.assertEqual(cleared['advisor']['signature'], '')
        self.assertEqual(cleared['advisor']['signed_by'], '')
        self.assertEqual(cleared['advisor']['signed_name'], '')

    def test_reopen_writes_one_override_row_with_the_previous_state_snapshot(self):
        record, _review_id, field_id = self._completed()
        instance = self._instance(record)

        ok, _row = review_instances.reopen_review_instance_for_editing(
            instance, reason_code='signature-error', note='Wrong signatory.', actor=COACH_EMAIL,
        )
        self.assertTrue(ok)

        rows = self._reopens(record)
        self.assertEqual(len(rows), 1)
        entry = rows[0]
        self.assertEqual(entry['review_instance_id'], instance['id'])
        self.assertEqual(entry['previous_status'], review_instances.STATUS_COMPLETED)
        self.assertEqual(entry['new_status'], review_instances.STATUS_IN_PROGRESS)
        self.assertEqual(entry['reason_code'], 'signature-error')
        self.assertEqual(entry['note'], 'Wrong signatory.')
        self.assertEqual(entry['changed_by'], COACH_EMAIL)
        self.assertEqual(entry['calendar_event_id'], record.pk)

        snapshot = curriculum_views.as_json_value(entry['previous_state_snapshot'], {})
        self.assertEqual(snapshot['instance']['status'], review_instances.STATUS_COMPLETED)
        self.assertIsNotNone(snapshot['instance']['completedAt'])

        # The answers as they stood before the reopen.
        self.assertEqual([a['fieldId'] for a in snapshot['answers']], [field_id])
        self.assertEqual(snapshot['answers'][0]['answer'], 'All good.')

        # The full signature image -- the only surviving copy once the live row
        # has been blanked.
        self.assertEqual(len(snapshot['signatures']), 1)
        captured = snapshot['signatures'][0]
        self.assertEqual(captured['role'], 'advisor')
        self.assertEqual(captured['signature'], SIGNATURE_IMAGE)
        self.assertEqual(captured['signedName'], 'Coach One')
        self.assertIsNotNone(captured['signedAt'])

    # --------------------------------------------- (b) awaiting-signature

    def test_reopening_an_awaiting_signature_review_succeeds(self):
        record, _review_id, _field_id = self._awaiting_signature()
        instance = self._instance(record)
        self.assertEqual(instance['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        ok, row = review_instances.reopen_review_instance_for_editing(
            instance, reason_code='incorrect-answer', actor=COACH_EMAIL,
        )
        self.assertTrue(ok, row)
        self.assertEqual(row['status'], review_instances.STATUS_IN_PROGRESS)
        self.assertIsNone(row['completed_at'])

        rows = self._reopens(record)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['previous_status'], review_instances.STATUS_AWAITING_SIGNATURE)

    # -------------------------------------------- (c) every other status

    def test_reopening_from_any_other_status_is_rejected(self):
        # A distinct learner per case: each _linked_row creates a
        # CoachCalendarEvent whose event_key is unique per learner, and those
        # rows are Django-managed rather than part of _clear()'s curriculum
        # sweep, so reusing one learner here would collide on event_key.
        for learner_id, status in enumerate((
            review_instances.STATUS_NOT_SCHEDULED,
            review_instances.STATUS_SCHEDULED,
            review_instances.STATUS_IN_PROGRESS,
        ), start=940):
            with self.subTest(status=status):
                record, _review_id = self._linked_row(learner_id=learner_id)
                review_instances.force_review_instance_status_for_tests(
                    record.review_instance_id, status, actor='test',
                )
                instance = self._instance(record)

                ok, errors = review_instances.reopen_review_instance_for_editing(
                    instance, reason_code='correction-required', actor=COACH_EMAIL,
                )
                self.assertFalse(ok)
                self.assertIn('status', errors)
                # Nothing was written for a rejected attempt.
                self.assertEqual(self._reopens(record), [])
                self.assertEqual(self._instance(record)['status'], status)

    def test_an_invalid_reason_code_is_rejected_and_other_requires_a_note(self):
        record, _review_id, _field_id = self._completed()
        instance = self._instance(record)

        ok, errors = review_instances.reopen_review_instance_for_editing(
            instance, reason_code='graph-unavailable', actor=COACH_EMAIL,
        )
        self.assertFalse(ok)
        self.assertIn('reason', errors)

        ok, errors = review_instances.reopen_review_instance_for_editing(
            instance, reason_code='other', note='', actor=COACH_EMAIL,
        )
        self.assertFalse(ok)
        self.assertIn('note', errors)

        self.assertEqual(self._reopens(record), [])
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

    # ------------------------------------------------ (d) Calendar mirror

    def test_the_calendar_row_moves_back_to_in_progress_and_clears_completed_at(self):
        record, _review_id, _field_id = self._completed()
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
        self.assertIsNotNone(record.review_completed_at)

        ok, _row = review_instances.reopen_review_instance_for_editing(
            self._instance(record), reason_code='correction-required', actor=COACH_EMAIL,
        )
        self.assertTrue(ok)

        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_IN_PROGRESS)
        self.assertIsNone(record.review_completed_at)

    def test_the_mirror_refuses_a_calendar_row_belonging_to_another_review(self):
        """Identity/ownership must still agree before a reopen may move Calendar.

        Stubbed for the same reason as the allowed-set test below: what is under
        test is the validation branch, not a database round trip.
        """
        instance = {
            'id': 'REVI-STUB', 'calendar_event_id': 1, 'learner_id': 901,
            'review_template_id': 'REV-STUB', 'coach_email': COACH_EMAIL,
        }
        mismatches = {
            'does not point back': SimpleNamespace(
                review_instance_id='REVI-SOMETHING-ELSE', learner_id=901,
                review_template_id='REV-STUB', owner_email=COACH_EMAIL,
            ),
            'different learner': SimpleNamespace(
                review_instance_id='REVI-STUB', learner_id=999,
                review_template_id='REV-STUB', owner_email=COACH_EMAIL,
            ),
            'different Review template': SimpleNamespace(
                review_instance_id='REVI-STUB', learner_id=901,
                review_template_id='REV-OTHER', owner_email=COACH_EMAIL,
            ),
            'different coach': SimpleNamespace(
                review_instance_id='REVI-STUB', learner_id=901,
                review_template_id='REV-STUB', owner_email='someone-else@example.com',
            ),
        }
        for expected, calendar in mismatches.items():
            with self.subTest(mismatch=expected):
                qs = SimpleNamespace(
                    select_for_update=lambda: SimpleNamespace(
                        filter=lambda **kw: SimpleNamespace(first=lambda: calendar),
                    ),
                )
                with patch.object(CoachCalendarEvent, 'objects', qs):
                    with self.assertRaises(ValueError) as caught:
                        review_instances._locked_linked_calendar_for_mirror(instance)
                self.assertIn(expected, str(caught.exception))
                self.assertIn('reconciliation', str(caught.exception).lower())

    def test_the_writer_rolls_everything_back_when_the_mirror_refuses(self):
        """A refused mirror must leave status, signatures and audit untouched.

        """
        record, _review_id, _field_id = self._completed()
        instance = self._instance(record)
        record.review_instance_id = 'REVI-SOMETHING-ELSE'
        record.save(update_fields=['review_instance_id', 'updated_at'])

        with self.assertRaises(ValueError):
            review_instances.reopen_review_instance_for_editing(
                instance, reason_code='correction-required', actor=COACH_EMAIL,
            )

        # Looked up by the real instance id: `record` now deliberately points
        # at a different one.
        reloaded = review_instances.get_review_instance(instance['id'])
        self.assertEqual(reloaded['status'], review_instances.STATUS_COMPLETED)
        self.assertEqual(review_instances.list_review_instance_reopens(instance['id']), [])
        signed = review_instances.get_review_instance_signatures(instance['id'])
        self.assertIsNotNone(signed['advisor']['signed_at'])

    def test_the_mirror_accepts_only_finished_calendar_states(self):
        """The mirror accepts awaiting-signature/completed and nothing else.

        Production keeps instance and Calendar exactly in step -- the completion
        endpoint calls _sync_calendar_record_to_review_instance_status and the
        signature mirror advances it again -- so a Calendar row still sitting at
        in-progress or scheduled under a finished instance means the two have
        genuinely diverged. That must raise, not be quietly written over.

        Stubbed rather than DB-driven: this asserts the allowed-set branch only,
        and letting a ValueError escape a half-finished write inside a TestCase
        transaction upsets sqlite's teardown constraint check. The writer's
        all-or-nothing rollback is covered by the identity test above.
        """
        instance = {'id': 'REVI-STUB', 'calendar_event_id': 1}

        for refused in (
            CoachCalendarEvent.STATUS_IN_PROGRESS,
            CoachCalendarEvent.STATUS_SCHEDULED,
        ):
            with self.subTest(calendar_status=refused):
                calendar = SimpleNamespace(status=refused, review_completed_at='x', saved=False)
                with patch.object(
                    review_instances, '_locked_linked_calendar_for_mirror', return_value=calendar,
                ):
                    with self.assertRaises(ValueError) as caught:
                        review_instances._mirror_linked_calendar_after_reopen(instance)
                message = str(caught.exception).lower()
                self.assertIn('reconciliation', message)
                self.assertIn(refused, message)
                # Nothing was written over on the refused row.
                self.assertEqual(calendar.status, refused)
                self.assertEqual(calendar.review_completed_at, 'x')

        for accepted in (
            CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
            CoachCalendarEvent.STATUS_COMPLETED,
        ):
            with self.subTest(calendar_status=accepted):
                saves = []
                calendar = SimpleNamespace(
                    status=accepted, review_completed_at='x',
                    save=lambda **kw: saves.append(kw),
                )
                with patch.object(
                    review_instances, '_locked_linked_calendar_for_mirror', return_value=calendar,
                ):
                    review_instances._mirror_linked_calendar_after_reopen(instance)
                self.assertEqual(calendar.status, CoachCalendarEvent.STATUS_IN_PROGRESS)
                self.assertIsNone(calendar.review_completed_at)
                self.assertEqual(
                    saves, [{'update_fields': ['status', 'review_completed_at', 'updated_at']}],
                )

    # --------------------------------------- (e) edit and re-complete cycle

    def test_edit_and_re_complete_after_a_reopen_works_end_to_end(self):
        record, _review_id, field_id = self._completed()
        instance = self._instance(record)

        ok, row = review_instances.reopen_review_instance_for_editing(
            instance, reason_code='incorrect-answer', actor=COACH_EMAIL,
        )
        self.assertTrue(ok, row)

        # Edit the answer that was wrong.
        instance = self._instance(record)
        review_instances.save_review_instance_answers(
            instance, {field_id: 'Corrected answer.'}, actor=COACH_EMAIL,
        )
        instance = self._instance(record)

        # Re-complete exactly as if it were the first time: the template still
        # requires an advisor signature, so this lands on awaiting-signature.
        ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL)
        self.assertTrue(ok, errors)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        # And a fresh signature completes it again.
        review_instances.record_review_instance_signature(
            self._instance(record), 'advisor', signed_by=COACH_EMAIL, signed_name='Coach One',
            signature=SIGNATURE_IMAGE, actor=COACH_EMAIL,
        )
        final = self._instance(record)
        self.assertEqual(final['status'], review_instances.STATUS_COMPLETED)
        self.assertIsNotNone(final['completed_at'])

        answers = review_instances.get_review_instance_answers(final['id'])
        self.assertEqual(
            curriculum_views.as_json_value(answers[field_id]['answer'], None),
            'Corrected answer.',
        )

        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
        self.assertIsNotNone(record.review_completed_at)

        # One reopen happened, and its snapshot still holds the ORIGINAL answer.
        rows = self._reopens(record)
        self.assertEqual(len(rows), 1)
        snapshot = curriculum_views.as_json_value(rows[0]['previous_state_snapshot'], {})
        self.assertEqual(snapshot['answers'][0]['answer'], 'All good.')

    # ------------------------------------------------------- (f) the CAS

    def test_a_second_reopen_on_a_stale_row_is_rejected_by_the_compare_and_swap(self):
        record, _review_id, _field_id = self._completed()
        stale = self._instance(record)

        ok, _row = review_instances.reopen_review_instance_for_editing(
            stale, reason_code='correction-required', actor=COACH_EMAIL,
        )
        self.assertTrue(ok)

        # `stale` still claims status=completed, exactly as a second browser tab
        # or a double submit would. The re-check under the row lock must reject
        # it rather than reopening an already-in-progress review a second time.
        ok, errors = review_instances.reopen_review_instance_for_editing(
            stale, reason_code='correction-required', actor=COACH_EMAIL,
        )
        self.assertFalse(ok)
        self.assertIn('status', errors)
        self.assertEqual(len(self._reopens(record)), 1)

    # ----------------------------------------------------------- endpoint

    def test_the_endpoint_reopens_and_returns_the_updated_definition(self):
        record, _review_id, _field_id = self._completed()
        response = self._call(record.review_instance_id, body={'reasonCode': 'correction-required'})
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['instance']['status'], review_instances.STATUS_IN_PROGRESS)
        self.assertEqual(len(self._reopens(record)), 1)

    def test_the_endpoint_refuses_a_coach_who_does_not_own_the_instance(self):
        record, _review_id, _field_id = self._completed()
        response = self._call(
            record.review_instance_id, body={'reasonCode': 'correction-required'},
            coach_email='someone-else@example.com',
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self._reopens(record), [])
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

    def test_the_endpoint_rejects_a_bad_reason_with_400(self):
        record, _review_id, _field_id = self._completed()
        response = self._call(record.review_instance_id, body={'reasonCode': 'nonsense'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('reason', json.loads(response.content)['errors'])
        self.assertEqual(self._reopens(record), [])
