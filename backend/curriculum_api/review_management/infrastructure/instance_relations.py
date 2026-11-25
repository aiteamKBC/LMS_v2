"""Existing Review Instance relation names; no schema or record changes."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.relations import OCCURRENCE_OVERRIDES_TABLE


REVIEW_INSTANCES_TABLE = 'review_instances'


REVIEW_INSTANCE_ANSWERS_TABLE = 'review_instance_answers'


REVIEW_INSTANCE_SIGNATURES_TABLE = 'review_instance_signatures'


REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE = 'review_instance_manual_overrides'


REVIEW_INSTANCE_REOPENS_TABLE = 'review_instance_reopens'


LEARNER_REVIEW_ADDITIONS_TABLE = 'learner_review_additions'


OVERRIDES_TABLE = OCCURRENCE_OVERRIDES_TABLE
