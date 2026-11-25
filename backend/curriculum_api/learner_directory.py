"""Small assigned-learner directory; progress is loaded separately on demand."""
from django.http import JsonResponse
from django.db import DatabaseError
from django.views.decorators.http import require_GET
from django.views.decorators.cache import never_cache
from login.permissions import staff_only

SCOPES = {'programme', 'cohort', 'group', 'module'}


@never_cache
@require_GET
@staff_only()
def counts(request):
    from curriculum_api.directory.api.queries import counts as implementation
    from .learner_status_counts import status_counts
    return implementation(request, SCOPES=SCOPES, JsonResponse=JsonResponse, DatabaseError=DatabaseError,
        status_counts=status_counts,
    )


def roster(scope, identifier, status):
    from curriculum_api.directory.application.queries import roster as implementation
    from . import views
    from .learner_status_counts import status_key
    return implementation(scope, identifier, status,
        scope_placement_lineage=views.scope_placement_lineage,
        assigned_learners_for_scope=views.assigned_learners_for_scope, status_key=status_key,
    )


@never_cache
@require_GET
@staff_only()
def learners(request):
    from curriculum_api.directory.api.queries import learners as implementation
    from . import views
    from .learner_status_counts import status_key
    return implementation(request, SCOPES=SCOPES, JsonResponse=JsonResponse, DatabaseError=DatabaseError,
        curriculum_read_scope=views.curriculum_read_scope, roster=roster, status_key=status_key,
    )
