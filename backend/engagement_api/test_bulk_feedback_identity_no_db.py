"""Bulk attendance feedback: real read SQL on disposable synthetic SQLite data."""
from contextlib import nullcontext
from datetime import datetime, timezone
import sqlite3
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import feedback_delivery as delivery


class BulkFeedbackIdentityTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.create_function('btrim', 1, lambda value: value.strip() if value is not None else None)
        self.db.executescript('''
            ATTACH DATABASE ':memory:' AS Learner;
            ATTACH DATABASE ':memory:' AS curriculum;
            CREATE TABLE "Learner".learners (id INTEGER PRIMARY KEY, enrolment_id INTEGER, email TEXT);
            INSERT INTO "Learner".learners VALUES
                (11,71,'changed@example.test'), (12,72,'second@example.test'),
                (13,73,'absent@example.test'), (14,NULL,'unlinked@example.test'),
                (21,81,'duplicate1@example.test'), (22,81,'duplicate2@example.test');
            CREATE TABLE curriculum.live_sessions (id TEXT, module_title TEXT, module_catalogue_id TEXT);
            INSERT INTO curriculum.live_sessions VALUES ('S1','Synthetic module','M1');
            CREATE TABLE curriculum.live_session_occurrences (
                id TEXT, live_session_id TEXT, session_number INTEGER, scheduled_start TEXT,
                scheduled_end TEXT, actual_end TEXT, attendance_report_id TEXT, status TEXT);
            INSERT INTO curriculum.live_session_occurrences VALUES
                ('O1','S1',1,'2026-11-01T09:00:00','2026-11-01T10:00:00','2026-11-01T10:00:00','REPORT','completed'),
                ('O2','S1',2,'2026-11-02T09:00:00','2026-11-02T10:00:00',NULL,'','scheduled'),
                ('OTHER','S1',3,'2026-11-03T09:00:00','2026-11-03T10:00:00','2026-11-03T10:00:00','REPORT2','completed');
            CREATE TABLE curriculum.live_session_learner_attendance (
                id INTEGER, occurrence_id TEXT, module_catalogue_id TEXT, learner_profile_id INTEGER,
                learner_email TEXT, learner_name TEXT, attendance_status TEXT);
            INSERT INTO curriculum.live_session_learner_attendance VALUES
                (1,'O1','M1',11,'old@example.test','','present'),
                (2,'O1','M1',12,'second@example.test','Second learner','present'),
                (3,'O1','M1',13,'absent@example.test','Absent learner','absent'),
                (4,'O1','M1',14,'unlinked@example.test','Unlinked learner','present'),
                (5,'O1','M1',999,'changed@example.test','Unknown profile','present'),
                (6,'O1','M1',21,'duplicate1@example.test','Ambiguous learner','present'),
                (7,'O2','M1',11,'changed@example.test','First learner','present'),
                (8,'OTHER','M1',11,'changed@example.test','First learner','present');
            CREATE TABLE curriculum.modules (module_catalogue_id TEXT, title TEXT, tutor_name TEXT, programme_name TEXT, group_id TEXT);
            INSERT INTO curriculum.modules VALUES ('M1','Synthetic module','Tutor','','G1');
            CREATE TABLE curriculum.groups (group_id TEXT, group_name TEXT, cohort_id TEXT);
            INSERT INTO curriculum.groups VALUES ('G1','Group','C1');
            CREATE TABLE curriculum.cohorts (cohort_id TEXT, cohort_name TEXT, programme_id TEXT);
            INSERT INTO curriculum.cohorts VALUES ('C1','Cohort','P1');
            CREATE TABLE curriculum.programmes (programme_id TEXT, name TEXT);
            INSERT INTO curriculum.programmes VALUES ('P1','');
        ''')
        self.statements = []
        cursor = MagicMock()
        def execute(sql, params):
            self.assertNotIn('Created_users', sql)
            self.statements.append((sql, params))
            sql = sql.replace('::text', '')
            bindings = []
            for value in params:
                sql = sql.replace('ANY(%s)', '(' + ','.join('?' for _ in value) + ')', 1)
                # SQLite needs IN in place of PostgreSQL's = ANY(array).
                bindings.extend(value)
            sql = sql.replace('= (', 'IN (')
            result = self.db.execute(sql, bindings)
            cursor.description = result.description
            names = [column[0] for column in result.description]
            cursor.fetchall.return_value = [tuple(
                datetime.fromisoformat(value) if name in ('scheduled_start', 'session_end') and value else value
                for name, value in zip(names, row)) for row in result.fetchall()]
        cursor.execute.side_effect = execute
        cursor.__enter__.return_value = cursor
        self.enterContext(patch.object(delivery, 'connection', SimpleNamespace(vendor='sqlite', cursor=lambda: cursor)))
        self.enterContext(patch.object(delivery.transaction, 'atomic', return_value=nullcontext()))
        self.enterContext(patch.object(delivery.EnrolmentUser.all_learners, 'get_queryset',
                                      side_effect=AssertionError('Created_users is unavailable')))
        self.profile_query = self.enterContext(patch.object(delivery.LearnerProfile, 'objects'))
        def profiles(**filters):
            query = MagicMock()
            query.select_related.return_value.only.return_value = [
                SimpleNamespace(id=row[0], enrolment_id=row[1], full_name=f'Learner {row[0]}', email=row[2],
                                programme_record=SimpleNamespace(name='Profile programme'))
                for row in self.db.execute('SELECT id,enrolment_id,email FROM "Learner".learners')
                if str(row[1]) in filters['enrolment_id__in']]
            return query
        self.profile_query.filter.side_effect = profiles
        self.form = SimpleNamespace(id=3, due_date=None, created_at=datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.saved_delivery = SimpleNamespace(id=50, form=self.form, question_set_pinned=True)
        existing = self.enterContext(patch.object(delivery.FeedbackDelivery.objects, 'select_related'))
        existing.return_value.filter.return_value.first.return_value = self.saved_delivery
        self.save_delivery = self.enterContext(patch.object(delivery.FeedbackDelivery.objects, 'update_or_create',
                                                           return_value=(self.saved_delivery, False)))
        self.redraw = self.enterContext(patch.object(delivery, '_pin_delivery_questions'))
        self.responses = self.enterContext(patch.object(delivery.FeedbackResponse, 'objects'))
        self.enterContext(patch.object(delivery, 'audit'))
        self.recipients = {'71': {'id': 501, 'revoked_at': None, 'public_claimed_at': None},
                           '73': {'id': 503, 'revoked_at': None, 'public_claimed_at': None},
                           'public': {'id': 504, 'revoked_at': None, 'public_claimed_at': 'claimed'}}
        self.original = self.recipients['71']
        self.answer = {'recipient_id': 501, 'answer': 'Existing synthetic response'}
        manager = self.enterContext(patch.object(delivery.FeedbackDeliveryRecipient, 'objects'))
        def exclude(*, enrolment_id__in):
            def revoke(**values):
                changed = 0
                for key, item in self.recipients.items():
                    if key not in enrolment_id__in and item['revoked_at'] is None and item['public_claimed_at'] is None:
                        item.update(values)
                        changed += 1
                return changed
            return SimpleNamespace(update=revoke)
        manager.filter.return_value.exclude.side_effect = exclude
        def upsert(*, delivery, enrolment_id, defaults):
            self.assertEqual(delivery.id, 50)
            created = enrolment_id not in self.recipients
            self.recipients.setdefault(enrolment_id, {'id': 600, 'public_claimed_at': None}).update(defaults)
            return self.recipients[enrolment_id], created
        manager.update_or_create.side_effect = upsert

    def sync(self, ids=('O1',)):
        return delivery.sync_post_lecture_feedback_from_attendance(occurrence_ids=ids, use_learner_profiles=True)

    def test_profile_fk_preserves_recipient_ids_and_responses_after_email_changes_and_retries(self):
        for _ in range(2):
            result = self.sync()
            self.assertEqual(result['recipientsMatched'], 2)
            self.assertEqual(result['unmatchedPresentAttendees'], 3)
            self.assertEqual(result['deliveryIds'], [50])
        self.assertEqual(set(self.recipients), {'71', '72', '73', 'public'})
        self.assertIs(self.recipients['71'], self.original)
        self.assertEqual(self.recipients['71']['id'], self.answer['recipient_id'])
        self.assertEqual(self.answer['answer'], 'Existing synthetic response')
        self.assertEqual(self.recipients['71']['learner_name'], 'Learner 11')
        self.assertEqual(self.recipients['71']['programme'], 'Profile programme')
        self.assertIsNotNone(self.recipients['73']['revoked_at'])
        self.assertIsNone(self.recipients['public']['revoked_at'])
        self.redraw.assert_not_called()
        self.assertEqual(self.responses.mock_calls, [])

    def test_unfinished_session_does_not_deliver_or_revoke_feedback(self):
        self.assertEqual(self.sync(('O2',))['rowsScanned'], 0)
        self.save_delivery.assert_not_called()
        self.assertIsNone(self.recipients['73']['revoked_at'])

    def test_other_occurrences_remain_outside_the_requested_scope(self):
        result = self.sync()
        self.assertEqual(result['occurrencesProcessed'], 1)
        self.assertEqual(self.save_delivery.call_args.kwargs['occurrence_key'], 'O1')
        self.assertEqual(self.statements[0][1], [['O1']])

    def test_duplicate_legacy_keys_are_rejected_in_the_recipient_lookup_too(self):
        result = delivery.sync_post_lecture_feedback(
            delivery.LectureOccurrence(key='O1', module_catalogue_id='M1',
                                       starts_at=datetime(2026, 11, 1, tzinfo=timezone.utc)),
            [delivery.Attendee('81')], attendance_finalized=True, use_learner_profiles=True)
        self.assertEqual(result['missingLearnerIds'], ['81'])
        self.assertEqual(result['recipientsMatched'], 0)
        self.assertNotIn('81', self.recipients)

    def test_form_created_after_the_lecture_does_not_change_history(self):
        self.form.created_at = datetime(2026, 11, 2, tzinfo=timezone.utc)
        self.assertEqual(self.sync()['formsMatched'], 0)
        self.save_delivery.assert_not_called()
        self.assertIsNone(self.recipients['73']['revoked_at'])
