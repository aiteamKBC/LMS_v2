"""Read-only count sources respecting each component store's archive contract."""


def component_count_source(source, ordinary_where):
    """Return a FROM relation and predicate without inventing lifecycle columns.

    Ordinary components retain the caller's existing status/NULL semantics.
    Native components expose deleted_at, not status; their view owns content_ref
    identity, cutover visibility and converted-course exclusion. Filter each
    source before combining them, since learning_components omits status.
    """
    native = '"curriculum"."free_authoring_components"'
    if source == native:
        return source, '"deleted_at" is null'
    if source != '"curriculum"."learning_components"':
        return source, ordinary_where
    ordinary_filter = f' where {ordinary_where}' if ordinary_where else ''
    return (
        '(select module_catalogue_id, type from "curriculum"."components"'
        + ordinary_filter
        + ' union all select module_catalogue_id, type from '
        + native + ' where "deleted_at" is null) as counted_components',
        '',
    )
