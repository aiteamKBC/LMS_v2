"""Exact module resolver query; caller supplies the database read capability."""

def read_resolution_candidates(
    requested_values,
    *,
    AUTHORING_MODULES_TABLE,
    authoring_fetch_all,
    clean_str,
    database_vendor,
    normalise,
    unique,
):
    requested_title_keys = unique([normalise(value) for value in requested_values if normalise(value)])
    module_rows = []
    if database_vendor() == 'postgresql':
        clauses = []
        params = []
        placeholders = ', '.join(['%s'] * len(requested_values))
        clauses.append(f'module_catalogue_id in ({placeholders})')
        params.extend(requested_values)
        clauses.append(f'source_id in ({placeholders})')
        params.extend(requested_values)
        if requested_title_keys:
            title_placeholders = ', '.join(['%s'] * len(requested_title_keys))
            clauses.append(f"btrim(lower(regexp_replace(coalesce(title, ''), '\\s+', ' ', 'g'))) in ({title_placeholders})")
            params.extend(requested_title_keys)
        module_rows = authoring_fetch_all(
            AUTHORING_MODULES_TABLE,
            f'({" or ".join(clauses)})',
            params,
            'updated_at desc, title',
        )
    else:
        requested_set = set(requested_values)
        title_set = set(requested_title_keys)
        module_rows = [
            row for row in authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='updated_at desc, title')
            if clean_str(row.get('module_catalogue_id')) in requested_set
            or clean_str(row.get('source_id')) in requested_set
            or normalise(row.get('title')) in title_set
        ]
    return module_rows
