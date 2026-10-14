"""Actual PostgreSQL acceptance tests. Only a fresh loopback kbc_rewards_test_* database."""
import importlib
import json
import os
from pathlib import Path
import sys
import threading
import unittest
import uuid
import types
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
config_path=os.environ.get("KBC_REWARDS_TEST_CONNECTION_FILE")
if not config_path:
    raise RuntimeError("An isolated local database config file is required.")
cfg=json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
if cfg.get("host") not in ("127.0.0.1","localhost","::1") or not str(cfg.get("dbname","")).startswith("kbc_rewards_test_"):
    raise RuntimeError("Only a loopback isolated reward test database is permitted.")
source=ROOT.parent
sys.path.insert(0,str(source))
from django.conf import settings
settings.configure(
 SECRET_KEY="synthetic-rewards-test-only",DEBUG=False,USE_TZ=True,TIME_ZONE="UTC",
 INSTALLED_APPS=["engagement_api"],DEFAULT_AUTO_FIELD="django.db.models.BigAutoField",
 DATABASES={"default":{"ENGINE":"django.db.backends.postgresql","NAME":cfg["dbname"],"USER":cfg["user"],
 "PASSWORD":cfg["password"],"HOST":cfg["host"],"PORT":cfg["port"],"CONN_MAX_AGE":0}},
 KBC_SHARED_REWARDS_READY=True)
cfg.clear()
settings.DATABASES["enrolment"]=dict(settings.DATABASES["default"])
import django
django.setup()
import engagement_api
from django.db import connections,transaction
from django.utils import timezone
from engagement_api import shared_rewards as r
from engagement_api.models import PointsRule,PointsGrant,Reward,VoucherClaim
from engagement_api.services import grant_points,points_summary
from engagement_api.segment_rules import RewardError
learner_package=types.ModuleType("learner_api")
learner_package.__path__=[str(source/"learner_api")]
sys.modules["learner_api"]=learner_package
from learner_api import marking_queue_entry
marking_queue_entry.record_submission_row=lambda row:None
from engagement_api import saved_progress_rewards as saved

with connections["default"].cursor() as c:
    c.execute("SELECT current_database()")
    if not c.fetchone()[0].startswith("kbc_rewards_test_"):
        raise RuntimeError("Test database identity changed.")
    c.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
    if c.fetchone()[0]:
        raise RuntimeError("Test database must start empty; never overwrite existing tables.")
    c.execute((ROOT/"test-fixtures.sql").read_text(encoding="utf-8"))
    c.execute((ROOT/"schema.sql").read_text(encoding="utf-8"))

def sql(statement,args=()):
    with connections["default"].cursor() as c:
        c.execute(statement,args)
        return c.fetchall() if c.description else None

class PostgreSQLRewardsTests(unittest.TestCase):
    def setUp(self):
        settings.KBC_SHARED_REWARDS_READY=True
        # Truncate only known synthetic tables in this fresh guarded test DB.
        sql('''TRUNCATE "Engagement".shared_reward_observations,"Engagement".shared_reward_active_intervals,
          "Engagement".shared_reward_acceptances,"Engagement".shared_reward_outbox,"Engagement".shared_reward_sessions,
          "Engagement".shared_reward_saved_progress,
          "Engagement".shared_reward_bonus_verifications,"Engagement".shared_reward_award_links,
          "Engagement".shared_reward_leaderboard_optins,"Engagement".shared_reward_voucher_requests,
          "Engagement".shared_reward_voucher_options,"Engagement".voucher_claims,"Engagement".points_grants,
          "Engagement".points_rules,"Engagement".rewards,"Engagement".shared_reward_config,
          "Learner".learner_progress_entries,"Learner".learners,"Learner".learning_reflection_submissions,
          "Learner".evidence_files,"Engagement".event_bookings,"Engagement".events RESTART IDENTITY CASCADE''')
        self.now=timezone.now()
        sql('INSERT INTO "Engagement".shared_reward_config(module_id,enabled,starts_at) VALUES(%s,true,%s)',
            [r.PILOT_MODULE,self.now-timedelta(days=2)])
        sql('INSERT INTO "Learner".learners VALUES(991,501,\'active\',\'Synthetic Learner\'),(992,502,\'active\',\'Other Learner\')')
        for key in (r.HOUR_RULE,r.QUIZ_RULE,r.BONUS_RULE):
            PointsRule.objects.create(key=key,name=key,description="Synthetic",points=0,category="Learning",
                frequency="Per verified event",trigger=key,active=True)
        self.component={"componentId":"PMP-AUDIO-1","moduleId":r.PILOT_MODULE,"weekId":"W01","tutorValidationRequired":False}

    def tracking(self,name="session",kind="component",activity="PMP-AUDIO-1",started=None):
        return {"sessionId":name,"activityKind":kind,"activityId":activity,"learnerKind":"apprenticeship",
         "countingMode":"active_quiz" if kind=="quiz" else "active_playback",
         "startedAt":started or self.now-timedelta(hours=4)}

    def observe(self,t=None,segments=None,event=None,seq=1,learner="501",profile=991,component=None):
        t=t or self.tracking()
        return r.record_observations(learner_id=learner,profile_id=profile,component=component or self.component,
           tracking=t,token="synthetic-signed-token-"+t["sessionId"],event_id=event or t["sessionId"]+":"+str(seq),
           sequence=seq,observed_intervals=segments if segments is not None else [{"startOffsetMs":0,"endOffsetMs":5000}])

    def progress(self,t=None,verified=5,correct=None,total=None,order=1):
        t=t or self.tracking()
        return sql('''INSERT INTO "Learner".learner_progress_entries
          (learner_id,entry_order,kind,quiz_ref,component_ref,verified_seconds,time_tracking_source,
          time_tracking_session_ref,started_at,submitted_at,achieved_score,total_score)
          VALUES(991,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
          [order,t["activityKind"],str(t["activityId"]) if t["activityKind"]=="quiz" else None,
          str(t["activityId"]) if t["activityKind"]!="quiz" else None,verified,
          "signed_session_capped_"+t["countingMode"],t["sessionId"],t["startedAt"],self.now,correct,total])[0][0]

    def whole_hour(self,t):
        for batch in range(6):
            self.observe(t,[{"startOffsetMs":n*5000,"endOffsetMs":(n+1)*5000} for n in range(batch*120,(batch+1)*120)],seq=batch+1)

    def credit(self,amount=300):
        return grant_points(r.BONUS_RULE,"501","Synthetic",points=amount,event_reference="synthetic-balance",source_type="manual")

    def voucher(self,amount=1,stock=10):
        reward=Reward.objects.create(name="Synthetic voucher",points=amount*100,delivery_type="digital",stock=stock)
        sql('INSERT INTO "Engagement".shared_reward_voucher_options VALUES(%s,%s,true)',[reward.pk,amount])
        return reward

    def test_default_off_and_no_implicit_activation(self):
        settings.KBC_SHARED_REWARDS_READY=False
        with self.assertRaisesRegex(RewardError,"rewards_not_enabled"):self.observe()
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_sessions')[0][0],0)
        self.assertFalse(r.summary(learner_id="501")["policy"]["enabled"])

    def test_exact_retry_conflict_sequence_owner_and_no_grant_on_observation(self):
        first=self.observe();second=self.observe()
        self.assertFalse(first["duplicate"]);self.assertTrue(second["duplicate"])
        self.assertEqual(PointsGrant.objects.count(),0)
        for kwargs in ({"segments":[{"startOffsetMs":1,"endOffsetMs":5000}]},{"learner":"502","profile":992},
                       {"seq":3},{"event":"different"}):
            with self.assertRaises(RewardError):self.observe(**kwargs)
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_observations')[0][0],1)

    def test_segments_do_not_credit_pause_gap_or_whole_envelope(self):
        self.observe(segments=[{"startOffsetMs":0,"endOffsetMs":3000},{"startOffsetMs":70000,"endOffsetMs":75000}])
        pid=self.progress(verified=8);r.reconcile_progress(pid)
        self.assertEqual(r.summary(learner_id="501")["study"]["acceptedStudySeconds"],8)
        self.assertEqual(PointsGrant.objects.count(),0)

    def test_hour_union_across_devices_and_idempotent_retry(self):
        a=self.tracking("a");b=self.tracking("b")
        self.whole_hour(a);self.whole_hour(b)
        pa=self.progress(a,verified=3600);pb=self.progress(b,verified=3600,order=2)
        r.reconcile_progress(pa);r.reconcile_progress(pb);r.reconcile_progress(pa)
        self.assertEqual(points_summary("501")["earned"],1)
        self.assertEqual(r.summary(learner_id="501")["study"]["acceptedStudySeconds"],3600)

    def test_fraction_trim_and_excess_rejection(self):
        self.observe(segments=[{"startOffsetMs":0,"endOffsetMs":1500}])
        pid=self.progress(verified=1);result=r.reconcile_progress(pid)
        self.assertEqual(result["acceptedMilliseconds"],1000)
        self.assertEqual(sql('SELECT extract(epoch from active_end-active_start) FROM "Engagement".shared_reward_active_intervals')[0][0],1)
        t=self.tracking("too-much");self.observe(t)
        bad=self.progress(t,verified=3,order=2)
        with self.assertRaisesRegex(RewardError,"observed_duration_exceeds_saved_budget"):r.reconcile_progress(bad)

    def test_first_quiz_70_percent_and_perfect_not_stacked(self):
        for name,quiz,correct,expect in [("q1",77,7,7),("q2",78,10,20),("q3",79,6,0)]:
            t=self.tracking(name,"quiz",quiz);self.observe(t,[])
            p=self.progress(t,0,correct,10);r.reconcile_progress(p)
        self.assertEqual(points_summary("501")["earned"],27)
        t=self.tracking("retake","quiz",77);self.observe(t,[])
        r.reconcile_progress(self.progress(t,0,10,10,order=2))
        self.assertEqual(points_summary("501")["earned"],27)

    def test_prepolicy_first_failure_is_still_first_submission(self):
        t=self.tracking("old","quiz",77)
        self.progress(t,0,0,10,order=1)
        new=self.tracking("new","quiz",77);self.observe(new,[])
        r.reconcile_progress(self.progress(new,0,10,10,order=2))
        self.assertEqual(points_summary("501")["earned"],0)

    def test_coach_review_pending_then_acceptance_and_durable_outbox(self):
        self.component["tutorValidationRequired"]=True
        self.observe();pid=self.progress()
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_outbox')[0][0],1)
        self.assertEqual(r.reconcile_progress(pid)["status"],"waiting_review")
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_acceptances')[0][0],0)
        sql('''UPDATE "Learner".learning_reflection_submissions SET status='accepted'
          WHERE learner_id='501' AND activity_id='PMP-AUDIO-1' AND progress_entry_id=%s''',[pid])
        self.assertEqual(r.reconcile_progress(pid)["status"],"done")

    def test_grant_failure_rolls_back_acceptance_and_recovers_without_legacy_stack(self):
        t=self.tracking("q","quiz",77);self.observe(t,[]);pid=self.progress(t,0,10,10)
        PointsRule.objects.filter(key=r.QUIZ_RULE).update(active=False)
        self.assertTrue(r.owns_progress_record("501",{"timeTrackingSessionId":"q"}))
        self.assertEqual(sql('SELECT state FROM "Engagement".shared_reward_outbox')[0][0],"pending")
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_acceptances')[0][0],0)
        PointsRule.objects.filter(key=r.QUIZ_RULE).update(active=True)
        self.assertEqual(r.reconcile_pending()[0]["status"],"done")
        self.assertEqual(points_summary("501")["earned"],20)

    def test_concurrent_reconciliation_grants_only_once(self):
        t=self.tracking("q","quiz",77);self.observe(t,[]);pid=self.progress(t,0,10,10)
        barrier=threading.Barrier(2)
        def run():
            try:barrier.wait();return r.reconcile_progress(pid)["status"]
            finally:connections.close_all()
        with ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda _:run(),range(2)))
        self.assertEqual(results,["done","done"]);self.assertEqual(PointsGrant.objects.count(),1)

    def test_voucher_request_reserves_once_retry_and_rejection_releases(self):
        self.credit();self.voucher()
        one=r.voucher_request(learner_id="501",learner_name="Synthetic",request_id="request",amount_gbp=1)
        two=r.voucher_request(learner_id="501",learner_name="Synthetic",request_id="request",amount_gbp=1)
        self.assertEqual(one["request"]["claimId"],two["request"]["claimId"]);self.assertTrue(two["duplicate"])
        self.assertEqual(points_summary("501")["balance"],200)
        with self.assertRaisesRegex(RewardError,"voucher_request_conflict"):
            r.voucher_request(learner_id="501",learner_name="Synthetic",request_id="request",amount_gbp=2)
        VoucherClaim.objects.filter(pk=one["request"]["claimId"]).update(status="rejected")
        self.assertEqual(points_summary("501")["balance"],300)

    def test_concurrent_voucher_requests_cannot_overspend(self):
        self.credit(100);self.voucher()
        barrier=threading.Barrier(2)
        def run(i):
            try:
                barrier.wait()
                try:return r.voucher_request(learner_id="501",learner_name="Synthetic",request_id="request"+str(i),amount_gbp=1)["request"]["status"]
                except RewardError as exc:return exc.code
            finally:connections.close_all()
        with ThreadPoolExecutor(2) as pool:results=list(pool.map(run,range(2)))
        self.assertCountEqual(results,["pending","insufficient_points"])
        self.assertEqual(VoucherClaim.objects.count(),1);self.assertEqual(points_summary("501")["balance"],0)

    def test_bonus_once_only_and_approved_evidence_owner(self):
        evidence=str(uuid.uuid4());sql('INSERT INTO "Learner".evidence_files(id,learner_id,status) VALUES(%s,\'501\',\'approved\')',[evidence])
        kwargs=dict(learner_id="501",learner_name="Synthetic",module_id=r.PILOT_MODULE,opportunity="inclusiveness",
                    evidence_reference=evidence,completion_date=self.now.date(),staff_id="staff:1",learner_kind="apprenticeship")
        first=r.verify_bonus(**kwargs,verification_id="verify:1")
        second=r.verify_bonus(**kwargs,verification_id="verify:2")
        self.assertTrue(second["duplicate"]);self.assertEqual(first["grantId"],second["grantId"])
        self.assertEqual(points_summary("501")["earned"],500)
        with self.assertRaises(RewardError):
            r.verify_bonus(**{**kwargs,"learner_id":"502"},verification_id="verify:3")

    def test_opt_in_required_and_opt_out_hides_alias(self):
        self.credit()
        self.assertEqual(r.summary(learner_id="501")["leaderboard"]["entries"],[])
        r.set_leaderboard(learner_id="501",module_id=r.PILOT_MODULE,opted_in=True,display_name="Synthetic alias")
        self.assertEqual(r.summary(learner_id="501")["leaderboard"]["entries"][0]["displayName"],"Synthetic alias")
        r.set_leaderboard(learner_id="501",module_id=r.PILOT_MODULE,opted_in=False,display_name="")
        self.assertEqual(r.summary(learner_id="502")["leaderboard"]["entries"],[])

    def test_batch_retry_keeps_original_cumulative_after_later_batches(self):
        original=self.observe()
        self.observe(seq=2,segments=[{"startOffsetMs":5000,"endOffsetMs":10000}])
        retry=self.observe()
        self.assertEqual(original["cumulativeObservedMilliseconds"],retry["cumulativeObservedMilliseconds"])
        self.assertEqual(retry["cumulativeObservedMilliseconds"],5000)

    def test_max_length_event_id_reconciles_and_evidence_is_immutable(self):
        self.observe(event="x"*180);pid=self.progress();r.reconcile_progress(pid)
        self.assertEqual(r.summary(learner_id="501")["study"]["acceptedStudySeconds"],5)
        from django.db import DatabaseError
        with self.assertRaises(DatabaseError):
            sql('UPDATE "Engagement".shared_reward_observations SET observed_ms=0')

    def test_pending_failure_and_review_queue_do_not_starve_next_job(self):
        a=self.tracking("a");b=self.tracking("b")
        self.observe(a);self.observe(b)
        pa=self.progress(a);pb=self.progress(b,order=2)
        with patch.object(r,"reconcile_progress",side_effect=RuntimeError("synthetic")):
            self.assertEqual(r.reconcile_pending(limit=1)[0]["progressId"],pa)
        self.assertEqual(r.reconcile_pending(limit=1)[0]["progressId"],pb)

    def test_progress_rollback_does_not_leave_award_outbox(self):
        self.observe()
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                self.progress()
                raise RuntimeError("rollback synthetic progress")
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_outbox')[0][0],0)
        self.assertEqual(PointsGrant.objects.count(),0)

    def test_coach_binding_all_activity_kinds_preserves_same_but_not_new_attempt(self):
        for index,kind in enumerate(("component","video","quiz")):
            component={**self.component,"componentId":"activity-"+kind,"type":kind,"tutorValidationRequired":True}
            aid=91 if kind=="quiz" else component["componentId"]
            t=self.tracking(kind,kind,aid)
            self.observe(t,[],component=component)
            pid=self.progress(t,0,7 if kind=="quiz" else None,10 if kind=="quiz" else None,order=index+1)
            self.assertEqual(r.reconcile_progress(pid)["status"],"waiting_review")
            row=sql('SELECT progress_entry_id,status FROM "Learner".learning_reflection_submissions WHERE activity_id=%s',[component["componentId"]])[0]
            self.assertEqual(row,(pid,"submitted_for_tutor_review"))
            sql('UPDATE "Learner".learning_reflection_submissions SET status=\'accepted\' WHERE activity_id=%s',[component["componentId"]])
            self.assertEqual(r.reconcile_progress(pid)["status"],"done")
            # A repeated old caller with a None progress link cannot corrupt acceptance.
            marking_queue_entry.queue_for_marking(component_id=component["componentId"],kind="apprenticeship",learner_id="501",
                context={"activityType":kind,"progressEntryId":None})
            self.assertEqual(sql('SELECT progress_entry_id,status FROM "Learner".learning_reflection_submissions WHERE activity_id=%s',[component["componentId"]])[0],(pid,"accepted"))
            newer=self.tracking(kind+"-retake",kind,aid);self.observe(newer,[],component=component)
            newpid=self.progress(newer,0,10 if kind=="quiz" else None,10 if kind=="quiz" else None,order=index+10)
            self.assertEqual(r.reconcile_progress(newpid)["status"],"waiting_review")
            self.assertEqual(sql('SELECT progress_entry_id,status FROM "Learner".learning_reflection_submissions WHERE activity_id=%s',[component["componentId"]])[0],(newpid,"submitted_for_tutor_review"))

    def test_browser_first_quiz_uses_persisted_scope_and_legacy_never_stacks(self):
        from engagement_api.hooks import award_for_progress
        t=self.tracking("web","quiz",77);pid=self.progress(t,0,7,10)
        comp={**self.component,"type":"quiz","quizMeta":{"quizId":77},"learnerKind":"apprenticeship"}
        with patch.object(saved,"_resolve_component",return_value=comp),patch("engagement_api.services.grant_points",wraps=grant_points) as grant:
            award_for_progress("501","Synthetic",{"attempt":999,"passed":True,"kind":"quiz","quizId":123},progress_id=pid)
            self.assertEqual(grant.call_count,1)
            self.assertEqual(grant.call_args.args[0],r.QUIZ_RULE)
            award_for_progress("501","Synthetic",{"attempt":1,"passed":True,"kind":"quiz","quizId":77},progress_id=pid)
        self.assertEqual(points_summary("501")["earned"],7)
        self.assertEqual(r.summary(learner_id="501")["study"]["acceptedStudySeconds"],0)

    def test_browser_review_queues_actual_progress_and_accepts_only_that_attempt(self):
        t=self.tracking("web-review","quiz",77);pid=self.progress(t,0,10,10)
        comp={**self.component,"type":"quiz","quizMeta":{"quizId":77},
            "learnerKind":"apprenticeship","tutorValidationRequired":True}
        with patch.object(saved,"_resolve_component",return_value=comp):
            self.assertEqual(saved.reconcile_saved_progress(pid)["status"],"waiting_review")
            sql('UPDATE "Learner".learning_reflection_submissions SET status=\'accepted\' WHERE progress_entry_id=%s',[pid])
            self.assertEqual(saved.reconcile_saved_progress(pid)["status"],"done")
        self.assertEqual(points_summary("501")["earned"],20)

    def test_unassigned_browser_progress_keeps_existing_policy_and_owner_guard(self):
        t=self.tracking("unassigned","quiz",77);pid=self.progress(t,0,10,10)
        with self.assertRaisesRegex(RewardError,"progress_identity_mismatch"):
            saved.reconcile_saved_progress(pid,expected_learner="502")
        with patch.object(saved,"_resolve_component",return_value=None):
            self.assertFalse(saved.reconcile_saved_progress(pid)["owned"])
        self.assertEqual(PointsGrant.objects.count(),0)

    def test_summary_nonparticipant_cannot_read_peers_and_ties_share_rank(self):
        r.set_leaderboard(learner_id="501",module_id=r.PILOT_MODULE,opted_in=True,display_name="Alice")
        self.assertEqual(r.summary(learner_id="502")["leaderboard"]["entries"],[])
        r.set_leaderboard(learner_id="502",module_id=r.PILOT_MODULE,opted_in=True,display_name="George")
        self.assertEqual([e["rank"] for e in r.summary(learner_id="502")["leaderboard"]["entries"]],[1,1])
        settings.KBC_SHARED_REWARDS_READY=False
        self.assertEqual(r.summary(learner_id="502")["leaderboard"]["entries"],[])

    def test_summary_caps_recent_requests_and_exports_synthetic_contract_fixture(self):
        self.credit(30000);reward=self.voucher(stock=250)
        for i in range(205):
            r.voucher_request(learner_id="501",learner_name="Synthetic",request_id="request-"+str(i),amount_gbp=1)
        result=r.summary(learner_id="501")
        self.assertEqual(len(result["voucherRequests"]),200)
        (ROOT/"synthetic-summary-fixture.json").write_text(json.dumps(result,indent=2),encoding="utf-8")

    def test_repair_hook_uses_actual_registered_progress_id_without_client_metadata(self):
        from engagement_api.hooks import award_for_progress
        t=self.tracking("repair","quiz",77);self.observe(t,[]);pid=self.progress(t,0,10,10)
        with patch("engagement_api.services.grant_points",wraps=grant_points) as grant:
            award_for_progress("501","Synthetic",{"kind":"quiz","quizId":77,"attempt":1,"passed":True},progress_id=pid)
            award_for_progress("501","Synthetic",{"kind":"quiz","quizId":77,"attempt":1,"passed":True},progress_id=pid)
            self.assertEqual(grant.call_count,1)
            self.assertEqual(grant.call_args.args[0],r.QUIZ_RULE)
        self.assertEqual(points_summary("501")["earned"],20)

    def test_verified_bonus_reused_id_must_not_change_evidence_or_date(self):
        evidence=str(uuid.uuid4())
        sql('INSERT INTO "Learner".evidence_files(id,learner_id,status) VALUES(%s,\'501\',\'approved\')',[evidence])
        kwargs=dict(learner_id="501",learner_name="Synthetic",module_id=r.PILOT_MODULE,
          opportunity="career-planner",evidence_reference=evidence,completion_date=self.now.date(),
          staff_id="staff:1",learner_kind="apprenticeship",verification_id="strict-id")
        r.verify_bonus(**kwargs)
        with self.assertRaisesRegex(RewardError,"verification_id_conflict"):
            r.verify_bonus(**{**kwargs,"completion_date":self.now.date()-timedelta(days=1)})

    def test_semester_winner_requires_top_opted_in_score_and_explicit_confirmation(self):
        from datetime import date
        semester=date(2026,9,30)
        sql('UPDATE "Engagement".shared_reward_config SET starts_at=%s,semester_end=%s',
            [self.now-timedelta(days=365),semester])
        for learner,name in (("501","Alice"),("502","George")):
            r.set_leaderboard(learner_id=learner,module_id=r.PILOT_MODULE,opted_in=True,display_name=name)
        grant=self.credit(100)
        sql('INSERT INTO "Engagement".shared_reward_award_links VALUES(%s,%s,%s)',[grant.pk,r.PILOT_MODULE,"synthetic-credit"])
        evidence=str(uuid.uuid4())
        sql('INSERT INTO "Learner".evidence_files(id,learner_id,status) VALUES(%s,\'502\',\'approved\')',[evidence])
        kwargs=dict(learner_id="502",learner_name="Synthetic",module_id=r.PILOT_MODULE,
          opportunity="semester-winner",evidence_reference=evidence,completion_date=semester,
          staff_id="staff:1",learner_kind="apprenticeship",verification_id="winner",confirmed_winner=True)
        with self.assertRaisesRegex(RewardError,"winner_must_top_module_leaderboard"):r.verify_bonus(**kwargs)
        sql('UPDATE "Learner".evidence_files SET learner_id=\'501\' WHERE id=%s',[evidence])
        self.assertEqual(r.verify_bonus(**{**kwargs,"learner_id":"501"})["points"],1000)
        self.assertTrue(r.verify_bonus(**{**kwargs,"learner_id":"501"})["duplicate"])

if __name__=="__main__":
    unittest.main(verbosity=2)
