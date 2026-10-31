from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import learner_detail


class LearnerProfileProgrammeProjectionTests(SimpleTestCase):
    def test_normalized_profile_does_not_hydrate_removed_programme_column(self):
        source = SimpleNamespace(pk=101, programme="Final Test")
        profile = SimpleNamespace(__dict__={})

        with patch.object(
            learner_detail, "learner_profile_for_source", return_value=profile,
        ) as resolve, patch.object(learner_detail, "prefetch_related_objects"):
            result = learner_detail._active_profile_for_source(
                source, 101, heal=False,
            )

        self.assertIs(result, profile)
        fields = resolve.call_args.kwargs["fields"]
        self.assertNotIn("programme", fields)
        self.assertIn("programme_id", fields)
        self.assertEqual(profile.__dict__["programme"], "Final Test")
