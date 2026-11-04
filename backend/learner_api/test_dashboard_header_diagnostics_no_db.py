"""Dashboard header database failures are diagnosable server-side, never to the learner.

No database: the header builder is replaced by one that raises a Django
DatabaseError wrapping a synthetic driver error.
"""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import OperationalError, ProgrammingError
from django.test import RequestFactory, SimpleTestCase

from . import dashboard_header

GENERIC = {'error': 'Could not load your Dashboard header. Please try again.'}
SECRET = 'password=synthetic-secret host=db.internal person@example.test'


class DriverError(Exception):
    """Stands in for a psycopg error: a SQLSTATE and a diagnostic primary message."""

    def __init__(self, sqlstate, primary):
        super().__init__(f'{primary} {SECRET}')
        self.sqlstate = sqlstate
        self.diag = SimpleNamespace(message_primary=primary)


def failing_builder(wrapper, sqlstate, primary):
    def build(*_args, **_kwargs):
        try:
            raise DriverError(sqlstate, primary)
        except DriverError as cause:
            raise wrapper(f'{primary} {SECRET}') from cause
    return build


class HeaderDiagnosticsTests(SimpleTestCase):
    def call(self, builder, *, minimal=True):
        view = dashboard_header.dashboard_header.__wrapped__.__wrapped__   # skip auth; keep journal view
        request = RequestFactory().get('/learner_api/dashboard/commercial/101/header/minimal/')
        request.login_account = SimpleNamespace(role='learner', subject_id=101)
        with patch.object(dashboard_header, 'read_header_source', return_value=SimpleNamespace(pk=101)), \
             patch.object(dashboard_header, 'build_minimal_header', side_effect=builder), \
             patch.object(dashboard_header, 'build_dashboard_header', side_effect=builder), \
             self.assertLogs('learner_api.dashboard_header', level='ERROR') as logs:
            response = view(request, 'commercial', 101, minimal=minimal)
        return response, '\n'.join(logs.output)

    def test_schema_error_logs_class_sqlstate_message_and_location(self):
        response, log = self.call(failing_builder(ProgrammingError, '42703', 'column g.coach_name does not exist'))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content), GENERIC)
        self.assertIn('variant=minimal', log)
        self.assertIn('kind=commercial learner_id=101', log)
        self.assertIn('type=ProgrammingError', log)
        self.assertIn('sqlstate=42703', log)
        self.assertIn("schema_message='column g.coach_name does not exist'", log)
        self.assertIn('test_dashboard_header_diagnostics_no_db.py', log)   # innermost project frame
        for secret in ('synthetic-secret', 'db.internal', 'person@example.test'):
            self.assertNotIn(secret, log)

    def test_non_schema_error_withholds_the_message(self):
        response, log = self.call(failing_builder(OperationalError, '08006', 'connection to db.internal failed'),
                                  minimal=False)
        self.assertEqual(json.loads(response.content), GENERIC)
        self.assertIn('variant=full', log)
        self.assertIn('sqlstate=08006', log)
        self.assertIn("schema_message='withheld'", log)
        self.assertNotIn('db.internal', log)

    def test_learner_response_never_carries_internal_text(self):
        response, _log = self.call(failing_builder(ProgrammingError, '42P01', 'relation "curriculum.x" does not exist'))
        body = response.content.decode()
        for text in ('42P01', 'curriculum.x', 'synthetic-secret', 'Traceback'):
            self.assertNotIn(text, body)
