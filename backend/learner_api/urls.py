from django.urls import path

from . import absence_reports, apprenticeship_agreement, attendance, calendar, components, curriculum, calendar_connections, employer_portal, employers, evidence, ilr_document, training_plan_document, written_agreement, learner_detail, learning_plan, lms_schema, media_proxy, module_shift, quizzes, reflection_ai, reflection_submissions, review_form, time_tracking, videos, views

urlpatterns = [
    path("tutor-learners/", views.tutor_learners, name="tutor-learners"),
    path("enrolment-users/", views.enrolment_users, name="enrolment-users"),
    path("enrolment-users/options/", views.enrolment_user_options, name="enrolment-user-options"),
    path("enrolment-users/<int:pk>/", views.enrolment_user_detail, name="enrolment-user-detail"),
    path("enrolment-users/<int:pk>/finish/", views.enrolment_user_finish, name="enrolment-user-finish"),
    # The learner's learning plan: their group's modules, editable within the
    # same programme. Offered once the learner reaches Delivery.
    path("learning-plan/<int:pk>/", learning_plan.learning_plan, name="learning-plan"),
    # The modules taught alongside one module — the alternatives a learner can be
    # shifted onto. The shift itself is a plan save, so it has no endpoint here.
    # "options/" before the <int:pk> route, which would otherwise never be
    # reached for it.
    path("module-shift/options/", module_shift.module_shift_options, name="module-shift-options"),
    path("module-shift/<int:pk>/", module_shift.module_shift, name="module-shift"),
    # The week-by-week pairing behind a shift's progress step: which of the
    # learner's completed components line up with the module they are joining.
    path(
        "module-shift/<int:pk>/progress/",
        module_shift.module_shift_progress,
        name="module-shift-progress",
    ),
    # The statutory Apprenticeship Agreement, filled from the learner's record,
    # their group's delivery window and their learning plan's total hours.
    path(
        "apprenticeship-agreement/<int:pk>/",
        apprenticeship_agreement.apprenticeship_agreement,
        name="apprenticeship-agreement",
    ),
    path(
        "apprenticeship-agreement/<int:pk>/issue/",
        apprenticeship_agreement.issue_agreement,
        name="apprenticeship-agreement-issue",
    ),
    path(
        "apprenticeship-agreement/<int:pk>/sign/",
        apprenticeship_agreement.sign_agreement,
        name="apprenticeship-agreement-sign",
    ),
    # The Individual Learner Record: signed by the learner and the provider.
    # Never shown to the employer.
    path("ilr-document/<int:pk>/", ilr_document.ilr_document, name="ilr-document"),
    path("ilr-document/<int:pk>/issue/", ilr_document.issue_ilr, name="ilr-document-issue"),
    path("ilr-document/<int:pk>/sign/", ilr_document.sign_ilr, name="ilr-document-sign"),
    # The tripartite Training Plan: signed by the apprentice, the employer and
    # the training provider.
    path("training-plan-document/<int:pk>/", training_plan_document.training_plan_document, name="training-plan-document"),
    path("training-plan-document/<int:pk>/issue/", training_plan_document.issue_training_plan, name="training-plan-document-issue"),
    path("training-plan-document/<int:pk>/sign/", training_plan_document.sign_training_plan, name="training-plan-document-sign"),
    # The Written Agreement: signed by the learner, employer and provider.
    path("written-agreement/<int:pk>/", written_agreement.written_agreement, name="written-agreement"),
    path("written-agreement/<int:pk>/issue/", written_agreement.issue_written_agreement, name="written-agreement-issue"),
    path("written-agreement/<int:pk>/sign/", written_agreement.sign_written_agreement, name="written-agreement-sign"),
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
    # The employer-facing portal: their learners, and the documents they must sign.
    # Declared before "employers/<int:pk>/" is irrelevant (different prefix), but
    # the signature route is declared before the learner route for clarity.
    path("employer-portal/<int:employer_id>/", employer_portal.employer_portal, name="employer-portal"),
    path(
        "employer-portal/<int:employer_id>/learner/<str:kind>/<int:learner_id>/",
        employer_portal.employer_portal_learner,
        name="employer-portal-learner",
    ),
    path(
        "employer-portal/<int:employer_id>/learner/<str:kind>/<int:learner_id>/plan/",
        employer_portal.employer_portal_learner_plan,
        name="employer-portal-learner-plan",
    ),
    path("employers/<int:pk>/", employers.employer_detail, name="employer-detail"),
    path("learner-detail/<str:kind>/<int:pk>/", learner_detail.learner_detail, name="learner-detail"),
    path("kbc-lms/all-students-schema/", lms_schema.all_students_schema, name="kbc-lms-all-students-schema"),
    path("media/google-drive/<str:file_id>/", media_proxy.google_drive_media, name="google-drive-media"),
    path("media/legacy-attachment/<str:attachment_id>/", media_proxy.legacy_attachment_media, name="legacy-attachment-media"),
    path("media/legacy-attachment/<str:attachment_id>/pdf-info/", media_proxy.legacy_attachment_pdf_info, name="legacy-attachment-pdf-info"),
    path("media/legacy-attachment/<str:attachment_id>/pdf-page/<int:page_number>/", media_proxy.legacy_attachment_pdf_page, name="legacy-attachment-pdf-page"),
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
    # Signed start time shared by quizzes and learning components.
    path("time-tracking/start/", time_tracking.start_time_tracking, name="time-tracking-start"),
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
    path("evidence/<str:kind>/<int:pk>/<uuid:file_id>/", evidence.delete_evidence, name="evidence-delete"),
]
