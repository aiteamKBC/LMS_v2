"""Observe the actual callable after a wrapper becomes a direct re-export."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager
from types import FunctionType
from unittest.mock import patch


@contextmanager
def placement_read_fixture(name, *args, **kwargs):
    """One synthetic read capability for the compatibility export and its owner."""
    from curriculum_api import curriculum_names
    from curriculum_api.catalogue.infrastructure import placement_reads
    with ExitStack() as stack:
        capability = stack.enter_context(patch.object(placement_reads, name, *args, **kwargs))
        if hasattr(curriculum_names, name):
            stack.enter_context(patch.object(curriculum_names, name, capability))
        yield capability


@contextmanager
def observe_export(legacy, owner, name, **kwargs):
    implementation = getattr(owner, name)
    # An imported alias is the exact owner object, not a forwarding function.
    # Spy at its public lookup site while retaining the original wraps target.
    target = legacy if getattr(legacy, name, None) is implementation else owner
    with composition_fixture(target, name, **kwargs) as observed:
        yield observed


@contextmanager
def bind_test_defaults(owner, **dependencies):
    """Inject synthetic capabilities at the concrete owner's existing contract."""
    with ExitStack() as stack:
        for value in vars(owner).values():
            if not isinstance(value, FunctionType) or value.__module__ != owner.__name__:
                continue
            defaults = value.__kwdefaults__ or {}
            replacements = {name: replacement for name, replacement in dependencies.items()
                            if name in defaults}
            if replacements:
                stack.enter_context(patch.dict(defaults, replacements))
        yield


@contextmanager
def database_read_fixture(name, *args, **kwargs):
    """Give old facades and the concrete reader the SAME synthetic capability."""
    from curriculum_api import views
    from curriculum_api.catalogue.infrastructure import database_reads
    with ExitStack() as stack:
        capability = stack.enter_context(patch.object(database_reads, name, *args, **kwargs))
        if hasattr(views, name):
            stack.enter_context(composition_fixture(views, name, capability))
        from curriculum_api.catalogue.infrastructure import authoring_runtime, authoring_schema_runtime
        for owner in (authoring_runtime, authoring_schema_runtime):
            if hasattr(owner, name):
                stack.enter_context(patch.object(owner, name, capability))
        yield capability


@contextmanager
def ksb_read_fixture(name, *args, **kwargs):
    """One fake for old KSB exports, their owner and explicit SQL read ports."""
    from curriculum_api import ksb_mapping_placement
    from curriculum_api.catalogue.infrastructure import ksb_read_store, authoring_sql, authoring_reads
    with ExitStack() as stack:
        capability = stack.enter_context(patch.object(ksb_read_store, name, *args, **kwargs))
        stack.enter_context(patch.object(ksb_mapping_placement, name, capability))
        port = {'relation': 'ksb_relation', 'attach_component_items': 'attach_component_ksbs',
                'attach_descriptions': 'attach_ksb_descriptions'}.get(name)
        if port:
            for owner in (authoring_sql, authoring_reads):
                stack.enter_context(bind_test_defaults(owner, **{port: capability}))
        yield capability


@contextmanager
def authoring_logger_fixture(*args, **kwargs):
    from curriculum_api import views
    from curriculum_api.catalogue.infrastructure import authoring_reads
    with composition_fixture(views, 'logger', *args, **kwargs) as logger, \
         bind_test_defaults(authoring_reads, logger=logger):
        yield logger


@contextmanager
def authoring_read_fixture(name, *args, **kwargs):
    """One synthetic capability at the old export and current read lookup sites."""
    from curriculum_api import views, authoring_read_transport
    from curriculum_api.catalogue.infrastructure import authoring_runtime, authoring_schema_runtime, authoring_sql
    owner = next(module for module in (authoring_runtime, authoring_schema_runtime, authoring_sql, views)
                 if hasattr(module, name))
    with ExitStack() as stack:
        capability = stack.enter_context(composition_fixture(owner, name, *args, **kwargs))
        for module in (views, authoring_runtime, authoring_schema_runtime, authoring_sql, authoring_read_transport):
            if module is not owner and hasattr(module, name):
                stack.enter_context(composition_fixture(module, name, capability))
        yield capability
