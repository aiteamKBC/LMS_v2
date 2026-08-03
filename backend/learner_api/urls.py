from django.urls import path

from . import absence_reports, attendance, calendar, calendar_connections, components, curriculum, evidence, learner_detail, lms_schema, quizzes, reflection_ai, reflection_submissions, videos, views

urlpatterns = [
    path("enrolment-users/", views.enrolment_users, name="enrolment-users"),
    path("enrolment-users/options/", views.enrolment_user_options, name="enrolment-user-options"),
    path("enrolment-users/<int:pk>/", views.enrolment_user_detail, name="enrolment-user-detail"),
    path("enrolment-users/<int:pk>/finish/", views.enrolment_user_finish, name="enrolment-user-finish"),
    path("commercial-users/", views.commercial_users, name="commercial-users"),
    path("commercial-users/<int:pk>/", views.commercial_user_detail, name="commercial-user-detail"),
    path("staff-users/", views.staff_users, name="staff-users"),
    path("staff-users/<int:pk>/", views.staff_user_detail, name="staff-user-detail"),
    path("learner-detail/<str:kind>/<int:pk>/", learner_detail.learner_detail, name="learner-detail"),
    path("kbc-lms/all-students-schema/", lms_schema.all_students_schema, name="kbc-lms-all-students-schema"),
    path("attendance/<str:kind>/<int:learner_id>/", attendance.learner_attendance, name="learner-attendance"),
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
    # British-English voice reflection transcription, moderation and learning-scope check
    path("reflection/transcribe/", reflection_ai.transcribe_reflection, name="reflection-transcribe"),
    path("reflection/proofread/", reflection_ai.proofread_reflection, name="reflection-proofread"),
    path("reflection/submissions/", reflection_submissions.create_reflection_submission, name="reflection-submission-create"),
    # learner calendar (coaching sessions from Coach.coach_calendar_event)
    path("calendar/<str:kind>/<int:pk>/", calendar.learner_calendar, name="learner-calendar"),
    path("calendar/<str:kind>/<int:pk>/book/", calendar.learner_calendar_book, name="learner-calendar-book"),
    path("calendar-connections/<str:kind>/<int:learner_id>/", calendar_connections.connection_list, name="learner-calendar-connections"),
    path("calendar-connections/<str:kind>/<int:learner_id>/availability/", calendar_connections.availability, name="learner-calendar-availability"),
    path("calendar-connections/<str:kind>/<int:learner_id>/<str:provider>/oauth/", calendar_connections.oauth_start, name="learner-calendar-oauth"),
    path("calendar-connections/<str:kind>/<int:learner_id>/<str:provider>/connect/", calendar_connections.credential_connect, name="learner-calendar-connect"),
    path("calendar-connections/<str:kind>/<int:learner_id>/<str:provider>/disconnect/", calendar_connections.disconnect, name="learner-calendar-disconnect"),
    path("absence-reports/<str:kind>/<int:learner_id>/", absence_reports.learner_absence_reports, name="learner-absence-reports"),
    # learner evidence uploads (Azure Blob Storage backed)
    path("evidence/<str:kind>/<int:pk>/upload/", evidence.upload_evidence, name="evidence-upload"),
    path("evidence/<str:kind>/<int:pk>/", evidence.list_evidence, name="evidence-list"),
    path("evidence/<str:kind>/<int:pk>/<uuid:file_id>/download/", evidence.download_evidence, name="evidence-download"),
]
