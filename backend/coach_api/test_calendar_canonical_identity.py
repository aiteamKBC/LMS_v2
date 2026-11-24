"""No-I/O coverage of normalized calendar reads, writes and owner stability."""
from datetime import date
from importlib import import_module
from unittest.mock import patch, MagicMock
from django.db import models
from django.db.backends.postgresql.base import DatabaseWrapper
from django.db.models.sql import InsertQuery, UpdateQuery
from django.test import SimpleTestCase
from learner_api.models import PlacementCoach
from .models import CoachCalendarEvent
from .calendar_identity import ALIASES


class CanonicalCalendarIdentityTests(SimpleTestCase):
    def connection(self):
        return DatabaseWrapper({'ENGINE': 'django.db.backends.postgresql', 'NAME': 'compile_only'}, 'compile_only')

    def record(self, **kwargs):
        return CoachCalendarEvent(event_key='synthetic', learner_profile_id=42,
                                  target_date=date(2026, 11, 24), event_type='catch-up', **kwargs)

    def test_read_aliases_join_original_owner_not_current_coach(self):
        with patch.object(CoachCalendarEvent._meta, 'db_table', 'Learner"."coach_calendar_event'):
            query = CoachCalendarEvent.objects.filter(owner_email__iexact='coach@example.invalid').values(
                'owner_email', 'owner_name', 'learner_email', 'learner_name', 'graph_organizer_email').query
            sql, params = query.get_compiler(connection=self.connection()).as_sql()
        self.assertIn('"Learner"."coach_calendar_event"', sql)
        self.assertIn('"curriculum"."coaches"', sql)
        self.assertIn('"owner_coach_id"', sql)
        self.assertIn('"learner_id"', sql)
        self.assertNotIn('.coach_id', sql)
        self.assertNotIn('"Coach"."coach_calendar_event"', sql)

    def test_insert_has_no_retired_columns_or_view(self):
        record = self.record(owner_coach_id='original-coach', owner_name='ignored', learner_name='ignored')
        fields = [f for f in record._meta.local_concrete_fields if not f.primary_key]
        with patch.object(CoachCalendarEvent._meta, 'db_table', 'Learner"."coach_calendar_event'):
            query = InsertQuery(CoachCalendarEvent)
            query.insert_values(fields, [record])
            sql, _ = query.get_compiler(connection=self.connection()).as_sql()[0]
        self.assertIn('INSERT INTO "Learner"."coach_calendar_event"', sql)
        for name in ALIASES:
            self.assertNotIn('"' + name + '"', sql)
        self.assertIn('"owner_coach_id"', sql)
        self.assertIn('"graph_organizer_email"', sql)

    def test_update_targets_canonical_table_with_owner_filter(self):
        with patch.object(CoachCalendarEvent._meta, 'db_table', 'Learner"."coach_calendar_event'):
            query = CoachCalendarEvent.objects.filter(owner_email__iexact='original@example.invalid').query.chain(UpdateQuery)
            query.add_update_values({'status': 'scheduled'})
            sql, _ = query.get_compiler(connection=self.connection()).as_sql()
        self.assertTrue(sql.startswith('UPDATE "Learner"."coach_calendar_event"'))
        self.assertIn('"owner_coach_id"', sql)

    def test_new_owner_resolves_unique_canonical_coach(self):
        record = self.record(owner_email=' Original@example.invalid ')
        coach = PlacementCoach(id='original', email='original@example.invalid', name='Original')
        query = MagicMock()
        query.filter.return_value.__getitem__.return_value = [coach]
        with patch.object(PlacementCoach.objects, 'using', return_value=query):
            record.prepare_owner(using='default')
        self.assertEqual(record.owner_coach_id, 'original')
        query.filter.assert_called_once_with(email__iexact='Original@example.invalid')

    def test_missing_or_ambiguous_owner_fails_before_save(self):
        for owners in ([], [PlacementCoach(id='a'), PlacementCoach(id='b')]):
            query = MagicMock()
            query.filter.return_value.__getitem__.return_value = owners
            with patch.object(PlacementCoach.objects, 'using', return_value=query), self.assertRaises(ValueError):
                self.record(owner_email='same@example.invalid').prepare_owner(using='default')

    def test_saved_owner_does_not_follow_caseload_or_display_assignments(self):
        record = CoachCalendarEvent.from_db('default', ['id', 'owner_coach_id', 'learner_profile_id'], [7, 'original', 42])
        record._calendar_owner_email = 'original@example.invalid'
        record.graph_organizer_email = 'organizer@example.invalid'
        record.owner_email = 'new-coach@example.invalid'
        with patch.object(models.Model, 'save') as save:
            record.save(update_fields=['owner_email', 'owner_name', 'status'])
        self.assertEqual(record.owner_coach_id, 'original')
        self.assertEqual(record.owner_email, 'original@example.invalid')
        self.assertEqual(record.graph_organizer_email, 'organizer@example.invalid')
        self.assertEqual(save.call_args.kwargs['update_fields'], {'status'})
        record.owner_coach_id = 'replacement'
        with self.assertRaises(ValueError):
            record.save()

    def test_bulk_identity_changes_are_rejected(self):
        for key in (*ALIASES, 'owner_coach_id', 'owner_coach'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                CoachCalendarEvent.objects.update(**{key: 'replacement'})

    def test_state_migration_never_executes_ddl(self):
        migration = import_module('coach_api.migrations.0041_calendar_canonical_owner').Migration
        self.assertEqual(len(migration.operations), 1)
        self.assertEqual(migration.operations[0].database_operations, [])


    def test_calendar_owner_ids_never_accept_enrolment_id(self):
        from learner_api.calendar import _record_owner_ids
        for kind in ('first-session', 'eligibility-review', 'workspace', 'mcr', 'catch-up'):
            with self.subTest(kind=kind):
                self.assertEqual(_record_owner_ids(self.record(), created_user_id=12, profile_id=42), {'42'})
                self.assertEqual(_record_owner_ids(self.record(), created_user_id=12, profile_id=None), set())

    def test_introduction_profile_lookup_never_falls_back_to_enrolment(self):
        from login.lms_introduction import calendar_learner_id
        from learner_api.models import LearnerProfile
        from types import SimpleNamespace
        for value in (42, None):
            with patch.object(LearnerProfile.objects, 'filter') as query:
                query.return_value.values_list.return_value.first.return_value = value
                self.assertEqual(calendar_learner_id(SimpleNamespace(pk=12)), value)
                query.assert_called_once_with(enrolment_id=12)
