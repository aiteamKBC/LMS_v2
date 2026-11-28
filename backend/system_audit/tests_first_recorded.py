"""Created versus First recorded, across every way a write reaches the trail.

The rule under test, and the one nothing here may weaken: a revision says
``created`` only when the row itself proves it was made by this save -- its
``created_at`` and ``updated_at`` both stamped by the write. A record that
existed before history and is first seen while being edited says ``recorded``.
Being the first revision is never, on its own, evidence of a create.

One class per capture family, because each family hands ``record_rows`` its
row a different way and each has broken differently:

* curriculum single-row raw SQL (``authoring_upsert``, ``returning *``);
* curriculum bulk raw SQL (``authoring_bulk_upsert``), which recorded its
  payloads -- rows without stamps -- so every create read as first recorded;
* ORM registrations (``register_model`` / ``AuditedQuerySet``), whose stamps
  must reach the decision without entering the snapshot;
* hand-built rows (``record_table_rows`` with a zipped COLUMNS tuple).
"""
from datetime import datetime, timedelta
from unittest import mock

from django.db import connection, models
from django.test.utils import isolate_apps

from curriculum_api import versioning, views
from curriculum_api.tests_audit_trail import AuditHarness
from system_audit import writes

LONG_AGO = datetime(2025, 1, 6, 9, 30, 0)


def snapshot_keys(revision):
    return set(versioning.as_dict(revision['snapshot']))


class CurriculumSingleRowTests(AuditHarness):
    """Family 1: ``authoring_upsert`` records the row its ``returning *`` gave."""

    def test_single_row_create_is_reported_as_created(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-NEW', 'module_catalogue_id': 'MOD-A', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': 'Brand new',
        }))
        self.assertEqual(self.revisions('component', 'COMP-NEW')[0]['action'], 'created')

    def test_single_row_edit_of_pre_history_row_is_recorded(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-OLD', 'module_catalogue_id': 'MOD-A', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': 'Long-standing', 'created_at': LONG_AGO,
        }))
        rows = self.revisions('component', 'COMP-OLD')
        self.assertEqual(rows[0]['action'], 'recorded')


class CurriculumBulkUpsertTests(AuditHarness):
    """Family 2: ``authoring_bulk_upsert`` -- weeks, components, KSB mappings."""

    PAYLOADS = {
        views.AUTHORING_WEEKS_TABLE: ('week', {
            'id': 'WEEK-B1', 'module_catalogue_id': 'MOD-B', 'week_number': 1, 'title': 'Week one',
        }),
        views.AUTHORING_COMPONENTS_TABLE: ('component', {
            'id': 'COMP-B1', 'module_catalogue_id': 'MOD-B', 'week_id': 'WEEK-B1',
            'type': 'quiz', 'title': 'Check', 'display_order': 1,
        }),
        views.AUTHORING_KSB_MAPPINGS_TABLE: ('ksb_mapping', {
            'id': 'KSB-B1', 'module_catalogue_id': 'MOD-B', 'week_id': 'WEEK-B1',
            'component_id': 'COMP-B1', 'ksb_code': 'K1', 'ksb_id': 'K1', 'classification': 'main',
        }),
    }

    def bulk(self, table, payload):
        return self.committed(lambda: views.authoring_bulk_upsert(table, ['id'], [dict(payload)]))

    def install_pre_history_row(self, table, payload):
        """A row that predates history and was never edited: both stamps equal.

        The hardest case. Its stamps match each other, so any path that read
        them back without the save having moved ``updated_at`` would call it new.
        """
        row = dict(payload, created_at=LONG_AGO, updated_at=LONG_AGO)
        columns = list(row)
        with connection.cursor() as cursor:
            cursor.execute(
                f'insert into {views.authoring_table_name(table)} '
                f'({", ".join(views.quote_ident(c) for c in columns)}) '
                f'values ({", ".join(["%s"] * len(columns))})',
                [row[c] for c in columns],
            )

    def test_bulk_upsert_create_is_reported_as_created(self):
        self.sign_in()
        for table, (entity_type, payload) in self.PAYLOADS.items():
            with self.subTest(entity_type=entity_type):
                self.bulk(table, payload)
                rows = self.revisions(entity_type, payload['id'])
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]['action'], 'created')
                # The stamps decided it; they are still not content.
                self.assertFalse({'created_at', 'updated_at'} & snapshot_keys(rows[0]))

    def test_bulk_upsert_edit_of_pre_history_row_is_recorded(self):
        self.sign_in()
        for table, (entity_type, payload) in self.PAYLOADS.items():
            with self.subTest(entity_type=entity_type):
                self.install_pre_history_row(table, payload)
                edited = dict(payload)
                if 'title' in edited:
                    edited['title'] = 'Edited title'
                else:
                    edited['classification'] = 'secondary'
                self.bulk(table, edited)
                rows = self.revisions(entity_type, payload['id'])
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]['action'], 'recorded')
                self.assertNotEqual(rows[0]['action'], 'created')

    def test_bulk_upsert_keeps_the_stored_created_at(self):
        """The write itself must not reset the row's origin (SQLite used REPLACE)."""
        table, (entity_type, payload) = views.AUTHORING_WEEKS_TABLE, self.PAYLOADS[views.AUTHORING_WEEKS_TABLE]
        self.install_pre_history_row(table, payload)
        self.bulk(table, dict(payload, title='Renamed'))
        stored = views.fetch_all(
            f'select created_at, title from {views.authoring_table_name(table)} where id = %s', [payload['id']],
        )[0]
        self.assertEqual(stored['title'], 'Renamed')
        self.assertTrue(str(stored['created_at']).startswith('2025-01-06'))

    def test_bulk_upsert_edit_after_a_create_is_an_edit(self):
        self.sign_in()
        table, (entity_type, payload) = views.AUTHORING_COMPONENTS_TABLE, self.PAYLOADS[views.AUTHORING_COMPONENTS_TABLE]
        self.bulk(table, payload)
        self.bulk(table, dict(payload, title='Final check'))
        rows = self.revisions(entity_type, payload['id'])
        self.assertEqual([row['action'] for row in rows], ['created', 'updated'])
        self.assertEqual(self.changed_fields(rows[1]), {'title': ('Check', 'Final check')})


class RecordedSnapshotTests(AuditHarness):
    """A first-recorded revision is the found state, and keeps its whole copy."""

    def test_recorded_snapshot_survives_a_later_revision(self):
        self.sign_in()
        payload = {
            'id': 'COMP-KEEP', 'module_catalogue_id': 'MOD-K', 'week_id': 'WEEK-K',
            'type': 'quiz', 'title': 'As found', 'display_order': 3,
        }
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], dict(payload, created_at=LONG_AGO)))
        first = self.revisions('component', 'COMP-KEEP')[0]
        self.assertEqual(first['action'], 'recorded')

        # The trim runs only on PostgreSQL. Capture what it would send, so the
        # protection is proved on this database too rather than passing because
        # nothing ran.
        sent = []

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=None):
                # `transaction.atomic()` opens its savepoint through here too.
                if 'jsonb_object_agg' in sql:
                    sent.append(params)

        real_trim = versioning.trim_superseded

        def trim_as_postgres(pending, inserted):
            with mock.patch.object(versioning.connection, 'vendor', 'postgresql'), \
                    mock.patch.object(versioning.connection, 'cursor', lambda: Cursor()):
                return real_trim(pending, inserted)

        with mock.patch.object(versioning, 'trim_superseded', trim_as_postgres):
            self.committed(lambda: views.authoring_upsert(
                views.AUTHORING_COMPONENTS_TABLE, ['id'], dict(payload, title='Edited later')))

        rows = self.revisions('component', 'COMP-KEEP')
        self.assertEqual([row['action'] for row in rows], ['recorded', 'updated'])
        self.assertTrue(sent, 'the later revision did not try to slim its predecessor')
        protected = sent[0][2]
        self.assertIn('recorded', protected)
        # And the stored first revision still has every field it was found with,
        # not just SLIM_SNAPSHOT_KEYS.
        kept = self.snapshot(rows[0])
        self.assertEqual(kept['title'], 'As found')
        self.assertEqual(kept['type'], 'quiz')
        self.assertGreater(set(kept), set(versioning.SLIM_SNAPSHOT_KEYS) & set(kept))

    def test_recorded_is_a_full_snapshot_action(self):
        self.assertIn('recorded', versioning.FULL_SNAPSHOT_ACTIONS)


@isolate_apps('curriculum_api')
class OrmRegistrationTests(AuditHarness):
    """Family 3: ``register_model(timestamps=...)`` and ``AuditedQuerySet``."""

    def setUp(self):
        super().setUp()

        class Stamped(models.Model):
            id = models.IntegerField(primary_key=True)
            title = models.TextField()
            created_at = models.DateTimeField(auto_now_add=True)
            updated_at = models.DateTimeField(auto_now=True)
            objects = writes.AuditedQuerySet.as_manager()

            class Meta:
                app_label = 'curriculum_api'
                db_table = 'audit_stamped_records'
                managed = False

        self.Stamped = Stamped
        with connection.cursor() as cursor:
            cursor.execute(
                'CREATE TABLE IF NOT EXISTS audit_stamped_records '
                '(id integer primary key, title text, created_at datetime, updated_at datetime)'
            )
            cursor.execute('DELETE FROM audit_stamped_records')
            # Pre-history, never edited: both stamps the same old instant.
            cursor.execute(
                'INSERT INTO audit_stamped_records VALUES (1, %s, %s, %s)',
                ['Found', LONG_AGO, LONG_AGO],
            )
        writes.register_model(
            Stamped, workspace='coach', entity_type='audit_stamped_record',
            key='id', title='title', columns=('id', 'title'),
            timestamps=('created_at', 'updated_at'),
        )
        self.sign_in('Test Actor', 'test@example.invalid')

    def tearDown(self):
        writes.TIMESTAMP_ATTRS.pop('audit_stamped_record', None)
        super().tearDown()

    def test_orm_create_is_reported_as_created(self):
        self.committed(lambda: self.Stamped.objects.create(id=2, title='Made now'))
        rows = self.revisions('audit_stamped_record', '2')
        self.assertEqual(rows[0]['action'], 'created')
        # Timestamps decide the action and never become snapshot fields.
        self.assertEqual(snapshot_keys(rows[0]) - {versioning.CONTEXT_KEY}, {'id', 'title'})

    def test_orm_bulk_create_is_reported_as_created(self):
        self.committed(lambda: self.Stamped.objects.bulk_create([
            self.Stamped(id=3, title='Bulk one'), self.Stamped(id=4, title='Bulk two'),
        ]))
        self.assertEqual(
            {row['action'] for row in self.revisions('audit_stamped_record')}, {'created'},
        )

    def test_orm_bulk_update_of_pre_history_row_is_never_created(self):
        obj = self.Stamped.objects.get(pk=1)
        obj.title = 'Edited in bulk'
        # bulk_update leaves `updated_at` alone, so the stamps still match each
        # other. Django runs it through `update()`, which reads the before-state,
        # so it is a known edit -- and the matching stamps must not turn it into
        # a create.
        self.committed(lambda: self.Stamped.objects.bulk_update([obj], ['title']))
        rows = self.revisions('audit_stamped_record', '1')
        self.assertEqual(rows[0]['action'], 'updated')
        self.assertEqual(self.changed_fields(rows[0]), {'title': ('Found', 'Edited in bulk')})

    def test_unproven_bulk_rows_carry_no_stamps(self):
        # Directly at the seam: a read-back that is not an insert offers none.
        captured = []
        with mock.patch.object(writes, 'record_table_rows',
                               lambda table, rows, **kw: captured.extend(rows)):
            self.Stamped.objects.all()._record_pks([1])
            self.Stamped.objects.all()._record_pks([1], inserted=True)
        self.assertNotIn('created_at', captured[0])
        self.assertEqual(captured[1]['created_at'], LONG_AGO.replace(tzinfo=captured[1]['created_at'].tzinfo))

    def test_orm_conflict_tolerant_bulk_create_of_pre_history_row_is_not_created(self):
        self.committed(lambda: self.Stamped.objects.bulk_create(
            [self.Stamped(id=1, title='Upserted')],
            update_conflicts=True, unique_fields=['id'], update_fields=['title'],
        ))
        rows = self.revisions('audit_stamped_record', '1')
        self.assertEqual(rows[0]['action'], 'recorded')

    def test_orm_save_of_pre_history_row_is_an_edit_never_a_create(self):
        obj = self.Stamped.objects.get(pk=1)
        obj.title = 'Edited one at a time'
        self.committed(lambda: obj.save(update_fields=['title']))
        rows = self.revisions('audit_stamped_record', '1')
        # The before-state was read, so this is a real edit with a real diff.
        self.assertEqual(rows[0]['action'], 'updated')
        self.assertEqual(self.changed_fields(rows[0]), {'title': ('Found', 'Edited one at a time')})

    def test_a_save_that_only_moves_updated_at_records_nothing(self):
        self.committed(lambda: self.Stamped.objects.create(id=5, title='Stable'))
        obj = self.Stamped.objects.get(pk=5)
        self.committed(lambda: obj.save())
        self.assertEqual(len(self.revisions('audit_stamped_record', '5')), 1)

    def test_a_timestamp_pair_naming_a_missing_field_is_refused(self):
        with self.assertRaises(ValueError):
            writes.register_model(
                self.Stamped, workspace='coach', entity_type='audit_stamped_broken',
                key='id', title='title', columns=('id', 'title'),
                timestamps=('created_at', 'modified_at'),
            )


class HandBuiltRowTests(AuditHarness):
    """Family 4: a registered raw table and a row built from a COLUMNS tuple."""

    def setUp(self):
        super().setUp()
        writes.register(
            'audit_hand_rows', workspace='coach', entity_type='audit_hand_row',
            key='id', title='title', columns=('id', 'title'),
        )
        self.sign_in('Test Actor', 'test@example.invalid')

    def record(self, row):
        self.committed(lambda: writes.record_table_rows('audit_hand_rows', [row]))
        return self.revisions('audit_hand_row', row['id'])[0]

    def test_hand_built_create_is_reported_as_created(self):
        now = datetime.utcnow()
        revision = self.record({'id': '1', 'title': 'New', 'created_at': now, 'updated_at': now})
        self.assertEqual(revision['action'], 'created')
        self.assertFalse({'created_at', 'updated_at'} & snapshot_keys(revision))

    def test_hand_built_edit_of_pre_history_row_is_recorded(self):
        revision = self.record({
            'id': '2', 'title': 'Old', 'created_at': LONG_AGO, 'updated_at': datetime.utcnow(),
        })
        self.assertEqual(revision['action'], 'recorded')

    def test_hand_built_row_without_stamps_is_recorded(self):
        self.assertEqual(self.record({'id': '3', 'title': 'Unknown origin'})['action'], 'recorded')

    def test_document_stamps_come_only_from_the_insert(self):
        from enrolment_api import documents

        stamp = datetime(2026, 10, 4, 12, 0, 0)
        row = ('doc-1', 'ilr', 'ilr.pdf', 'path', 10, False, stamp,
               None, None, False, None, None, False, 'apprentice', 7, 'Learner', stamp)
        captured = []
        with mock.patch('system_audit.writes.record_table_rows',
                        lambda table, rows, **kw: captured.extend(rows)):
            documents._record_document(row, inserted=True)
            documents._record_document(row[:16])
        self.assertEqual((captured[0]['created_at'], captured[0]['updated_at']), (stamp, stamp))
        # A replace or a signature carries no stamps: "Updated_at" does not move
        # on those statements, so a re-read pair would prove nothing.
        self.assertNotIn('created_at', captured[1])


class RegistrationDriftTests(AuditHarness):
    """The wiring itself: who declares stamps, and that none reach a snapshot."""

    STAMPED = {
        'quiz', 'quiz_question', 'quiz_answer', 'learner_profile', 'enrolment_review',
        'eligibility_review', 'rpl_review', 'health_safety_review', 'apprenticeship_agreement',
        'ilr_document', 'training_plan_document', 'written_agreement', 'extended_ilr',
        'wizard_personal_details', 'wizard_skills_radar', 'wizard_ksb_assessment', 'wizard_plr',
        'wizard_plr_record', 'wizard_cv_job', 'wizard_policy_ack', 'reward', 'engagement_event',
        'points_rule', 'flash_card_deck', 'flash_card', 'chat_conversation',
    }

    def test_every_model_with_a_timestamp_pair_declares_it(self):
        registered = {entity for entity in self.STAMPED if entity in versioning.SNAPSHOT_COLUMNS}
        self.assertTrue(registered, 'no ORM registrations loaded')
        missing = {entity for entity in registered if entity not in writes.TIMESTAMP_ATTRS}
        self.assertEqual(missing, set())

    def test_declared_timestamps_never_enter_the_snapshot(self):
        for entity, pair in writes.TIMESTAMP_ATTRS.items():
            with self.subTest(entity=entity):
                self.assertFalse(set(pair) & set(versioning.SNAPSHOT_COLUMNS.get(entity, ())))

    def test_hand_built_column_lists_keep_stamps_out_of_their_snapshots(self):
        from audit_api import audit_trail as audit
        from manual_audit_api import audit_trail as manual
        from progress_reviews_api import runs

        for entity, columns in (
            ('progress_review_run', runs.RUN_AUDIT_COLUMNS),
            ('activity_override', audit.ACTIVITY_OVERRIDE_COLUMNS),
            ('evidence_override', audit.EVIDENCE_OVERRIDE_COLUMNS),
            ('manual_signoff', manual.SIGNOFF_COLUMNS),
        ):
            with self.subTest(entity=entity):
                self.assertIn('created_at', columns)
                if entity in versioning.SNAPSHOT_COLUMNS:
                    self.assertNotIn('created_at', versioning.SNAPSHOT_COLUMNS[entity])
        # The positional readers of the returning clauses still find their columns.
        self.assertEqual(audit.ACTIVITY_OVERRIDE_RETURNING[-2:], ('updated_at', 'created_at'))
        self.assertEqual(manual.SIGNOFF_RETURNING[-1], 'created_at')

    def test_quiz_questions_and_answers_store_updated_at(self):
        from quiz_api.models import QuizAnswer, QuizQuestion

        for model in (QuizQuestion, QuizAnswer):
            field = model._meta.get_field('updated_at')
            self.assertTrue(field.auto_now)
            self.assertTrue(field.null)


class QuizCaptureTests(AuditHarness):
    """The real quiz registration, driven through its real ``post_save`` handler.

    SQLite cannot insert into ``"curriculum"."quizzes"`` through the ORM (its
    ``RETURNING`` refuses schema-qualified columns), so the stored row the
    handler re-reads is served from memory. Everything after that read -- the
    registered columns, the declared stamps, the created/recorded decision --
    is the production path.
    """

    def save_signal(self, quiz, created):
        from django.db.models.signals import post_save
        from quiz_api.models import QuizPackage

        manager = mock.Mock()
        manager.get.return_value = quiz
        with mock.patch.object(QuizPackage._base_manager, 'using', return_value=manager):
            self.committed(lambda: post_save.send(
                sender=QuizPackage, instance=quiz, created=created, raw=False, using='default'))

    def quiz(self, pk, created_at, updated_at):
        from quiz_api.models import QuizPackage

        return QuizPackage(id=pk, title='Unit 1 check', created_at=created_at, updated_at=updated_at)

    def setUp(self):
        super().setUp()
        if 'quiz' not in writes.TIMESTAMP_ATTRS:
            self.skipTest('quiz registration not loaded in this configuration')
        self.sign_in()

    def test_quiz_create_is_reported_as_created(self):
        now = datetime.utcnow()
        self.save_signal(self.quiz(901, now, now + timedelta(microseconds=40)), created=True)
        rows = self.revisions('quiz', '901')
        self.assertEqual(rows[0]['action'], 'created')
        self.assertFalse({'created_at', 'updated_at'} & snapshot_keys(rows[0]))

    def test_quiz_edit_of_pre_history_quiz_is_recorded(self):
        # Not an insert, and no before-state could be read: the stamps are
        # withheld, so even a never-edited quiz cannot read as created.
        self.save_signal(self.quiz(902, LONG_AGO, LONG_AGO), created=False)
        self.assertEqual(self.revisions('quiz', '902')[0]['action'], 'recorded')


class CanonicalActionTests(AuditHarness):
    def test_a_non_canonical_action_is_refused(self):
        item = {column: None for column in versioning.REVISION_COLUMNS}
        item.update(entity_type='component', entity_id='X', action='create')
        with self.assertLogs('curriculum_api.versioning', level='ERROR'):
            self.assertEqual(versioning.insert_revisions([item]), {})
        self.assertEqual(self.revisions('component', 'X'), [])
