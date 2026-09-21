"""Signature archive regression checks without Django, storage or DB access."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).parent

def load(filename, name, namespace):
    tree = ast.parse((ROOT / filename).read_text(encoding='utf-8'))
    tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
    for node in tree.body:
        node.decorator_list = []
    exec(compile(tree, filename, 'exec'), namespace)
    return namespace[name]

class ServiceError(Exception):
    def __init__(self, message, code, status):
        super().__init__(message)
        self.status = status

class SignatureArchiveTests(unittest.TestCase):
    def test_owner_reader_keeps_active_and_archive_scoped_to_same_transition(self):
        query = Mock(return_value=[{'learner_id': 125, 'signer_role': 'learner', 'report_month': '2026-07'}])
        function = load('repository.py', 'signature_owner', {'query': query, 'SIGNOFFS': 'signoffs',
            'TRANSITIONS': 'transitions', 'VERSION': 'v1'})
        self.assertEqual(function('file-id')['learner_id'], 125)
        sql, args = query.call_args.args
        self.assertIn("s.programme_key=('otjh-transition:' || t.learner_id::text)", sql)
        self.assertIn("'otjh-transition:' || t.learner_id::text || ':resign-archive:'", sql)
        self.assertIn('s.review_confirmed IS TRUE', sql)
        self.assertEqual(args, ['v1', 'file-id'])
        query.return_value = [{'learner_id': 125, 'signer_role': 'learner'}, {'learner_id': 126, 'signer_role': 'learner'}]
        self.assertIsNone(function('file-id'))
        query.return_value = []
        self.assertIsNone(function('file-id'))

    def file_reader(self, role, learner_id):
        repo = SimpleNamespace(signature_owner=Mock(return_value={'learner_id': 125, 'report_month': '2026-07'}),
                               student=Mock(return_value={'id': 125, 'aptem_id': 92}))
        service = SimpleNamespace(ServiceError=ServiceError,
            resolve_authenticated_learner=Mock(return_value={'id': learner_id}),
            coach_learner=Mock(return_value=({'id': 125}, 'coach')),
            require_month=Mock(), readable_transition=Mock(return_value={'required_months': ['2026-07']}))
        storage = SimpleNamespace(read=Mock(return_value=iter([b'image'])))
        function = load('views.py', 'signature_file', {'repo': repo, 'service': service, 'storage': storage,
            'StreamingHttpResponse': lambda stream, **kwargs: list(stream)})
        request = SimpleNamespace(login_account=SimpleNamespace(role=role))
        return function, request, service, storage

    def test_learner_can_read_own_archived_image(self):
        function, request, service, storage = self.file_reader('learner', 125)
        self.assertEqual(function(request, 'image-id'), [b'image'])
        service.require_month.assert_called_once()
        storage.read.assert_called_once_with('image-id')

    def test_other_learner_cannot_read_archived_image(self):
        function, request, _, storage = self.file_reader('learner', 126)
        with self.assertRaises(ServiceError) as error:
            function(request, 'image-id')
        self.assertEqual(error.exception.status, 404)
        storage.read.assert_not_called()

    def test_staff_still_requires_caseload_authorization(self):
        function, request, service, storage = self.file_reader('coach', None)
        service.coach_learner.side_effect = ServiceError('Forbidden', 'forbidden', 403)
        with self.assertRaises(ServiceError):
            function(request, 'image-id')
        storage.read.assert_not_called()

    def test_missing_active_signature_reopens_even_with_old_finalization(self):
        state = load('service.py', '_state', {})
        before = state('2026-07', {}, {('2026-07', 'learner'): {'id': 1}}, {'event_type': 'finalized'}, 0)
        after = state('2026-07', {}, {}, {'event_type': 'finalized'}, 0)
        self.assertEqual(before['status'], 'complete')
        self.assertEqual(after['status'], 'awaiting_signature')

if __name__ == '__main__':
    unittest.main()
