"""Programme-date writes on a verified disposable local PostgreSQL database."""

import json
import os
from datetime import date
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, connections

from coach_api.tests_support.transaction_cases import CoachTransactionTestCase
from learner_api.management.commands.sync_aptem_learner_details import Command
from learner_api.models import EnrolmentUser, LearnerProfile
from login.models import LoginAccount


class AptemDatesPostgresTests(CoachTransactionTestCase):
    def setUp(self):
        connection = connections["enrolment"]
        config = connection.settings_dict
        expected_directory = os.environ.get("APTEM_DETAIL_TEST_DATA_DIRECTORY")
        if (connection.vendor != "postgresql" or config["HOST"] != "127.0.0.1"
                or not str(config["NAME"]).startswith("test_lms_gate_ticket4_")
                or not expected_directory):
            raise RuntimeError("Use the verified local PostgreSQL feature runner.")
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),host(inet_server_addr()),current_setting('data_directory')")
            database, host, directory = cursor.fetchone()
            if (database != config["NAME"] or host != "127.0.0.1"
                    or Path(directory).resolve() != Path(expected_directory).resolve()):
                raise RuntimeError("The actual database does not match the verified disposable cluster.")
            cursor.execute('CREATE SCHEMA IF NOT EXISTS "LMS"')
            for table in ('"LMS"."Aptem_users"', '"LMS"."non_active_users"'):
                cursor.execute(f'''CREATE TABLE IF NOT EXISTS {table} (
                    "ID" bigint PRIMARY KEY, "FullName" text, "Program-Status" text,
                    "Start-Date" date, "End-Date" date
                )''')
        self.enrolments = []
        self.profiles = []
        self.addCleanup(self.clean_owned_rows)
        for index, kind, local_status in (
            (1, "commercial", "Delivery"), (2, "apprenticeship", "Withdrawn"),
            (3, "commercial", "Active"),
        ):
            learner = EnrolmentUser.all_learners.using("enrolment").create(
                username=f"Example Learner {index}", email=f"aptem-dates-{index}@example.invalid",
                aptem_id=str(901000 + index), learner_type=kind, programme_status=local_status,
                start_date="2023-01-01", end_date="2029-12-31", planned_hours="600",
                learner_start_date="2022-02-03", learner_end_date="2029-11-12",
                learning_plan={"preserve": True},
            )
            self.enrolments.append(learner)
            self.profiles.append(LearnerProfile.objects.using("enrolment").create(
                full_name=learner.username, email=learner.email, enrolment_id=learner.pk,
                aptem_id=901000 + index, learner_type=kind, programme_status=local_status,
                lifecycle_status=local_status.casefold(), completed_hours="12", planned_hours="600",
                start_date=date(2023, 1, 1), end_date=date(2029, 12, 31),
                learner_start_date="2022-02-03", learner_end_date="2029-11-12",
            ))
            table = '"LMS"."non_active_users"' if index == 2 else '"LMS"."Aptem_users"'
            status = "Withdrawn" if index == 2 else "Active"
            start, end = ((date(2024, 3, 4), date(2028, 5, 6)) if index == 2
                          else (date(2025, 1, 2), date(2027, 8, 30)))
            with connection.cursor() as cursor:
                cursor.execute(f'INSERT INTO {table} ("ID","FullName","Program-Status","Start-Date","End-Date") VALUES (%s,%s,%s,%s,%s)',
                               [901000 + index, learner.username, status, start, end])
        self.native = EnrolmentUser.all_learners.using("enrolment").create(
            username="Native Example", email="native-dates@example.invalid", aptem_id=None,
            start_date="2022-01-01", end_date="2026-12-31", programme_status="Delivery",
        )
        self.enrolments.append(self.native)
        # An external learner without any local account must never be imported.
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO "LMS"."Aptem_users" ("ID","FullName","Program-Status","Start-Date","End-Date") VALUES (%s,%s,%s,%s,%s)',
                           [901004, "External Only Example", "Active", date(2025, 1, 2), date(2027, 8, 30)])

    def clean_owned_rows(self):
        with connections["enrolment"].cursor() as cursor:
            for table in ('"LMS"."Aptem_users"', '"LMS"."non_active_users"'):
                cursor.execute(f'DELETE FROM {table} WHERE "ID"=ANY(%s)', [[901001, 901002, 901003, 901004]])
            cursor.execute('DELETE FROM "Learner".learners WHERE id=ANY(%s)',
                           [[row.pk for row in self.profiles]])
            cursor.execute('DELETE FROM enrolment."Created_users" WHERE id=ANY(%s)',
                           [[row.pk for row in self.enrolments]])

    def apply(self):
        output = StringIO()
        call_command("sync_aptem_learner_details", apply=True, all_rows=True, stdout=output)
        return json.loads(output.getvalue())

    def test_dates_update_existing_active_and_inactive_learners_and_repeat_without_writes(self):
        local_count = EnrolmentUser.all_learners.using("enrolment").count()
        profile_count = LearnerProfile.objects.using("enrolment").count()
        account_count = LoginAccount.objects.using("enrolment").count()
        report = self.apply()
        self.assertEqual(report["counts"]["changed"], 3)
        for index, (learner, profile) in enumerate(zip(self.enrolments, self.profiles), start=1):
            learner.refresh_from_db(using="enrolment")
            profile.refresh_from_db(using="enrolment")
            start, end = ((date(2024, 3, 4), date(2028, 5, 6)) if index == 2
                          else (date(2025, 1, 2), date(2027, 8, 30)))
            self.assertEqual((learner.start_date, learner.end_date), (start.isoformat(), end.isoformat()))
            self.assertEqual((profile.start_date, profile.end_date), (start, end))
            self.assertEqual(learner.learning_plan, {"preserve": True})
            self.assertEqual(learner.planned_hours, "600")
            self.assertEqual(float(profile.completed_hours), 12)
            self.assertEqual(float(profile.planned_hours), 600)
            self.assertEqual(learner.learner_start_date, "2022-02-03")
            self.assertEqual(profile.learner_end_date, "2029-11-12")
        self.assertEqual(self.enrolments[0].programme_status, "Delivery")
        self.native.refresh_from_db(using="enrolment")
        self.assertEqual((self.native.start_date, self.native.end_date), ("2022-01-01", "2026-12-31"))
        self.assertEqual(EnrolmentUser.all_learners.using("enrolment").count(), local_count)
        self.assertEqual(LearnerProfile.objects.using("enrolment").count(), profile_count)
        self.assertEqual(LoginAccount.objects.using("enrolment").count(), account_count)
        self.assertEqual(self.apply()["counts"].get("changed", 0), 0)

    def test_blank_imported_end_preserves_the_existing_end_on_both_records(self):
        with connections["enrolment"].cursor() as cursor:
            cursor.execute('UPDATE "LMS"."non_active_users" SET "End-Date"=NULL WHERE "ID"=901002')
        report = self.apply()
        learner, profile = self.enrolments[1], self.profiles[1]
        learner.refresh_from_db(using="enrolment")
        profile.refresh_from_db(using="enrolment")
        self.assertEqual(learner.start_date, "2024-03-04")
        self.assertEqual(profile.start_date, date(2024, 3, 4))
        self.assertEqual(learner.end_date, "2029-12-31")
        self.assertEqual(profile.end_date, date(2029, 12, 31))
        self.assertEqual(report["counts"]["preserved.missing_end_date"], 1)

    def test_explicit_existing_profile_link_supports_a_missing_enrolment_aptem_id(self):
        learner = self.enrolments[0]
        EnrolmentUser.all_learners.using("enrolment").filter(pk=learner.pk).update(aptem_id=None)
        report = self.apply()
        learner.refresh_from_db(using="enrolment")
        self.profiles[0].refresh_from_db(using="enrolment")
        self.assertIsNone(learner.aptem_id)
        self.assertEqual(learner.start_date, "2025-01-02")
        self.assertEqual(self.profiles[0].aptem_id, 901001)
        self.assertEqual(report["counts"]["profile_aptem_id_fallback"], 1)
        self.assertEqual(report["counts"]["without_trusted_aptem_id"], 1)

    def test_failure_after_grouped_writes_rolls_back_all_date_changes(self):
        original = Command._write_many

        def fail_after_writes(command, pending):
            original(command, pending)
            raise DatabaseError("Synthetic failure after grouped updates")

        output = StringIO()
        with patch.object(Command, "_write_many", fail_after_writes):
            with self.assertRaisesMessage(CommandError, "changes rolled back"):
                call_command("sync_aptem_learner_details", apply=True, all_rows=True, stdout=output)
        self.assertEqual(output.getvalue(), "")
        for learner, profile in zip(self.enrolments, self.profiles):
            learner.refresh_from_db(using="enrolment")
            profile.refresh_from_db(using="enrolment")
            self.assertEqual(learner.start_date, "2023-01-01")
            self.assertEqual(profile.start_date, date(2023, 1, 1))
