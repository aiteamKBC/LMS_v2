"""Read-only source overlay for a controlled notification-change comparison.

No checkout, branch switch or source-file replacement. Other working-tree code
is identical in baseline and candidate runs. This reconstructs removal of this
task's runtime edits, not the historical state of unrelated concurrent edits.
"""
import hashlib
import importlib.abc
import importlib.util
from pathlib import Path
import subprocess
import sys


def install(root):
    sources = {}
    for module in ('tutor_notifications', 'schema_gate'):
        path = f'backend/curriculum_api/{module}.py'
        sources['curriculum_api.' + module] = subprocess.check_output(
            ['git', 'show', 'HEAD:' + path], cwd=root).decode('utf-8')
    path = root / 'backend/curriculum_api/views.py'
    source = path.read_text(encoding='utf-8')
    replacements = {
        '    # Notification history is retained; its RESTRICT FK may refuse this delete.':
            "    wipe('tutor_module_notifications', [module_clause])",
        "        ('curriculum', 'tutor_module_notifications', 'module_catalogue_id', 'tutorNotifications', None),\n": '',
        "        'tutorNotifications': 'tutor notification records',\n": '',
    }
    for old, new in replacements.items():
        assert source.count(old) == 1, 'Notification-only baseline patch no longer matches.'
        source = source.replace(old, new)
    sources['curriculum_api.views'] = source

    class SourceOverlay(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, fullname, path=None, target=None):
            if fullname in sources:
                return importlib.util.spec_from_loader(fullname, self)

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            filename = root / 'backend' / (module.__name__.replace('.', '/') + '.py')
            module.__file__ = str(filename)
            exec(compile(sources[module.__name__], str(filename), 'exec'), module.__dict__)

    sys.meta_path.insert(0, SourceOverlay())
    return {name: hashlib.sha256(source.encode()).hexdigest() for name, source in sources.items()}
