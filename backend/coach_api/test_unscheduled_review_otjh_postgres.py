"""Unscheduled submission against an independently verified PostgreSQL test DB.

Uses existing application tables and transaction-scoped synthetic rows. No DDL,
Graph, mail or reporting-database writes are needed for these regressions.
"""
from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.db import connection
from django.test import TestCase
from django.utils import timezone

from .migrated_completion import submit
from .migrated_completion_views import _sign_and_complete
from .migrated_otjh import UK
from .migrated_templates import snapshot_for
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewTemplate
from .test_migrated_templates import DEFINITION
from .tests_migrated_completion import PNG


@skipUnless(connection.vendor == 'postgresql', 'Requires verified isolated PostgreSQL')
class UnscheduledReviewHoursTests(TestCase):
    def query(self, sql, params=()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall() if cursor.description else []

    def setUp(self):
        token = uuid4().hex
        email = f'review-{token}@example.invalid'
        self.enrolment_id = self.query(
            'INSERT INTO enrolment."Created_users" ("Username","Email","Learner_type") '
            'VALUES (%s,%s,%s) RETURNING id', ['Synthetic learner', email, 'apprenticeship'])[0][0]
        self.learner_id = self.query(
            'INSERT INTO "Learner".learners '
            '(full_name,email,lifecycle_status,enrolment_id,aptem_id,completed_hours) '
            'VALUES (%s,%s,%s,%s,%s,20) RETURNING id',
            ['Synthetic learner', email, 'active', self.enrolment_id, 9_000_000_000 + int(token[:8], 16)])[0][0]
        self.other_id = self.query(
            'INSERT INTO "Learner".learners (full_name,email,lifecycle_status,completed_hours) '
            'VALUES (%s,%s,%s,40) RETURNING id',
            ['Other synthetic learner', f'other-{email}', 'active'])[0][0]
        self.source_id = self.query(
            'INSERT INTO "Learner".reviews (learner_id,aptem_review_id,review_type,status) '
            'VALUES (%s,%s,%s,%s) RETURNING id',
            [self.learner_id, token, 'Monthly Coaching Meeting', 'Not Scheduled'])[0][0]
        definition = {**deepcopy(DEFINITION),
            'signatures': {'advisor': False, 'participant': True, 'employer': False},
            'otjh': {'expectedHours': 1.25, 'countsTowardsOtjh': True}}
        template = MigratedReviewTemplate.objects.create(
            scope='PROGRAMME', programme_key=f'id:{token}', review_family='MCM',
            name='Synthetic MCM', is_active=True, definition_json=definition)
        self.review = ImportedReviewInstance.objects.create(
            owner_email='coach@example.invalid', event_key=f'imported-review:{token}',
            learner_id=self.learner_id, source_review_id=self.source_id,
            migrated_template=template, template_snapshot=snapshot_for(template), status='not-scheduled')
        self.enterContext(patch('coach_api.migrated_completion_views.booking_for_overlay', return_value=None))
        self.account = SimpleNamespace(pk=901, display_name='Synthetic learner', email=email)

    def ledger(self):
        return self.query('SELECT actual_seconds,actual_basis FROM "Learner".learner_progress_entries '
                          'WHERE learner_id=%s AND canonical_activity_key=%s',
                          [self.learner_id, f'migrated-review:{self.source_id}'])

    def total(self, learner_id):
        return self.query('SELECT completed_hours FROM "Learner".learners WHERE id=%s', [learner_id])[0][0]

    def finish(self):
        _sign_and_complete(self.review, 'participant', account=self.account, signature=PNG)

    def test_unbooked_submission_credits_only_after_signature_and_never_twice(self):
        submit(self.review, {'progress': 'Agreed actions'})
        self.assertEqual(self.review.status, 'awaiting-signature')
        self.assertEqual(self.ledger(), [])
        self.assertEqual(self.total(self.learner_id), Decimal('20'))
        self.finish()
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, 'completed')
        self.assertEqual(self.ledger(), [(Decimal('4500'), 'migrated-review:configured-hours')])
        self.assertEqual(self.total(self.learner_id), Decimal('21.25'))
        self.assertEqual(self.total(self.other_id), Decimal('40'))
        with self.assertRaises(ValueError):
            self.finish()
        self.assertEqual(len(self.ledger()), 1)
        self.assertEqual(self.review.migrated_signatures.count(), 1)
        self.assertFalse(CoachCalendarEvent.objects.filter(event_key=self.review.event_key).exists())
        self.assertEqual(self.query('SELECT status,completed_date FROM "Learner".reviews WHERE id=%s',
                                    [self.source_id]), [('Not Scheduled', None)])

    def test_locked_month_rolls_back_final_signature_and_completion(self):
        submit(self.review, {'progress': 'Agreed actions'})
        self.query('INSERT INTO "Learner".learner_monthly_locks (learner_id,report_month,locked_at) '
                   'VALUES (%s,%s,%s)',
                   [self.learner_id, timezone.now().astimezone(UK).strftime('%Y-%m'), timezone.now()])
        with self.assertRaisesRegex(ValueError, 'locked'):
            self.finish()
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, 'awaiting-signature')
        self.assertIsNone(self.review.completed_at)
        self.assertFalse(self.review.migrated_signatures.exists())
        self.assertEqual(self.ledger(), [])
        self.assertEqual(self.total(self.learner_id), Decimal('20'))

    def test_disabled_otjh_policy_still_completes_without_credit(self):
        self.review.template_snapshot['otjh']['countsTowardsOtjh'] = False
        self.review.save(update_fields=['template_snapshot'])
        submit(self.review, {'progress': 'Agreed actions'})
        self.finish()
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, 'completed')
        self.assertEqual(self.ledger(), [])
        self.assertEqual(self.total(self.learner_id), Decimal('20'))

    def test_other_learner_source_cannot_receive_credit_or_final_signature(self):
        submit(self.review, {'progress': 'Agreed actions'})
        self.review.learner_id = self.other_id
        self.review.save(update_fields=['learner_id'])
        with self.assertRaisesRegex(ValueError, 'source association'):
            self.finish()
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, 'awaiting-signature')
        self.assertFalse(self.review.migrated_signatures.exists())
        self.assertEqual(self.ledger(), [])
        self.assertEqual(self.total(self.learner_id), Decimal('20'))
        self.assertEqual(self.total(self.other_id), Decimal('40'))
