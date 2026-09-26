"""The rule that a structure payload and its revision are one snapshot.

The real functions, lifted out of views.py and run against an in-memory module;
no Django setup, no database, no network. What is under test is an ordering, and
an ordering is exactly what a mocked store can demonstrate:

The Module Builder reads a module, holds it open, and later writes the WHOLE
structure back with the revision it was handed. The save is refused unless the
stored material still fingerprints to that revision. So a payload that arrives
carrying a revision NEWER than its own content is not a stale read -- it is a
save that will pass the guard and overwrite whoever wrote in between, reporting
success. These reads run in autocommit, one snapshot per statement, so the only
thing standing between that and a silent data loss is which of the two is read
first.
"""
import ast
import unittest
from pathlib import Path
from unittest.mock import patch


def load_functions():
    """The real ``structure_payload_with_revision`` and its sibling."""
    wanted_functions = {'structure_payload_with_revision', 'stamp_revision_after_write'}
    wanted_constants = {'STRUCTURE_REVISION_UNAVAILABLE'}
    tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
    nodes = [
        node for node in tree.body
        if (isinstance(node, ast.FunctionDef) and node.name in wanted_functions)
        or (
            isinstance(node, ast.Assign)
            and any(getattr(target, 'id', None) in wanted_constants for target in node.targets)
        )
    ]
    assert len(nodes) == len(wanted_functions) + len(wanted_constants), [
        getattr(node, 'name', None) for node in nodes
    ]
    namespace = {}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'revision-functions', 'exec'), namespace)
    return namespace


class StructureSnapshotTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.namespace = load_functions()
        # One module, standing in for the six tables the fingerprint covers.
        self.stored_title = 'Week one'
        self.revision_reads = []
        self.namespace['module_structure_revision'] = self.read_revision

    def read_revision(self, module_catalogue_id):
        """What the six-table fingerprint would return for the current content."""
        revision = f'rev-of-{self.stored_title}'
        self.revision_reads.append(revision)
        return revision

    def build_payload(self):
        return {'catalogueId': 'MOD-1', 'weekStructure': [{'title': self.stored_title}]}

    def stamp(self, build):
        return self.namespace['structure_payload_with_revision'](build, 'MOD-1')

    def test_a_write_during_the_build_leaves_a_revision_the_save_guard_will_refuse(self):
        # Somebody else commits while this request is assembling the payload.
        # The reader therefore ends up holding content that is newer than the
        # revision it was promised -- which is the safe way round, because the
        # revision it holds is no longer the stored one and the save built on it
        # is refused. The opposite (new revision, old content) is accepted by
        # the guard and destroys the other writer's work in silence.
        def build_with_a_concurrent_save():
            self.stored_title = 'Week one, renamed by Sara'
            return self.build_payload()

        payload = self.stamp(build_with_a_concurrent_save)

        self.assertEqual(payload['structureRevision'], 'rev-of-Week one')
        self.assertNotEqual(payload['structureRevision'], self.read_revision('MOD-1'))
        # The content really is the post-write content: the pair is genuinely
        # inconsistent, and it is the revision that is behind, never ahead.
        self.assertEqual(payload['weekStructure'][0]['title'], 'Week one, renamed by Sara')

    def test_the_revision_is_read_before_the_payload_not_after_it(self):
        # The ordering stated directly, because every other guarantee here rests
        # on it and a refactor could reverse it without failing anything else.
        order = []
        self.namespace['module_structure_revision'] = lambda module_id: order.append('revision') or 'rev-1'

        self.stamp(lambda: order.append('payload') or self.build_payload())

        self.assertEqual(order, ['revision', 'payload'])

    def test_a_quiet_module_is_stamped_with_its_own_revision(self):
        # The ordinary case: nothing moved, so the pair is exactly consistent
        # and the save it feeds is accepted.
        payload = self.stamp(self.build_payload)

        self.assertEqual(payload['structureRevision'], 'rev-of-Week one')
        self.assertEqual(payload['weekStructure'][0]['title'], 'Week one')

    def test_a_revision_that_cannot_be_read_is_stamped_unverified_rather_than_blank(self):
        # '' travels back to the endpoint as "this caller is not asking to be
        # checked", so the save would run with no guard at all. A value that can
        # never equal a fingerprint makes the save fail closed instead.
        self.namespace['module_structure_revision'] = lambda module_id: ''

        payload = self.stamp(self.build_payload)

        self.assertEqual(payload['structureRevision'], self.namespace['STRUCTURE_REVISION_UNAVAILABLE'])
        self.assertTrue(payload['structureRevision'])

    def test_a_module_that_is_not_there_is_returned_unstamped(self):
        self.assertIsNone(self.stamp(lambda: None))
        self.assertEqual(self.stamp(lambda: {}), {})

    def test_a_caller_that_has_just_written_stamps_the_revision_of_its_own_write(self):
        # The one legitimate exception, and the reason it is a separate function
        # rather than a flag: the training-plan read provisions the structure on
        # the way through, so a revision read beforehand would describe the
        # module as it was before it existed and refuse the first save of it.
        self.stored_title = 'Week one, just provisioned'

        payload = self.namespace['stamp_revision_after_write'](self.build_payload(), 'MOD-1')

        self.assertEqual(payload['structureRevision'], 'rev-of-Week one, just provisioned')
        self.assertIsNone(self.namespace['stamp_revision_after_write'](None, 'MOD-1'))


if __name__ == '__main__':
    unittest.main()
