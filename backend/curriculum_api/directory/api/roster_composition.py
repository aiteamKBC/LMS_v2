"""Concrete directory roster composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.row_values import narrow_learners_to_placement
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.catalogue_resolution import scope_placement_lineage
from curriculum_api.catalogue.infrastructure.hierarchy_composition import assigned_learners_for_programme
from curriculum_api.catalogue.infrastructure.placement_runtime import scope_programme_identifier
from curriculum_api.http_cache import conditional_json_response
from curriculum_api.http_cache import encode_json_entry
from django.db import connection
from django.views.decorators.http import require_GET


CURRICULUM_LEARNER_SCOPES = ('programme', 'cohort', 'group', 'module', 'week', 'component')


def assigned_learners_for_scope(scope, identifier, lifecycle_status='', lineage=None, *, strict=False):
    from curriculum_api.directory.application.assigned_reads import assigned_learners_for_scope as implementation
    def read_module_roster(module_id, learners, status):
        from curriculum_api.learner_assignments import module_assignment_roster
        return module_assignment_roster(module_id, learners, status)
    return implementation(scope, identifier, lifecycle_status, lineage, strict=strict,
        scope_placement_lineage=scope_placement_lineage,
        scope_programme_identifier=scope_programme_identifier, clean_str=clean_str,
        database_vendor=lambda: connection.vendor, module_assignment_roster=read_module_roster,
        assigned_learners_for_programme=assigned_learners_for_programme,
        narrow_learners_to_placement=narrow_learners_to_placement,
    )


def _scope_learner_roster_payload_uncached(request, scope, identifier):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.queries import _scope_learner_roster_payload_uncached as read
    return read(
        request.GET,
        scope,
        identifier,
        assigned_learners_for_scope=assigned_learners_for_scope,
        clean_str=clean_str,
        normalise=normalise,
        scope_placement_lineage=scope_placement_lineage,
        truthy=truthy,
    )


def scope_learner_roster_entry(request, scope, identifier):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.api.responses import scope_learner_roster_entry as read
    return read(
        request,
        scope,
        identifier,
        _scope_learner_roster_payload_uncached=_scope_learner_roster_payload_uncached,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        encode_json_entry=encode_json_entry,
        normalise=normalise,
        truthy=truthy,
    )


def scope_learner_roster_response(request, scope, identifier):
    """The roster for an HTTP client: gzip when accepted, 304 when unchanged."""
    return conditional_json_response(request, scope_learner_roster_entry(request, scope, identifier))


@require_GET
def curriculum_programme_learner_roster(request, programme_id):
    return scope_learner_roster_response(request, 'programme', programme_id)


@require_GET
def curriculum_cohort_learner_roster(request, cohort_id):
    return scope_learner_roster_response(request, 'cohort', cohort_id)


@require_GET
def curriculum_group_learner_roster(request, group_id):
    return scope_learner_roster_response(request, 'group', group_id)


@require_GET
def curriculum_module_learner_roster(request, module_catalogue_id):
    return scope_learner_roster_response(request, 'module', module_catalogue_id)


@require_GET
def curriculum_week_learner_roster(request, week_id):
    return scope_learner_roster_response(request, 'week', week_id)


@require_GET
def curriculum_scope_learner_roster(request):
    from curriculum_api.reporting.api.achievement_reads import curriculum_scope_learner_roster as implementation
    return implementation(
        request,
        CURRICULUM_LEARNER_SCOPES=CURRICULUM_LEARNER_SCOPES, clean_str=clean_str, json_error=json_error,
        scope_learner_roster_response=scope_learner_roster_response,
    )
