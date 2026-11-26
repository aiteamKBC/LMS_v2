"""Run change-detection steps with synthetic Git output and no remote services."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
CI = ROOT / '.github/ci'
BASE = 'b' * 40
COMMIT = 'a' * 40


def step_script(workflow, step_id):
    lines = (ROOT / '.github/workflows' / workflow).read_text(encoding='utf-8').splitlines()
    start = lines.index('      - id: ' + step_id)
    start = next(i + 1 for i in range(start, len(lines)) if lines[i] == '        run: |')
    result = []
    for line in lines[start:]:
        if line.strip() and not line.startswith('          '):
            break
        result.append(line[10:])
    return '\n'.join(result).replace('${{ github.repository }}', 'synthetic/offline-repository')


class ChangeDetectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.root / '.github/ci').mkdir(parents=True)
        shutil.copyfile(CI / 'teams_files.txt', self.root / '.github/ci/teams_files.txt')
        git_bash = Path('C:/Program Files/Git/bin/bash.exe')
        self.bash = str(git_bash) if os.name == 'nt' and git_bash.exists() else shutil.which('bash')
        self.assertTrue(self.bash, 'Bash is required to verify change detection')
        self.command('git', '''
case "$1" in
  rev-parse) printf '%s\n' "$COMMIT";;
  merge-base) [ "${2:-}" = --is-ancestor ] || printf '%s\n' "$BASE";;
  cat-file) exit 0;;
  diff) cat "$FILES_PATH";;
  *) exit 99;;
esac
''')
        self.command('curl', 'printf \'{"workflow_runs":[{"head_sha":"%s","event":"push"}]}\\n\' "$BASE"')
        self.command('python3', 'cat >/dev/null; printf \'%s\\n\' "$BASE"')

    def command(self, name, script):
        path = self.bin / name
        path.write_text('#!/usr/bin/env bash\nset -eu\n' + script, encoding='utf-8', newline='\n')
        path.chmod(0o700)

    def run_step(self, files, workflow='deploy-aws.yml', step_id='diff'):
        files_path = self.root / 'files'
        files_path.write_text('\n'.join(files), encoding='utf-8', newline='\n')
        output = self.root / 'output'
        summary = self.root / 'summary'
        mock_bin = self.bin.as_posix()
        if os.name == 'nt':
            mock_bin = '/' + mock_bin[0].lower() + mock_bin[2:]
        env = dict(os.environ, MOCK_BIN=mock_bin, FILES_PATH=files_path.as_posix(),
                   COMMIT=COMMIT, BASE=BASE, REF=COMMIT, GITHUB_REF='refs/heads/main',
                   GITHUB_OUTPUT=output.as_posix(), GITHUB_STEP_SUMMARY=summary.as_posix(),
                   GH_TOKEN='synthetic-offline-token', EVENT='push')
        script = 'export PATH="$MOCK_BIN:$PATH"\n' + step_script(workflow, step_id)
        result = subprocess.run([self.bash, '-c', script], cwd=self.root, env=env,
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout[-1500:])
        return dict(line.split('=', 1) for line in output.read_text().splitlines())

    def assert_scope(self, files, frontend, backend, **kwargs):
        values = self.run_step(files, **kwargs)
        self.assertEqual(values['frontend'], str(frontend).lower())
        self.assertEqual(values['backend'], str(backend).lower())

    def test_empty_change_does_not_deploy_application(self):
        self.assert_scope([], False, False)

    def test_frontend_only(self):
        self.assert_scope(['frontend/src/pages/employer/EmployerDashboard.tsx'], True, False)

    def test_backend_only(self):
        self.assert_scope(['backend/learner_api/employer_portal.py'], False, True)

    def test_large_frontend_only_change(self):
        self.assert_scope(['frontend/src/file_%05d.ts' % i for i in range(10000)], True, False)

    def test_large_backend_only_change(self):
        self.assert_scope(['backend/learner_api/file_%05d.py' % i for i in range(10000)], False, True)

    def test_large_mixed_change_detects_both_prefixes(self):
        self.assert_scope(['backend/learner_api/employer_portal.py']
                          + ['frontend/src/file_%05d.ts' % i for i in range(10000)], True, True)

    def test_ci_change_at_start_of_large_list_runs_every_gate(self):
        self.assert_scope(['.github/workflows/deploy-aws.yml']
                          + ['docs/file_%05d.md' % i for i in range(10000)], True, True)

    def test_ci_change_beyond_display_limit_runs_every_gate(self):
        self.assert_scope(['docs/file_%05d.md' % i for i in range(10000)]
                          + ['.github/workflows/deploy-aws.yml'], True, True)

    def test_teams_control_change_at_start_of_large_list_runs_every_gate(self):
        self.assert_scope(['.github/workflows/teams-checks.yml']
                          + ['docs/file_%05d.md' % i for i in range(10000)], True, True,
                          workflow='teams-checks.yml', step_id='scope')

    def test_teams_large_frontend_change_keeps_frontend_gate(self):
        self.assert_scope(['frontend/src/file_%05d.ts' % i for i in range(10000)], True, False,
                          workflow='teams-checks.yml', step_id='scope')


if __name__ == '__main__':
    unittest.main()
