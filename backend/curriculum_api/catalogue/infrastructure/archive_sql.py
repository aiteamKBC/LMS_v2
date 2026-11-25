"""SQL predicates for the existing normalized curriculum archive contract."""

STATUS_TABLES = frozenset({
    'programmes', 'cohorts', 'groups', 'modules', 'weeks', 'components', 'ksb_mappings', 'coaches', 'tutors',
})


def uses_status(table):
    return table in STATUS_TABLES


def live_sql(alias=''):
    prefix = f'{alias}.' if alias and not alias.endswith('.') else alias
    return f"{prefix}\"status\" not in ('inactive', 'archived')"


def inactive_sql(alias=''):
    prefix = f'{alias}.' if alias and not alias.endswith('.') else alias
    return f"{prefix}\"status\" in ('inactive', 'archived')"
