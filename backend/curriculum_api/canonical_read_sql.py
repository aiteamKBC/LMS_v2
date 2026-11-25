"""Small SQL fragments for the normalised Curriculum read schema.

These helpers are intentionally read-only.  They keep learner projections on
the canonical status and KSB foreign-key relationships without changing the
shape of the API payloads those projections already return.
"""


def ksb_physical_table(table):
    """Translate the retained authoring collection key to its physical owner."""
    return 'ksb_component_mappings' if table == 'ksb_mappings' else table


def standard_source_sql(alias):
    """Compatibility selector value derived from an exact registered pair."""
    return (f"CASE WHEN {alias}.standard_ref IS NOT NULL AND {alias}.standard_version IS NOT NULL "
            f"THEN 'standard:' || lower({alias}.standard_ref) || '-v' || "
            f"replace({alias}.standard_version,'.','-') ELSE '' END")


def current_status_sql(alias):
    """Keep every row except the explicitly inactive one.

    NULL, blank and unrecognised statuses retain their previous visibility;
    only the owner-approved ``inactive`` value is interpreted as hidden.
    """
    return f"lower(btrim(coalesce({alias}.status, ''))) <> 'inactive'"


def module_expected_otjh_sql(module_alias='m'):
    """Correlated expression returning active-component expected OTJH for one module row.

    Matches the Python helpers: each component's hours are rounded to the nearest whole
    minute before summing (otjh_rounded_minutes), then the total is converted back to
    hours at two decimal places (otjh_hours_from_minutes).

    Internal aliases use the module_alias as a prefix to avoid collisions with the
    outer query.  The ``status <> 'inactive'`` predicate mirrors current_status_sql.
    """
    w = f"{module_alias}_w"
    c = f"{module_alias}_c"
    return (
        f"COALESCE(ROUND("
        f"COALESCE(("
        f"SELECT SUM(ROUND({c}.expected_otjh::numeric * 60)::bigint)"
        f" FROM curriculum.weeks {w}"
        f" JOIN curriculum.components {c} ON {c}.week_id = {w}.id"
        f" WHERE {w}.module_catalogue_id = {module_alias}.module_catalogue_id"
        f" AND lower(btrim(coalesce({c}.status, ''))) <> 'inactive'"
        f" AND lower(btrim(coalesce({w}.status, ''))) <> 'inactive'"
        f"), 0)::numeric / 60.0, 2), 0.00)"
    )


def standard_ksb_join_sql(mapping_alias='mapping', standard_alias='standard_ksb'):
    """Canonical mapping -> Skills England KSB relationship."""
    return (f"JOIN curriculum.ksb_standard_definitions {standard_alias} "
            f"ON {standard_alias}.id = {mapping_alias}.standard_ksb_id")


def standard_ksb_compatibility_id_sql(standard_alias='standard_ksb'):
    """Retain the installed view/API ID shape without the removed mapping column.

    The official numeric definition ID is scoped by its standard and version;
    a code alone is never an identity.
    """
    return (f"lower({standard_alias}.standard_ref) || '-v' || "
            f"replace({standard_alias}.standard_version, '.', '-') || '-' || "
            f"{standard_alias}.id::text")


def component_ksb_mappings_sql(component_alias='c', mapping_alias='mapping',
                               standard_alias='standard_ksb'):
    """Return a component's mappings in the legacy JSON response shape.

    The removed component JSONB column is derived from normalised mapping rows.
    A correlated aggregate avoids multiplying component rows.
    """
    return f"""coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'code',{standard_alias}.ksb_code,
            'standardKsbId',{standard_alias}.id,
            'standardRef',{standard_alias}.standard_ref,
            'standardVersion',{standard_alias}.standard_version,
            'description',{standard_alias}.ksb_description,
            'ksbId',{standard_ksb_compatibility_id_sql(standard_alias)},
            'classification',{mapping_alias}.classification,
            'weight',{mapping_alias}.weight,
            'weightClass',{mapping_alias}.weight_class,
            'sourceType',{mapping_alias}.source_type,
            'sourceId',{mapping_alias}.source_id
        ) ORDER BY {standard_alias}.ksb_code,{mapping_alias}.id)
        FROM curriculum.ksb_component_mappings {mapping_alias}
        {standard_ksb_join_sql(mapping_alias, standard_alias)}
        WHERE {mapping_alias}.component_id={component_alias}.id
          AND {mapping_alias}.status='active'
          AND nullif(btrim({standard_alias}.ksb_code),'') IS NOT NULL
    ), '[]'::jsonb)"""


def component_ksb_codes_sql(component_alias='c', mapping_alias='mapping',
                            standard_alias='standard_ksb', eligibility_sql='TRUE'):
    """Return only the KSB codes needed by compact weekly projections."""
    return f"""coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'code',{standard_alias}.ksb_code
        ) ORDER BY {standard_alias}.ksb_code,{mapping_alias}.id)
        FROM curriculum.ksb_component_mappings {mapping_alias}
        {standard_ksb_join_sql(mapping_alias, standard_alias)}
        WHERE {mapping_alias}.component_id={component_alias}.id
          AND {mapping_alias}.status='active'
          AND ({eligibility_sql})
          AND nullif(btrim({standard_alias}.ksb_code),'') IS NOT NULL
    ), '[]'::jsonb)"""
