"""Read-only ECS recording diagnostics. Never retrieve or print secret values."""
import json
import os
import subprocess

REQUIRED = (
    'BUNNY_STREAM_ENABLED', 'BUNNY_STREAM_LIBRARY_ID', 'BUNNY_STREAM_API_KEY',
    'BUNNY_STREAM_TOKEN_KEY', 'MICROSOFT_GRAPH_TENANT_ID',
    'MICROSOFT_GRAPH_CLIENT_ID', 'MICROSOFT_GRAPH_CLIENT_SECRET',
)


def aws(*args):
    result = subprocess.run(['aws', *args, '--output', 'json'],
                            capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError('AWS read unavailable')
    return json.loads(result.stdout)


def container_summary(definition, running, override, expected_digest):
    values = {item['name']: item.get('value', '') for item in definition.get('environment', [])}
    secrets = {item['name'] for item in definition.get('secrets', [])}
    overridden = {item['name']: item.get('value', '') for item in override.get('environment', [])}
    values.update(overridden)
    secrets.difference_update(overridden)
    presence = {key: 'secret_mapped' if key in secrets else
                'present' if values.get(key, '').strip() else 'missing_or_empty' for key in REQUIRED}
    enabled = values.get('BUNNY_STREAM_ENABLED', '').strip().lower()
    enabled_state = ('secret_mapped_unverified' if 'BUNNY_STREAM_ENABLED' in secrets else
                     'true' if enabled == 'true' else 'false' if enabled == 'false' else 'unset_or_invalid')
    command = ' '.join(definition.get('entryPoint', []) +
                       override.get('command', definition.get('command', [])))
    return {
        'container': definition['name'],
        'image_matches_release': bool(expected_digest and running.get('imageDigest') == expected_digest),
        'settings': presence,
        'bunny_enabled': enabled_state,
        'library_matches_expected': ('secret_mapped_unverified' if 'BUNNY_STREAM_LIBRARY_ID' in secrets
                                     else values.get('BUNNY_STREAM_LIBRARY_ID') == '798153'),
        'scheduled_session_command': 'process_session_results' in command and '--scheduled' in command,
    }


def inspect_service(service, cluster, expected_digest):
    arns = aws('ecs', 'list-tasks', '--cluster', cluster, '--service-name', service,
               '--desired-status', 'RUNNING').get('taskArns', [])
    if not arns:
        return {'service': service, 'running_tasks': 0, 'containers': []}
    tasks = aws('ecs', 'describe-tasks', '--cluster', cluster, '--tasks', *arns)['tasks']
    definitions, summaries = {}, []
    for task in tasks:
        arn = task['taskDefinitionArn']
        if arn not in definitions:
            definitions[arn] = aws('ecs', 'describe-task-definition', '--task-definition', arn)['taskDefinition']
        overrides = {item['name']: item for item in task.get('overrides', {}).get('containerOverrides', [])}
        running = {item['name']: item for item in task.get('containers', [])}
        for container in definitions[arn]['containerDefinitions']:
            if not container.get('essential', True):
                continue
            summaries.append(container_summary(container, running.get(container['name'], {}),
                                                overrides.get(container['name'], {}), expected_digest))
    return {'service': service, 'running_tasks': len(tasks), 'containers': summaries}


def main():
    # This observation must not undo a healthy release or masquerade as live
    # playback acceptance. Permissions and unresolved configuration are visible.
    for service in ('session-worker', 'curriculum-api'):
        try:
            image = aws('ecr', 'describe-images', '--repository-name', os.environ['ECR_REPOSITORY'],
                        '--image-ids', 'imageTag=' + os.environ['COMMIT'])['imageDetails'][0]
            report = inspect_service(service, os.environ['ECS_CLUSTER'], image['imageDigest'])
            print(json.dumps(report, sort_keys=True))
            if not report['running_tasks'] or any(
                    not row['image_matches_release'] or row['bunny_enabled'] != 'true'
                    or row['library_matches_expected'] is not True
                    or (service == 'session-worker' and not row['scheduled_session_command'])
                    or any(value == 'missing_or_empty' for value in row['settings'].values())
                    for row in report['containers']):
                print(f'::warning::{service}: recording runtime requires verification; see safe summary above.')
        except (RuntimeError, KeyError, ValueError, OSError, subprocess.TimeoutExpired):
            print(json.dumps({'service': service, 'inspected': False,
                              'reason': 'AWS runtime read unavailable; configuration remains unverified.'}))
            print(f'::warning::{service}: recording runtime could not be inspected.')


if __name__ == '__main__':
    main()
