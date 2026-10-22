"""Prepare/check a scoped patch without applying it or modifying either branch.

Usage: python -I -B backend/login/prepare_phase1_integration.py --target MAIN_TREE
       --output phase1-backend-integration.patch
Refuses overlapping target edits, existing patch output, or differing HEADs.
Only the explicit Backend allowlist is included; no ignored DB/Frontend files.
"""
import argparse
import difflib
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]
FILES = (
    'backend/login/sessions.py', 'backend/login/invitations.py', 'backend/login/views.py',
    'backend/login/identity.py', 'backend/config/settings.py',
    'backend/learner_api/routers.py',
    'backend/config/learner_auth.py', 'backend/login/selectors.py',
    'backend/login/learner_auth_reader.py', 'backend/login/test_learner_auth_adapter.py',
    'backend/login/test_auth_writers_local_postgres.py',
    'backend/login/test_selectors_local_postgres.py', 'backend/login/test_selectors_no_db.py',
    'backend/login/prepare_phase1_integration.py',
)


def git(root, *args, check=True):
    return subprocess.run(['git', '-C', str(root), *args], text=True,
                          encoding='utf-8', capture_output=True, check=check)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    target = args.target.resolve()
    output = args.output.resolve()
    if target == ROOT or not output.is_relative_to(ROOT) or output.suffix != '.patch':
        raise SystemExit('Use a distinct target and a new .patch inside the Backend worktree')
    if git(ROOT, 'rev-parse', 'HEAD').stdout != git(target, 'rev-parse', 'HEAD').stdout:
        raise SystemExit('HEADs differ: explicit reconciliation required before preparing a patch')
    chunks = []
    changed = []
    for name in FILES:
        source = ROOT / name
        old = git(ROOT, 'show', 'HEAD:' + name, check=False)
        base = old.stdout if old.returncode == 0 else None
        destination = target / name
        current = destination.read_text(encoding='utf-8') if destination.exists() else None
        new = source.read_text(encoding='utf-8')
        if current == new:
            continue
        if current != base:
            raise SystemExit('Overlapping target change: ' + name)
        if new == base:
            continue
        changed.append(name)
        chunks.append('diff --git a/' + name + ' b/' + name + '\n')
        if base is None:
            chunks.append('new file mode 100644\n')
        chunks.extend(difflib.unified_diff((base or '').splitlines(keepends=True),
            new.splitlines(keepends=True), fromfile='a/' + name if base is not None else '/dev/null',
            tofile='b/' + name))
    with output.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(''.join(chunks))
    checked = git(target, 'apply', '--check', str(output), check=False)
    if checked.returncode:
        raise SystemExit('Patch prepared but apply-check failed; target unchanged: ' + checked.stderr)
    print(f'PASS: {len(changed)} Backend files; patch applies cleanly. Target unchanged.')
    print('Patch:', output)


if __name__ == '__main__':
    main()
