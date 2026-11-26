"""Revisions written by an older version of the log still read back.

An early form of the log stored only the names of the fields that moved
(``["orientation_ksb_mappings"]``) rather than ``{field, from, to}``. Reading
one raised ``'str' object has no attribute 'get'`` and failed the whole page --
on production, ``?entity=module`` on the system-wide trail. The field is still
listed; its values are reported as not recorded, never as empty.
"""

from curriculum_api import versioning
from curriculum_api.tests_audit_trail import AuditHarness


class LegacyChangedFieldsTests(AuditHarness):

    def legacy_revision(self, changed_fields):
        with self.connection_cursor() as cursor:
            cursor.execute(
                f'insert into {versioning.qualified(versioning.REVISIONS_TABLE)} (entity_type, entity_id, '
                'revision_no, action, title, snapshot, changed_fields, actor_email, actor_name) '
                'values (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
                ['module', 'MOD-LEGACY', 1, 'update', 'Orientation', '{}', changed_fields,
                 'author@example.test', 'Author'],
            )

    def read(self, query):
        response = self.client.get(f'/curriculum_api/curriculum/quality/audit-trail/{query}')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_a_list_of_field_names_reads_back_instead_of_failing_the_page(self):
        self.legacy_revision('["orientation_ksb_mappings"]')

        payload = self.read('?entity=module&days=7')

        event = next(event for event in payload['events'] if event['entityId'] == 'MOD-LEGACY')
        self.assertEqual(len(event['changes']), 1)
        change = event['changes'][0]
        self.assertEqual(change['field'], 'orientation_ksb_mappings')
        self.assertIsNone(change['before'])
        self.assertIsNone(change['after'])
        self.assertFalse(change['valuesRecorded'])

    def test_an_unreadable_entry_is_skipped_and_the_rest_still_shown(self):
        self.legacy_revision('[42, null, {"field": "title", "from": "Old", "to": "New"}]')

        payload = self.read('?entity=module&days=7')

        event = next(event for event in payload['events'] if event['entityId'] == 'MOD-LEGACY')
        self.assertEqual([change['field'] for change in event['changes']], ['title'])
        self.assertEqual((event['changes'][0]['before'], event['changes'][0]['after']), ('Old', 'New'))
