"""Candidate image and one-off calendar migration gate. AWS values stay private."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

STATE = Path('.deploy-state')
KEY = 'CALENDARIFIC_API_KEY'
SERVICE_NAMES = ('curriculum-api', 'night-api')
DEFINITION_FIELDS = (
    'family', 'taskRoleArn', 'executionRoleArn', 'networkMode', 'containerDefinitions',
    'volumes', 'placementConstraints', 'requiresCompatibilities', 'cpu', 'memory',
    'pidMode', 'ipcMode', 'proxyConfiguration', 'inferenceAccelerators',
    'ephemeralStorage', 'runtimePlatform', 'enableFaultInjection',
)


class ReleaseError(RuntimeError):
    pass


def aws(*args):
    try:
        result = subprocess.run(['aws', *args, '--output', 'json', '--no-cli-pager'],
                                capture_output=True, text=True, timeout=70)
    except (OSError, subprocess.TimeoutExpired):
        raise ReleaseError('AWS command unavailable: ' + ' '.join(args[:2])) from None
    if result.returncode:
        # Print only the AWS error class, never task definitions/secret values.
        match = re.search(r'\(([A-Za-z0-9_.]+)\)', result.stderr)
        code = match.group(1) if match else 'command_failed'
        raise ReleaseError('AWS ' + ' '.join(args[:2]) + ': ' + code)
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise ReleaseError('AWS returned invalid JSON') from None


def aws_input(service, action, body):
    # Registration JSON contains existing secret references and environment
    # settings. Keep it out of argv/logs and delete the private file promptly.
    descriptor, name = tempfile.mkstemp(prefix='lms-calendar-', suffix='.json')
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            json.dump(body, handle)
        return aws(service, action, '--cli-input-json', 'file://' + name)
    finally:
        Path(name).unlink(missing_ok=True)


def image_identity(commit, digest):
    if not re.fullmatch(r'[a-f0-9]{40}', commit) or not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ReleaseError('Invalid release commit or image digest')


def candidate_record(repository_uri, tag):
    commit = os.environ['COMMIT']
    details = aws('ecr', 'describe-images', '--repository-name', os.environ['ECR_REPOSITORY'],
                  '--image-ids', 'imageTag=' + tag)['imageDetails']
    if len(details) != 1:
        raise ReleaseError('Candidate image not uniquely identified')
    digest = details[0]['imageDigest']
    image_identity(commit, digest)
    STATE.mkdir(exist_ok=True)
    (STATE / 'candidate.json').write_text(json.dumps({
        'commit': commit, 'digest': digest, 'image': repository_uri + '@' + digest,
        'candidate_tag': tag,
    }), encoding='utf-8')


def candidate():
    data = json.loads((STATE / 'candidate.json').read_text(encoding='utf-8'))
    image_identity(data['commit'], data['digest'])
    if data['commit'] != os.environ['COMMIT'] or not data['image'].endswith('@' + data['digest']):
        raise ReleaseError('Candidate does not match release')
    return data


def service_definition(name):
    response = aws('ecs', 'describe-services', '--cluster', os.environ['ECS_CLUSTER'], '--services', name)
    if response.get('failures') or len(response.get('services', [])) != 1:
        raise ReleaseError('Calendar service unavailable: ' + name)
    service = response['services'][0]
    definition = aws('ecs', 'describe-task-definition', '--task-definition', service['taskDefinition'])['taskDefinition']
    if (definition.get('networkMode') != 'awsvpc' or 'FARGATE' not in definition.get('requiresCompatibilities', [])
            or len(definition.get('containerDefinitions', [])) != 1
            or definition.get('runtimePlatform', {}).get('cpuArchitecture', 'X86_64') != 'X86_64'
            or definition.get('runtimePlatform', {}).get('operatingSystemFamily', 'LINUX') != 'LINUX'
            or not service.get('networkConfiguration', {}).get('awsvpcConfiguration', {}).get('subnets')):
        raise ReleaseError('Unsupported calendar task topology: ' + name)
    container = definition['containerDefinitions'][0]
    values = [item.get('valueFrom', '') for item in container.get('secrets', []) if item['name'] == KEY]
    if len(values) != 1 or not values[0] or any(item['name'] == KEY for item in container.get('environment', [])):
        raise ReleaseError('Calendarific secret reference missing or conflicting: ' + name)
    return service, definition, values[0]


def migration_definition(source, image, mode):
    definition = {key: copy.deepcopy(source[key]) for key in DEFINITION_FIELDS if key in source}
    definition['family'] = source['family'] + '-calendar-gate'
    container = definition['containerDefinitions'][0]
    container['image'] = image
    container['entryPoint'] = ['python']
    container['command'] = ['-c', Path(__file__).with_name('calendar_schema_gate.py').read_text(encoding='utf-8')]
    container['workingDirectory'] = '/app'
    # The API's HTTP health check/restart rule must not restart a one-off DDL task.
    container.pop('healthCheck', None)
    container.pop('restartPolicy', None)
    values = {item['name']: item['value'] for item in container.get('environment', [])}
    overrides = {
        'CALENDAR_GATE_MODE': mode,
        'CALENDAR_EXPECTED_ENDPOINT': os.environ['CALENDAR_EXPECTED_ENDPOINT'],
        'CALENDAR_EXPECTED_DATABASE': os.environ['CALENDAR_EXPECTED_DATABASE'],
        'CALENDAR_RESTORE_POINT': os.environ.get('CALENDAR_RESTORE_POINT', ''),
        'COUNTRY_HOLIDAY_AUTO_SYNC': 'false', 'ENGLAND_HOLIDAY_AUTO_SYNC': 'false',
        'CURRICULUM_WARM': '0', 'AZURE_MAIL_ENABLED': 'false',
    }
    if any(item['name'] in overrides for item in container.get('secrets', [])):
        raise ReleaseError('One-off migration environment conflicts with secret settings')
    values.update(overrides)
    container['environment'] = [{'name': key, 'value': value} for key, value in sorted(values.items())]
    return definition


def run_one_off(service, source, image, mode, digest, clock=time.monotonic, sleep=time.sleep):
    definition = migration_definition(source, image, mode)
    registered = aws_input('ecs', 'register-task-definition', definition)['taskDefinition']['taskDefinitionArn']
    token = hashlib.sha256((registered + os.environ['COMMIT'] + os.environ.get('GITHUB_RUN_ID', '')
                            + os.environ.get('GITHUB_RUN_ATTEMPT', '') + mode).encode()).hexdigest()
    request = {
        'cluster': os.environ['ECS_CLUSTER'], 'taskDefinition': registered,
        'launchType': 'FARGATE', 'count': 1, 'clientToken': token,
        'networkConfiguration': service['networkConfiguration'],
        'platformVersion': service.get('platformVersion', 'LATEST'),
        'startedBy': 'lms-calendar-' + mode, 'enableExecuteCommand': False,
    }
    launched = aws_input('ecs', 'run-task', request)
    tasks = launched.get('tasks', [])
    if launched.get('failures') or len(tasks) != 1:
        raise ReleaseError('Calendar one-off task could not start: ' + mode)
    arn = tasks[0]['taskArn']
    deadline = clock() + 600
    while True:
        result = aws('ecs', 'describe-tasks', '--cluster', os.environ['ECS_CLUSTER'], '--tasks', arn)
        tasks = result.get('tasks', [])
        if result.get('failures') or len(tasks) != 1:
            raise ReleaseError('Calendar task status unavailable: ' + mode)
        task = tasks[0]
        if task.get('lastStatus') == 'STOPPED':
            containers = task.get('containers', [])
            if (task.get('taskDefinitionArn') != registered or len(containers) != 1
                    or containers[0].get('name') != definition['containerDefinitions'][0]['name']
                    or containers[0].get('exitCode') != 0 or containers[0].get('imageDigest') != digest):
                raise ReleaseError('Calendar task failed or used the wrong image: ' + mode)
            return arn
        if clock() >= deadline:
            aws('ecs', 'stop-task', '--cluster', os.environ['ECS_CLUSTER'], '--task', arn,
                '--reason', 'Calendar schema gate timed out; live services unchanged')
            raise ReleaseError('Calendar task timed out: ' + mode)
        sleep(10)


def schema_gate(required):
    release = candidate()
    proof_file = STATE / 'schema-proof.json'
    proof_file.unlink(missing_ok=True)
    proof = {'commit': release['commit'], 'digest': release['digest'], 'services': {}}
    if required:
        sources = {name: service_definition(name) for name in SERVICE_NAMES}
        if len({value[2] for value in sources.values()}) != 1:
            raise ReleaseError('Day and night Calendarific secret references differ')
        for name, mode in zip(SERVICE_NAMES, ('apply', 'verify')):
            service, definition, _ = sources[name]
            task = run_one_off(service, definition, release['image'], mode, release['digest'])
            proof['services'][name] = {'definition': service['taskDefinition'], 'task': task}
            print('Calendar ' + mode + ' task verified: ' + task)
        proof['schema'] = 'verified'
    else:
        proof['schema'] = 'not_required'
    proof_file.write_text(json.dumps(proof), encoding='utf-8')
    print('Calendar schema gate: ' + proof['schema'])


def verified_candidate():
    release = candidate()
    proof = json.loads((STATE / 'schema-proof.json').read_text(encoding='utf-8'))
    if (proof.get('commit') != release['commit'] or proof.get('digest') != release['digest']
            or proof.get('schema') not in {'verified', 'not_required'}):
        raise ReleaseError('Schema proof does not match candidate image')
    if (os.environ.get('CALENDAR_SCHEMA_REQUIRED') == 'true'
            and (proof['schema'] != 'verified' or set(proof.get('services', {})) != set(SERVICE_NAMES))):
        raise ReleaseError('Day and night schema verification required')
    for name, record in proof.get('services', {}).items():
        service, _, _ = service_definition(name)
        if service['taskDefinition'] != record['definition']:
            raise ReleaseError('Calendar service configuration changed during migration')
    return release


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('record', 'schema', 'verified-digest'))
    parser.add_argument('--repository-uri')
    parser.add_argument('--tag')
    args = parser.parse_args()
    if args.action == 'record':
        candidate_record(args.repository_uri, args.tag)
    elif args.action == 'schema':
        required = os.environ.get('CALENDAR_SCHEMA_REQUIRED')
        if required not in {'true', 'false'}:
            raise ReleaseError('Calendar schema requirement was not resolved')
        schema_gate(required == 'true')
    else:
        print(verified_candidate()['digest'])


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        reason = str(exc) if isinstance(exc, ReleaseError) else type(exc).__name__
        raise SystemExit('Calendar release blocked: ' + reason)
