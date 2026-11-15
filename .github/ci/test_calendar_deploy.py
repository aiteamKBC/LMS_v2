"""Exercise the real deployment shell against fake Docker/AWS commands."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import json
import tempfile
import unittest

CI = Path(__file__).resolve().parent
ROOT = CI.parent.parent
COMMIT = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64


class DeployOrderingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.root / '.github/ci').mkdir(parents=True)
        (self.root / '.github/ci/deploy.sh').write_text((CI / 'deploy.sh').read_text(), encoding='utf-8', newline='\n')
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        EVENTS=str(self.root / 'events').replace('\\', '/'), COMMIT=COMMIT,
                        REGISTRY='registry', ECR_REPOSITORY='repository', IMAGE_TAG='live',
                        ECS_CLUSTER='cluster', GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='1',
                        PYTHON='fake-python')
        git_bash = Path('C:/Program Files/Git/bin/bash.exe')
        self.bash = str(git_bash) if os.name == 'nt' and git_bash.exists() else shutil.which('bash')
        if not self.bash:
            self.fail('Bash is required to verify deployment guards')
        mock_bin = self.bin.as_posix()
        if os.name == 'nt':
            mock_bin = '/' + mock_bin[0].lower() + mock_bin[2:]
        self.env['MOCK_BIN'] = mock_bin
        self.command('fake-python', '''
echo "python $2" >> "$EVENTS"
if [ "$2" = verified-digest ]; then
  [ "${GATE_FAIL:-0}" = 0 ] || exit 1
  echo "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
fi
''')
        self.command('gunzip', 'echo image')
        self.command('docker', '''
echo "docker $*" >> "$EVENTS"
[ "$1" != load ] || cat >/dev/null
''')
        self.command('aws', '''
echo "aws $*" >> "$EVENTS"
case "$1 $2" in
  'ecr batch-get-image')
    case "$*" in *imageDigest=*) echo CANDIDATE;; *) echo PREVIOUS;; esac;;
  'ecr put-image')
    case "$*" in *'--image-tag live '*)
      [ ! -f .deploy-state/pushed ] || echo 'promotion-intent-present' >> "$EVENTS"
      if [ "${FAIL_PROMOTE:-0}" = 1 ]; then echo 'Ambiguous network failure'; exit 1; fi;; esac;;
  'ecs list-services') echo curriculum-api;;
esac
''')

    def command(self, name, script):
        path = self.bin / name
        path.write_text('#!/usr/bin/env bash\nset -eu\n' + script, encoding='utf-8', newline='\n')
        path.chmod(0o700)

    def run_step(self, step, **env):
        return subprocess.run([self.bash, '-c', 'export PATH="$MOCK_BIN:$PATH"; exec bash .github/ci/deploy.sh "$1"',
                               'calendar-guard-test', step], cwd=self.root,
                              env=dict(self.env, **env), capture_output=True, text=True, timeout=15)

    def events(self):
        path = self.root / 'events'
        return path.read_text() if path.exists() else ''

    def test_candidate_push_never_changes_live_or_canonical_commit_tags(self):
        result = self.run_step('push-candidate')
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        self.assertIn('docker push -q registry/repository:candidate-' + COMMIT + '-123-1', events)
        self.assertIn('python record', events)
        self.assertNotIn('registry/repository:live', events)
        self.assertNotIn('docker push -q registry/repository:' + COMMIT, events)
        self.assertNotIn('put-image', events)
        self.assertFalse((self.root / '.deploy-state/pushed').exists())

    def test_unverified_candidate_cannot_mutate_ecr_or_restart_services(self):
        result = self.run_step('promote', GATE_FAIL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('aws ', self.events())
        self.assertFalse((self.root / '.deploy-state/pushed').exists())

    def test_promote_uses_verified_digest_and_records_intent_before_live_write(self):
        result = self.run_step('promote')
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        self.assertLess(events.index('python verified-digest'), events.index('aws ecr batch-get-image'))
        self.assertIn('imageDigest=' + DIGEST, events)
        self.assertIn('--image-tag live --image-manifest CANDIDATE', events)
        self.assertIn('promotion-intent-present', events)
        self.assertNotIn('ecs update-service', events)

    def test_ambiguous_live_write_failure_retains_rollback_marker(self):
        result = self.run_step('promote', FAIL_PROMOTE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.root / '.deploy-state/pushed').exists())
        self.assertIn('promotion-intent-present', self.events())

    def test_pre_promotion_failure_rollback_never_changes_live_services(self):
        result = self.run_step('rollback')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), '')

    def test_roll_without_promotion_is_blocked(self):
        result = self.run_step('roll')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events(), '')

    def test_old_push_command_cannot_bypass_schema_gate(self):
        result = self.run_step('push')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events(), '')


class WorkflowContractTests(unittest.TestCase):
    def test_schema_gate_precedes_live_promotion_and_rollout(self):
        workflow = (ROOT / '.github/workflows/deploy-aws.yml').read_text()
        commands = ['deploy.sh push-candidate', 'calendar_release.py schema', 'deploy.sh promote', 'deploy.sh roll']
        positions = [workflow.index(command) for command in commands]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('security, teams, release-guards]', workflow)

    def test_app_revision_is_pinned_and_only_merged_main_is_deployed(self):
        workflow = (ROOT / '.github/workflows/deploy-aws.yml').read_text()
        self.assertIn('git merge-base --is-ancestor "$COMMIT" origin/main', workflow)
        self.assertIn('COMMIT: ${{ needs.changes.outputs.commit }}', workflow)
        self.assertEqual(workflow.count('ref: ${{ env.CHECKOUT_REF }}'), 1)
        self.assertNotIn("github.ref == 'refs/heads/main' ||", workflow)
        # Older application rollback still checks out current deployment tooling.
        deploy = workflow.split('  deploy:\n', 1)[1]
        self.assertIn('ref: ${{ github.sha }}', deploy)

    def test_manual_rollback_never_becomes_a_false_changed_files_baseline(self):
        workflow = (ROOT / '.github/workflows/deploy-aws.yml').read_text()
        line = next(line for line in workflow.splitlines() if 'r=json.load(sys.stdin)["workflow_runs"]' in line)
        script = line.split("python3 -c '", 1)[1].split("'", 1)[0]
        for event, expected in (('push', COMMIT), ('workflow_dispatch', '')):
            result = subprocess.run([sys.executable, '-c', script],
                                    input=json.dumps({'workflow_runs': [{'event': event, 'head_sha': COMMIT}]}),
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), expected)


if __name__ == '__main__':
    unittest.main()
