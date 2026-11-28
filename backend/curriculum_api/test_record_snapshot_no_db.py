"""Run directly with Python. No Django imports, DB setup, credentials or network.

The record a drawer edits has to arrive with the token that describes it. A
fresh token beside the cached overview's stale values is how a reader who
changed nothing used to overwrite a colleague's save.
"""
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).parent


class JsonResponse(dict):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status_code = status


def install_stubs(views):
    django = types.ModuleType('django')
    http = types.ModuleType('django.http')
    http.JsonResponse = JsonResponse
    decorators = types.ModuleType('django.views.decorators.http')
    decorators.require_GET = lambda view: view
    package = types.ModuleType('snapshot_pkg')
    package.__path__ = []
    package.views = views
    sys.modules.update({
        'django': django,
        'django.http': http,
        'django.views': types.ModuleType('django.views'),
        'django.views.decorators': types.ModuleType('django.views.decorators'),
        'django.views.decorators.http': decorators,
        'snapshot_pkg': package,
        'snapshot_pkg.views': views,
    })
    spec = importlib.util.spec_from_file_location('snapshot_pkg.record_snapshots', ROOT / 'record_snapshots.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Request:
    def __init__(self, **params):
        self.GET = params


class FakeViews(types.ModuleType):
    """The four record builders and the token reader, recording call order."""

    def __init__(self):
        super().__init__('snapshot_pkg.views')
        self.calls = []
        self.revision = 'rev-11'
        self.stored = {'id': 'COHORT-1', 'name': 'A renamed it'}
        self.clean_str = lambda value: str(value or '').strip()
        self.json_error = lambda message, status=400, **extra: JsonResponse({'error': message, **extra}, status)
        self.programme_conflict_record = self.cohort_conflict_record = self.group_conflict_record = self.read_record
        self.resolve_stored_module_catalogue_id = lambda identifier: 'MOD-CAT'
        self.get_authoring_structure_payload = lambda identifier: self.read_record(identifier)
        self.curriculum_module_from_authoring_payload = lambda payload: payload

    def curriculum_record_revision(self, kind, identifier):
        self.calls.append(('revision', kind, identifier))
        return self.revision

    def read_record(self, identifier):
        self.calls.append(('record', identifier))
        if isinstance(self.stored, Exception):
            raise self.stored
        return self.stored


class RecordSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.views = FakeViews()
        self.module = install_stubs(self.views)

    def snapshot(self, **params):
        return self.module.curriculum_record_snapshot(Request(**params))

    def test_answers_the_record_with_its_token(self):
        response = self.snapshot(kind='cohort', id='COHORT-1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['revision'], 'rev-11')
        self.assertEqual(response['record'], {'id': 'COHORT-1', 'name': 'A renamed it'})

    def test_reads_the_token_before_the_record(self):
        # A write between the two reads must leave the token older than the
        # record -- refused and merged -- never newer, which would overwrite.
        self.snapshot(kind='group', id='GROUP-1')
        self.assertEqual([call[0] for call in self.views.calls], ['revision', 'record'])

    def test_module_reads_the_stored_catalogue_module(self):
        self.snapshot(kind='module', id='MOD-ROW')
        self.assertIn(('record', 'MOD-CAT'), self.views.calls)

    def test_a_record_without_a_version_says_so_and_reads_nothing_else(self):
        self.views.revision = ''
        response = self.snapshot(kind='cohort', id='COHORT-1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response['revision'], response['record']), ('', None))
        self.assertEqual([call[0] for call in self.views.calls], ['revision'])

    def test_a_token_without_its_record_is_never_handed_out(self):
        for failure in (None, RuntimeError('database went away')):
            self.views.stored = failure
            response = self.snapshot(kind='programme', id='PROG-1')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('revision', response)

    def test_unknown_kinds_and_missing_ids_are_refused(self):
        for params in ({'kind': 'weekTemplate', 'id': 'W-1'}, {'kind': 'cohort'}, {}):
            self.assertEqual(self.snapshot(**params).status_code, 400)
        self.assertEqual(self.views.calls, [])


if __name__ == '__main__':
    unittest.main()
