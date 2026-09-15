"""Exercise import commits and rollbacks against isolated in-memory SQLite.

Run with --settings=config.settings_sqlite_test. This suite owns its connection
and creates only temporary model tables; it never opens a configured database.
"""
import json
from contextlib import ExitStack
from io import BytesIO
from types import SimpleNamespace
from unittest import TestCase, skipUnless
from unittest.mock import patch

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections
from django.db.utils import ConnectionHandler
from django.test import RequestFactory
from openpyxl import Workbook

from login.models import LoginAccount
from . import learner_import
from .models import EnrolmentUser, LearnerProfile


@skipUnless(getattr(settings, "USE_SQLITE_FOR_TESTS", False), "Requires isolated SQLite test settings.")
class LearnerImportTransactionTests(TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        config = {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        handler = ConnectionHandler({"default": dict(config), "enrolment": dict(config)})
        self.database = handler["enrolment"]
        self.stack.callback(self.database.close)
        self.stack.enter_context(patch.object(connections._connections, "enrolment", self.database, create=True))
        for model, table in ((EnrolmentUser, "import_students"),
                             (LoginAccount, "import_accounts"),
                             (LearnerProfile, "import_profiles")):
            self.stack.enter_context(patch.object(model._meta, "db_table", table))
        with self.database.schema_editor() as editor:
            editor.create_model(EnrolmentUser)
            editor.create_model(LoginAccount)
        # Duplicate detection projects only email from the delivery profile.
        with self.database.cursor() as cursor:
            cursor.execute('CREATE TABLE import_profiles (id INTEGER PRIMARY KEY, email TEXT)')
            cursor.execute('CREATE UNIQUE INDEX import_account_email ON import_accounts ("Subject_type", lower("Email"))')
        self.actor = SimpleNamespace(role="staff", email="officer@example.test", is_active=True)
        self.stack.enter_context(patch("login.permissions.authenticate_request", return_value=self.actor))
        self.stack.enter_context(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))
        self.stack.enter_context(patch.object(learner_import, "load_references", return_value={
            "programmes": [], "cohorts": [], "groups": [], "employers": [], "owners": [],
        }))
        self.send_email = self.stack.enter_context(patch("login.services.send_invitation"))

    def upload(self, *, dry_run=False):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Students"
        sheet.append(["First name", "Surname", "Email"])
        sheet.append(["First", "Learner", "first@example.test"])
        sheet.append(["Second", "Learner", "second@example.test"])
        content = BytesIO()
        workbook.save(content)
        workbook.close()
        request = RequestFactory().post(
            "/learner_api/enrolment-users/import/",
            {"file": SimpleUploadedFile("students.xlsx", content.getvalue()),
             "dryRun": str(dry_run).lower()},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        request.login_account = self.actor
        response = learner_import.import_students(request)
        return response.status_code, json.loads(response.content)

    def test_preview_does_not_create_students_or_accounts(self):
        status, body = self.upload(dry_run=True)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["count"], 2)
        self.assertEqual(body["imported"], 0)
        self.assertEqual(EnrolmentUser.all_learners.count(), 0)
        self.assertEqual(LoginAccount.objects.count(), 0)
        self.send_email.assert_not_called()

    def test_commit_creates_linked_commercial_learners_without_email(self):
        status, body = self.upload()
        self.assertEqual(status, 201, body)
        self.assertEqual(body["imported"], 2)
        learners = list(EnrolmentUser.all_learners.order_by("email"))
        self.assertEqual(len(learners), 2)
        self.assertNotEqual(learners[0].uuid, learners[1].uuid)
        for learner in learners:
            self.assertEqual(learner.learner_type, "commercial")
            self.assertEqual(learner.programme_status, "Delivery")
            self.assertEqual(learner.status, "FullUser")
            self.assertEqual(learner.type, "User")
            self.assertTrue(learner.invite_to_platform)
            account = LoginAccount.objects.get(subject_type="learner", subject_id=learner.pk)
            self.assertEqual(account.email, learner.email)
            self.assertEqual(account.role, "learner")
            self.assertEqual(account.password_hash, "")
        self.assertTrue(all(row["invitation"]["awaitingInvitation"] for row in body["results"]))
        self.send_email.assert_not_called()

    def test_second_account_database_failure_rolls_back_entire_batch(self):
        existing = EnrolmentUser.all_learners.create(username="Existing", email="existing@example.test")
        with self.database.cursor() as cursor:
            cursor.execute('''CREATE TRIGGER reject_second_account
                BEFORE INSERT ON import_accounts
                WHEN NEW."Email" = 'second@example.test'
                BEGIN SELECT RAISE(ABORT, 'Injected account failure'); END''')
        with self.assertLogs("login", level="ERROR"):
            status, body = self.upload()
        self.assertEqual(status, 400, body)
        self.assertEqual(body["imported"], 0)
        self.assertEqual(list(EnrolmentUser.all_learners.values_list("pk", flat=True)), [existing.pk])
        self.assertEqual(LoginAccount.objects.count(), 0)
        self.assertFalse(self.database.in_atomic_block)
        self.send_email.assert_not_called()

    def test_reupload_rejects_duplicates_without_creating_extra_rows(self):
        self.assertEqual(self.upload()[0], 201)
        status, body = self.upload()
        self.assertEqual(status, 400, body)
        self.assertEqual(body["imported"], 0)
        self.assertEqual(len(body["errors"]), 2)
        self.assertEqual(EnrolmentUser.all_learners.count(), 2)
        self.assertEqual(LoginAccount.objects.count(), 2)
        self.send_email.assert_not_called()
