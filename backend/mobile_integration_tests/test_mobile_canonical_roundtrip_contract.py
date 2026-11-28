"""Source-linked mobile -> canonical writer -> saved-row -> mobile contracts.

The real maintained audio/video/quiz views, quiz grader, signed timing and
mobile progress projector execute here. A fresh in-memory SQLite repository
replaces ONLY the canonical ``save_progress_record`` persistence boundary and
profile reads. Identity, curriculum, working-hours and provider dependencies
are isolated fixtures. This is not a production ORM/migration/HTTP test.

In particular, the full canonical saver requires the learner/KSB/quiz-answer
model graph, curriculum snapshots, completed-hours recalculation and Engagement
post-commit hooks. Importing production settings merely to exercise that graph
would be unsafe. The six writer tests need no network or credentials. The
separate opt-in SQL test uses an explicitly supplied loopback-only fixture.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

import test_mobile_contract as base
from django.test import override_settings


SOURCE_ROOT = Path(__file__).resolve().parent.parent
PACKAGE = "_mobile_canonical_roundtrip"
RISK = "MOD-SYNTHETIC-RISK"
SP = "MOD-SYNTHETIC-SP"


def source_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, SOURCE_ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def fixture(name, **members):
    module = types.ModuleType(name)
    module.__dict__.update(members)
    sys.modules[name] = module
    return module


class CanonicalRepository:
    """Independent transactional persistence fixture, not a mocked writer."""

    def __init__(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.execute("""CREATE TABLE progress_rows (
            id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL,
            source_id INTEGER NOT NULL, kind TEXT NOT NULL,
            session_id TEXT UNIQUE NOT NULL, record TEXT NOT NULL,
            activity TEXT NOT NULL)""")

    def save(self, profile, record, activity):
        with self.connection:
            self.connection.execute(
                "INSERT INTO progress_rows(profile_id,source_id,kind,session_id,record,activity) VALUES(?,?,?,?,?,?)",
                (profile.pk, profile.enrolment_id, record["kind"],
                 record["timeTrackingSessionId"], json.dumps(record), json.dumps(activity)),
            )

    def read(self, profile_id):
        return [json.loads(row[0]) for row in self.connection.execute(
            "SELECT record FROM progress_rows WHERE profile_id=? ORDER BY id", (profile_id,))]

    def used(self, session_id):
        return self.connection.execute(
            "SELECT 1 FROM progress_rows WHERE session_id=?", (session_id,)).fetchone() is not None


class FixtureProfile:
    def __init__(self, repository, identity, source_id):
        self.repository = repository
        self.pk = self.id = identity
        self.enrolment_id = source_id
        self.lifecycle_status = "active"

    @property
    def training_plan_progress(self):
        return self.repository.read(self.pk)


class ProfileSelection(list):
    def only(self, *fields):
        return self

    def exists(self):
        return bool(self)


class CanonicalRoundTripTests(unittest.TestCase):
    request = base.MobileFacadeTests.request

    def setUp(self):
        base.MobileFacadeTests.setUp(self)
        settings_patch = override_settings(USE_TZ=True)
        settings_patch.enable()
        self.addCleanup(settings_patch.disable)
        self.repo = CanonicalRepository()
        self.addCleanup(self.repo.connection.close)
        module_patch = patch.dict(sys.modules)
        module_patch.start()
        self.addCleanup(module_patch.stop)
        package = fixture(PACKAGE)
        package.__path__ = [str(SOURCE_ROOT / "learner_api")]
        quiz_package = fixture("quiz_api")
        quiz_package.__path__ = [str(SOURCE_ROOT / "quiz_api")]

        self.sources = {
            501: SimpleNamespace(pk=501, learner_type="apprenticeship", username="Synthetic A", programme="Test"),
            502: SimpleNamespace(pk=502, learner_type="commercial", username="Synthetic B", programme="Test"),
        }
        self.profiles = {source_id: FixtureProfile(self.repo, source_id + 490, source_id)
                         for source_id in self.sources}
        self.source = self.sources[501]
        self.profile = self.profiles[501]
        self.plans = {501: [{"moduleId": RISK, "moduleTitle": "Risk"}],
                      502: [{"moduleId": SP, "moduleTitle": "Scheduling"}]}
        self.content = {
            501: [self.media("RISK-AUDIO", "podcast", "audioUrl", RISK),
                  self.media("RISK-VIDEO", "video", "videoUrl", RISK),
                  self.quiz_activity("RISK-QUIZ", RISK, 77),
                  self.quiz_activity(None, RISK, 88)],
            502: [self.media("SP-AUDIO", "reading", "audioUrl", SP)],
        }
        self.quiz_data = {qid: self.quiz_fixture(qid) for qid in (77, 88)}

        def source_get(*, pk):
            return self.sources[int(pk)]

        def profile_filter(**filters):
            return ProfileSelection(p for p in self.profiles.values()
                if all(getattr(p, key) == value for key, value in filters.items()))

        base.Source.all_learners.get.side_effect = source_get
        previous_profile_filter = base.Profile.objects.filter.side_effect
        base.Profile.objects.filter.side_effect = profile_filter
        self.addCleanup(setattr, base.Profile.objects.filter, "side_effect", previous_profile_filter)
        source_model = type("CanonicalSource", (), {"objects": SimpleNamespace(get=source_get),
                                                     "DoesNotExist": base.Source.DoesNotExist})
        fixture(PACKAGE + ".models", CommercialUser=source_model, EnrolmentUser=source_model)
        fixture(PACKAGE + ".identity", learner_profile_for_source=lambda source, learner_id, **kwargs:
                self.profiles[source.pk] if int(learner_id) == source.pk else None)
        fixture(PACKAGE + ".active_users", ComponentReferenceError=ValueError,
                save_progress_record=self.repo.save, sync_active_user=lambda source: self.profiles[source.pk])
        fixture(PACKAGE + ".working_hours_holidays", is_working_hours_holiday=lambda day: False)
        fixture(PACKAGE + ".working_rules", DeclaredCompletionError=ValueError,
                resolve_completion_instants=lambda *args, **kwargs: (None, None),
                validation_response_payload=lambda error: {"error": str(error)})
        fixture(PACKAGE + ".marking_queue_entry", requires_tutor_validation=lambda cid: False,
                queue_for_marking=Mock(side_effect=AssertionError("No provider/marking writes in this fixture")))
        fixture(PACKAGE + ".assignment_topics", topic_id=lambda value: "" if value is None else value)
        permission_patch = patch.object(sys.modules["login.permissions"], "learner_self_or_admin",
                                        lambda **kwargs: lambda view: view, create=True)
        permission_patch.start()
        self.addCleanup(permission_patch.stop)
        self.timer = source_module(PACKAGE + ".time_tracking", "learner_api/time_tracking.py")
        self.timer.tracking_session_already_used = self.repo.used
        self.audio_writer = source_module(PACKAGE + ".components", "learner_api/components.py")
        self.audio_writer.component_ksb_codes = lambda cid: ["K1"]
        self.audio_writer._component_meta = lambda cid: ("podcast", "Synthetic recording")
        self.video_writer = source_module(PACKAGE + ".videos", "learner_api/videos.py")
        self.quiz_writer = source_module(PACKAGE + ".quizzes", "learner_api/quizzes.py")
        self.quiz_writer._fetch_quiz = lambda qid: copy.deepcopy(self.quiz_data.get(qid))
        self.quiz_writer.record_quiz_attempt = Mock()
        sys.modules.update({"learner_api.time_tracking": self.timer,
                            "learner_api.components": self.audio_writer,
                            "learner_api.videos": self.video_writer,
                            "learner_api.quizzes": self.quiz_writer})
        base.mobile.build_learner_detail.side_effect = self.read_detail
        self.addCleanup(setattr, base.mobile.build_learner_detail, "side_effect", None)
        plan_patch = patch.object(base.mobile, "effective_training_plan", lambda source: self.plans[source.pk])
        plan_patch.start()
        self.addCleanup(plan_patch.stop)
        eligibility_patch = patch.object(base.mobile, "_published_choice_quiz_ids",
                                         lambda ids: set(ids).intersection(self.quiz_data))
        eligibility_patch.start()
        self.addCleanup(eligibility_patch.stop)
        presentation_patch = patch.object(base.mobile, "_presentation_metadata", lambda rows: {})
        presentation_patch.start()
        self.addCleanup(presentation_patch.stop)

    @staticmethod
    def media(cid, kind, media_key, module):
        return {"componentId": cid, "moduleId": module, "weekId": module + "-W1",
                "module": module, "week": "Week 1", "component": cid, "type": kind,
                media_key: "https://example.invalid/fixture-media", "ksbMappings": [{"code": "K1"}]}

    @staticmethod
    def quiz_activity(cid, module, quiz_id):
        return {"componentId": cid, "moduleId": module, "weekId": module + "-W1",
                "module": module, "week": "Week 1", "component": "Synthetic MCQ",
                "type": "quiz", "isQuiz": True, "quizMeta": {"quizId": quiz_id, "questions": 1}}

    @staticmethod
    def quiz_fixture(qid):
        return {"id": qid, "title": "Synthetic MCQ", "module": "Risk", "programme": "Test",
                "weekId": RISK + "-W1", "duration": 5, "timeUnit": "minutes",
                "passingGrade": 70, "randomizeQuestions": False, "randomizeAnswers": False,
                "questions": [{"id": 10, "text": "Which answer is correct?", "type": "single_choice",
                               "points": 1, "sortOrder": 1, "explanation": "Fixture", "imageUrl": "",
                               "answers": [{"id": 12, "text": "Correct", "isCorrect": True, "sortOrder": 1},
                                           {"id": 13, "text": "Incorrect", "isCorrect": False, "sortOrder": 2}]}]}

    def read_detail(self, source, learner_id, **kwargs):
        self.assertEqual(source.pk, learner_id)
        rows = self.repo.read(self.profiles[source.pk].pk)
        content = copy.deepcopy(self.content[source.pk])
        module = self.plans[source.pk][0]["moduleId"]
        return {"components": content, "week": [{"moduleId": module, "weekId": module + "-W1", "module": module}],
                "modules": [module], "learningAccess": {"blocked": False},
                "componentProgress": [r for r in rows if r["kind"] == "component"],
                "videoProgress": [r for r in rows if r["kind"] == "video"],
                "quizAttempts": [r for r in rows if r["kind"] == "quiz"], "componentMarkingStatus": {}}

    def start(self, component_id, mode):
        # Execute the real timing view through the facade with a synthetic
        # sixty-second history; signing, identity binding and caps remain real.
        began = datetime.now(timezone.utc) - timedelta(seconds=60)
        with patch.object(self.timer.timezone, "now", return_value=began):
            response = base.mobile.start_learning_session(self.request("POST", {"componentId": component_id, "mode": mode}))
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)

    def finish(self, component_id, mode, *, answers=None, token=None):
        session = token or self.start(component_id, mode)
        payload = {"trackingToken": session["trackingToken"], "timeTakenSeconds": 999,
                   "feedback": "Synthetic reflection"}
        if answers is not None:
            payload["answers"] = answers
        view = {"audio": base.mobile.complete_component, "video": base.mobile.complete_video,
                "quiz": base.mobile.submit_quiz}[mode]
        return view(self.request("POST", payload), component_id), session

    def progress(self):
        response = base.mobile.progress(self.request())
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)

    def test_non_pmp_audio_video_quiz_use_actual_writers_and_saved_readback(self):
        for cid, mode in (("RISK-AUDIO", "audio"), ("RISK-VIDEO", "video"), ("RISK-QUIZ", "quiz")):
            result, _ = self.finish(cid, mode, answers={"10": 12} if mode == "quiz" else None)
            self.assertEqual(result.status_code, 200, result.content)
        rows = self.repo.read(991)
        self.assertEqual([row["kind"] for row in rows], ["component", "video", "quiz"])
        self.assertEqual([row.get("componentId") for row in rows], ["RISK-AUDIO", "RISK-VIDEO", None])
        self.assertEqual(rows[2]["quizId"], 77)
        self.assertEqual((rows[2]["passed"], rows[2]["grade"], rows[2]["achievedScore"]), (True, 1.0, 1))
        self.assertTrue(all(59 <= row["verifiedSeconds"] <= 62 for row in rows))
        self.assertTrue(all(row["claimedSeconds"] < 999 for row in rows))
        self.assertEqual(self.repo.connection.execute("SELECT DISTINCT profile_id,source_id FROM progress_rows").fetchall(), [(991, 501)])
        result = self.progress()
        self.assertEqual(result["moduleId"], RISK)
        self.assertEqual(set(result["completedComponentIds"]), {"RISK-AUDIO", "RISK-VIDEO", "RISK-QUIZ"})
        for key, row in zip(("componentProgress", "videoProgress", "quizAttempts"), rows):
            self.assertEqual(result[key], [row])

    def test_standalone_quiz_saves_canonical_quiz_not_mobile_id(self):
        catalogue = base.mobile.catalogue(self.request())
        self.assertEqual(catalogue.status_code, 200, catalogue.content)
        item = next(row for row in json.loads(catalogue.content)["components"] if (row.get("quizMeta") or {}).get("quizId") == 88)
        self.assertTrue(item["componentId"].startswith("mobile-quiz-"))
        result, session = self.finish(item["componentId"], "quiz", answers={"10": 12})
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(session["activityId"], "88")
        record = self.repo.read(991)[0]
        self.assertEqual(record["quizId"], 88)
        self.assertNotIn("componentId", record)
        self.assertEqual(self.progress()["completedComponentIds"], [item["componentId"]])

    def test_wrong_quiz_answer_is_actually_graded_and_does_not_complete(self):
        result, _ = self.finish("RISK-QUIZ", "quiz", answers={"10": 13})
        self.assertEqual(result.status_code, 200, result.content)
        record = self.repo.read(991)[0]
        self.assertEqual((record["passed"], record["grade"]), (False, 0.0))
        self.assertEqual(self.progress()["completedComponentIds"], [])
        self.assertEqual(self.progress()["submittedComponentIds"], ["RISK-QUIZ"])

    def test_commercial_account_writes_own_profile_and_cannot_read_other_learner(self):
        result, session = self.finish("RISK-AUDIO", "audio")
        self.assertEqual(result.status_code, 200, result.content)
        self.account.subject_id = 502
        self.assertEqual(self.progress()["componentProgress"], [])
        denied, _ = self.finish("SP-AUDIO", "audio", token=session)
        self.assertEqual(denied.status_code, 400)
        denied = base.mobile.start_learning_session(self.request("POST", {"componentId": "RISK-AUDIO", "mode": "audio"}))
        self.assertEqual(denied.status_code, 404)
        result, _ = self.finish("SP-AUDIO", "audio")
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(self.progress()["completedComponentIds"], ["SP-AUDIO"])
        self.assertEqual(len(self.repo.read(991)), 1)
        self.assertEqual(len(self.repo.read(992)), 1)
        self.assertEqual(self.repo.connection.execute("SELECT profile_id,source_id FROM progress_rows ORDER BY id").fetchall(), [(991, 501), (992, 502)])

    def test_duplicate_signed_session_is_refused_by_actual_writer(self):
        first, session = self.finish("RISK-AUDIO", "audio")
        self.assertEqual(first.status_code, 200, first.content)
        second, _ = self.finish("RISK-AUDIO", "audio", token=session)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(len(self.repo.read(991)), 1)

    def test_browser_canonical_write_is_seen_by_mobile_and_attempts_continue(self):
        session = self.timer.issue_tracking_session(activity_kind="quiz", activity_id=77,
                    learner_kind="apprenticeship", learner_id=501, counting_mode="active_quiz",
                    issued_at=datetime.now(timezone.utc) - timedelta(seconds=45))
        request = self.request("POST", {"trackingToken": session["trackingToken"], "timeTakenSeconds": 30,
                                       "answers": {"10": 12}, "module": "Risk", "week": "Week 1"},
                               query="?kind=apprenticeship&learnerId=501")
        result = self.quiz_writer.submit_quiz_attempt(request, 77)
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(self.progress()["quizAttempts"][0]["attempt"], 1)
        mobile_result, _ = self.finish("RISK-QUIZ", "quiz", answers={"10": 12})
        self.assertEqual(mobile_result.status_code, 200, mobile_result.content)
        self.assertEqual([row["attempt"] for row in self.repo.read(991)], [1, 2])
        self.assertEqual([row["attempt"] for row in self.progress()["quizAttempts"]], [1, 2])


@unittest.skipUnless(os.environ.get("KBC_MOBILE_ISOLATED_DB_CONFIG"),
                     "Explicit isolated PostgreSQL fixture config required")
class PublishedChoiceSqlTests(unittest.TestCase):
    """Actual PostgreSQL eligibility SQL, in a rolled-back fixture transaction.

    The opt-in variable contains only a local config path. The fixture refuses
    non-loopback hosts and databases outside the dedicated review-test prefix.
    No Django application settings or production database aliases are loaded.
    """

    def test_published_choice_metadata_uses_real_postgres_semantics(self):
        import psycopg

        config = json.loads(Path(os.environ["KBC_MOBILE_ISOLATED_DB_CONFIG"]).read_text(encoding="utf-8-sig"))
        if set(config) - {"host", "port", "dbname", "user", "password"}:
            self.fail("PostgreSQL fixture config contains unsupported connection options")
        if config.get("host") not in {"127.0.0.1", "::1"} or not str(config.get("dbname", "")).startswith("kbc_rewards_test_review_"):
            self.fail("PostgreSQL fixture must use the reserved loopback review-test database")
        connection = psycopg.connect(**config, connect_timeout=5)
        self.addCleanup(connection.close)
        self.addCleanup(connection.rollback)
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            self.assertEqual(cursor.fetchone()[0], config["dbname"])
            cursor.execute("""SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname NOT IN ('pg_catalog','information_schema')
                  AND n.nspname NOT LIKE 'pg_toast%%' AND n.nspname NOT LIKE 'pg_temp_%%'
                  AND c.relkind IN ('r','p','v','m','S','f')""")
            self.assertEqual(cursor.fetchone()[0], 0, "PostgreSQL fixture database must be empty")
            # The reserved database must be fresh. Never overwrite a schema or
            # truncate an existing table to make this test pass.
            cursor.execute("CREATE SCHEMA curriculum")
            cursor.execute("CREATE TABLE curriculum.quizzes(id INTEGER PRIMARY KEY,status TEXT)")
            cursor.execute("""CREATE TABLE curriculum.quiz_questions(
                id INTEGER PRIMARY KEY,quiz_id INTEGER,question_type TEXT,is_archived BOOLEAN)""")
            cursor.execute("CREATE TABLE curriculum.quiz_answers(id INTEGER PRIMARY KEY,question_id INTEGER)")
            cursor.executemany("INSERT INTO curriculum.quizzes VALUES(%s,%s)",
                [(1, "published"), (2, "published"), (3, "published"), (4, "published"),
                 (5, "draft"), (6, "retracted"), (7, "published"), (8, "published"),
                 (9, "published"), (10, "PUBLISHED"), (11, "published")])
            questions = [
                (101, 1, "single_choice", False), (102, 1, "multiple_choice", False), (103, 1, "true_false", False),
                (201, 2, "single_choice", False), (202, 2, "matching", False),
                (401, 4, "single_choice", True), (501, 5, "single_choice", False),
                (601, 6, "single_choice", False), (701, 7, "single_choice", False),
                (801, 8, None, False), (901, 9, "", False), (1001, 10, "single_choice", False),
                (1101, 11, "single_choice", False), (1102, 11, "matching", True),
            ]
            cursor.executemany("INSERT INTO curriculum.quiz_questions VALUES(%s,%s,%s,%s)", questions)
            cursor.executemany("INSERT INTO curriculum.quiz_answers VALUES(%s,%s)",
                               [(qid, qid) for qid, *_ in questions if qid != 701])
        with patch.object(base.mobile, "connections", {"enrolment": connection}):
            self.assertEqual(base.mobile._published_choice_quiz_ids(set(range(1, 12))), {1, 10, 11})
            self.assertEqual(base.mobile._published_choice_quiz_ids({1}), {1})
            self.assertEqual(base.mobile._published_choice_quiz_ids({999}), set())
            self.assertEqual(base.mobile._published_choice_quiz_ids(set()), set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
