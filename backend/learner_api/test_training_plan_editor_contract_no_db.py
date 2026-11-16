from django.test import SimpleTestCase

from learner_api.training_plan_editor_contract import (
    parse_training_plan_editor_request,
    training_plan_editor_error_status,
)
from learner_api.training_plan_writes import (
    TrainingPlanAuthorizationError,
    TrainingPlanDependencyConflict,
    TrainingPlanValidationError,
    TrainingPlanVersionConflict,
)


class TrainingPlanEditorRequestContractTests(SimpleTestCase):
    def test_version_and_ordered_module_ids_are_required(self):
        request = parse_training_plan_editor_request({
            "modules": [{"moduleId": "M-2"}, {"moduleId": "M-1"}],
            "expectedPlanVersion": "sha256:opaque",
        })
        self.assertEqual(request.module_ids, ("M-2", "M-1"))
        self.assertEqual(request.expected_plan_version, "sha256:opaque")

    def test_missing_or_blank_version_is_rejected(self):
        for payload in (
            {"modules": [{"moduleId": "M-1"}]},
            {"modules": [{"moduleId": "M-1"}], "expectedPlanVersion": "  "},
            {"modules": [{"moduleId": "M-1"}], "expectedPlanVersion": None},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(TrainingPlanValidationError) as caught:
                    parse_training_plan_editor_request(payload)
                self.assertEqual(caught.exception.code, "expected_plan_version_required")

    def test_empty_plan_is_rejected_without_reconciliation(self):
        with self.assertRaises(TrainingPlanValidationError) as caught:
            parse_training_plan_editor_request({
                "modules": [],
                "expectedPlanVersion": "sha256:empty",
            })
        self.assertEqual(caught.exception.code, "empty_training_plan_not_allowed")

    def test_duplicate_assignments_are_rejected_instead_of_collapsed(self):
        with self.assertRaises(TrainingPlanValidationError) as caught:
            parse_training_plan_editor_request({
                "modules": ["M-1", {"moduleId": "M-1"}],
                "expectedPlanVersion": "v1",
            })
        self.assertEqual(caught.exception.code, "duplicate_module_assignment")
        self.assertEqual(caught.exception.details, {"moduleIds": ["M-1"]})

    def test_structured_domain_errors_have_stable_http_statuses(self):
        cases = (
            (TrainingPlanValidationError("invalid", "Invalid"), 400),
            (TrainingPlanAuthorizationError("denied", "Denied"), 403),
            (TrainingPlanVersionConflict("stale", "Stale"), 409),
            (TrainingPlanDependencyConflict("history", "History"), 409),
        )
        for error, status in cases:
            with self.subTest(code=error.code):
                self.assertEqual(training_plan_editor_error_status(error), status)
                self.assertEqual(error.as_dict()["error"]["code"], error.code)

