"""Concrete catalogue application operations; dependencies supplied by outer adapters."""

from curriculum_api.catalogue.application.scope_identity import authoring_summary_delivery_signature as _default_authoring_summary_delivery_signature
from curriculum_api.catalogue.domain.content_values import training_module_identifier as _default_training_module_identifier
from curriculum_api.catalogue.domain.delivery_identity import actual_cohort_identity as _default_actual_cohort_identity
from curriculum_api.catalogue.domain.delivery_identity import actual_group_identity as _default_actual_group_identity
from curriculum_api.catalogue.domain.hierarchy_values import canonical_programme_name as _default_canonical_programme_name
from curriculum_api.catalogue.domain.hierarchy_values import extract_notes_meta as _default_extract_notes_meta
from curriculum_api.catalogue.domain.ranking import best_authoring_summary as _default_best_authoring_summary
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise


def resolve_stored_module_catalogue_id(
    identifier,
    *,
    authoring_module_exists,
    clean_str=_default_clean_str,
    resolve_authoring_catalogue_id,
):
    """Resolve any public module identifier to the stored MOD-* primary key.

    The existence check first is what makes this cheap.
    ``resolve_authoring_catalogue_id`` is the general answer, but it summarises
    every module in the database to give it -- five round trips, four of them
    whole-table reads and one of them every component row -- because it has to
    search modules by source id, training id and delivery signature. That search
    only means anything for an identifier that is *not* a stored module: a legacy
    ``training-module-`` id, a ``catalogue-module-`` alias, a delivery source id.
    An identifier that already names a stored module is its own answer, and one
    indexed lookup settles it.

    Named for what it returns rather than for a caller: reads want the same
    resolution writes do, and the previous ``_for_write`` name had the module
    structure endpoint reaching for the expensive resolver on every GET rather
    than this one.
    """
    ident = clean_str(identifier)
    if not ident:
        return ''
    if ident.startswith('catalogue-module-'):
        ident = ident.replace('catalogue-module-', '', 1)
    if authoring_module_exists(ident):
        return ident
    return resolve_authoring_catalogue_id(ident) or ''


def resolve_authoring_catalogue_id(
    identifier,
    *,
    actual_cohort_identity=_default_actual_cohort_identity,
    actual_group_identity=_default_actual_group_identity,
    authoring_catalogue_summaries,
    authoring_summary_delivery_signature=_default_authoring_summary_delivery_signature,
    best_authoring_summary=_default_best_authoring_summary,
    canonical_programme_name=_default_canonical_programme_name,
    clean_str=_default_clean_str,
    extract_notes_meta=_default_extract_notes_meta,
    get_program_config_rows,
    normalise=_default_normalise,
    program_config_by_id,
    training_module_identifier=_default_training_module_identifier,
    training_row_by_id,
    training_row_module_catalogue_id,
):
    ident = clean_str(identifier)
    if not ident:
        return ''
    # Resolution reads only ids, the delivery signature and the ranking figures
    # (authoring_summary_score), all of which the content-free summaries carry.
    # The full summaries read every component and KSB mapping in the catalogue
    # (~10 s on the remote database) just to answer "which module is this?".
    summaries = authoring_catalogue_summaries(include_programme_deleted=True, include_content=False)
    if not summaries:
        return ''

    candidates = []

    def add_candidate(summary):
        if summary and summary not in candidates:
            candidates.append(summary)

    for summary in summaries.values():
        summary_identifiers = {
            clean_str(summary.get('catalogueId')),
            clean_str(summary.get('sourceId')),
        }
        if summary.get('sourceId'):
            summary_identifiers.add(training_module_identifier(summary.get('sourceId')))
        if ident in summary_identifiers:
            add_candidate(summary)

    if ident.startswith('training-module-'):
        training_id = ident.replace('training-module-', '', 1)
        row = training_row_by_id(training_id)
        if row:
            meta = row.get('_meta') or extract_notes_meta(row.get('notes'))
            legacy_ids = {
                training_id,
                training_module_identifier(training_id),
                training_row_module_catalogue_id(row),
            }
            try:
                programme_name = canonical_programme_name(row, program_config_by_id(get_program_config_rows()))
            except Exception:
                programme_name = row.get('Program') or 'Unassigned programme'
            cohort_identity = actual_cohort_identity(row, programme_name)
            group_identity = actual_group_identity(row, cohort_identity['id']) if cohort_identity else None
            delivery_signature = '|'.join([
                normalise(programme_name),
                normalise(row.get('module_name')),
                normalise((cohort_identity or {}).get('id') or (cohort_identity or {}).get('name')),
                normalise((group_identity or {}).get('id') or (group_identity or {}).get('name')),
            ])
            for summary in summaries.values():
                summary_identifiers = {
                    clean_str(summary.get('catalogueId')),
                    clean_str(summary.get('sourceId')),
                }
                if summary_identifiers.intersection(legacy_ids):
                    add_candidate(summary)
                    continue
                if delivery_signature and authoring_summary_delivery_signature(summary) == delivery_signature:
                    add_candidate(summary)

    best = best_authoring_summary(candidates)
    return clean_str(best.get('catalogueId')) if best else ''
