"""Canonical identities for achievement readers, independent of metric formulas.

Historical snapshots belong to their owning tables. This projection exposes only
official, non-excluded progress relationships for a learner's resolved standard.
It does not turn a mapping into achievement: callers retain acceptance/completion
rules and deduplicate their own activity or standard coverage population.
"""


def pin_learner_standard(cursor, learner_id):
    """Pin once, under the owner row lock; definitions are never synthesized."""
    cursor.execute('''SELECT l.standard_ref,l.standard_version,p.standard_ref,p.standard_version
        FROM "Learner".learners l LEFT JOIN curriculum.programmes p ON p.programme_id=l.programme_id
        WHERE l.id=%s FOR UPDATE OF l''', [learner_id])
    row = cursor.fetchone()
    if not row:
        raise ValueError('Learner identity no longer exists.')
    reference, version = row[:2] if row[0] is not None else row[2:]
    if not reference or not version:
        return None
    if row[0] and row[2] and row[0] != row[2]:
        raise ValueError('Pinned learner standard conflicts with the programme standard.')
    cursor.execute('SELECT 1 FROM curriculum.ksb_standard_versions WHERE standard_ref=%s AND standard_version=%s', [reference,version])
    if not cursor.fetchone():
        return None
    if row[0] is None:
        cursor.execute('''UPDATE "Learner".learners SET standard_ref=%s,standard_version=%s
            WHERE id=%s AND standard_ref IS NULL AND standard_version IS NULL''', [reference,version,learner_id])
        if cursor.rowcount != 1:
            raise ValueError('Incomplete learner standard pin requires reconciliation.')
    return reference,version


def learner_definition_condition(definition_alias, learner_id_sql):
    """Eligibility of an authored definition for one canonical learner owner."""
    return f'''EXISTS (SELECT 1 FROM "Learner".learners ksb_owner
        LEFT JOIN curriculum.programmes ksb_programme ON ksb_programme.programme_id=ksb_owner.programme_id
        JOIN curriculum.ksb_standard_versions ksb_version
          ON ksb_version.standard_ref=coalesce(ksb_owner.standard_ref,ksb_programme.standard_ref)
         AND ksb_version.standard_version=coalesce(ksb_owner.standard_version,ksb_programme.standard_version)
        WHERE ksb_owner.id={learner_id_sql}
          AND {definition_alias}.standard_ref=ksb_version.standard_ref
          AND {definition_alias}.standard_version=ksb_version.standard_version
          AND (ksb_owner.standard_ref IS NULL OR ksb_programme.standard_ref IS NULL
               OR ksb_owner.standard_ref=ksb_programme.standard_ref))'''


def official_progress_relation():
    """One row per eligible progress/position, with authoritative definition text.

    A learner pin wins over the programme version. A conflicting programme
    reference is ineligible; another version of the same standard remains pinned.
    Without a learner pin the programme's exact registered pair is used. Missing
    pairs never resolve by code, title, or latest-version heuristics.
    """
    return '''(SELECT k.progress_id,k.position,k.standard_ksb_id,
        d.ksb_code,d.ksb_description,k.classification,k.weight,k.weight_class,
        k.source_type,k.source_id,k.mapping_status,k.is_excluded,
        k.legacy_definition_snapshot,k.exclusion_reason,k.exclusion_metadata,
        d.standard_ref,d.standard_version
        FROM "Learner".ksb_learner_progress k
        JOIN "Learner".learner_progress_entries entry ON entry.id=k.progress_id
        JOIN "Learner".learners owner ON owner.id=entry.learner_id
        LEFT JOIN curriculum.programmes programme ON programme.programme_id=owner.programme_id
        JOIN curriculum.ksb_standard_versions version
          ON version.standard_ref=coalesce(owner.standard_ref,programme.standard_ref)
         AND version.standard_version=coalesce(owner.standard_version,programme.standard_version)
        JOIN curriculum.ksb_standard_definitions d ON d.id=k.standard_ksb_id
          AND d.standard_ref=version.standard_ref AND d.standard_version=version.standard_version
        WHERE k.is_excluded=false AND k.mapping_status='verified'
          AND entry.deleted_at IS NULL
          AND (owner.standard_ref IS NULL OR programme.standard_ref IS NULL
               OR owner.standard_ref=programme.standard_ref))'''


def point_counts_sql():
    """Existing accepted-evidence point formula over canonical eligible links."""
    return f'''WITH links AS (
        SELECT DISTINCT ON (k.ksb_code,p.id) k.ksb_code AS code,p.id,
            k.ksb_description AS description,k.position,p.accepted,
            (p.activity_status='completed' AND p.accepted IS TRUE) AS achieved
        FROM "Learner".learner_progress_entries p
        JOIN {official_progress_relation()} k ON k.progress_id=p.id
        WHERE p.learner_id=%s AND p.deleted_at IS NULL AND k.ksb_code IS NOT NULL
        ORDER BY k.ksb_code,p.id,k.position
    ) SELECT code,(array_agg(description ORDER BY id,position))[1] AS description,
        count(*) AS "evidenceCount",count(*) FILTER (WHERE achieved) AS completed,
        count(*) FILTER (WHERE accepted IS TRUE) AS "pointsAchieved"
        FROM links GROUP BY code ORDER BY min(id),code'''
