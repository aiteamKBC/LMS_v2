"""Build programme module candidates from one normalized child-row snapshot.

Delivery and authoring response shapes still participate in the established
selection contract. Stored config documents never supply module content.
"""
from ..domain.programme_scope import module_catalogue_id, owns_record
from .overview import CurriculumOverviewUnavailable


class ProgrammeModulesUnavailable(CurriculumOverviewUnavailable):
    """Required module facts were unavailable or changed during the read."""

from curriculum_api.catalogue.application.scope_identity import programme_identifier_looks_exact as _default_programme_identifier_looks_exact
from curriculum_api.catalogue.domain.hierarchy_values import matches_curriculum_identifier as _default_matches_curriculum_identifier
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def programme_module_candidates(
    modules,
    programme,
    config,
    *,
    workspace_view=False,
    module_rows=None,
    known_programme_ids=(),
    PROGRAMME_MODULE_IDENTITY_FIELDS,
    CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
    clean_str=_default_clean_str,
    component_text_cancels,
    enrich_curriculum_modules_with_authoring_details,
    get_authoring_structure_payloads,
    matches_curriculum_identifier=_default_matches_curriculum_identifier,
    module_index_rows,
    programme_identifier_looks_exact=_default_programme_identifier_looks_exact,
    programme_authoring_module_rows,
    programme_authoring_modules,
    programme_structure_child_rows,
):
    try:
        index = module_index_rows() if module_rows is None else module_rows
        owned = [row for row in index if owns_record(
            programme, row.get('programme_id'), row.get('programme_name'),
            known_ids=known_programme_ids, clean_str=clean_str,
            matches_curriculum_identifier=matches_curriculum_identifier,
            identifier_looks_exact=programme_identifier_looks_exact,
        )]
        owned_ids = {clean_str(row.get('module_catalogue_id')) for row in owned}
        # The compatibility delivery shape must have an actual row in this scope.
        # A stale cached/config row cannot invent a module or move its ownership.
        modules = [module for module in modules
                   if module_catalogue_id(module, clean_str=clean_str) in owned_ids]
        authoring_rows = programme_authoring_module_rows(programme, config, module_rows=owned)
        ids = sorted({module_catalogue_id(module, clean_str=clean_str) for module in modules}
                     | {clean_str(row.get('module_catalogue_id')) for row in authoring_rows})
        ids = [value for value in ids if value]
        if not ids:
            return []

        def candidates(component_text):
            children = programme_structure_child_rows(ids, component_text=component_text)
            # Both representations consume these exact hydrated facts. Quality,
            # staff and extra fields keep the former full authoring contract.
            payloads = get_authoring_structure_payloads(
                ids, component_columns=CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
                child_rows=children,
            )
            if any(not payloads.get(identifier) for identifier in ids):
                raise ProgrammeModulesUnavailable('A scoped module disappeared while reading its structure.')
            # Recheck ownership against the structure snapshot as well as the
            # index: a concurrent programme reassignment cannot leak old content.
            if any(not owns_record(
                programme, payloads[identifier].get('programmeId'),
                payloads[identifier].get('programmeName'), known_ids=known_programme_ids,
                clean_str=clean_str, matches_curriculum_identifier=matches_curriculum_identifier,
                identifier_looks_exact=programme_identifier_looks_exact,
            ) for identifier in ids):
                raise ProgrammeModulesUnavailable('Module ownership changed during the read.')
            return [
                *enrich_curriculum_modules_with_authoring_details(
                    modules, authoring_payloads=payloads,
                ),
                *programme_authoring_modules(
                    programme, config, module_rows=authoring_rows, payloads_by_id=payloads,
                ),
            ]

        if workspace_view:
            lean = candidates(False)
            if component_text_cancels(lean, PROGRAMME_MODULE_IDENTITY_FIELDS):
                return lean
        return candidates(True)
    except ProgrammeModulesUnavailable:
        raise
    except Exception as exc:
        raise ProgrammeModulesUnavailable('Required programme module facts could not be read.') from exc
