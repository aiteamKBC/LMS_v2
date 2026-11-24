from unittest.mock import patch

from django.test import SimpleTestCase

from . import records


class EvidenceRecordRegistrationTests(SimpleTestCase):
    def test_evidence_audit_uses_only_the_canonical_owner(self):
        registrations = []

        with patch.object(records, "register", side_effect=lambda table, **config: registrations.append((table, config))), \
             patch.object(records, "register_model"):
            records.register_learner_records()

        _, config = next(item for item in registrations if item[0] == "evidence_files")
        self.assertEqual(config["parent"], "learner_profile_id")
        self.assertIn("learner_profile_id", config["columns"])
        self.assertNotIn("created_user_id", config["columns"])
