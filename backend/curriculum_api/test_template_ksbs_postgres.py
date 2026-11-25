"""Executed only by the verified disposable PostgreSQL runner."""
import json
from django.db import connection
from django.test import RequestFactory, TestCase
from . import views


class TemplateKsbApiTests(TestCase):
    databases = {'default'}

    def setUp(self):
        # TestCase rolls back DDL; the process-level provisioning flag does not.
        views._WEEK_TEMPLATE_TABLES_READY = False
        views.provision_week_template_tables()
        with connection.cursor() as cursor:
            cursor.execute('''ALTER TABLE curriculum.ksb_component_mappings
                ADD CONSTRAINT test_template_owner CHECK((component_id IS NULL)<>(template_component_id IS NULL)),
                ADD CONSTRAINT test_template_fk FOREIGN KEY(template_component_id)
                    REFERENCES curriculum.week_template_components(id) ON DELETE RESTRICT,
                ADD CONSTRAINT test_template_unique UNIQUE(template_component_id,standard_ksb_id)''')
            cursor.execute('''INSERT INTO curriculum.ksb_standard_definitions
                (id,standard_ref,standard_version,ksb_code,ksb_type,ksb_description)
                VALUES (9001,'ST0612','1.0','K1','knowledge','Synthetic definition')''')
        self.factory = RequestFactory()

    def create(self, **overrides):
        payload = {'title': 'Synthetic template', 'components': [{
            'id': 'TC-1', 'type': 'reading', 'title': 'Synthetic reading',
            'ksbMappings': [{'standardKsbId': 9001, 'weight': 2.5,
                             'classification': 'main', 'weightClass': 'hard'}]}]}
        payload.update(overrides)
        return views.curriculum_week_template_collection(
            self.factory.post('/', data=json.dumps(payload), content_type='application/json'))

    def patch(self, ident, payload):
        return views.curriculum_week_template_detail(
            self.factory.patch('/', data=json.dumps(payload), content_type='application/json'), ident)

    def test_create_read_edit_remove_preserves_component_and_mapping_identity(self):
        response = self.create()
        self.assertEqual(response.status_code, 200, response.content)
        record = json.loads(response.content)['weekTemplate']
        component = record['components'][0]
        mapping = component['ksbMappings'][0]
        self.assertEqual(mapping['standardKsbId'], 9001)
        component['ksbMappings'][0]['weight'] = 3
        response = self.patch(record['id'], {'components': [component]})
        self.assertEqual(response.status_code, 200, response.content)
        updated = json.loads(response.content)['weekTemplate']
        self.assertEqual(updated['components'][0]['ksbMappings'][0]['id'], mapping['id'])
        self.assertEqual(updated['components'][0]['ksbMappings'][0]['weight'], 3)
        component.pop('ksbMappings')
        response = self.patch(record['id'], {'components': [component], 'status': 'published'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(json.loads(response.content)['weekTemplate']['components'][0]['ksbMappings'][0]['weight'], 3)
        response = self.patch(record['id'], {'components': []})
        self.assertEqual(response.status_code, 200, response.content)
        with connection.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM curriculum.ksb_component_mappings WHERE template_component_id=%s', [component['id']])
            self.assertEqual(cursor.fetchone()[0], 0)

    def test_invalid_mapping_rolls_back_template_and_components(self):
        response = self.create(components=[{'id': 'BAD-TC', 'title': 'Invalid',
                                         'ksbMappings': [{'standardKsbId': 999999, 'weight': 1}]}])
        self.assertEqual(response.status_code, 400, response.content)
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM curriculum.week_template_components WHERE id='BAD-TC'")
            self.assertEqual(cursor.fetchone()[0], 0)
            cursor.execute("SELECT count(*) FROM curriculum.week_templates WHERE title='Synthetic template'")
            self.assertEqual(cursor.fetchone()[0], 0)

    def test_collection_batches_mapping_reads_and_stale_revision_cannot_overwrite(self):
        from django.test.utils import CaptureQueriesContext
        original = json.loads(self.create().content)['weekTemplate']
        self.create(title='Second',components=original['components'])
        with CaptureQueriesContext(connection) as queries:
            response = views.curriculum_week_template_collection(self.factory.get('/'))
        self.assertEqual(response.status_code,200,response.content)
        mapping_queries = [q for q in queries.captured_queries if 'FROM curriculum.ksb_component_mappings m' in q['sql']]
        self.assertEqual(len(mapping_queries),1)
        self.assertIn('"standardKsbId": 9001',response.content.decode())
        revision = original['revision']
        changed = self.patch(original['id'],{'title':'Changed','expectedRevision':revision})
        self.assertEqual(changed.status_code,200,changed.content)
        stale = self.patch(original['id'],{'title':'Stale','expectedRevision':revision})
        self.assertEqual(stale.status_code,409,stale.content)
        self.assertEqual(views.week_template_record(original['id'])['title'],'Changed')
        revision = views.week_template_revision(original['id'])
        with connection.cursor() as cursor:
            cursor.execute('UPDATE curriculum.ksb_component_mappings SET weight=8 WHERE template_component_id=%s', [original['components'][0]['id']])
        self.assertNotEqual(views.week_template_revision(original['id']),revision)

    def test_copy_and_archive_leave_independent_mapping_owners(self):
        original = json.loads(self.create().content)['weekTemplate']
        response = self.create(title='Copied template', components=original['components'])
        self.assertEqual(response.status_code, 200, response.content)
        copied = json.loads(response.content)['weekTemplate']
        self.assertNotEqual(original['components'][0]['id'], copied['components'][0]['id'])
        self.assertNotEqual(original['components'][0]['ksbMappings'][0]['id'], copied['components'][0]['ksbMappings'][0]['id'])
        response = views.curriculum_week_template_detail(self.factory.delete('/'), original['id'])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(views.week_template_record(copied['id'])['components'][0]['ksbMappings']), 1)
        with connection.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM curriculum.ksb_component_mappings WHERE template_component_id IS NOT NULL')
            self.assertEqual(cursor.fetchone()[0], 2)

    def test_placement_preserves_template_and_rejects_incompatible_destination(self):
        from . import ksb_mapping_placement, write_shape
        template = json.loads(self.create().content)['weekTemplate']
        original = template['components'][0]['ksbMappings'][0]
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.programmes(programme_id,name,standard_ref,standard_version) VALUES('TP-P','Template placement','ST0612','1.0')")
            cursor.execute("INSERT INTO curriculum.modules(module_catalogue_id,programme_id,title) VALUES('TP-M','TP-P','Placed')")
            cursor.execute("INSERT INTO curriculum.components(id,week_id,module_catalogue_id,type) VALUES('TP-C','TP-W','TP-M','reading')")
        payload = views.authoring_mapping_payload('TP-M', original, component_id='TP-C', week_id='TP-W', enforce_unique=False)
        shaped, _ = write_shape.normalise('ksb_mappings', payload, {'standard_ksb_id'})
        copied = ksb_mapping_placement.reuse_mapping_rows([shaped])[0]
        self.assertNotEqual(copied['id'], original['id'])
        self.assertEqual(copied['standard_ksb_id'], 9001)
        self.assertEqual(float(copied['weight']), 2.5)
        self.assertEqual(copied['classification'], 'main')
        self.assertEqual(copied['weight_class'], 'hard')
        with connection.cursor() as cursor:
            cursor.execute('''INSERT INTO curriculum.ksb_component_mappings
                (id,component_id,standard_ksb_id,weight,classification,weight_class,status)
                VALUES(%s,'TP-C',9001,%s,%s,%s,'active')''',
                [copied['id'], copied['weight'], copied['classification'], copied['weight_class']])
        retry = ksb_mapping_placement.reuse_mapping_rows([shaped, shaped])
        self.assertEqual(len(retry), 1)
        self.assertEqual(retry[0]['id'], copied['id'])
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.programmes SET standard_version='2.0' WHERE programme_id='TP-P'")
        with self.assertRaises(ValueError):
            write_shape.normalise('ksb_mappings', payload, {'standard_ksb_id'})
        self.assertEqual(views.week_template_record(template['id'])['components'][0]['ksbMappings'][0]['id'], original['id'])

    def test_state_migrations_apply_and_reverse_without_changing_canonical_schema_or_rows(self):
        from django.db.migrations.loader import MigrationLoader
        from django.test import override_settings
        from learner_api.models import KsbStandardVersion, SourceActivityKsbMapping, LearnerActivityKsbMapping, LearnerProgressKsb
        with connection.cursor() as cursor:
            cursor.execute('CREATE TABLE IF NOT EXISTS "Learner".learner_progress_entries(id bigint PRIMARY KEY)')
        with connection.schema_editor() as editor:
            for model in (KsbStandardVersion, SourceActivityKsbMapping, LearnerActivityKsbMapping, LearnerProgressKsb):
                with connection.cursor() as cursor:
                    cursor.execute('SELECT to_regclass(%s)', [editor.quote_name(model._meta.db_table)])
                    exists = cursor.fetchone()[0]
                if not exists:
                    editor.create_model(model)
        with connection.cursor() as cursor:
            cursor.execute('''ALTER TABLE curriculum.ksb_component_mappings
                RENAME CONSTRAINT test_template_owner TO chk_ksb_mapping_owner;
                ALTER TABLE curriculum.ksb_component_mappings RENAME CONSTRAINT test_template_fk TO fk_ksb_template_component;
                ALTER TABLE curriculum.ksb_component_mappings RENAME CONSTRAINT test_template_unique TO uq_template_component_standard_ksb;
                ALTER TABLE curriculum.ksb_component_mappings
                    ADD CONSTRAINT ksb_mappings_component_id_fkey FOREIGN KEY(component_id) REFERENCES curriculum.components(id) ON DELETE RESTRICT,
                    ADD CONSTRAINT ksb_mappings_component_standard_unique UNIQUE(component_id,standard_ksb_id)''')
        original = json.loads(self.create().content)['weekTemplate']
        def fingerprint():
            with connection.cursor() as cursor:
                cursor.execute("SELECT table_schema,table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema IN ('curriculum','Learner') ORDER BY 1,2,3")
                columns = cursor.fetchall()
                cursor.execute('SELECT * FROM curriculum.ksb_component_mappings ORDER BY id')
                return columns, cursor.fetchall()
        before = fingerprint()
        with override_settings(MIGRATION_MODULES={}):
            loader = MigrationLoader(None)
            first = loader.disk_migrations[('learner_api','0032_canonical_ksb_state')]
            second = loader.disk_migrations[('curriculum_api','0099_canonical_ksb_state')]
            old = loader.project_state(first.dependencies)
            with connection.schema_editor() as editor:
                after_first = first.apply(old.clone(), editor)
                after_second = second.apply(after_first.clone(), editor)
                self.assertIn(('learner_api','learneractivityksbmapping'), after_second.models)
                second.unapply(after_first, editor)
                first.unapply(old, editor)
        self.assertEqual(fingerprint(), before)
        self.assertEqual(views.week_template_record(original['id'])['components'][0]['ksbMappings'][0]['standardKsbId'],9001)
