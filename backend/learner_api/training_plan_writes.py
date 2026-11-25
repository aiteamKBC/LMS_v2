"""Compatibility alias for the normalized Learning Plans writer.

The implementation lives in the Domain First capability. Replacing this
module entry with that exact module object preserves existing imports, class
and exception identities, monkey-patch targets, and runtime state without
creating a second writer implementation.
"""

import sys

from .learning_plans.infrastructure import training_plan_writes as _implementation

sys.modules[__name__] = _implementation
