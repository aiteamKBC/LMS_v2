"""What the audit log is allowed to know.

These tests are about restraint rather than function. The write layer is easy to
verify by hand -- a save appears in the feed -- and hard to verify in the one
way that matters, which is that a learner's date of birth, address and national
insurance number never reach it. That failure is silent: the page looks correct
either way, and the only sign of it is a column in a table nobody reads until
somebody asks how the LMS came to hold a second copy of everybody's personal
data.

So: the redaction is asserted per field, the allowlist is asserted to exclude
what was never named, and the rollback rule is asserted per connection.
"""

from django.db import DEFAULT_DB_ALIAS
from django.test import SimpleTestCase

from curriculum_api import versioning

from . import writes


class RedactionTests(SimpleTestCase):
    def test_a_sensitive_field_records_that_it_changed_but_not_what_to(self):
        before = versioning.build_snapshot('learner_record', {
            'id': 7, 'username': 'Sam Hunt', 'date_of_birth': '1998-04-02',
        })
        after = versioning.build_snapshot('learner_record', {
            'id': 7, 'username': 'Sam Hunt', 'date_of_birth': '1998-04-03',
        })

        self.assertNotIn('1998-04-02', str(before))
        self.assertNotIn('1998-04-03', str(after))

        changes = versioning.diff_snapshots(before, after)
        self.assertEqual([change['field'] for change in changes], ['date_of_birth'])

    def test_an_unchanged_sensitive_field_records_nothing(self):
        # A digest that moved on every save would make every save look like an
        # edit to somebody's date of birth.
        row = {'id': 7, 'username': 'Sam Hunt', 'date_of_birth': '1998-04-02'}
        first = versioning.build_snapshot('learner_record', dict(row))
        second = versioning.build_snapshot('learner_record', dict(row))
        self.assertEqual(versioning.diff_snapshots(first, second), [])

    def test_the_learner_record_hides_every_personal_detail(self):
        hidden = versioning.REDACTED_COLUMNS['learner_record']
        for column in (
            'date_of_birth', 'phone_number', 'address', 'current_postcode',
            'national_insurance_number', 'legal_sex', 'gender', 'age', 'contacts',
        ):
            self.assertIn(column, hidden, f'{column} would be stored in the clear')

    def test_a_coach_note_is_audited_without_being_copied(self):
        hidden = versioning.REDACTED_COLUMNS['absence_report']
        self.assertIn('reason', hidden)
        self.assertIn('coach_note', hidden)
        self.assertIn('evidence_text', hidden)
        # The category is the part a reader needs and the part that is safe.
        self.assertNotIn('reason_category', hidden)

    def test_a_way_into_a_meeting_is_not_collected_at_all(self):
        # Redacting a link would be pointless; not collecting it is the point.
        collected = versioning.SNAPSHOT_COLUMNS['coach_meeting']
        self.assertNotIn('meeting_link', collected)
        self.assertNotIn('graph_web_link', collected)
        self.assertIn('graph_event_id', collected)

    def test_redacting_a_column_that_is_not_collected_is_refused(self):
        # Silently ignoring it would leave a line of configuration that reads as
        # a protection and is not one.
        with self.assertRaises(ValueError):
            writes.register(
                'system_audit_test_table',
                workspace='admin',
                entity_type='system_audit_test_entity',
                key='id',
                columns=('id', 'name'),
                redact=('secret',),
            )


class WorkspaceTests(SimpleTestCase):
    def test_every_registered_record_belongs_to_a_workspace(self):
        for entity in versioning.ENTITY_TYPES:
            self.assertTrue(
                writes.workspace_for_entity(entity),
                f'{entity} has no workspace, so its changes could not be scoped',
            )

    def test_the_scoped_door_reads_only_its_own_workspace(self):
        curriculum = set(writes.entity_types_for_workspace('curriculum'))
        coach = set(writes.entity_types_for_workspace('coach'))
        self.assertIn('module', curriculum)
        self.assertIn('coach_meeting', coach)
        self.assertFalse(curriculum & coach)

    def test_no_workspace_means_every_workspace(self):
        self.assertEqual(
            set(writes.entity_types_for_workspace('')),
            set(versioning.ENTITY_TYPES),
        )

    def test_the_reported_coverage_is_what_is_actually_registered(self):
        # The Audit Trail shows this list to say which workspaces its Changes
        # feed can speak for. A hard-coded list would keep saying 'curriculum'
        # after the others were wired in, which is a lie in the safer direction
        # but a lie all the same.
        self.assertEqual(
            writes.change_workspaces(),
            sorted({writes.workspace_for_entity(e) for e in versioning.ENTITY_TYPES}),
        )


class BufferTests(SimpleTestCase):
    def tearDown(self):
        versioning.discard_pending()

    def test_each_connection_buffers_on_its_own(self):
        # One request can write through two connections, and each becomes
        # durable at its own commit. A shared buffer would let the first commit
        # carry the second's rows out with it -- a revision recorded for a write
        # that might still roll back.
        versioning.pending_buffer(DEFAULT_DB_ALIAS)[('module', 'M1')] = {'entity_type': 'module'}
        versioning.pending_buffer('enrolment')[('learner_record', '7')] = {'entity_type': 'learner_record'}

        versioning.flush_pending(DEFAULT_DB_ALIAS)

        self.assertEqual(versioning.pending_buffer(DEFAULT_DB_ALIAS), {})
        self.assertEqual(len(versioning.pending_buffer('enrolment')), 1)

    def test_discarding_one_connection_leaves_the_other(self):
        versioning.pending_buffer(DEFAULT_DB_ALIAS)[('module', 'M1')] = {}
        versioning.pending_buffer('enrolment')[('learner_record', '7')] = {}

        versioning.discard_pending(DEFAULT_DB_ALIAS)

        self.assertNotIn(DEFAULT_DB_ALIAS, versioning.pending_buffers())
        self.assertIn('enrolment', versioning.pending_buffers())


class RowTests(SimpleTestCase):
    def test_a_row_carries_exactly_the_allowlisted_columns(self):
        class Fake:
            id = 7
            username = 'Sam Hunt'
            national_insurance_number = 'QQ123456C'
            something_new = 'added to the model later'

        row = writes.row_from_instance(Fake(), ('id', 'username'))
        self.assertEqual(row, {'id': 7, 'username': 'Sam Hunt'})
        # The guarantee that matters: a column added to a model later cannot
        # reach history without somebody naming it here.
        self.assertNotIn('something_new', row)
        self.assertNotIn('national_insurance_number', row)

    def test_an_unreadable_column_is_absent_rather_than_missing(self):
        class Fake:
            id = 7

            @property
            def broken(self):
                raise RuntimeError('deferred')

        row = writes.row_from_instance(Fake(), ('id', 'broken'))
        # Present and None, so the snapshot keeps its shape: dropping the key
        # would read as "this field was removed" on the next diff.
        self.assertEqual(row, {'id': 7, 'broken': None})
