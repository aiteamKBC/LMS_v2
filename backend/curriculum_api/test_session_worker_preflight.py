"""Real preflight with mocked credentials: no AWS calls or queue writes."""
from io import StringIO
from unittest.mock import Mock,patch
from django.core.management.base import CommandError
from django.test import SimpleTestCase,override_settings
from .session_worker_preflight import archive_runtime_preflight


@override_settings(STORAGE_BACKEND='s3',AWS_S3_STORAGE_BUCKET='synthetic-bucket',AZURE_STORAGE_ACCOUNT='synthetic',AZURE_STORAGE_KEY='')
class WorkerArchivePreflightTests(SimpleTestCase):
    def test_iam_credentials_are_resolved_before_the_worker_is_allowed(self):
        with patch('boto3.Session')as session:
            credentials=session.return_value.get_credentials.return_value
            origin=archive_runtime_preflight()
        credentials.get_frozen_credentials.assert_called_once_with()
        self.assertTrue(origin.endswith(':s3'))

    def test_missing_role_credentials_fail_without_revealing_settings(self):
        with patch('boto3.Session')as session,self.assertLogs('curriculum_api.session_worker_preflight',level='WARNING')as logs:
            session.return_value.get_credentials.return_value=None
            with self.assertRaisesMessage(CommandError,'NoCredentialsError'):
                archive_runtime_preflight()
        self.assertIn('no session jobs claimed',' '.join(logs.output))
        self.assertNotIn('synthetic-bucket',' '.join(logs.output))

    def test_provider_exception_text_is_never_logged_or_returned(self):
        with patch('boto3.Session',side_effect=RuntimeError('private-token@example.invalid')), self.assertLogs('curriculum_api.session_worker_preflight',level='WARNING')as logs:
            with self.assertRaises(CommandError)as error:archive_runtime_preflight()
        self.assertNotIn('private-token',str(error.exception)+' '.join(logs.output))

    def test_refused_preflight_prevents_discovery_claims_and_provider_calls(self):
        from .management.commands import process_session_results as worker
        with patch.object(worker,'archive_runtime_preflight',side_effect=CommandError('Refused')), \
             patch.object(worker,'connections')as connections, patch.object(worker,'archive_series')as archive:
            with self.assertRaisesMessage(CommandError,'Refused'):
                worker.Command(stdout=StringIO()).handle(limit=1,scheduled=True,provision_container=False)
        connections.__getitem__.assert_not_called()
        archive.assert_not_called()

    @override_settings(AWS_S3_STORAGE_BUCKET='')
    def test_missing_namespace_configuration_is_rejected_before_loading_credentials(self):
        with patch('boto3.Session')as session,self.assertLogs('curriculum_api.session_worker_preflight',level='WARNING'):
            with self.assertRaisesMessage(CommandError,'ValueError'):archive_runtime_preflight()
        session.assert_not_called()
