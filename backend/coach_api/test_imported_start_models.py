"""Private model-runner persistence checks; NOT PostgreSQL locking acceptance."""
from copy import deepcopy
from datetime import date, time
from django.test import TestCase
from .models import CoachCalendarEvent, ImportedReviewInstance
from .imported_review_start import start_locked


class ImportedStartPersistenceTests(TestCase):
    def test_only_status_and_updated_at_change_and_retry_is_a_noop_for_all_families(self):
        for number, family in enumerate(('MCM', 'PR', 'PR_SKILLS_RADAR', 'PSP'), 1):
            with self.subTest(family=family):
                key = f'imported-review:synthetic-{number}'
                calendar = CoachCalendarEvent.objects.create(event_key=key, owner_email='coach@example.invalid',
                    learner_id=42, event_type='mcr' if family == 'MCM' else 'progress-review', status='scheduled',
                    target_date=date(2026, 10, 20),
                    scheduled_date=date(2026, 10, 20), scheduled_time=time(10), sync_state='synced',
                    graph_event_id=f'graph-{number}', meeting_link='https://example.invalid/teams')
                overlay = ImportedReviewInstance.objects.create(event_key=key, owner_email=calendar.owner_email,
                    learner_id=42, source_review_id=number, status='scheduled',
                    template_snapshot={'sections': [{'key': 'discussion'}]}, answers={'recap': 'Preserve'},
                    meeting_intelligence={'reviewRevision': 2, 'summary': {'text': 'Saved suggestion'}},
                    progress_snapshot={'hours': 17}, signature_requirements={'advisor': True})
                before = deepcopy(ImportedReviewInstance.objects.values().get(pk=overlay.pk))
                self.assertTrue(start_locked(overlay, calendar, family))
                overlay.refresh_from_db(); calendar.refresh_from_db()
                after = ImportedReviewInstance.objects.values().get(pk=overlay.pk)
                self.assertEqual(overlay.status, 'in-progress')
                self.assertEqual(calendar.status, 'in-progress')
                self.assertEqual({k: v for k, v in before.items() if k not in {'status', 'updated_at'}},
                                 {k: v for k, v in after.items() if k not in {'status', 'updated_at'}})
                self.assertTrue(start_locked(overlay, calendar, family))
                self.assertEqual(ImportedReviewInstance.objects.values().get(pk=overlay.pk), after)
