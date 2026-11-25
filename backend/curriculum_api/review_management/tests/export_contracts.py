"""Pinned former public bindings, used only for contract tests."""
import importlib
import json
from pathlib import Path

EXPORTS = json.loads((Path(__file__).parent / 'fixtures/retired_review_exports.json').read_text())


def declared_owner(original_module, name):
    owner, symbol = EXPORTS['curriculum_api.' + original_module][name]
    assert symbol == name
    return importlib.import_module(owner)


def declared_callable(original_module, name):
    return getattr(declared_owner(original_module, name), name)
