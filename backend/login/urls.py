"""URLs for the login app, mounted at /login_api/ (see config/urls.py)."""
from django.urls import path
from django.views.decorators.cache import never_cache
from . import safeguarding_sso
from . import inclusion_sso
from . import coach_directory
from . import lms_introduction

from . import admin_evidence, advanced_admin, advanced_admin_assignment_uploads, access_requests, microsoft_sso, platform_admin, saved_signature, views
from old_otjh.entry import entry_status


def restricted_path(route, view, *, name):
    """Keep scoped learner data out of shared and browser caches."""
    return path(route, never_cache(view), name=name)


urlpatterns = [
    restricted_path('advanced-admin/learners/<int:profile_id>/assignment-uploads/', advanced_admin_assignment_uploads.assignments, name='advanced-admin-assignment-uploads'),
    restricted_path('advanced-admin/learners/<int:profile_id>/assignment-uploads/<uuid:record_id>/open/', advanced_admin_assignment_uploads.assignment_document, name='advanced-admin-assignment-upload-document'),
    restricted_path('advanced-admin/learners/', advanced_admin.learners, name='advanced-admin-learners'),
    restricted_path('advanced-admin/learners/<int:profile_id>/', advanced_admin.learner_detail, name='advanced-admin-learner-detail'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/', advanced_admin.learner_learning, name='advanced-admin-learner-learning'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/wordpress-courses/', advanced_admin.learner_wordpress_courses, name='advanced-admin-learner-wordpress-courses'),
    restricted_path('advanced-admin/learners/<int:profile_id>/module-progress/', advanced_admin.learner_module_progress, name='advanced-admin-learner-module-progress'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/covers/<str:cover_key>/', advanced_admin.learner_cover, name='advanced-admin-learner-cover'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/material/<int:group_id>/<int:activity_id>/', advanced_admin.learner_material, name='advanced-admin-learner-material'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/quiz-review/<str:kind>/<int:group_id>/<int:activity_id>/', advanced_admin.learner_legacy_quiz_review, name='advanced-admin-learner-legacy-quiz-review'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/material/<int:group_id>/<int:activity_id>/media/<int:media_index>/', advanced_admin.learner_material_media, name='advanced-admin-learner-material-media'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/material/<int:group_id>/<int:activity_id>/source-file/', advanced_admin.learner_material_file, name='advanced-admin-learner-material-source-file'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/material/<int:group_id>/<int:activity_id>/files/<str:attachment_id>/', advanced_admin.learner_material_file, name='advanced-admin-learner-material-attachment'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/components/<str:component_id>/', advanced_admin.learner_component, name='advanced-admin-learner-component'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/components/<str:component_id>/quiz-review/', advanced_admin.learner_component_quiz_review, name='advanced-admin-learner-component-quiz-review'),
    restricted_path('advanced-admin/learners/<int:profile_id>/learning/components/<str:component_id>/files/<str:slot>/', advanced_admin.learner_component_file, name='advanced-admin-learner-component-file'),
    restricted_path('advanced-admin/learners/<int:profile_id>/attendance/', advanced_admin.learner_attendance, name='advanced-admin-learner-attendance'),
    restricted_path('advanced-admin/learners/<int:profile_id>/lecture-workspace/', advanced_admin.learner_lecture_workspace, name='advanced-admin-learner-lecture-workspace'),
    restricted_path('advanced-admin/learners/<int:profile_id>/enrolment/', advanced_admin.learner_enrolment, name='advanced-admin-learner-enrolment'),
    restricted_path('advanced-admin/learners/<int:profile_id>/compliance/', advanced_admin.learner_compliance, name='advanced-admin-learner-compliance'),
    restricted_path('advanced-admin/learners/<int:profile_id>/compliance/<uuid:document_id>/open/', advanced_admin.learner_compliance_file, name='advanced-admin-learner-compliance-file'),
    restricted_path('advanced-admin/learners/<int:profile_id>/messages/', advanced_admin.learner_messages, name='advanced-admin-learner-messages'),
    restricted_path('advanced-admin/learners/<int:profile_id>/monthly-logs/', advanced_admin.learner_monthly_logs, name='advanced-admin-learner-monthly-logs'),
    restricted_path('advanced-admin/learners/<int:profile_id>/evidence/', advanced_admin.learner_evidence, name='advanced-admin-learner-evidence'),
    restricted_path('advanced-admin/learners/<int:profile_id>/monthly-reports/', advanced_admin.learner_monthly_reports, name='advanced-admin-learner-monthly-reports'),
    restricted_path('advanced-admin/learners/<int:profile_id>/legacy-assignments/', advanced_admin.learner_legacy_assignments, name='advanced-admin-learner-legacy-assignments'),
    restricted_path('advanced-admin/learners/<int:profile_id>/audit-assignments/', advanced_admin.learner_audit_assignments, name='advanced-admin-learner-audit-assignments'),
    restricted_path('advanced-admin/learners/<int:profile_id>/audit-assignments/check/<int:record_id>/mark/', advanced_admin.learner_audit_assignment_source_mark, name='advanced-admin-learner-audit-assignment-source-mark'),
    restricted_path('advanced-admin/learners/<int:profile_id>/audit-assignments/evidence/<int:evidence_id>/mark/', advanced_admin.learner_audit_assignment_mark, name='advanced-admin-learner-audit-assignment-mark'),
    restricted_path('advanced-admin/learners/<int:profile_id>/audit-assignments/evidence/<int:evidence_id>/<str:part>/open/', advanced_admin.learner_audit_assignment_document, name='advanced-admin-learner-audit-assignment-document'),
    restricted_path('advanced-admin/learners/<int:profile_id>/legacy-assignments/<int:evidence_id>/mark/', advanced_admin.learner_legacy_marking, name='advanced-admin-learner-legacy-marking'),
    restricted_path('advanced-admin/learners/<int:profile_id>/legacy-assignments/<int:evidence_id>/<str:part>/open/', advanced_admin.learner_legacy_assignment_document, name='advanced-admin-learner-legacy-assignment-document'),
    restricted_path('advanced-admin/learners/<int:profile_id>/evidence/<uuid:file_id>/download/', advanced_admin.learner_evidence_download, name='advanced-admin-learner-evidence-download'),
    restricted_path('advanced-admin/learners/<int:profile_id>/inclusion/', advanced_admin.learner_inclusion, name='advanced-admin-learner-inclusion'),
    restricted_path('advanced-admin/learners/<int:profile_id>/inclusion/reports/<uuid:report_id>/pdf/', advanced_admin.learner_inclusion_report_pdf, name='advanced-admin-learner-inclusion-report-pdf'),
    restricted_path('advanced-admin/learners/<int:profile_id>/quality/', advanced_admin.learner_quality, name='advanced-admin-learner-quality'),
    restricted_path('advanced-admin/learners/<int:profile_id>/reviews/', advanced_admin.learner_reviews, name='advanced-admin-learner-reviews'),
    restricted_path('advanced-admin/learners/<int:profile_id>/coaching-sessions/', advanced_admin.learner_coaching_sessions, name='advanced-admin-learner-coaching-sessions'),
    restricted_path('advanced-admin/learners/<int:profile_id>/coaching-reviews/', advanced_admin.learner_coaching_reviews, name='advanced-admin-learner-coaching-reviews'),
    restricted_path('advanced-admin/learners/<int:profile_id>/coaching-sessions/<uuid:session_id>/', advanced_admin.learner_coaching_session_detail, name='advanced-admin-learner-coaching-session-detail'),
    restricted_path('advanced-admin/learners/<int:profile_id>/eligibility/', advanced_admin.learner_eligibility, name='advanced-admin-learner-eligibility'),
    restricted_path('advanced-admin/learners/<int:profile_id>/eligibility/<str:event_key>/form/', advanced_admin.learner_eligibility_form, name='advanced-admin-learner-eligibility-form'),
    restricted_path('advanced-admin/learners/<int:profile_id>/reviews/<str:aptem_review_id>/pdf/', advanced_admin.learner_review_pdf, name='advanced-admin-learner-review-pdf'),
    restricted_path('advanced-admin/learners/<int:profile_id>/reviews/<str:aptem_review_id>/original-pdf/', advanced_admin.learner_original_review_pdf, name='advanced-admin-learner-original-review-pdf'),
    restricted_path('advanced-admin/learners/<int:profile_id>/reviews/<str:aptem_review_id>/pdf-signatures/', advanced_admin.learner_review_pdf_signatures, name='advanced-admin-learner-review-pdf-signatures'),
    restricted_path('advanced-admin/csrf/', advanced_admin.csrf_token, name='advanced-admin-csrf'),
    restricted_path('advanced-admin/learners/<int:profile_id>/submissions/', advanced_admin.learner_submissions, name='advanced-admin-learner-submissions'),
    restricted_path('advanced-admin/learners/<int:profile_id>/submissions/<uuid:submission_id>/', advanced_admin.learner_submissions, name='advanced-admin-learner-submission'),
    path("inclusion/authorize/", inclusion_sso.authorize, name="inclusion-authorize"),
    path('public/coaches/<slug:slug>/', coach_directory.public_coach, name='public-coach-booking'),
    path('public/lms-introduction/', lms_introduction.public_request, name='public-lms-introduction'),
    path('admin/coach-directory/', coach_directory.directory, name='admin-coach-directory'),
    path('admin/coach-directory/<int:pk>/', coach_directory.directory, name='admin-coach-directory-item'),
    path("safeguarding/authorize/", safeguarding_sso.authorize, name="safeguarding-authorize"),
    path("health/", views.health, name="login-health"),

    # --- session ---
    path("login/", views.login, name="login"),
    path("logout/", views.logout, name="logout"),
    path("me/", views.me, name="login-me"),
    # The signed-in person's own saved signature, offered wherever they sign.
    path("me/signature/", saved_signature.my_signature, name="login-my-signature"),
    path("learner-entry/", entry_status, name="learner-entry"),

    # --- sign in with Microsoft (see microsoft_sso.py) ---
    path("microsoft/start/", microsoft_sso.start, name="login-microsoft-start"),
    path("microsoft/callback/", microsoft_sso.callback, name="login-microsoft-callback"),

    # --- password management ---
    path("change-password/", views.change_password, name="login-change-password"),
    path("forgot-password/", views.forgot_password, name="login-forgot-password"),
    path("reset/", views.reset_info, name="login-reset-info"),
    path("reset-password/", views.reset_password, name="login-reset-password"),

    # --- invitations ---
    path("invitation/", views.invitation_info, name="login-invitation-info"),
    path("accept-invitation/", views.accept_invitation_view, name="login-accept-invitation"),
    path("accounts/invite/", views.invite_account, name="login-invite-account"),
    path("accounts/invitation-link/", views.invitation_link_view, name="login-invitation-link"),

    # --- a signed-in account with no access grant asking for one ---
    path("request-access/", access_requests.request_access, name="login-request-access"),

    # --- super admin console (admin role only, see platform_admin.py) ---
    path("admin/overview/", platform_admin.overview, name="admin-overview"),
    # ?metric=<key> — the records behind one platform-report figure.
    path("admin/report-drill/", platform_admin.report_drill, name="admin-report-drill"),
    path("admin/accounts/", platform_admin.accounts, name="admin-accounts"),
    path("admin/accounts/<int:pk>/", platform_admin.account_action, name="admin-account-action"),
    path("admin/audit/", platform_admin.audit, name="admin-audit"),
    path("admin/roles/", platform_admin.roles, name="admin-roles"),
    path("admin/email-log/", platform_admin.email_log, name="admin-email-log"),
    # kind is "invitation" or "reset" — the two tables the log merges.
    path(
        "admin/email-log/<str:kind>/<int:pk>/acknowledge/",
        platform_admin.email_acknowledge,
        name="admin-email-acknowledge",
    ),
    path("admin/system/", platform_admin.system, name="admin-system"),
    path("admin/documents/", platform_admin.documents, name="admin-documents"),
    path("admin/curriculum/", platform_admin.curriculum, name="admin-curriculum"),
    path(
        "admin/evidence/classified-learners/",
        admin_evidence.classified_learners,
        name="admin-evidence-classified-learners",
    ),
    path(
        "admin/evidence/classified-learners/<int:learner_id>/assignments/",
        admin_evidence.learner_assignments,
        name="admin-evidence-learner-assignments",
    ),
    path(
        "admin/evidence/classified-learners/<int:learner_id>/evidence/<int:evidence_id>/open/",
        admin_evidence.open_evidence_document,
        name="admin-evidence-document-open",
    ),
    path(
        "admin/evidence/classified-learners/<int:learner_id>/evidence/<int:evidence_id>/text/",
        admin_evidence.evidence_text_preview,
        name="admin-evidence-document-text",
    ),
    path(
        "admin/evidence/classified-learners/<int:learner_id>/evidence/<int:evidence_id>/selection/",
        admin_evidence.select_assignment,
        name="admin-evidence-assignment-selection",
    ),
    path(
        "admin/evidence/classified-learners/<int:learner_id>/evidence/<int:evidence_id>/ksb-codes/",
        admin_evidence.update_ksb_codes,
        name="admin-evidence-ksb-codes",
    ),
    path(
        "admin/evidence/classified-learners/<int:learner_id>/evidence/<int:evidence_id>/report-form/",
        admin_evidence.report_form,
        name="admin-evidence-report-form",
    ),
    path(
        "admin/evidence/classified-learners/<int:learner_id>/evidence/<int:evidence_id>/report-form/save/",
        admin_evidence.save_report_form,
        name="admin-evidence-report-form-save",
    ),
    path("admin/certificate-template/", platform_admin.certificate_template, name="admin-certificate-template"),
]
