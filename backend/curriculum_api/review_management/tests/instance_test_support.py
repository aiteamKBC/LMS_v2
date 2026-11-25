"""Patch the explicit bindings of the extracted engine in synthetic tests.

The old engine shared one module namespace. Its unchanged tests now patch the
same dependency at every declared extraction binding, using one shared mock.
This helper is test-only; production imports and calls have no indirection.
"""
from contextlib import ExitStack, contextmanager
import importlib
import json
from pathlib import Path
from unittest.mock import patch


@contextmanager
def instance_fixture(name, *args, **kwargs):
    fixture = json.loads((Path(__file__).parent / 'fixtures/instance_boundary.json').read_text())
    modules = [importlib.import_module('curriculum_api.review_management.' + owner)
               for owner in sorted(set(fixture['owners'].values()))]
    targets = [module for module in modules if name in vars(module)]
    if not targets:
        raise AssertionError('Unknown Review Instance test dependency: ' + name)
    with ExitStack() as stack:
        replacement = stack.enter_context(patch.object(targets[0], name, *args, **kwargs))
        for target in targets[1:]:
            stack.enter_context(patch.object(target, name, new=replacement))
        yield replacement
