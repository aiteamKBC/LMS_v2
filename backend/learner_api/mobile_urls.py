"""Include under the already-forwarded /learner_api/mobile/ prefix."""
from django.urls import path
from . import mobile
from . import mobile_rewards

urlpatterns = [
    path("download/android/", mobile.download_android),
    path("rewards/summary/", mobile_rewards.summary),
    path("rewards/observations/", mobile_rewards.observations),
    path("rewards/voucher-requests/", mobile_rewards.voucher_request),
    path("rewards/leaderboard/", mobile_rewards.leaderboard),
    path("session/", mobile.session),
    path("catalogue/", mobile.catalogue),
    path("progress/", mobile.progress),
    path("hours/", mobile.hours),
    path("points/", mobile.points),
    path("meetings/", mobile.meetings),
    path("learning-sessions/start/", mobile.start_learning_session),
    path("components/<str:component_id>/complete/", mobile.complete_component),
    path("components/<str:component_id>/transcript/", mobile.transcript),
    path("videos/<str:component_id>/complete/", mobile.complete_video),
    path("quizzes/<str:component_id>/", mobile.quiz),
    path("quizzes/<str:component_id>/submit/", mobile.submit_quiz),
    path("meetings/<str:action>/", mobile.meeting_action),
]

