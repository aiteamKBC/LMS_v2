"""LMS contract ownership and read-only behavior; no database or storage calls."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import employer_contracts as contracts, employer_portal as portal


class EmployerContractsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role='employer', subject_id=9)
        # An Aptem link must not cause imported-contract reads.
        self.learner = SimpleNamespace(pk=101, employer_id=9, aptem_id=550)
        self.model = MagicMock()
        self.model.all_learners.get.return_value = self.learner
        self.model.DoesNotExist = type('DoesNotExist', (Exception,), {})
        self.lms = {'id': '1', 'label': 'Training Plan', 'kind': 'training-plan', 'signed': False,
                    'signable': True, 'generatedAt': '2026-11-20'}
        for patcher in (
            patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}),
            patch('login.permissions.authenticate_request', side_effect=lambda request: self.account),
            patch.object(portal, '_employer_or_404', return_value=(SimpleNamespace(pk=9), None)),
            patch.object(portal, 'SOURCE_MODELS', {'commercial': self.model, 'apprenticeship': self.model}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(portal, '_document_signing_rows', return_value=[self.lms])
        self.documents = patcher.start()
        self.addCleanup(patcher.stop)

    def request(self, *, employer_id=9, kind='apprenticeship', method='get'):
        return contracts.employer_learner_contracts(
            getattr(self.factory, method)('/contracts/'), employer_id=employer_id,
            kind=kind, learner_id=101,
        )

    def test_returns_only_lms_issued_contracts_for_both_learner_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            body = json.loads(self.request(kind=kind).content)
            self.assertEqual(body['sources'], {'lms': 'ready'})
            self.assertEqual(len(body['contracts']), 1)
            self.assertEqual(body['contracts'][0]['source'], 'lms')
            self.assertEqual(body['contracts'][0]['document'], self.lms)
            self.documents.assert_called_with(kind, 101, strict_read=True)

    def test_signature_status_is_the_saved_employer_signature(self):
        for signed in (True, False):
            self.lms['signed'] = signed
            self.assertIs(json.loads(self.request().content)['contracts'][0]['signed'], signed)

    def test_failed_lms_read_is_visible_instead_of_an_empty_success(self):
        self.documents.side_effect = DatabaseError('unavailable')
        body = json.loads(self.request().content)
        self.assertEqual(body, {'contracts': [], 'sources': {'lms': 'error'}})

    def test_other_employer_or_unowned_learner_cannot_read(self):
        self.assertEqual(self.request(employer_id=10).status_code, 404)
        self.learner.employer_id = 10
        self.assertEqual(self.request().status_code, 403)
        self.documents.assert_not_called()

    def test_anonymous_and_learner_roles_cannot_read(self):
        for account in (None, SimpleNamespace(role='learner', subject_id=101)):
            self.account = account
            self.assertIn(self.request().status_code, (401, 403))
        self.documents.assert_not_called()

    def test_staff_can_read_owned_learner_contracts(self):
        self.account = SimpleNamespace(role='staff', subject_id=88)
        self.assertEqual(self.request().status_code, 200)

    def test_post_is_rejected_without_reading_or_signing(self):
        self.assertEqual(self.request(method='post').status_code, 405)
        self.documents.assert_not_called()

    def test_metadata_is_not_cached_publicly(self):
        self.assertEqual(self.request()['Cache-Control'], 'private, no-store')

    def test_strict_read_does_not_create_tables_and_surfaces_failure(self):
        with patch.object(portal, '_active_documents', return_value={}), \
                patch('enrolment_api.document_tables.ensure_enrolment_documents_table') as ensure, \
                patch('django.db.connections') as connections:
            connections.__getitem__.return_value.cursor.side_effect = DatabaseError('missing table')
            with self.assertRaises(DatabaseError):
                portal._document_signing_rows_for([('apprenticeship', 101)], strict_read=True)
            ensure.assert_not_called()
