"""Read-only status totals, sharing the curriculum roster's placement rules."""
import json
from collections import Counter, defaultdict

from django.db import DatabaseError

from . import curriculum_names


from curriculum_api.directory.domain.membership_values import (
    status_key,
    plan_membership,
)
from curriculum_api.directory.infrastructure.membership_runtime import (
    learner_facts,
    placement_lineages,
    members_for_lineages,
    counts_for_lineages,
    status_counts,
    module_member_enrolment_ids,
    module_member_enrolment_ids_by_module,
)
