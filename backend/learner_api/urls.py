from django.urls import path

from . import absence_reports, attendance, calendar, components, curriculum, employers, evidence, learner_detail, quizzes, reflection_ai, reflection_submissions, review_form, videos, views

urlpatterns = [
    path("enrolment-users/", views.enrolment_users, name="enrolment-users"),
    path("enrolment-users/options/", views.enrolment_user_options, name="enrolment-user-options"),
    path("enrolment-users/<int:pk>/", views.enrolment_user_detail, name="enrolment-user-detail"),
    path("enrolment-users/<int:pk>/finish/", views.enrolment_user_finish, name="enrolment-user-finish"),
    path("commercial-users/", views.commercial_users, name="commercial-users"),
    path("commercial-users/<int:pk>/", views.commercial_user_detail, name="commercial-user-detail"),
    path("staff-users/", views.staff_users, name="staff-users"),
    path("staff-users/<int:pk>/", views.staff_user_detail, name="staff-user-detail"),
    # organisation + employer profiles. "options/" is declared before the
    # <int:pk> routes, which would otherwise never be reached for it.
    path("employers/options/", employers.employer_options, name="employer-options"),
    path("organisations/", employers.organisations, name="organisations"),
    path("organisations/<int:pk>/", employers.organisation_detail, name="organisation-detail"),
    path("employers/", employers.employers, name="employers"),
    path("employers/<int:pk>/", employers.employer_detail, name="employer-detail"),
    path("learner-detail/<str:kind>/<int:pk>/", learner_detail.learner_detail, name="learner-detail"),
    path("attendance/<str:kind>/<int:learner_id>/", attendance.learner_attendance, name="learner-attendance"),
    path("learners/<int:pk>/coach/", views.learner_coach, name="learner-coach"),
    # curriculum lookups for the training-plan builder
    path("curriculum/programmes/", curriculum.programmes, name="curriculum-programmes"),
    path("curriculum/cohorts/", curriculum.cohorts, name="curriculum-cohorts"),
    path("curriculum/groups/", curriculum.groups, name="curriculum-groups"),
    path("curriculum/modules/", curriculum.modules, name="curriculum-modules"),
    path("curriculum/weeks/", curriculum.weeks, name="curriculum-weeks"),
    path("curriculum/components/", curriculum.components, name="curriculum-components"),
    path("curriculum/ksb-profile/", curriculum.ksb_profile, name="curriculum-ksb-profile"),
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
    path("calendar/<str:kind>/<int:pk>/cancel/", calendar.learner_calendar_cancel, name="learner-calendar-cancel"),
    path("calendar/<str:kind>/<int:pk>/onboarding-reviews/", calendar.learner_onboarding_reviews, name="learner-onboarding-reviews"),
    # Declared before the <path:event_key> route below, which would otherwise
    # never be reached for the bare list URL.
    path("reviews/<str:kind>/<int:pk>/", review_form.enrolment_review_documents, name="enrolment-review-documents"),
    # Before the <path:event_key> route below, which is greedy and would
    # otherwise absorb the trailing "sign" into the event key.
    path("reviews/<str:kind>/<int:pk>/<str:event_key>/sign/", review_form.enrolment_review_sign, name="enrolment-review-sign"),
    # The enrolment review form. `path` matches an event key like
    # "eligibility-review:31:1:2026-08-03" (colons, no slashes) but not the
    # trailing segment, so <path:> is used to keep it intact.
    path("reviews/<str:kind>/<int:pk>/<path:event_key>/", review_form.enrolment_review_form, name="enrolment-review-form"),
    path("absence-reports/<str:kind>/<int:learner_id>/", absence_reports.learner_absence_reports, name="learner-absence-reports"),
    # learner evidence uploads (Azure Blob Storage backed)
    path("evidence/<str:kind>/<int:pk>/upload/", evidence.upload_evidence, name="evidence-upload"),
    path("evidence/<str:kind>/<int:pk>/", evidence.list_evidence, name="evidence-list"),
    path("evidence/<str:kind>/<int:pk>/<uuid:file_id>/download/", evidence.download_evidence, name="evidence-download"),
]
