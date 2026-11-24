"""Synthetic ports around actual current functions; never import legacy views.

Source fixtures still select real bodies. Moved functions are imported from their
current owners and called with explicit capabilities; absent test capabilities
raise when used. This is not a copy of either meeting algorithm.
"""
import ast
from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
import importlib
import json
from pathlib import Path
from .policy_composition_oracle import EXPORTS as PURE_EXPORTS, SNAPSHOT as PURE_SNAPSHOT, actual as pure_actual

USE_ORIGINAL = False

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/legacy_snapshot.json').read_text(encoding='utf-8'))

CALENDAR_SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/calendar_snapshot.json').read_text(encoding='utf-8'))
DELIVERY_SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/delivery_snapshot.json').read_text(encoding='utf-8'))
LIFECYCLE_SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/lifecycle_snapshot.json').read_text(encoding='utf-8'))
ENTRIES = {**SNAPSHOT['functions'], **CALENDAR_SNAPSHOT['functions'], **DELIVERY_SNAPSHOT['functions'], **LIFECYCLE_SNAPSHOT['functions']}

# Approved dev additions: the old snapshot remains immutable. These ports now
# belong to the current implementation and must use the fixture's capabilities.
DEV_PORTS = {
    'curriculum_teams_meeting': ('prune_study_week_fillers', 'teams_module_session_limit'),
    'curriculum_teams_meeting_schedule': ('prune_study_week_fillers', 'teams_module_session_limit'),
    'curriculum_teams_meeting_artifacts': ('teams_module_session_limit',),
    'apply_teams_occurrence_shifts': ('read_calendar_instances',),
    'teams_expanded_instances': ('read_calendar_instances',),
}


def _import(module, name):
    return getattr(importlib.import_module(module), name)


def _lazy(module, name):
    def call(*args, **kwargs):
        return _import(module, name)(*args, **kwargs)
    return call


def _missing(name):
    def forbidden(*args, **kwargs):
        raise AssertionError('Synthetic meeting capability was not supplied: ' + name)
    return forbidden


def load_current_functions(names, namespace, tree=None):
    tree = tree or current_entry_tree()
    namespace.setdefault('__package__', 'curriculum_api')
    existing = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    exports = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            module = ('curriculum_api.' if node.level == 1 else '') + (node.module or '')
            exports.update({a.asname or a.name: (module, a.name) for a in node.names})
    for name in names:
        if name == 'teams_module_session_limit':
            # Extract the actual application body, keeping all reads supplied by
            # the synthetic namespace instead of importing runtime composition.
            source = ast.parse((ROOT / 'meetings/application/invitation_preparation.py').read_text(encoding='utf-8'))
            function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == name)
            function.args.kwonlyargs = []
            function.args.kw_defaults = []
            exec(compile(ast.Module(body=[function], type_ignores=[]), '<current-series-limit>', 'exec'), namespace)
            continue
        if name in PURE_EXPORTS:
            if USE_ORIGINAL:
                exec(compile(PURE_SNAPSHOT['functions'][name], '<frozen-pure-meeting>', 'exec'), namespace)
            else:
                namespace[name] = pure_actual(name)
            continue
        if name in ENTRIES:
            entry = ENTRIES[name]
            if USE_ORIGINAL:
                exec(compile(entry['source'], '<frozen-meeting>', 'exec'), namespace)
                continue
            if entry.get('ready_flag') or entry.get('composed'):
                exec(compile(ast.Module(body=[existing[name]], type_ignores=[]), '<current-public-meeting>', 'exec'), namespace)
                continue
            implementation = _import('curriculum_api.' + entry['owner'], name)
            imported = {}
            for source in ([] if entry.get('deferred_imports') else entry['imports']):
                node = ast.parse(source).body[0]
                module = ('curriculum_api.' if node.level == 1 else '') + node.module
                for alias in node.names:
                    local = alias.asname or alias.name
                    imported[local] = _import(module, alias.name) if alias.name.isupper() else _lazy(module, alias.name)
            def bind(name=name, entry=entry, implementation=implementation, imported=imported):
                def call(*args, **kwargs):
                    ports = {key: namespace.get(key, _missing(key))
                             for key in (*entry['globals'], *DEV_PORTS.get(name, ()))}
                    if name == 'curriculum_teams_meeting' or entry.get('optional_owner'):
                        ports['teams_module_owner_id'] = namespace.get('teams_module_owner_id')
                    if name == 'curriculum_teams_meeting_schedule':
                        ports['schedule_request'] = namespace[name]
                    if entry.get('deferred_imports'):
                        def calendar_fallback():
                            scope = {'__package__': 'curriculum_api'}
                            exec(compile(entry['imports'][0], '<calendar-imports>', 'exec'), scope)
                            def display_cohort_holidays(cohort_ids):
                                exec(compile(entry['imports'][1], '<calendar-display-import>', 'exec'), scope)
                                return scope['display_cohort_holidays'](cohort_ids)
                            return scope['CalendarUnavailable'], display_cohort_holidays
                        ports['calendar_fallback'] = calendar_fallback
                    for factory in entry.get('factories', []):
                        def load(factory=factory):
                            scope = {'__package__': 'curriculum_api'}
                            exec(compile(factory['source'], '<meeting-deferred-import>', 'exec'), scope)
                            return tuple(scope[key] for key in factory['names'])
                        ports[factory['name']] = load
                    return implementation(*args, **kwargs, **ports, **imported)
                return call
            namespace[name] = bind()
        elif name in existing:
            exec(compile(ast.Module(body=[existing[name]], type_ignores=[]), str(ROOT / 'views.py'), 'exec'), namespace)
        elif name in exports:
            namespace[name] = _import(*exports[name])
        else:
            raise AssertionError('Current source symbol not found: ' + name)
