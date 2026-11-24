"""Build summary totals, declarations and progress-linked evidence from read facts."""
from collections import defaultdict


def learner_progress_ksb_totals(
    learner_ids,
    programme_ksb_codes,
    *,
    compact=False,
    clean_str,
    compact_progress_totals,
    coverage_normalise_code,
    float_weight,
    logger,
    progress_counts_as_achieved,
    progress_source_available,
    progress_total_rows,
):
    """Return only the achieved KSB totals needed by programme summary cards.

    ``learner_progress_ksb_consumption`` deliberately returns the full learner
    activity history because the Curriculum impact drill-down needs OTJH,
    lineage, deleted-component resolution and excluded rows. The programme
    cards need none of that detail. Reusing the drill-down query there made
    every cold Curriculum home request scan and join the full progress history
    once per programme.

    Keep the same completion and repeat-attempt rules while selecting only
    progress rows that carry one of this programme's KSB codes. This is a read
    optimisation, not a second definition of achievement: the decision still
    comes from ``learner_api.progress_rules``.
    """
    if not learner_ids or not progress_source_available():
        return {}
    code_filter = sorted({
        coverage_normalise_code(code)
        for code in programme_ksb_codes
        if coverage_normalise_code(code)
    })
    if not code_filter:
        return {}

    if compact:
        progress_totals = compact_progress_totals()
        try:
            return progress_totals(learner_ids, code_filter)
        except Exception as exc:
            logger.warning('Could not load compact learner progress KSB totals: %s', exc)
            return {}

    totals = defaultdict(lambda: defaultdict(float))
    try:
        rows = progress_total_rows(learner_ids, code_filter)
    except Exception as exc:
        logger.warning('Could not load learner progress KSB totals: %s', exc)
        return {}

    seen = set()
    allowed_codes = set(code_filter)
    for row in rows:
        code = coverage_normalise_code(row.get('ksb_code'))
        if not code or code not in allowed_codes:
            continue
        if not progress_counts_as_achieved(kind=row.get('kind'), passed=row.get('passed')):
            continue
        component_ref = clean_str(row.get('component_ref'))
        dedupe_key = (row.get('learner_id'), component_ref or row.get('progress_id'), code)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        totals[row.get('learner_id')][code] += float_weight(row.get('weight') or 0)
    return {
        learner_id: dict(code_totals)
        for learner_id, code_totals in totals.items()
    }


def learner_declared_ksb_codes(
    learner_ids,
    programme_ksb_codes,
    *,
    coverage_normalise_code,
    declaration_rows,
    declaration_source_available,
    logger,
    parse_json_value,
):
    """Return KSB codes explicitly selected by each learner in a reflection.

    A learner declaration is a set membership signal, not a weighted amount:
    selecting K1 in several reflections still achieves K1 once for that
    learner. Draft reflections are excluded; submitted and accepted reflections
    are the learner's saved declaration in the Learner schema.
    """
    if not learner_ids or not declaration_source_available():
        return {}
    allowed = {
        coverage_normalise_code(code)
        for code in programme_ksb_codes
        if coverage_normalise_code(code)
    }
    if not allowed:
        return {}
    try:
        rows = declaration_rows(learner_ids)
    except Exception as exc:
        logger.warning('Could not load learner-declared KSB codes: %s', exc)
        return {}

    declared = defaultdict(set)
    for row in rows:
        values = parse_json_value(row.get('ksb_codes'), [])
        if not isinstance(values, list):
            continue
        learner_id = row.get('learner_id')
        for value in values:
            code = coverage_normalise_code(value.get('code') if isinstance(value, dict) else value)
            if code in allowed:
                declared[learner_id].add(code)
    return dict(declared)


def progress_evidence_index(progress_ids, *, clean_str, evidence_rows, unique):
    """Evidence files keyed by the progress entry they were uploaded against.

    Evidence ownership is normalized through ``learner_profile_id``. This index
    joins on ``progress_entry_id`` instead — the same deterministic key Learner,
    Coach and Curriculum already share.
    """
    ids = unique([str(value) for value in (progress_ids or []) if value not in (None, '')])
    if not ids:
        return {}
    rows = evidence_rows(ids)
    if rows is None:
        return {}
    index = defaultdict(list)
    for row in rows:
        uploaded_at = row.get('uploaded_at')
        index[str(row.get('progress_entry_id'))].append({
            'evidenceId': str(row.get('id')) if row.get('id') is not None else '',
            'fileName': row.get('original_filename') or '',
            'status': row.get('status') or '',
            'scanResult': row.get('scan_result') or '',
            'sectionRef': row.get('section_ref') or '',
            'componentId': clean_str(row.get('component_ref')),
            'contentType': row.get('content_type') or '',
            'sizeBytes': row.get('size_bytes'),
            'uploadedAt': uploaded_at.isoformat() if hasattr(uploaded_at, 'isoformat') else '',
        })
    return dict(index)
