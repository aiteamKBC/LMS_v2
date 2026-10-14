"""Real source linkage and signed continuation hours on a verified test database.

Run only after verifying the PostgreSQL test target. All fixtures are synthetic,
uniquely named and removed by their exact keys; no live Graph calls are needed.
"""
from datetime import date, time
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import connections, transaction
from django.test import RequestFactory, SimpleTestCase

from . import views
from .migrated_completion import complete, required_roles, sign, submit
from .migrated_otjh import review_rows_bulk, summarize
from .migrated_template_sync import synchronize_locked
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewSignature, MigratedReviewTemplate
from .tests_migrated_completion import PNG


class MigratedOtjhPostgresTests(SimpleTestCase):
    databases = {'default', 'enrolment'}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for alias in cls.databases:
            config = connections[alias].settings_dict
            if connections[alias].vendor != 'postgresql':
                raise RuntimeError('These integration tests require verified PostgreSQL.')
            if config['NAME'] != settings.DATABASES['default']['TEST'].get('NAME'):
                raise RuntimeError('Refusing to write outside the selected test database.')

    def test_all_families_initialize_start_sign_complete_and_keep_frozen_hours(self):
        for family, source_type in (('MCM', 'Monthly Coaching Meeting'), ('PR', 'Progress Review'),
                                     ('PR_SKILLS_RADAR', 'Progress Review (+ Skills Radar)')):
            with self.subTest(family=family):
                self.exercise(family, source_type)

    def exercise(self, family, source_type):
        key = 'otjh-' + uuid4().hex
        learner_id, source_id = -int(uuid4().int % 10**8), -int(uuid4().int % 10**12)
        owner = {'id': learner_id, 'aptem_id': 101, 'programme_id': key, 'programme': 'Synthetic'}
        template = MigratedReviewTemplate.objects.create(scope='PROGRAMME', programme_key='id:' + key,
            review_family=family, name='Synthetic review hours', expected_otjh=1.5, counts_towards_otjh=True,
            is_active=True, definition_json={'sections': [{'key': 's', 'title': 'Discussion', 'order': 0,
                'fields': [{'key': 'note', 'title': 'Note', 'aptemType': 1, 'order': 0}]}]})
        self.addCleanup(lambda: MigratedReviewTemplate.objects.filter(pk=template.pk).delete())
        with connections['default'].cursor() as cursor:
            cursor.execute('''INSERT INTO "Learner".reviews
                (id,learner_id,aptem_review_id,review_type,status,planned_scheduled_date)
                VALUES (%s,%s,%s,%s,%s,%s)''', [source_id, learner_id, key, source_type, 'Scheduled', date(2026,10,14)])
        def remove_source():
            with connections['default'].cursor() as cursor:
                cursor.execute('DELETE FROM "Learner".reviews WHERE id=%s AND aptem_review_id=%s', [source_id, key])
        self.addCleanup(remove_source)
        event_key = 'imported-review:' + key
        definition = {'canInitialize': True, 'readOnly': True, 'sourceStatus': 'Scheduled',
            'migratedProgrammeKey': 'id:' + key, 'historicalReview': {'id': str(source_id), 'type': source_type},
            'instance': {'id': event_key, 'learnerId': learner_id}}
        coach = 'otjh-coach@example.invalid'
        factory = RequestFactory()
        with patch.object(views, 'authenticated_coach_email', return_value=coach), \
             patch.object(views, '_imported_review_definition', side_effect=[definition, {}]):
            response = unwrap(views.coach_review_instance_initialize)(factory.post('/initialize'), event_key)
        self.assertEqual(response.status_code, 200, response.content)
        overlay = ImportedReviewInstance.objects.get(source_review_id=source_id)
        self.addCleanup(lambda: ImportedReviewInstance.objects.filter(pk=overlay.pk).delete())
        self.addCleanup(lambda: MigratedReviewSignature.objects.filter(overlay_id=overlay.pk).delete())
        calendar = CoachCalendarEvent.objects.create(event_key=event_key, owner_email=coach, learner_id=learner_id,
            event_type='mcr' if family == 'MCM' else 'progress-review', target_date=date(2026,10,14),
            scheduled_date=date(2026,10,14), scheduled_time=time(10), status='scheduled',
            graph_event_id='synthetic-event-' + key, meeting_link='https://example.invalid/' + key, sync_state='synced')
        self.addCleanup(lambda: CoachCalendarEvent.objects.filter(pk=calendar.pk).delete())
        template.expected_otjh = 2.5
        template.save()
        self.assertEqual(summarize(review_rows_bulk([owner])[learner_id]), {'planned': 2.5, 'completed': 0})
        definition.update(migratedForm=True, readOnly=False, localStatus='scheduled')
        request = factory.post('/start', data=json.dumps({'status': 'in-progress'}), content_type='application/json')
        request.coach_email = coach
        with patch.object(views, '_imported_review_definition', return_value=definition), \
             patch.object(views, 'sync_calendar_event_to_graph') as graph:
            response = unwrap(views.coach_review_instance_local_status)(request, event_key)
        self.assertEqual(response.status_code, 200, response.content)
        graph.assert_not_called()
        overlay.refresh_from_db()
        self.assertEqual(overlay.template_snapshot['otjh']['expectedHours'], 2.5)
        template.expected_otjh = 9
        template.counts_towards_otjh = False
        template.definition_json['sections'][0]['title'] = 'Updated questions'
        template.save()
        with transaction.atomic():
            synchronize_locked(overlay, family, 'id:' + key)
            submit(overlay, {'note': 'Synthetic completed discussion'})
            self.assertEqual(summarize(review_rows_bulk([owner])[learner_id])['completed'], 0)
            for role in required_roles(overlay):
                sign(overlay, role, account=SimpleNamespace(pk=-1, display_name='Synthetic signer', email=coach), signature=PNG)
            complete(overlay)
        for _ in range(2):
            self.assertEqual(summarize(review_rows_bulk([owner])[learner_id]), {'planned': 2.5, 'completed': 2.5})
        calendar.refresh_from_db()
        self.assertEqual(calendar.graph_event_id, 'synthetic-event-' + key)
        self.assertEqual(calendar.meeting_link, 'https://example.invalid/' + key)
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('SELECT status,completed_date FROM "Learner".reviews WHERE id=%s', [source_id])
            self.assertEqual(cursor.fetchone(), ('Scheduled', None))
