"""Small SQL fragments for the normalised Curriculum read schema.

These helpers are intentionally read-only.  They keep learner projections on
the canonical status and KSB foreign-key relationships without changing the
shape of the API payloads those projections already return.
"""


def current_status_sql(alias):
    """Keep every row except the explicitly inactive one.

    NULL, blank and unrecognised statuses retain their previous visibility;
    only the owner-approved ``inactive`` value is interpreted as hidden.
    """
    return f"lower(btrim(coalesce({alias}.status, ''))) <> 'inactive'"


def standard_ksb_join_sql(mapping_alias='mapping', standard_alias='standard_ksb'):
    """Canonical mapping -> Skills England KSB relationship."""
    return (f"JOIN curriculum.standard_ksbs {standard_alias} "
            f"ON {standard_alias}.id = {mapping_alias}.standard_ksb_id")


def component_ksb_mappings_sql(component_alias='c', mapping_alias='mapping',
                               standard_alias='standard_ksb'):
    """Return a component's mappings in the legacy JSON response shape.

    The removed component JSONB column is derived from normalised mapping rows.
    A correlated aggregate avoids multiplying component rows.
    """
    return f"""coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'code',{standard_alias}.ksb_code,
            'description',{standard_alias}.ksb_description,
            'ksbId',{mapping_alias}.ksb_id,
            'classification',{mapping_alias}.classification,
            'weight',{mapping_alias}.weight,
            'weightClass',{mapping_alias}.weight_class,
            'sourceType',{mapping_alias}.source_type,
            'sourceId',{mapping_alias}.source_id
        ) ORDER BY {standard_alias}.ksb_code,{mapping_alias}.id)
        FROM curriculum.ksb_mappings {mapping_alias}
        {standard_ksb_join_sql(mapping_alias, standard_alias)}
        WHERE {mapping_alias}.component_id={component_alias}.id
          AND {current_status_sql(mapping_alias)}
          AND nullif(btrim({standard_alias}.ksb_code),'') IS NOT NULL
    ), '[]'::jsonb)"""


def component_ksb_codes_sql(component_alias='c', mapping_alias='mapping',
                            standard_alias='standard_ksb'):
    """Return only the KSB codes needed by compact weekly projections."""
    return f"""coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'code',{standard_alias}.ksb_code
        ) ORDER BY {standard_alias}.ksb_code,{mapping_alias}.id)
        FROM curriculum.ksb_mappings {mapping_alias}
        {standard_ksb_join_sql(mapping_alias, standard_alias)}
        WHERE {mapping_alias}.component_id={component_alias}.id
          AND {current_status_sql(mapping_alias)}
          AND nullif(btrim({standard_alias}.ksb_code),'') IS NOT NULL
    ), '[]'::jsonb)"""
