from django.urls import path

from .contract_documents import archive_contract, rename_contract, upload_contract
from .document_views import audit_blob, contract_file, evidence_file
from .evidence_documents import archive_evidence, update_evidence_date, upload_evidence
from .ledger_views import (
    activities as ledger_activities,
    activity as ledger_activity,
    attendance_sheet as ledger_attendance_sheet,
    cohort as ledger_cohort,
    health as ledger_health,
    quiz_attempt as ledger_quiz_attempt,
)
from .match_ledger_views import (
    activity_annotation,
    activity_overrides,
    health as match_health,
    learner_hours,
    learner_profile,
    learner_profile_dates,
    save_activity_annotation,
)
from .plan_pickers import (
    picker_assignment_evidence,
    picker_assignments,
    picker_attendance_grid,
    picker_attendance_modules,
    picker_attendance_sessions,
    picker_group_activities,
    picker_ksbs,
    picker_lms_groups,
    picker_materials,
)
from .plan_views import (
    plan_activities,
    plan_group_detail,
    plan_group_members,
    plan_group_months,
    plan_groups,
    plan_matrix,
    plan_progress,
    plan_progress_bulk,
    plan_suggest_members,
)
from .signoff_views import learner_signoff


urlpatterns = [
    # Read feed over the Manual_audit mirror (same contract as the automatic
    # workspace's Last_audit ledger, so the cloned UI consumes it unchanged).
    path("ledger/health", ledger_health, name="manual-ledger-health"),
    path("ledger/cohort/", ledger_cohort, name="manual-ledger-cohort"),
    path("ledger/activities/", ledger_activities, name="manual-ledger-activities"),
    path("ledger/activity/", ledger_activity, name="manual-ledger-activity"),
    path("ledger/quiz-attempt/", ledger_quiz_attempt, name="manual-ledger-quiz-attempt"),
    path("ledger/attendance-sheet/", ledger_attendance_sheet, name="manual-ledger-attendance-sheet"),
    # Auditor-entered data (annotations, overlays, learner profile).
    path("match-ledger/health", match_health, name="manual-match-ledger-health"),
    path("match-ledger/activity-annotation", activity_annotation, name="manual-activity-annotation"),
    path("match-ledger/activity-annotation/save", save_activity_annotation, name="manual-activity-annotation-save"),
    path("match-ledger/activity-overrides", activity_overrides, name="manual-activity-overrides"),
    path("match-ledger/learner-hours", learner_hours, name="manual-learner-hours"),
    path("match-ledger/learner-profile", learner_profile, name="manual-learner-profile"),
    path("match-ledger/learner-profile-dates", learner_profile_dates, name="manual-learner-profile-dates"),
    # Plan builder (groups, months, members, activities, progress).
    path("plan/groups", plan_groups, name="manual-plan-groups"),
    path("plan/groups/<int:group_id>", plan_group_detail, name="manual-plan-group"),
    path("plan/groups/<int:group_id>/members", plan_group_members, name="manual-plan-members"),
    path("plan/groups/<int:group_id>/months", plan_group_months, name="manual-plan-months"),
    path("plan/groups/<int:group_id>/suggest-members", plan_suggest_members, name="manual-plan-suggest-members"),
    path("plan/groups/<int:group_id>/matrix", plan_matrix, name="manual-plan-matrix"),
    path("plan/activities", plan_activities, name="manual-plan-activities"),
    path("plan/progress", plan_progress, name="manual-plan-progress"),
    path("plan/progress/bulk", plan_progress_bulk, name="manual-plan-progress-bulk"),
    # Plan builder pickers (select from the group's own data).
    path("plan/pickers/attendance-sessions", picker_attendance_sessions, name="manual-plan-picker-attendance"),
    path("plan/pickers/attendance-grid", picker_attendance_grid, name="manual-plan-picker-attendance-grid"),
    path("plan/pickers/attendance-modules", picker_attendance_modules, name="manual-plan-picker-attendance-modules"),
    path("plan/pickers/materials", picker_materials, name="manual-plan-picker-materials"),
    path("plan/pickers/assignments", picker_assignments, name="manual-plan-picker-assignments"),
    path("plan/pickers/assignment-evidence", picker_assignment_evidence, name="manual-plan-picker-assignment-evidence"),
    path("plan/pickers/ksbs", picker_ksbs, name="manual-plan-picker-ksbs"),
    path("plan/pickers/lms-groups", picker_lms_groups, name="manual-plan-picker-lms-groups"),
    path("plan/pickers/group-activities", picker_group_activities, name="manual-plan-picker-group-activities"),
    # Monthly journal sign-off.
    path("learners/<str:learner_id>/signoff/", learner_signoff, name="manual-learner-signoff"),
    # Contract / evidence documents (manual-owned writes).
    path("contracts/upload", upload_contract, name="manual-contract-upload"),
    path("contracts/<str:contract_id>/open", contract_file, name="manual-contract-file"),
    path("contracts/<str:contract_id>/archive", archive_contract, name="manual-contract-archive"),
    path("contracts/<str:contract_id>/name", rename_contract, name="manual-contract-name"),
    path("evidence/upload", upload_evidence, name="manual-evidence-upload"),
    path("evidence/<str:evidence_id>/open", evidence_file, name="manual-evidence-file"),
    path("evidence/<str:evidence_id>/date", update_evidence_date, name="manual-evidence-date"),
    path("evidence/<str:evidence_id>/archive", archive_evidence, name="manual-evidence-archive"),
    path("blob/", audit_blob, name="manual-audit-blob"),
]
