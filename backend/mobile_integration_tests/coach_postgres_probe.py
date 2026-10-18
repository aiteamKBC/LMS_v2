"""Fresh-process, opt-in coach GET probe against a disposable loopback database.

Minimal synthetic ORM rows exercise real coach grants, normalized caseload SQL,
canonical profile linkage and canonical accepted-hour aggregation. Curriculum,
session transport and reward reads remain isolated fixtures. Fixture DDL rolls
back. Every SQL statement executed during a facade GET must be a read.
"""
import json
import os
from pathlib import Path
import re

cfg = json.loads(Path(os.environ["KBC_MOBILE_ISOLATED_DB_CONFIG"]).read_text(encoding="utf-8-sig"))
if (set(cfg) - {"host", "port", "dbname", "user", "password"}
        or cfg.get("host") != "127.0.0.1"
        or not str(cfg.get("dbname", "")).startswith("kbc_rewards_test_review_")):
    raise RuntimeError("Only the isolated loopback review database is allowed")

from django.conf import settings
settings.configure(DEFAULT_CHARSET="utf-8", SECRET_KEY="synthetic-coach-postgres",
    INSTALLED_APPS=[], USE_TZ=True, KBC_MOBILE_API_ENABLED=True,
    DATABASES={"default": {"ENGINE": "django.db.backends.postgresql", "NAME": cfg["dbname"],
        "HOST": cfg["host"], "PORT": cfg["port"], "USER": cfg["user"], "PASSWORD": cfg["password"]}})
import django
django.setup()
from django.db import connection, models, transaction
from unittest.mock import Mock, patch
from test_mobile_coach_contract import CoachContract, PACKAGE, fixture, load
import test_mobile_contract as base


class Profile(models.Model):
    enrolment_id = models.BigIntegerField()
    full_name = models.TextField()
    learner_type = models.TextField()
    programme = models.TextField()
    cohort = models.TextField()
    cohort_id = models.TextField()
    lifecycle_status = models.TextField()
    coach_email = models.TextField()

    class Meta:
        app_label = "synthetic_coach"
        db_table = '"Learner"."learners"'
        managed = False


class Source(models.Model):
    username = models.TextField(db_column="Username")
    learner_type = models.TextField()
    all_learners = models.Manager()

    class Meta:
        app_label = "synthetic_coach"
        db_table = '"enrolment"."Created_users"'
        managed = False


class Staff(models.Model):
    username = models.TextField()
    email = models.TextField()
    access = models.TextField()
    access_extra = models.TextField()

    class Meta:
        app_label = "synthetic_coach"
        db_table = '"enrolment"."Staff_users"'
        managed = False


statements = []
def only_reads(execute, sql, params, many, context):
    text = str(sql).strip()
    if (not re.match(r"^(SELECT|WITH)\b", text, re.I)
            or re.search(r"\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL|COPY)\b", text, re.I)):
        raise AssertionError("Coach GET attempted a non-read SQL statement")
    statements.append(text.split()[0].upper())
    return execute(sql, params, many, context)


case = CoachContract(methodName="test_primary_and_additional_coach_grants_use_server_identity")
try:
    case.setUp()
    case.facade.LearnerProfile = Profile
    case.facade.EnrolmentUser = Source
    case.auth.StaffUser = Staff
    import sys
    sys.modules["learner_api.models"].StaffUser = Staff
    fixture("learner_api.journal_sources", enabled=lambda: False)
    load("learner_api.ksb_points", "learner_api/ksb_points.py")
    fixture(PACKAGE + ".canonical_hours", pending_hour_records=lambda owners: {})
    canonical = load(PACKAGE + ".canonical_learning_pg", "learner_api/canonical_learning.py")
    def query(sql, params):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return [dict(zip([column[0] for column in cursor.description], row)) for row in cursor.fetchall()]
    canonical.query = query
    case.facade.canonical_learning = canonical
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT host(inet_server_addr()),inet_server_port(),current_database()")
            assert cursor.fetchone() == ("127.0.0.1", cfg["port"], cfg["dbname"])
            cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
            assert cursor.fetchone()[0] == 0, "Fixture database must be empty"
            cursor.execute('CREATE SCHEMA "Learner"')
            cursor.execute('CREATE SCHEMA enrolment')
            cursor.execute('''CREATE TABLE "Learner".learners(id BIGINT PRIMARY KEY,enrolment_id BIGINT,
                full_name TEXT,learner_type TEXT,programme TEXT,cohort TEXT,cohort_id TEXT,lifecycle_status TEXT,
                coach_email TEXT,coach_name TEXT,aptem_id BIGINT,programme_id TEXT,email TEXT,
                start_date DATE,end_date DATE)''')
            cursor.execute('''CREATE TABLE enrolment."Created_users"(id BIGINT PRIMARY KEY,"Username" TEXT,
                learner_type TEXT,"Email" TEXT,aptem_id BIGINT,"Planned_hours" NUMERIC)''')
            cursor.execute('''CREATE TABLE enrolment."Staff_users"(id BIGINT PRIMARY KEY,username TEXT,
                email TEXT,access TEXT,access_extra TEXT)''')
            cursor.execute('''CREATE TABLE "Learner".learner_progress_entries(id BIGINT PRIMARY KEY,
                learner_id BIGINT,actual_seconds NUMERIC,accepted BOOLEAN,deleted_at TIMESTAMPTZ)''')
            cursor.execute('''CREATE TABLE "Learner".learner_monthly_targets(id BIGINT PRIMARY KEY,
                learner_id BIGINT,report_month DATE,target_hours NUMERIC,programme_profile_id TEXT,
                enrolment_id BIGINT,programme_id TEXT,updated_at TIMESTAMPTZ)''')
            cursor.execute('''INSERT INTO enrolment."Staff_users" VALUES
                (73,'Synthetic coach',' COACH@example.TEST ','tutor','coach')''')
            cursor.execute('''INSERT INTO enrolment."Created_users" VALUES
                (501,'Learner A','apprenticeship','a@example.test',41,999),
                (502,'Learner B','commercial','b@example.test',42,999),
                (503,'Wrong bridge','apprenticeship','wrong@example.test',43,999)''')
            cursor.execute('''INSERT INTO "Learner".learners VALUES
                (991,501,'Learner A','apprenticeship','P','Class','CLASS','active',' coach@EXAMPLE.test ','Coach',41,'P','a@example.test','2026-01-01','2026-12-31'),
                (992,502,'Learner B','commercial','P','Class','CLASS','active','other@example.test','Other',42,'P','b@example.test','2026-01-01','2026-12-31'),
                (993,503,'Wrong bridge','apprenticeship','P','Class','CLASS','active','coach@example.test','Coach',43,'P','different@example.test','2026-01-01','2026-12-31')''')
            cursor.execute('''INSERT INTO "Learner".learner_progress_entries VALUES
                (1,991,3600,true,NULL),(2,991,7200,false,NULL),(3,992,18000,true,NULL),
                (4,991,90000,true,now()),(5,991,'NaN',true,NULL)''')
            cursor.execute('''INSERT INTO "Learner".learner_monthly_targets VALUES
                (1,991,'2026-10-01',12,'',501,'P',now()),
                (2,991,'2026-10-01',99,'',999,'WRONG',now())''')

        def get(handler="learners", **kwargs):
            with connection.execute_wrapper(only_reads):
                return case.call(handler, **kwargs)

        roster = get()
        assert roster.status_code == 200, roster.content
        payload = json.loads(roster.content)
        assert len(payload["learners"]) == 1, payload
        own = payload["learners"][0]
        assert (own["profileId"], own["learnerId"]) == ("991", "501")
        assert own["hours"]["acceptedOtjhHours"] == 1, own
        assert own["hours"]["plannedOtjhHours"] == 12, own
        for handler in ("learner", "catalogue", "progress"):
            assert get(handler, profile_id=992).status_code == 404
            assert get(handler, profile_id=501).status_code == 404
            assert get(handler, profile_id=993).status_code == 404
        with patch.object(base.mobile, "LearnerProfile", Profile):
            data = get("catalogue", profile_id=991)
            assert data.status_code == 200, data.content
            base.mobile.build_learner_detail.assert_called_with(
                case.facade.EnrolmentUser.all_learners.get(pk=501), 501,
                compact=True, read_only=True, quiz_view=True)
        with connection.cursor() as cursor:
            cursor.execute('UPDATE "Learner".learners SET coach_email=%s WHERE id=991', ['other@example.test'])
        assert get("catalogue", profile_id=991).status_code == 404
        assert json.loads(get().content)["learners"] == []
        with connection.cursor() as cursor:
            cursor.execute('UPDATE enrolment."Staff_users" SET access_extra=%s WHERE id=73', [''])
        assert get().status_code == 403
        assert len(statements) > 20
        transaction.set_rollback(True)
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
        assert cursor.fetchone()[0] == 0
    print(json.dumps({"status": "PASS", "readOnlySqlStatements": len(statements),
        "databaseHost": "127.0.0.1", "fixtureRolledBack": True, "productionSettingsLoaded": False,
        "checks": ["additional coach grant", "normalized live caseload", "profile/source IDs",
            "email identity bridge", "accepted hours exclude pending/deleted/nonfinite",
            "monthly target ownership", "cross learner404", "read-only catalogue",
            "assignment revocation", "grant revocation", "GET SQL read-only"]}))
finally:
    case.doCleanups()
    connection.close()
