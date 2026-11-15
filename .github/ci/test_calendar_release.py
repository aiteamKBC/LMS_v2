"""All ECS/ECR commands are mocked. Never reads local AWS credentials."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('calendar_release', Path(__file__).with_name('calendar_release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
COMMIT = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64
IMAGE = 'registry/repository@' + DIGEST


def source(name='day'):
    return {'family': name, 'taskDefinitionArn': name + ':26', 'networkMode': 'awsvpc',
            'requiresCompatibilities': ['FARGATE'], 'taskRoleArn': 'task-role',
            'executionRoleArn': 'execution-role', 'cpu': '256', 'memory': '512',
            'containerDefinitions': [{'name': 'api', 'image': 'registry/repository:live',
                                      'entryPoint': ['/app/docker-entrypoint.sh'],
                                      'command': ['gunicorn', 'config.wsgi'],
                                      'healthCheck': {'command': ['CMD', 'curl', '/health/']},
                                      'restartPolicy': {'enabled': True},
                                      'environment': [{'name': 'DATABASE_URL', 'value': 'private-existing-url'}],
                                      'secrets': [{'name': release.KEY, 'valueFrom': 'private-secret-ref'}],
                                      'logConfiguration': {'logDriver': 'awslogs', 'options': {}}}]}


def service(name='day'):
    return {'serviceName': name, 'taskDefinition': name + ':26', 'platformVersion': '1.4.0',
            'networkConfiguration': {'awsvpcConfiguration': {'subnets': ['subnet-existing'],
                                                            'securityGroups': ['sg-existing'],
                                                            'assignPublicIp': 'DISABLED'}}}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.addCleanup(patch.stopall)
        patch.object(release, 'STATE', self.state).start()
        patch.dict(os.environ, {'COMMIT': COMMIT, 'ECR_REPOSITORY': 'repository', 'ECS_CLUSTER': 'cluster',
                                'CALENDAR_EXPECTED_ENDPOINT': 'ep-example', 'CALENDAR_EXPECTED_DATABASE': 'neondb',
                                'CALENDAR_SCHEMA_REQUIRED': 'true'}, clear=False).start()
        self.write_candidate()

    def write_candidate(self):
        (self.state / 'candidate.json').write_text(json.dumps({'commit': COMMIT, 'digest': DIGEST,
                                                              'image': IMAGE, 'candidate_tag': 'candidate-unique'}))

    def test_candidate_is_pinned_by_digest_without_tagging_live(self):
        with patch.object(release, 'aws', return_value={'imageDetails': [{'imageDigest': DIGEST}]}) as aws:
            release.candidate_record('registry/repository', 'candidate-unique')
        self.assertEqual(release.candidate()['image'], IMAGE)
        self.assertEqual(aws.call_count, 1)
        self.assertEqual(aws.call_args.args[:2], ('ecr', 'describe-images'))

    def test_candidate_commit_or_digest_mismatch_is_rejected(self):
        for change in ({'commit': 'c' * 40}, {'digest': 'not-a-digest'}, {'image': 'other@wrong'}):
            self.write_candidate()
            data = json.loads((self.state / 'candidate.json').read_text())
            (self.state / 'candidate.json').write_text(json.dumps(dict(data, **change)))
            with self.subTest(change=change), self.assertRaises(release.ReleaseError):
                release.candidate()

    def test_day_and_night_are_verified_in_order_before_proof(self):
        def definitions(name):
            return service(name), source(name), 'same-secret-ref'
        with patch.object(release, 'service_definition', side_effect=definitions), \
                patch.object(release, 'run_one_off', side_effect=['apply-task', 'verify-task']) as run:
            release.schema_gate(True)
        self.assertEqual([call.args[3] for call in run.call_args_list], ['apply', 'verify'])
        proof = json.loads((self.state / 'schema-proof.json').read_text())
        self.assertEqual(proof['digest'], DIGEST)
        self.assertEqual(set(proof['services']), set(release.SERVICE_NAMES))
        self.assertEqual(proof['services']['night-api']['task'], 'verify-task')

    def test_night_failure_removes_stale_proof_and_never_permits_promotion(self):
        (self.state / 'schema-proof.json').write_text('{}')
        with patch.object(release, 'service_definition', return_value=(service(), source(), 'same-ref')), \
                patch.object(release, 'run_one_off', side_effect=['apply-task', release.ReleaseError('night failed')]), \
                self.assertRaises(release.ReleaseError):
            release.schema_gate(True)
        self.assertFalse((self.state / 'schema-proof.json').exists())

    def test_different_day_night_secret_references_launch_no_tasks(self):
        with patch.object(release, 'service_definition', side_effect=lambda name: (service(), source(), name)), \
                patch.object(release, 'run_one_off') as run, self.assertRaises(release.ReleaseError):
            release.schema_gate(True)
        run.assert_not_called()

    def test_old_main_application_needs_no_calendar_task_or_new_migrations(self):
        with patch.object(release, 'service_definition') as inspect, patch.object(release, 'run_one_off') as run:
            release.schema_gate(False)
        inspect.assert_not_called()
        run.assert_not_called()
        with patch.dict(os.environ, {'CALENDAR_SCHEMA_REQUIRED': 'false'}):
            self.assertEqual(release.verified_candidate()['digest'], DIGEST)

    def test_new_application_cannot_promote_using_old_application_proof(self):
        release.schema_gate(False)
        with self.assertRaises(release.ReleaseError):
            release.verified_candidate()

    def test_missing_wrong_digest_or_changed_service_proof_blocks_promotion(self):
        with self.assertRaises(FileNotFoundError):
            release.verified_candidate()
        proof = {'commit': COMMIT, 'digest': DIGEST, 'schema': 'verified', 'services': {
            name: {'definition': name + ':26'} for name in release.SERVICE_NAMES}}
        (self.state / 'schema-proof.json').write_text(json.dumps(dict(proof, digest='sha256:' + 'd' * 64)))
        with self.assertRaises(release.ReleaseError):
            release.verified_candidate()
        (self.state / 'schema-proof.json').write_text(json.dumps(proof))
        with patch.object(release, 'service_definition', return_value=(dict(service(), taskDefinition='day:27'), source(), 'ref')), \
                self.assertRaisesRegex(release.ReleaseError, 'configuration changed'):
            release.verified_candidate()

    def test_single_use_definition_preserves_roles_secrets_and_environment(self):
        original = source()
        before = copy.deepcopy(original)
        task = release.migration_definition(original, IMAGE, 'verify')
        self.assertEqual(original, before)
        self.assertEqual(task['taskRoleArn'], original['taskRoleArn'])
        self.assertEqual(task['executionRoleArn'], original['executionRoleArn'])
        container = task['containerDefinitions'][0]
        self.assertEqual(container['image'], IMAGE)
        self.assertEqual(container['secrets'], original['containerDefinitions'][0]['secrets'])
        env = {item['name']: item['value'] for item in container['environment']}
        self.assertEqual(env['DATABASE_URL'], 'private-existing-url')
        self.assertEqual(env['CALENDAR_GATE_MODE'], 'verify')
        self.assertEqual(container['entryPoint'], ['python'])
        self.assertNotIn('healthCheck', container)
        self.assertNotIn('restartPolicy', container)
        self.assertNotIn('taskDefinitionArn', task)

    def test_source_configuration_must_have_a_single_mapped_secret(self):
        for mutation in ('missing', 'literal', 'two-containers', 'ec2', 'arm64'):
            definition = source()
            if mutation == 'missing':
                definition['containerDefinitions'][0]['secrets'] = []
            elif mutation == 'literal':
                definition['containerDefinitions'][0]['environment'].append({'name': release.KEY, 'value': 'private'})
            elif mutation == 'two-containers':
                definition['containerDefinitions'].append({'name': 'worker'})
            elif mutation == 'ec2':
                definition['requiresCompatibilities'] = ['EC2']
            else:
                definition['runtimePlatform'] = {'cpuArchitecture': 'ARM64'}
            with self.subTest(mutation=mutation), \
                    patch.object(release, 'aws', side_effect=[{'services': [service()]}, {'taskDefinition': definition}]), \
                    self.assertRaises(release.ReleaseError):
                release.service_definition('day')

    def stopped(self, exit_code=0, digest=DIGEST):
        return {'tasks': [{'taskArn': 'owned-task', 'taskDefinitionArn': 'gate:1', 'lastStatus': 'STOPPED',
                           'containers': [{'name': 'api', 'exitCode': exit_code, 'imageDigest': digest}]}]}

    def input_responses(self):
        return [{'taskDefinition': {'taskDefinitionArn': 'gate:1'}}, {'tasks': [{'taskArn': 'owned-task'}]}]

    def test_one_off_uses_immutable_image_existing_network_and_no_service_update(self):
        with patch.object(release, 'aws_input', side_effect=self.input_responses()) as write, \
                patch.object(release, 'aws', return_value=self.stopped()) as read:
            self.assertEqual(release.run_one_off(service(), source(), IMAGE, 'apply', DIGEST), 'owned-task')
        registered = write.call_args_list[0].args[2]
        launched = write.call_args_list[1].args[2]
        self.assertEqual(registered['containerDefinitions'][0]['image'], IMAGE)
        self.assertEqual(launched['networkConfiguration'], service()['networkConfiguration'])
        self.assertEqual(launched['count'], 1)
        self.assertEqual(len(launched['clientToken']), 64)
        self.assertNotIn('overrides', launched)
        self.assertEqual(read.call_args.args[:2], ('ecs', 'describe-tasks'))

    def test_task_failure_wrong_image_or_task_definition_is_rejected(self):
        for response in (self.stopped(1), self.stopped(digest='sha256:' + 'c' * 64),
                         {'tasks': [dict(self.stopped()['tasks'][0], taskDefinitionArn='unexpected:1')]}):
            with self.subTest(response=response), \
                    patch.object(release, 'aws_input', side_effect=self.input_responses()), \
                    patch.object(release, 'aws', return_value=response), self.assertRaises(release.ReleaseError):
                release.run_one_off(service(), source(), IMAGE, 'apply', DIGEST)

    def test_timeout_stops_only_the_owned_task_and_blocks_promotion(self):
        running = {'tasks': [{'taskArn': 'owned-task', 'lastStatus': 'RUNNING'}]}
        with patch.object(release, 'aws_input', side_effect=self.input_responses()), \
                patch.object(release, 'aws', side_effect=[running, {}]) as aws, \
                self.assertRaisesRegex(release.ReleaseError, 'timed out'):
            release.run_one_off(service(), source(), IMAGE, 'apply', DIGEST, clock=Mock(side_effect=[0, 601]))
        self.assertIn('owned-task', aws.call_args.args)
        self.assertEqual(aws.call_args.args[:2], ('ecs', 'stop-task'))

    def test_registration_failure_never_launches_a_task(self):
        with patch.object(release, 'aws_input', side_effect=release.ReleaseError('AccessDeniedException')) as write, \
                self.assertRaises(release.ReleaseError):
            release.run_one_off(service(), source(), IMAGE, 'apply', DIGEST)
        self.assertEqual(write.call_count, 1)

    def test_aws_errors_do_not_expose_urls_secret_references_or_values(self):
        failure = SimpleResult(returncode=1, stdout='', stderr='An error occurred (AccessDeniedException): private-url SECRET-VALUE')
        with patch.object(subprocess, 'run', return_value=failure), self.assertRaises(release.ReleaseError) as caught:
            release.aws('ecs', 'run-task')
        self.assertIn('AccessDeniedException', str(caught.exception))
        self.assertNotIn('private-url', str(caught.exception))
        self.assertNotIn('SECRET-VALUE', str(caught.exception))


class SimpleResult:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


if __name__ == '__main__':
    unittest.main()
