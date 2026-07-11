from django.urls import path

from . import curriculum, learner_detail, quizzes, views

urlpatterns = [
    path("enrolment-users/", views.enrolment_users, name="enrolment-users"),
    path("enrolment-users/options/", views.enrolment_user_options, name="enrolment-user-options"),
    path("enrolment-users/<int:pk>/", views.enrolment_user_detail, name="enrolment-user-detail"),
    path("commercial-users/", views.commercial_users, name="commercial-users"),
    path("commercial-users/<int:pk>/", views.commercial_user_detail, name="commercial-user-detail"),
    path("learner-detail/<str:kind>/<int:pk>/", learner_detail.learner_detail, name="learner-detail"),
    # curriculum lookups for the training-plan builder
    path("curriculum/programmes/", curriculum.programmes, name="curriculum-programmes"),
    path("curriculum/cohorts/", curriculum.cohorts, name="curriculum-cohorts"),
    path("curriculum/groups/", curriculum.groups, name="curriculum-groups"),
    path("curriculum/modules/", curriculum.modules, name="curriculum-modules"),
    path("curriculum/weeks/", curriculum.weeks, name="curriculum-weeks"),
    path("curriculum/components/", curriculum.components, name="curriculum-components"),
    # quiz-taking
    path("quizzes/<int:quiz_id>/", quizzes.quiz_detail, name="quiz-detail"),
    path("quizzes/<int:quiz_id>/submit/", quizzes.submit_quiz_attempt, name="quiz-submit"),
]
