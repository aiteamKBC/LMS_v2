from django.urls import path

from . import calendar, components, curriculum, learner_detail, quizzes, videos, views

urlpatterns = [
    path("enrolment-users/", views.enrolment_users, name="enrolment-users"),
    path("enrolment-users/options/", views.enrolment_user_options, name="enrolment-user-options"),
    path("enrolment-users/<int:pk>/", views.enrolment_user_detail, name="enrolment-user-detail"),
    path("commercial-users/", views.commercial_users, name="commercial-users"),
    path("commercial-users/<int:pk>/", views.commercial_user_detail, name="commercial-user-detail"),
    path("learner-detail/<str:kind>/<int:pk>/", learner_detail.learner_detail, name="learner-detail"),
    path("learners/<int:pk>/coach/", views.learner_coach, name="learner-coach"),
    # curriculum lookups for the training-plan builder
    path("curriculum/programmes/", curriculum.programmes, name="curriculum-programmes"),
    path("curriculum/cohorts/", curriculum.cohorts, name="curriculum-cohorts"),
    path("curriculum/groups/", curriculum.groups, name="curriculum-groups"),
    path("curriculum/modules/", curriculum.modules, name="curriculum-modules"),
    path("curriculum/weeks/", curriculum.weeks, name="curriculum-weeks"),
    path("curriculum/components/", curriculum.components, name="curriculum-components"),
    path("curriculum/legacy-otjh/", curriculum.legacy_otjh, name="curriculum-legacy-otjh"),
    # quiz-taking
    path("quizzes/<int:quiz_id>/", quizzes.quiz_detail, name="quiz-detail"),
    path("quizzes/<int:quiz_id>/submit/", quizzes.submit_quiz_attempt, name="quiz-submit"),
    # video-watching
    path("videos/<str:component_id>/complete/", videos.submit_video_progress, name="video-complete"),
    # generic component completion (podcast / reading / slides / reflection / …)
    path("components/<str:component_id>/complete/", components.submit_component_progress, name="component-complete"),
    # learner calendar (coaching sessions from Coach.coach_calendar_event)
    path("calendar/<str:kind>/<int:pk>/", calendar.learner_calendar, name="learner-calendar"),
    path("calendar/<str:kind>/<int:pk>/book/", calendar.learner_calendar_book, name="learner-calendar-book"),
]
