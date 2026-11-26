"""Staff status edits must reach the profile used by reviews and coaching."""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .views import enrolment_user_detail


class StaffStatusProfileTests(SimpleTestCase):
    def update(self, payload):
        learner = SimpleNamespace(pk=501, id=501, programme_status="Delivery", save=Mock())
        request = RequestFactory().patch("/learner_api/enrolment-users/501/",
                                         data=json.dumps(payload), content_type="application/json")
        with patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}), \
                patch("learner_api.views.EnrolmentUser") as model, \
                patch("learner_api.views.advance_learner"), \
                patch("learner_api.views.sync_active_user") as sync, \
                patch("learner_api.views.to_board", return_value={}):
            model.all_learners.filter.return_value.first.return_value = learner
            response = enrolment_user_detail(request, 501)
        self.assertEqual(response.status_code, 200)
        return learner, sync

    def test_explicit_activation_refreshes_the_delivery_profile(self):
        learner, sync = self.update({"programmeStatus": "Active"})
        self.assertEqual(learner.programme_status, "Active")
        sync.assert_called_once_with(learner)

    def test_deactivation_also_reaches_the_profile(self):
        learner, sync = self.update({"programmeStatus": "On break"})
        self.assertEqual(learner.programme_status, "On break")
        sync.assert_called_once_with(learner)

    def test_unrelated_edit_does_not_rebuild_the_learning_plan(self):
        _, sync = self.update({"phone": "07000000000"})
        sync.assert_not_called()


class LearnerRefreshCounterTests(SimpleTestCase):
    def test_counter_does_not_disclose_staff_change_paths_to_learners(self):
        from curriculum_api.views import curriculum_cache_epoch
        request = RequestFactory().get("/curriculum_api/curriculum/cache-epoch/")
        request.login_account = SimpleNamespace(role="learner")
        with patch("curriculum_api.views.shared_curriculum_epoch", return_value=123), \
                patch("curriculum_api.views.recent_curriculum_changes") as changes:
            response = curriculum_cache_epoch(request)
        self.assertEqual(json.loads(response.content), {"epoch": 123, "changes": []})
        changes.assert_not_called()


class CurriculumSiblingIdentityTests(SimpleTestCase):
    def test_new_siblings_keep_distinct_ids_even_when_the_clock_does_not_advance(self):
        from curriculum_api.views import canonical_authoring_id, unique_timestamp_prefixed_id
        with patch("curriculum_api.views.datetime") as clock:
            clock.utcnow.return_value.strftime.return_value = "20260913000000000000"
            self.assertEqual(len({canonical_authoring_id("COMP") for _ in range(20)}), 20)
            self.assertEqual(len({unique_timestamp_prefixed_id("WEEK") for _ in range(20)}), 20)

    def test_existing_canonical_identity_is_preserved(self):
        from curriculum_api.views import canonical_authoring_id
        self.assertEqual(canonical_authoring_id("COMP", "COMP-existing-123"), "COMP-existing-123")
