from django.urls import path

from .views import audit_blob, learner_activity_stats, learner_audit, learner_audit_list, learner_signoff
from .learner_log_views import health, learner_activities, learner_summaries, mre_list, mre_summary


urlpatterns = [
    path("ledger/health", health, name="learner-log-health"),
    path("ledger/mre", mre_list, name="learner-log-mre"),
    path("ledger/mre/summary", mre_summary, name="learner-log-mre-summary"),
    path("ledger/learner-activities", learner_activities, name="learner-log-activities"),
    path("ledger/learners", learner_summaries, name="learner-log-learners"),
    path("learners/", learner_audit_list, name="audit-learners"),
    path("learners/stats/", learner_activity_stats, name="audit-learner-activity-stats"),
    path("learners/<int:learner_id>/", learner_audit, name="audit-learner"),
    path("learners/<int:learner_id>/signoff/", learner_signoff, name="audit-learner-signoff"),
    path("blob/", audit_blob, name="audit-blob"),
]
