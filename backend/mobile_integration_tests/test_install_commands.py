"""Isolated PostgreSQL checks for install commands. Requires a fresh loopback test database."""
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import unittest
from datetime import timedelta

ROOT = Path(__file__).resolve().parent
config = json.loads(Path(os.environ["KBC_REWARDS_TEST_CONNECTION_FILE"]).read_text(encoding="utf-8-sig"))
if config.get("host") != "127.0.0.1" or not config.get("dbname","").startswith("kbc_rewards_test_"):
    raise RuntimeError("A task-local test database is required.")
source = ROOT.parent
sys.path.insert(0,str(source))
from django.conf import settings
db={"ENGINE":"django.db.backends.postgresql","NAME":config["dbname"],"USER":config["user"],
    "PASSWORD":config["password"],"HOST":config["host"],"PORT":config["port"]}
settings.configure(SECRET_KEY="synthetic-install-only",USE_TZ=True,TIME_ZONE="UTC",
    INSTALLED_APPS=["engagement_api"],DATABASES={"default":dict(db),"enrolment":dict(db)},
    KBC_SHARED_REWARDS_READY=False)
config.clear();db.clear()
import django
django.setup()
import engagement_api
from django.core.management.base import CommandError
from django.db import connections
from django.db.migrations.state import ProjectState
from django.utils import timezone
from engagement_api.models import PointsRule,Reward,VoucherClaim,PointsGrant

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def sql(query,args=()):
    with connections["default"].cursor() as cur:
        cur.execute(query,args)
        return cur.fetchall() if cur.description else None

if sql("SELECT current_database()")[0][0] != settings.DATABASES["default"]["NAME"]:
    raise RuntimeError("Database identity changed.")
if sql("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")[0][0]:
    raise RuntimeError("Refusing to overwrite a non-empty test database.")
sql((ROOT/"test-fixtures.sql").read_text())
migration=load("install_migration",source/"engagement_api"/"migrations"/"0003_shared_reward_evidence.py")
if migration.SCHEMA_SHA256 != hashlib.sha256((ROOT/"schema.sql").read_bytes()).hexdigest():
    raise RuntimeError("The frozen migration must match the reviewed schema.")
with connections["default"].schema_editor() as editor:
    for operation in migration.Migration.operations:
        operation.database_forwards("engagement_api",editor,ProjectState(),ProjectState())
commands=source/"engagement_api"/"management"/"commands"
prepare=load("install_prepare",commands/"prepare_shared_rewards.py")
voucher=load("install_voucher",commands/"configure_shared_reward_voucher.py")
from engagement_api.shared_reward_setup import PILOT_MODULE,require_same_database

class InstallCommandTests(unittest.TestCase):
    def setUp(self):
        settings.KBC_SHARED_REWARDS_READY=False
        sql('TRUNCATE "Engagement".shared_reward_config,"Engagement".points_rules,"Engagement".rewards RESTART IDENTITY CASCADE')

    def prepare(self,**overrides):
        options=dict(operator="synthetic:operator",programme_start=None,module_end=None,semester_end=None,
                     masterclass_event_id=None,activate_now=False)
        options.update(overrides)
        prepare.Command(stdout=io.StringIO()).handle(**options)

    def test_schema_prepared_policy_and_rules_remain_disabled_without_awards(self):
        self.prepare()
        self.assertEqual(sql('SELECT enabled,starts_at FROM "Engagement".shared_reward_config'),[(False,None)])
        self.assertEqual(PointsRule.objects.filter(active=True).count(),0)
        self.assertEqual(PointsRule.objects.count(),3)
        self.assertEqual(PointsGrant.objects.count(),0)
        self.prepare()
        self.assertEqual(PointsRule.objects.count(),3)

    def test_activation_requires_global_flag_and_preserves_first_cutover(self):
        self.prepare()
        with self.assertRaises(CommandError): self.prepare(activate_now=True)
        self.assertEqual(sql('SELECT enabled FROM "Engagement".shared_reward_config'),[(False,)])
        settings.KBC_SHARED_REWARDS_READY=True
        before=timezone.now()
        self.prepare(activate_now=True)
        enabled,cutover=sql('SELECT enabled,starts_at FROM "Engagement".shared_reward_config')[0]
        self.assertTrue(enabled);self.assertGreaterEqual(cutover,before)
        self.assertEqual(PointsRule.objects.filter(active=True).count(),3)
        self.prepare(activate_now=True)
        self.assertEqual(sql('SELECT starts_at FROM "Engagement".shared_reward_config')[0][0],cutover)
        sql('UPDATE "Engagement".shared_reward_config SET enabled=false')
        with self.assertRaises(CommandError):self.prepare(activate_now=True)
        self.assertEqual(sql('SELECT starts_at FROM "Engagement".shared_reward_config')[0][0],cutover)

    def test_invalid_dates_rollback_without_creating_policy(self):
        with self.assertRaises(CommandError):
            self.prepare(programme_start=timezone.now().date(),module_end=timezone.now().date()-timedelta(days=1))
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_config')[0][0],0)

    def test_existing_voucher_only_no_fulfilment_and_stock_bounded_by_reservations(self):
        command=voucher.Command(stdout=io.StringIO())
        opts=dict(operator="synthetic:operator",reward_id=999,amount_gbp=1,stock=None,enable=False)
        with self.assertRaises(CommandError):command.handle(**opts)
        reward=Reward.objects.create(name="Synthetic",points=100,delivery_type="digital",stock=4)
        opts["reward_id"]=reward.pk
        command.handle(**opts)
        self.assertEqual(sql('SELECT enabled FROM "Engagement".shared_reward_voucher_options'),[(False,)])
        self.assertEqual(VoucherClaim.objects.count(),0)
        VoucherClaim.objects.create(learner_id="synthetic",learner_name="Synthetic",reward=reward,points=100,
                                    status="pending",delivery_type="digital")
        with self.assertRaises(CommandError):command.handle(**{**opts,"stock":0,"enable":True})
        reward.refresh_from_db();self.assertEqual(reward.stock,4)
        command.handle(**{**opts,"stock":2,"enable":True})
        reward.refresh_from_db();self.assertEqual(reward.stock,2)
        self.assertEqual(sql('SELECT enabled FROM "Engagement".shared_reward_voucher_options'),[(True,)])

    def test_mismatched_database_alias_is_rejected_before_queries(self):
        conn=connections["enrolment"]
        original=conn.settings_dict["NAME"]
        try:
            conn.settings_dict["NAME"]="unrelated"
            with self.assertRaises(CommandError):require_same_database()
        finally:conn.settings_dict["NAME"]=original

if __name__=="__main__":
    unittest.main(verbosity=2)
