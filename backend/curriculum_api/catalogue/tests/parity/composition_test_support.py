"""Inject the SAME synthetic capability into legacy exports and concrete consumers.

Only tests import this module. It does not change production lookup behavior or
patch unittest itself. Existing assertions and patch start/stop semantics remain.
"""
from contextlib import ExitStack, contextmanager
import json
from pathlib import Path
import sys
from unittest.mock import patch

from .entry_composition_oracle import SNAPSHOT

from .runtime_ownership_oracle import SNAPSHOT as RUNTIME_SNAPSHOT

from .registry_composition_oracle import SNAPSHOT as REGISTRY_SNAPSHOT

from .calendar_composition_oracle import SNAPSHOT as CALENDAR_SNAPSHOT

from .cache_composition_oracle import SNAPSHOT as CACHE_SNAPSHOT

from .overview_composition_oracle import SNAPSHOT as OVERVIEW_SNAPSHOT
from .cache_lifecycle_oracle import SNAPSHOT as CACHE_LIFECYCLE_SNAPSHOT
from .final_bindings_oracle import SNAPSHOT as FINAL_BINDINGS_SNAPSHOT

OWNERS = tuple('curriculum_api.' + name for name in
               dict.fromkeys((*SNAPSHOT['manifest']['modules'], *RUNTIME_SNAPSHOT['manifest']['modules'], *REGISTRY_SNAPSHOT['manifest']['modules'], *CALENDAR_SNAPSHOT['manifest']['modules'], *CACHE_SNAPSHOT['manifest']['modules'], *OVERVIEW_SNAPSHOT['manifest']['modules'], *CACHE_LIFECYCLE_SNAPSHOT['manifest']['modules'], *FINAL_BINDINGS_SNAPSHOT['manifest']['modules'])))
OWNERS += tuple(owner for groups in OVERVIEW_SNAPSHOT['extra_moves'].values() for owner in groups)
# Existing fixtures now inject their capabilities at the reviewed read consumers
# and concrete definitions; the public compatibility exports remain testable.
_READ_CONSUMERS = json.loads((Path(__file__).parents[1] /
    'fixtures/read_consumer_imports.json').read_text(encoding='utf-8'))
OWNERS += tuple(dict.fromkeys(
    [entry['file'].removeprefix('backend/').removesuffix('.py').replace('/', '.')
     for entry in _READ_CONSUMERS] +
    [binding['owner'] for entry in _READ_CONSUMERS for binding in entry['bindings']
     if binding['owner'] != 'django.db']))
# Same capabilities, now imported directly by the Free Course owners.
OWNERS += (
    'curriculum_api.catalogue.infrastructure.free_course_pricing',
    'curriculum_api.catalogue.infrastructure.free_course_catalogue_store',
    'curriculum_api.catalogue.infrastructure.free_course_commands',
    'curriculum_api.catalogue.infrastructure.free_course_policy_reads',
    'curriculum_api.catalogue.api.free_course_conversion',
    'curriculum_api.catalogue.infrastructure.free_course_conversion',
    'curriculum_api.catalogue.api.free_course_import',
    'curriculum_api.catalogue.infrastructure.free_course_import_storage',
    'curriculum_api.catalogue.infrastructure.free_course_structure_reads',
    'curriculum_api.catalogue.api.free_course_authoring',
)
_MISSING = object()


class composition_fixture:
    def __init__(self, target, attribute, *args, **kwargs):
        self.target, self.attribute = target, attribute
        self.args, self.kwargs = args, kwargs

    def start(self):
        original = getattr(self.target, self.attribute, _MISSING)
        self.stack = ExitStack()
        try:
            replacement = self.stack.enter_context(patch.object(self.target, self.attribute, *self.args, **self.kwargs))
            if getattr(self.target, '__name__', None) in {'curriculum_api.views', 'curriculum_api.cache_scope', 'curriculum_api.module_live', 'curriculum_api.learning_storage', 'curriculum_api.country_calendars', 'curriculum_api.delivery_calendar', 'curriculum_api.delivery_dashboard', 'curriculum_api.calendar_read_rows', 'curriculum_api.learner_status_counts', 'curriculum_api.read_model', 'curriculum_api.video_uploads'} and original is not _MISSING:
                for name in OWNERS:
                    owner = sys.modules.get(name)
                    if owner is not None and getattr(owner, self.attribute, _MISSING) is original:
                        self.stack.enter_context(patch.object(owner, self.attribute, replacement))
            return replacement
        except BaseException:
            self.stack.close()
            raise

    __enter__ = start

    def stop(self):
        self.stack.close()

    def __exit__(self, *exc):
        return self.stack.__exit__(*exc)


@contextmanager
def composition_fixtures(target, **capabilities):
    """Supply a group of explicit test values at their actual lookup owners."""
    with ExitStack() as stack:
        yield {name: stack.enter_context(composition_fixture(target, name, value))
               for name, value in capabilities.items()}


def composition_patch(target, *args, **kwargs):
    """Dotted fixture target with the same explicit owner fan-out as object fixtures."""
    from importlib import import_module
    module, attribute = target.rsplit('.', 1)
    return composition_fixture(import_module(module), attribute, *args, **kwargs)
