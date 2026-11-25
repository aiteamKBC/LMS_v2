"""Compatibility import for the canonical identity/placement capability.

Repository production consumers migrate to ``identity_placement.public``. This
module remains for historical test patches, scripts and external imports until a
release proves those callers no longer require the old dotted path.
"""

import logging

from .identity_placement.public import learner_profile_for_source
from .models import EnrolmentUser, LearnerProfile

logger = logging.getLogger(__name__)

__all__ = ("EnrolmentUser", "LearnerProfile", "learner_profile_for_source", "logger")
