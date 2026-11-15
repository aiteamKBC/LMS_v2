"""Static safety contracts for deleted Aptem-table replacement SQL."""

from pathlib import Path

from django.test import SimpleTestCase

from .aptem_identity import (
    ADMIN_EVIDENCE_IDENTITY_CTES,
    APTEM_IDENTITY_CTES,
    CURRENT_APTEM_IDENTITY_CTE,
)


class AptemIdentitySqlTests(SimpleTestCase):
    def test_current_identity_uses_normalized_learner_curriculum_and_coach(self):
        self.assertIn('FROM "Learner".learners', CURRENT_APTEM_IDENTITY_CTE)
        self.assertIn('curriculum.programmes', CURRENT_APTEM_IDENTITY_CTE)
        self.assertIn('curriculum.groups', CURRENT_APTEM_IDENTITY_CTE)
        self.assertIn('curriculum.coaches', CURRENT_APTEM_IDENTITY_CTE)
        self.assertIn('l.planned_hours', CURRENT_APTEM_IDENTITY_CTE)
        self.assertIn('l.target_hours', CURRENT_APTEM_IDENTITY_CTE)
        self.assertIn('l.completed_hours', CURRENT_APTEM_IDENTITY_CTE)

    def test_historical_rows_cannot_override_current_identity(self):
        self.assertIn('"Learner".aptem_historical_identities', APTEM_IDENTITY_CTES)
        self.assertIn('"LMS".non_active_users', APTEM_IDENTITY_CTES)
        self.assertIn('NOT EXISTS', APTEM_IDENTITY_CTES)

    def test_admin_eligibility_is_explicit(self):
        self.assertIn("('active', 'delivery')", ADMIN_EVIDENCE_IDENTITY_CTES)
        self.assertIn("= 'completed'", ADMIN_EVIDENCE_IDENTITY_CTES)

    def test_supported_runtime_files_do_not_name_deleted_tables(self):
        backend = Path(__file__).resolve().parents[1]
        files = [
            'learner_api/aptem_status.py',
            'learner_api/historical_evidence.py',
            'learner_api/legacy_assignments.py',
            'learner_api/management/commands/sync_aptem_learner_details.py',
            'login/admin_evidence.py',
            'audit_api/actual_hours/journal_hours.py',
            'audit_api/last_audit_ledger_views.py',
            'audit_api/learner_match_ledger_views.py',
            'audit_api/manual_ledger_views.py',
            'audit_api/management/commands/reconcile_monthly_logs.py',
            'audit_api/management/commands/sync_last_audit_aptem_learners.py',
            'manual_audit_api/plan_views.py',
            'manual_audit_api/plan_pickers.py',
            'manual_audit_api/match_ledger_views.py',
        ]
        for relative in files:
            with self.subTest(file=relative):
                source = (backend / relative).read_text(encoding='utf-8')
                self.assertNotIn('Aptem_users', source)

