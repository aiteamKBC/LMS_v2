from datetime import datetime, timedelta, timezone
from unittest.mock import patch, Mock
from django.test import TestCase
from .identity import Principal, AccessError
from .models import Notification, Preference, Device, Delivery
from .policy import default_preferences, reminder_plan
from .push import SendResult
from .worker import reconcile, dispatch_one, current_notification
from .sources import assignment_events, task_events

class SourcePolicyTests(TestCase):
    def test_saved_deadline_overrides_21st(self):
        row={"type":"assignment","componentId":"a","monthlyAssignment":True}
        dates={"a":{"date":"2026-10-06","week_end":"2026-10-11","due_timing":"End of week"}}
        self.assertEqual(next(assignment_events([row],dates,{}))["dueAt"].day,11)
        dates["a"]["due_timing"]=""
        self.assertEqual(next(assignment_events([row],dates,{}))["dueAt"].day,21)
    def test_ambiguous_dates_and_nonmonthly_excluded(self):
        rows=[{"type":"assignment","componentId":"a","monthlyAssignment":True},{"type":"assignment","componentId":"b","sessionDate":"2026-10-01"}]
        self.assertEqual(list(assignment_events(rows,{"a":{"date_needs_review":True}},{})),[])
    def test_partial_topics_do_not_suppress_assignment(self):
        row={"type":"assignment","componentId":"a","sessionDate":"2026-10-06","assignmentTopics":[{"id":"1"},{"id":"2"}]}
        self.assertFalse(next(assignment_events([row],{},{"a":{"1":"accepted"}}))["submitted"])
        self.assertTrue(next(assignment_events([row],{},{"a":{"1":"accepted","2":"submitted_for_tutor_review"}}))["submitted"])
    def test_only_dated_learner_tasks(self):
        rows=list(task_events("m",{"actions":[{"owner":"Coach","dueDate":"2026-10-21"},{"owner":"Learner","dueDate":"tomorrow"},{"owner":"Learner","dueDate":"2026-10-21","status":"Completed"}]}))
        self.assertEqual(len(rows),1);self.assertTrue(rows[0]["completed"])

class WorkerTests(TestCase):
    def setUp(self):
        self.now=datetime(2026,10,20,9,tzinfo=timezone.utc)
        self.person=Principal(11,101,"learner","Synthetic learner","c")
        self.event={"key":"a","kind":"assignment","dueAt":self.now+timedelta(days=1),"target":{"screen":"work"}}
        self.item=reminder_plan(self.event)[1]
        self.n=Notification.objects.create(account_id=11,key=self.item["key"],category="assignments",body="Your assignment is due tomorrow.",due_at=self.item["dueAt"],source={"kind":"reminder","sourceKey":"a"})
        prefs=default_preferences();prefs["assignments"]["push"]=True
        Preference.objects.create(account_id=11,categories=prefs)
        self.device=Device.objects.create(account_id=11,session_id="7",token="synthetic-device-token-123")
        self.delivery=Delivery.objects.create(notification=self.n,device=self.device,next_attempt_at=self.now)
        self.sender=Mock();self.sender.send.return_value=SendResult("sent","provider:test")
    def dispatch(self,**event):
        with patch("mobile_comms.worker.principal",return_value=self.person),patch("mobile_comms.worker.LoginSession.objects") as sessions,patch("mobile_comms.sources.events_for",return_value={"a":{**self.event,**event}}):
            sessions.filter.return_value.exists.return_value=True
            return dispatch_one(self.delivery.pk,self.sender,self.now)
    def test_success_and_duplicate_tick(self):
        self.assertEqual(self.dispatch(),"sent")
        self.assertEqual(self.dispatch(),"claimed");self.sender.send.assert_called_once()
    def test_submission_between_schedule_and_delivery(self):
        self.assertEqual(self.dispatch(submitted=True),"suppressed");self.sender.send.assert_not_called()
    def test_reschedule_cancels_old_job(self):
        reconcile(11,{"a":{**self.event,"dueAt":self.event["dueAt"]+timedelta(days=1)}},self.now)
        self.n.refresh_from_db();self.assertIsNotNone(self.n.cancelled_at)
    def test_transferred_token_never_delivers_to_other_account(self):
        self.device.account_id=12;self.device.save()
        self.assertEqual(self.dispatch(),"suppressed");self.sender.send.assert_not_called()
    def test_revoked_session_stops_push(self):
        with patch("mobile_comms.worker.principal",return_value=self.person),patch("mobile_comms.worker.LoginSession.objects") as sessions:
            sessions.filter.return_value.exists.return_value=False
            self.assertEqual(dispatch_one(self.delivery.pk,self.sender,self.now),"suppressed")
        self.sender.send.assert_not_called()
    def test_preference_change_stops_push(self):
        Preference.objects.filter(pk=11).update(categories=default_preferences())
        self.assertEqual(self.dispatch(),"suppressed")
    def test_disabled_account_stops_push(self):
        with patch("mobile_comms.worker.principal",side_effect=AccessError()):
            self.assertEqual(dispatch_one(self.delivery.pk,self.sender,self.now),"suppressed")
    def test_expired_job_is_not_delivered(self):
        self.now+=timedelta(minutes=11)
        self.assertEqual(self.dispatch(),"suppressed")
    def test_provider_unregistered_deactivates_token(self):
        self.sender.send.return_value=SendResult("invalid-device")
        self.assertEqual(self.dispatch(),"invalid-device");self.device.refresh_from_db();self.assertFalse(self.device.active)
    def test_retry_is_delayed(self):
        self.sender.send.return_value=SendResult("retry",retry_seconds=120)
        self.assertEqual(self.dispatch(),"retry");self.assertEqual(self.dispatch(),"claimed")
    def test_late_attendance_cancels_followup(self):
        event={"key":"meeting","kind":"session","startsAt":self.now-timedelta(minutes=15),"attended":True,"target":{"screen":"meetings"}}
        before={**event,"attended":False};item=reminder_plan(before)[2]
        self.n.key=item["key"];self.n.source={"kind":"reminder","sourceKey":"meeting"};self.n.save()
        self.assertFalse(current_notification(self.n,self.person,self.now,events={"meeting":event},dispatch=True))
    def test_reconcile_idempotent(self):
        reconcile(11,{"a":self.event},self.now);first=Notification.objects.count()
        reconcile(11,{"a":self.event},self.now);self.assertEqual(Notification.objects.count(),first)
    def test_original_schedule_can_be_restored_without_erasing_delivery_history(self):
        reconcile(11,{},self.now)
        self.n.refresh_from_db();self.assertIsNotNone(self.n.cancelled_at)
        reconcile(11,{"a":self.event},self.now)
        self.n.refresh_from_db();self.assertIsNone(self.n.cancelled_at)
        self.assertTrue(Delivery.objects.filter(pk=self.delivery.pk).exists())
