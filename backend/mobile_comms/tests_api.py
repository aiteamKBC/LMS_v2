import json, uuid
from types import SimpleNamespace
from unittest.mock import patch
from django.test import TestCase, RequestFactory
from . import identity, views
from .models import Thread, Message, Notification, Preference
from .identity import Principal, AccessError

class MessagingTests(TestCase):
    def setUp(self):
        self.a=Principal(11,101,"learner","Learner A","cohort-1")
        self.b=Principal(12,102,"learner","Learner B","cohort-1")
        self.other=Principal(13,103,"learner","Other cohort","cohort-2")
        self.coach=Principal(21,201,"coach","Coach",email="coach@example.test")
        self.factory=RequestFactory()
    def call(self,fn,user=None,data=None,**kw):
        request=(self.factory.get("/") if data is None else self.factory.post("/",json.dumps(data),
            content_type="application/json",HTTP_X_REQUESTED_WITH="XMLHttpRequest"))
        with patch.object(identity,"authenticate",return_value=user or self.a):
            return fn(request,**kw)
    def peer(self):
        return Thread.objects.create(key="pair",kind="peer",cohort_id="cohort-1",learner_a=101,learner_b=102)
    def resolve(self,id):
        return {101:self.a,102:self.b,103:self.other}[id]
    def test_peer_members_can_read(self):
        t=self.peer()
        with patch.object(identity,"active_learner",side_effect=self.resolve):
            self.assertEqual(self.call(views.messages,thread_id=t.pk).status_code,200)
            self.assertEqual(self.call(views.messages,user=self.b,thread_id=t.pk).status_code,200)
    def test_outsider_cannot_read_or_send(self):
        t=self.peer()
        with patch.object(identity,"active_learner",side_effect=self.resolve):
            self.assertEqual(self.call(views.messages,user=self.other,thread_id=t.pk).status_code,403)
            self.assertEqual(self.call(views.messages,user=self.other,data={"body":"x","clientId":str(uuid.uuid4())},thread_id=t.pk).status_code,403)
        self.assertEqual(Message.objects.count(),0)
    def test_moved_learner_loses_existing_thread(self):
        t=self.peer()
        moved=Principal(12,102,"learner","B","cohort-2")
        with patch.object(identity,"active_learner",side_effect=lambda id:self.a if id==101 else moved):
            self.assertEqual(self.call(views.messages,thread_id=t.pk).status_code,403)
    def test_idempotent_send_and_generic_notification(self):
        t=self.peer();data={"body":"Hello","clientId":str(uuid.uuid4())}
        with patch.object(identity,"active_learner",side_effect=self.resolve):
            self.assertEqual(self.call(views.messages,data=data,thread_id=t.pk).status_code,201)
            self.assertEqual(self.call(views.messages,data=data,thread_id=t.pk).status_code,200)
            self.assertEqual(self.call(views.messages,data={**data,"body":"changed"},thread_id=t.pk).status_code,409)
        self.assertEqual(Message.objects.count(),1)
        n=Notification.objects.get()
        self.assertEqual(n.account_id,self.b.account_id)
        self.assertNotIn("Hello",n.body)
    def test_rejects_client_sender(self):
        t=self.peer()
        with patch.object(identity,"active_learner",side_effect=self.resolve):
            response=self.call(views.messages,data={"body":"x","clientId":str(uuid.uuid4()),"senderId":12},thread_id=t.pk)
        self.assertEqual(response.status_code,400)
    def test_read_cursor_cannot_reference_other_thread(self):
        t=self.peer();other=Thread.objects.create(key="other",kind="cohort",cohort_id="cohort-2")
        m=Message.objects.create(thread=other,account_id=13,sender_name="C",body="x",client_id=uuid.uuid4())
        with patch.object(identity,"active_learner",side_effect=self.resolve):
            self.assertEqual(self.call(views.read_thread,data={"messageId":m.pk},thread_id=t.pk).status_code,400)
    def test_cohort_access_requires_exact_stable_id(self):
        t=Thread.objects.create(key="cohort",kind="cohort",cohort_id="cohort-1")
        self.assertEqual(self.call(views.messages,thread_id=t.pk).status_code,200)
        self.assertEqual(self.call(views.messages,user=self.other,thread_id=t.pk).status_code,403)
        self.assertEqual(self.call(views.messages,user=self.coach,thread_id=t.pk).status_code,403)
    def test_assignment_change_revokes_previous_coach(self):
        t=Thread.objects.create(key="coach",kind="coach",learner_a=101,coach_id=201)
        reassigned=Principal(22,202,"coach","New coach",email="other@example.test")
        with patch.object(identity,"active_learner",return_value=self.a),patch.object(identity,"coach_for",return_value=reassigned):
            self.assertEqual(self.call(views.messages,user=self.coach,thread_id=t.pk).status_code,403)
    def test_missing_security_header_rejected(self):
        request=self.factory.post("/",data="{}",content_type="application/json")
        self.assertEqual(views.preferences(request).status_code,403)
    def test_cross_origin_write_rejected(self):
        request=self.factory.post("/",data="{}",content_type="application/json",HTTP_X_REQUESTED_WITH="XMLHttpRequest",HTTP_ORIGIN="https://other.example")
        self.assertEqual(views.preferences(request).status_code,403)
    def test_missing_session_rejected(self):
        with patch.object(identity,"authenticate",side_effect=AccessError("Please sign in.",401)):
            self.assertEqual(views.session(self.factory.get("/")).status_code,401)
    def test_inbox_owner_boundary(self):
        Notification.objects.create(account_id=12,key="x",category="meetings",body="Private")
        self.assertEqual(json.loads(self.call(views.inbox).content)["notifications"],[])
    def test_preferences_have_independent_channels(self):
        from .policy import default_preferences
        p=default_preferences();p["cohort_messages"]={"inApp":True,"push":False}
        p["private_messages"]={"inApp":False,"push":True}
        self.assertEqual(self.call(views.preferences,data={"categories":p}).status_code,200)
        self.assertEqual(Preference.objects.get().categories,p)
    def test_preferences_do_not_change_other_accounts(self):
        self.call(views.preferences,data={"categories":__import__("mobile_comms.policy",fromlist=["default_preferences"]).default_preferences()})
        self.assertFalse(Preference.objects.filter(account_id=12).exists())
