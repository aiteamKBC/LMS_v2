from django.urls import path

from .views import audit_blob, learner_activity_stats, learner_audit, learner_audit_list, learner_signoff
from .learner_log_views import health, learner_activities, learner_summaries, mre_list, mre_summary
from .learner_match_ledger_views import (
    activity_annotation as match_activity_annotation,
    activity_overrides as match_activity_overrides,
    activity_learners as match_activity_learners,
    attendance_session as match_attendance_session,
    health as match_health,
    learner_activities as match_learner_activities,
    learner_profile as match_learner_profile,
    learner_summaries as match_learner_summaries,
    quiz_attempt as match_quiz_attempt,
    save_activity_annotation as match_save_activity_annotation,
)


urlpatterns = [
    path("ledger/health", health, name="learner-log-health"),
    path("ledger/mre", mre_list, name="learner-log-mre"),
    path("ledger/mre/summary", mre_summary, name="learner-log-mre-summary"),
    path("ledger/learner-activities", learner_activities, name="learner-log-activities"),
    path("ledger/learners", learner_summaries, name="learner-log-learners"),
    # REAL (auditor-copy) workspace: reads Audit.learner_match.programme_structure.
    path("match-ledger/health", match_health, name="match-ledger-health"),
    path("match-ledger/learner-activities", match_learner_activities, name="match-ledger-activities"),
    path("match-ledger/activity-learners", match_activity_learners, name="match-ledger-activity-learners"),
    path("match-ledger/attendance-session", match_attendance_session, name="match-ledger-attendance-session"),
    path("match-ledger/quiz-attempt", match_quiz_attempt, name="match-ledger-quiz-attempt"),
    path("match-ledger/activity-annotation", match_activity_annotation, name="match-ledger-activity-annotation"),
    path("match-ledger/activity-annotation/save", match_save_activity_annotation, name="match-ledger-activity-annotation-save"),
    path("match-ledger/activity-overrides", match_activity_overrides, name="match-ledger-activity-overrides"),
    path("match-ledger/learners", match_learner_summaries, name="match-ledger-learners"),
    path("match-ledger/learner-profile", match_learner_profile, name="match-ledger-learner-profile"),
    path("learners/", learner_audit_list, name="audit-learners"),
    path("learners/stats/", learner_activity_stats, name="audit-learner-activity-stats"),
    path("learners/<int:learner_id>/", learner_audit, name="audit-learner"),
    path("learners/<int:learner_id>/signoff/", learner_signoff, name="audit-learner-signoff"),
    path("blob/", audit_blob, name="audit-blob"),
]
