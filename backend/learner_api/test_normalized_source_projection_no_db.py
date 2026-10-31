from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import absence_reports, calendar_connections, meeting_attendance, review_sessions


def _queryset_returning(source):
    queryset = MagicMock()
    queryset.defer.return_value.filter.return_value.first.return_value = source
    return queryset


class NormalizedCreatedUserProjectionTests(SimpleTestCase):
    def test_meeting_source_defers_removed_legacy_columns(self):
        source = SimpleNamespace()
        queryset = _queryset_returning(source)
        model = SimpleNamespace(all_learners=queryset)
        with patch.dict(meeting_attendance.SOURCE_MODELS, {"commercial": model}), \
             patch.object(meeting_attendance, "attach_programme_name", return_value=source) as attach:
            result = meeting_attendance._source("commercial", 101)
        self.assertIs(result, source)
        queryset.defer.assert_called_once_with("status", "programme")
        attach.assert_called_once_with(source)

    def test_absence_source_defers_removed_legacy_columns(self):
        source = SimpleNamespace()
        queryset = _queryset_returning(source)
        with patch.object(absence_reports, "CommercialUser", SimpleNamespace(all_learners=queryset)), \
             patch.object(absence_reports, "attach_programme_name", return_value=source) as attach:
            result = absence_reports._source_learner("commercial", 101)
        self.assertIs(result, source)
        queryset.defer.assert_called_once_with("status", "programme")
        attach.assert_called_once_with(source)

    def test_review_source_defers_removed_legacy_columns(self):
        source = SimpleNamespace()
        queryset = _queryset_returning(source)
        model = SimpleNamespace(all_learners=queryset, DoesNotExist=RuntimeError)
        request = SimpleNamespace(method="GET", GET={"content": "summary"})
        with patch.dict(review_sessions.SOURCE_MODELS, {"commercial": model}), \
             patch.object(review_sessions, "attach_programme_name", return_value=source), \
             patch.object(review_sessions, "_calendar_profile", return_value=SimpleNamespace()), \
             patch.object(review_sessions, "coaching_events_for_learner", return_value=[]), \
             patch.object(review_sessions, "annotate_meeting_outcomes"):
            response = review_sessions.learner_review_sessions.__wrapped__(request, "commercial", 101)
        self.assertEqual(response.status_code, 200)
        queryset.defer.assert_called_once_with("status", "programme")

    def test_calendar_connection_ownership_reads_only_identity(self):
        source = SimpleNamespace(pk=101)
        queryset = MagicMock()
        queryset.only.return_value.filter.return_value.first.return_value = source
        model = SimpleNamespace(all_learners=queryset)
        with patch.dict(calendar_connections.SOURCE_MODELS, {"commercial": model}):
            result = calendar_connections._learner("commercial", 101)
        self.assertIs(result, source)
        queryset.only.assert_called_once_with("id")
