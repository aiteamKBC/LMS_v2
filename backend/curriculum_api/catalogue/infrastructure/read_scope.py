"""Infrastructure read scope. Explicit read capabilities preserve legacy contracts."""
import contextlib


@contextlib.contextmanager
def curriculum_read_scope(targeted_child_reads=False, *, read_scope_state):
    """Deduplicate repeated whole-table curriculum reads inside one build.

    Reentrant: a nested ``with`` reuses the outermost scope, which owns the
    lifetime, so a payload build called from inside another one still sees a
    single set of reads.

    ``targeted_child_reads`` is for a build that answers about one scope rather
    than looping over every programme. It keeps weeks/components/mappings on the
    ``module_catalogue_id in (...)`` query instead of the shared full read that
    only pays off across many programmes — see authoring_child_rows_for_modules.
    Dedup of the parent tables (modules, programmes, cohorts, groups) is
    unaffected, and both read paths are memoised, so nothing is read twice
    either way. Set on the outermost scope; a nested one inherits it.
    """
    if getattr(read_scope_state(), 'memo', None) is not None:
        yield
        return
    read_scope_state().memo = {}
    read_scope_state().targeted_child_reads = bool(targeted_child_reads)
    try:
        yield
    finally:
        read_scope_state().memo = None
        read_scope_state().targeted_child_reads = False


def _scope_memo_key(value):
    """Hashable stand-in for a call argument (query params arrive as lists)."""
    if isinstance(value, (list, tuple)):
        return tuple(_scope_memo_key(item) for item in value)
    if isinstance(value, (set, frozenset)):
        return frozenset(_scope_memo_key(item) for item in value)
    if isinstance(value, dict):
        return tuple(sorted((key, _scope_memo_key(item)) for key, item in value.items()))
    return value


def scoped_curriculum_read(fn, *, _scope_memo_key, functools, inspect, native_only, read_scope_state):
    """Memoise a read-only helper for the current curriculum_read_scope().

    Outside a scope the call passes straight through, so nothing changes for
    write paths or for callers that have not opted in. An argument that cannot
    be reduced to a hashable key also passes straight through rather than
    failing the request.

    Arguments are bound to the signature before keying, so a caller that spells
    out a default (``ensure_tables=True``) shares the memo with one that leaves
    it off. Without that, two reads of curriculum.modules that differ only in
    how they were written cost two round trips.
    """
    signature = inspect.signature(fn)

    def memo_key(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        key = (
            fn.__qualname__,
            native_only(),
            _scope_memo_key(tuple(bound.arguments.items())),
        )
        hash(key)
        return key

    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        memo = getattr(read_scope_state(), 'memo', None)
        if memo is None:
            return fn(*args, **kwargs)
        try:
            key = memo_key(*args, **kwargs)
        except (TypeError, ValueError):
            return fn(*args, **kwargs)
        if key not in memo:
            memo[key] = fn(*args, **kwargs)
        return memo[key]
    # The key a call would be memoised under, for prefetch_authoring_reads().
    wrapped.memo_key = memo_key
    return wrapped
