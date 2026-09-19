"""Isolated production validators: no Django app setup or database connections.

Extract only the pure validators and the injected cursor boundary, so importing
application URL/auth modules cannot initialise production database services.
"""
import ast
import hashlib
import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock
from django.conf import settings
from django.core import signing

if not settings.configured:
    settings.configure(SECRET_KEY='isolated-mcm-test-only', SECRET_KEY_FALLBACKS=[])

source = Path(__file__).with_name('monthly_assignment.py')
names = {'text', 'mapping', 'items', 'presentation_fingerprint', 'valid_presentation', 'valid_uploaded_presentation'}
functions = [node for node in ast.parse(source.read_text(encoding='utf-8')).body if isinstance(node, ast.FunctionDef) and node.name in names]
assert len(functions) == len(names)


class UploadedMcmTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value.__enter__.return_value
        self.scope = dict(hashlib=hashlib, json=json, signing=signing, connections={'enrolment': self.connection})
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), self.scope)
        self.payload = {'learnerKind': 'commercial', 'learnerId': '12', 'activityId': 'COMP-1', 'monthlyAssignment': {'presentationReviewed': True, 'uploadedPresentation': {'id': 'file-1', 'name': 'untrusted.pptx'}}}

    def check(self):
        return self.scope['valid_presentation'](self.payload)

    def test_uploaded_powerpoint_needs_no_generated_slides_or_token(self):
        for kind in ('commercial', 'apprenticeship'):
            for name in ('my-mcm.ppt', 'my-mcm.PPTX'):
                self.payload['learnerKind'] = kind
                self.cursor.fetchone.return_value = (name,)
                self.assertTrue(self.check())
                sql, params = self.cursor.execute.call_args.args
                self.assertEqual(params, ['file-1', kind, '12', 'COMP-1', 50 * 1024 * 1024])
                for clause in ("status = 'approved'", 'learner_id = %s', 'learner_kind = %s', 'section_ref = %s', 'size_bytes > 0'):
                    self.assertIn(clause, sql)

    def test_missing_foreign_or_unapproved_file_cannot_pass(self):
        self.cursor.fetchone.return_value = None
        self.assertFalse(self.check())

    def test_client_filename_does_not_override_stored_type(self):
        self.cursor.fetchone.return_value = ('notes.pdf',)
        self.assertFalse(self.check())

    def test_review_is_required_for_upload(self):
        self.payload['monthlyAssignment']['presentationReviewed'] = False
        self.assertFalse(self.check())
        self.connection.cursor.assert_not_called()

    def test_existing_export_remains_valid_without_database_access(self):
        monthly = self.payload['monthlyAssignment']
        monthly.pop('uploadedPresentation')
        monthly['slides'] = [{'title': 'MCM', 'body': 'My work'}]
        monthly['presentationToken'] = signing.dumps(self.scope['presentation_fingerprint'](self.payload), salt='monthly-assignment-pptx')
        self.assertTrue(self.check())
        self.connection.cursor.assert_not_called()
        monthly['slides'][0]['body'] = 'Changed after export'
        self.assertFalse(self.check())

    def test_neither_upload_nor_export_fails(self):
        self.payload['monthlyAssignment'].pop('uploadedPresentation')
        self.assertFalse(self.check())
        self.connection.cursor.assert_not_called()
