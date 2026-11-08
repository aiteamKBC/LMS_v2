"""Synthetic runtime diagnostics: no AWS calls or application startup."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('recording_runtime', Path(__file__).with_name('recording-runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RecordingRuntimeTests(unittest.TestCase):
    def test_summary_redacts_values_and_reports_missing_settings_and_wrong_image(self):
        definition = {'name': 'worker', 'environment': [
            {'name': 'BUNNY_STREAM_API_KEY', 'value': 'synthetic-private-upload-value'},
            {'name': 'BUNNY_STREAM_ENABLED', 'value': 'false'},
        ], 'secrets': [{'name': 'MICROSOFT_GRAPH_CLIENT_SECRET', 'valueFrom': 'synthetic-private-secret-arn'}]}
        result = runtime.container_summary(definition, {'imageDigest': 'old'}, {}, 'new')
        self.assertEqual(result['bunny_enabled'], 'false')
        self.assertFalse(result['image_matches_release'])
        self.assertEqual(result['settings']['BUNNY_STREAM_TOKEN_KEY'], 'missing_or_empty')
        self.assertEqual(result['settings']['MICROSOFT_GRAPH_CLIENT_SECRET'], 'secret_mapped')
        self.assertNotIn('synthetic-private', json.dumps(result))

    def test_secret_flag_is_unverified_and_actual_task_command_override_wins(self):
        definition = {'name': 'worker', 'secrets': [{'name': 'BUNNY_STREAM_ENABLED'}],
                      'command': ['python', 'manage.py', 'process_session_results', '--scheduled']}
        result = runtime.container_summary(definition, {'imageDigest': 'new'}, {'command': ['sleep', '60']}, 'new')
        self.assertEqual(result['bunny_enabled'], 'secret_mapped_unverified')
        self.assertFalse(result['scheduled_session_command'])
        self.assertTrue(result['image_matches_release'])

    def test_running_task_definition_is_inspected_instead_of_a_newer_service_revision(self):
        def cloud(*args):
            if args[1] == 'list-tasks':
                return {'taskArns': ['task']}
            if args[1] == 'describe-tasks':
                return {'tasks': [{'taskDefinitionArn': 'actual-running-revision',
                                  'containers': [{'name': 'worker', 'imageDigest': 'new'}]}]}
            self.assertEqual(args[-1], 'actual-running-revision')
            return {'taskDefinition': {'containerDefinitions': [{'name': 'worker', 'environment': [
                {'name': 'BUNNY_STREAM_ENABLED', 'value': 'true'}]}]}}
        with patch.object(runtime, 'aws', side_effect=cloud):
            result = runtime.inspect_service('session-worker', 'synthetic-cluster', 'new')
        self.assertEqual(result['running_tasks'], 1)
        self.assertEqual(result['containers'][0]['bunny_enabled'], 'true')

    def test_task_environment_override_can_disable_an_enabled_definition(self):
        definition = {'name': 'worker', 'environment': [{'name': 'BUNNY_STREAM_ENABLED', 'value': 'true'}]}
        override = {'environment': [{'name': 'BUNNY_STREAM_ENABLED', 'value': 'false'}]}
        self.assertEqual(runtime.container_summary(definition, {}, override, '')['bunny_enabled'], 'false')


if __name__ == '__main__':
    unittest.main()
