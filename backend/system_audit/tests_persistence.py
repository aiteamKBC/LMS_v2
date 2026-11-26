"""Real writes and real revision rows, on the isolated SQLite test database."""
from django.db import connection, models, transaction
from django.test.utils import isolate_apps

from curriculum_api import versioning
from curriculum_api.tests_audit_trail import AuditHarness
from system_audit import writes


@isolate_apps('curriculum_api')
class AuditWriteRegressionTests(AuditHarness):
    def setUp(self):
        super().setUp()

        class Record(models.Model):
            id = models.IntegerField(primary_key=True)
            title = models.TextField()
            status = models.TextField()
            objects = writes.AuditedQuerySet.as_manager()

            class Meta:
                app_label = 'curriculum_api'
                db_table = 'audit_test_records'
                managed = False

        class ProxyRecord(Record):
            class Meta:
                app_label = 'curriculum_api'
                proxy = True

        self.Record, self.ProxyRecord = Record, ProxyRecord
        with connection.cursor() as cursor:
            cursor.execute('CREATE TABLE IF NOT EXISTS audit_test_records (id integer primary key, title text, status text)')
            cursor.execute('DELETE FROM audit_test_records')
            cursor.execute("INSERT INTO audit_test_records VALUES (1, 'Before', 'draft')")
            cursor.execute("INSERT INTO audit_test_records VALUES (2, 'Untouched', 'draft')")
        writes.register_model(Record, workspace='coach', entity_type='audit_test_record',
                              key='id', title='title', columns=('id', 'title', 'status'))
        self.sign_in('Test Actor', 'test@example.invalid')

    def test_first_edit_of_existing_row_keeps_real_before_and_after(self):
        obj = self.Record.objects.get(pk=1)
        obj.title = 'After'
        self.committed(lambda: obj.save(update_fields=['title']))
        row = self.revisions('audit_test_record', '1')[-1]
        self.assertEqual(row['action'], 'updated')
        self.assertEqual(self.changed_fields(row), {'title': ('Before', 'After')})

    def test_partial_save_does_not_record_unsaved_fields(self):
        obj = self.Record.objects.get(pk=1)
        obj.title, obj.status = 'After', 'not persisted'
        self.committed(lambda: obj.save(update_fields=['title']))
        row = self.revisions('audit_test_record', '1')[-1]
        self.assertEqual(self.snapshot(row)['status'], 'draft')
        self.assertNotIn('status', self.changed_fields(row))

    def test_bulk_update_records_persisted_fields_only_and_leaves_other_row_alone(self):
        obj = self.Record.objects.get(pk=1)
        obj.title, obj.status = 'After', 'not persisted'
        self.committed(lambda: self.Record.objects.bulk_update([obj], ['title']))
        rows = self.revisions('audit_test_record')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['entity_id'], '1')
        self.assertEqual(self.changed_fields(rows[0]), {'title': ('Before', 'After')})
        self.assertEqual(self.Record.objects.get(pk=2).title, 'Untouched')

    def test_proxy_save_is_recorded(self):
        obj = self.ProxyRecord.objects.get(pk=1)
        obj.title = 'Commercial proxy edit'
        self.committed(lambda: obj.save(update_fields=['title']))
        self.assertEqual(len(self.revisions('audit_test_record', '1')), 1)

    def test_rolled_back_update_has_no_revision(self):
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    self.Record.objects.filter(pk=1).update(title='Rolled back')
                    raise ValueError('rollback')
            except ValueError:
                pass
        self.assertEqual(self.revisions('audit_test_record'), [])
        self.assertEqual(self.Record.objects.get(pk=1).title, 'Before')

    def test_repeated_updates_in_one_commit_keep_original_before(self):
        def save_twice():
            self.Record.objects.filter(pk=1).update(title='Intermediate')
            self.Record.objects.filter(pk=1).update(title='Final')
        self.committed(save_twice)
        rows = self.revisions('audit_test_record', '1')
        self.assertEqual(len(rows), 1)
        self.assertEqual(self.changed_fields(rows[0]), {'title': ('Before', 'Final')})
