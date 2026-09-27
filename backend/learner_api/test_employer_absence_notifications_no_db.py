"""No-database regression checks for employer recording-choice alerts."""
from __future__ import annotations

import inspect
import json
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.test import RequestFactory

from learner_api import employer_portal


class EmployerAbsenceNotificationTests(unittest.TestCase):
    def test_returns_only_recording_reports_for_learners_owned_by_employer(self):
        learner_manager = MagicMock()
        learner_manager.filter.return_value.values_list.return_value = [12, 13]
        report = SimpleNamespace(
            pk=44,
            learner_name="Example Learner",
            session_title="Session 8",
            created_at=datetime(2026, 9, 19, 12, 30, tzinfo=timezone.utc),
        )
        report_manager = MagicMock()
        report_manager.filter.return_value.order_by.return_value.__getitem__.return_value = [report]
        request = RequestFactory().get("/absence-notifications/")

        with patch.object(
            employer_portal,
            "SOURCE_MODELS",
            {"apprenticeship": SimpleNamespace(all_learners=learner_manager)},
        ), patch.object(employer_portal.CoachAbsenceReport, "objects", report_manager):
            response = inspect.unwrap(employer_portal.employer_absence_notifications)(request, 7)

        self.assertEqual(response.status_code, 200)
        learner_manager.filter.assert_called_once_with(employer_id=7)
        report_manager.filter.assert_called_once_with(
            learner_id__in=[12, 13],
            recovery_method="recorded",
        )
        payload = json.loads(response.content)
        self.assertEqual(payload["items"][0]["id"], "recorded-absence:44")
        self.assertIn("Attendance will remain absent", payload["items"][0]["text"])
        self.assertEqual(payload["items"][0]["link"], "/employers/7")


if __name__ == "__main__":
    unittest.main()
