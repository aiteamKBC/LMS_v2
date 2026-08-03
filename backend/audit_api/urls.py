from django.urls import path

from .views import audit_blob, learner_activity_stats, learner_audit, learner_audit_list, learner_signoff


urlpatterns = [
    path("learners/", learner_audit_list, name="audit-learners"),
    path("learners/stats/", learner_activity_stats, name="audit-learner-activity-stats"),
    path("learners/<int:learner_id>/", learner_audit, name="audit-learner"),
    path("learners/<int:learner_id>/signoff/", learner_signoff, name="audit-learner-signoff"),
    path("blob/", audit_blob, name="audit-blob"),
]
