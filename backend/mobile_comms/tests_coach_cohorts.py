"""Coach class-chat boundaries with synthetic identities and real chat persistence.

Unmanaged identity-table queries are isolated here. check_postgres exercises those
queries against real fresh PostgreSQL tables; no provider is called by either suite.
"""
import json
import uuid
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import TestCase, RequestFactory, SimpleTestCase
from django.utils import timezone

from . import identity, views, worker
from .identity import Principal, AccessError
from .models import Thread, Message, Notification, Preference, Device, Delivery
from .policy import default_preferences


class CohortRosterTests(SimpleTestCase):
    def setUp(self):
        self.a = Principal(11, 101, "learner", "A", "c1", "coach@example.test", cohort_name="Class One")
        self.b = Principal(12, 102, "learner", "B", "c1", "other@example.test", cohort_name="Class One")
        self.coach = Principal(21, 201, "coach", "Coach", email="coach@example.test")
        self.other = Principal(22, 202, "coach", "Other", email="other@example.test")

    def roster(self, people, coaches):
        query = Mock()
        query.annotate.return_value.filter.return_value = query
        with patch.object(identity, "active_profiles", return_value=query), \
             patch.object(identity, "eligible_learners", return_value=iter(people)), \
             patch.object(identity, "coach_for", side_effect=coaches):
            result = identity.cohort_members("c1")
        query.annotate.return_value.filter.assert_called_once_with(cohort_key="c1")
        return result

    def test_class_roster_includes_all_class_learners_and_their_coaches_once(self):
        members = self.roster([self.a, self.b], [self.coach, self.coach])
        self.assertEqual({p.account_id for p in members}, {11, 12, 21})
        self.assertEqual(identity.cohort_name(members), "Class One")

    def test_cohort_moved_between_candidate_query_and_resolution_is_excluded(self):
        members = self.roster([self.a, replace(self.b, cohort_id="c2")], [self.coach])
        self.assertEqual({p.account_id for p in members}, {11, 21})

    def test_ambiguous_or_revoked_coach_is_excluded_without_removing_learners(self):
        members = self.roster([self.a, self.b], [AccessError(), self.other])
        self.assertEqual({p.account_id for p in members}, {11, 12, 22})

    def test_invalid_cohort_identifier_never_queries_profiles(self):
        with patch.object(identity, "active_profiles") as profiles:
            for value in (None, "", " c1", "c1 ", "x" * 65, []):
                with self.subTest(value=value), self.assertRaises(AccessError):
                    identity.cohort_members(value)
        profiles.assert_not_called()

    def test_coach_directory_rechecks_unique_current_coach_assignment(self):
        query = Mock()
        query.annotate.return_value.filter.return_value = query
        with patch.object(identity, "active_profiles", return_value=query), \
             patch.object(identity, "eligible_learners", return_value=iter([self.a, self.b])), \
             patch.object(identity, "coach_for", side_effect=[self.coach, self.other]):
            learners = identity.assigned_learners(self.coach)
        self.assertEqual(learners, [self.a])
        query.annotate.return_value.filter.assert_called_once_with(coach_key=self.coach.email)

    def test_groups_use_exact_ids_and_deduplicate_without_title_identity(self):
        with patch.object(identity, "assigned_learners", return_value=[
            self.a, self.a, replace(self.b, cohort_id="c2"), replace(self.b, cohort_id="")]):
            groups = identity.cohort_directory(self.coach)
        self.assertEqual(groups, [{"id":"c1", "name":"Class One"}, {"id":"c2", "name":"Class One"}])

    def test_learner_group_directory_uses_fresh_identity_not_old_principal(self):
        with patch.object(identity, "active_learner", return_value=replace(self.a, cohort_id="c2")):
            self.assertEqual(identity.cohort_directory(self.a), [{"id":"c2", "name":"Class One"}])
        with patch.object(identity, "active_learner", return_value=replace(self.a, account_id=99)):
            self.assertEqual(identity.cohort_directory(self.a), [])

    def test_shared_coach_is_resolved_once_per_roster_not_per_learner(self):
        query = Mock()
        query.annotate.return_value.filter.return_value = query
        people = [self.a, replace(self.b, coach_email=self.a.coach_email)]
        with patch.object(identity, "active_profiles", return_value=query), \
             patch.object(identity, "eligible_learners", side_effect=lambda _: iter(people)), \
             patch.object(identity, "coach_for", return_value=self.coach) as resolve:
            self.assertEqual({p.account_id for p in identity.cohort_members("c1")}, {11, 12, 21})
            resolve.assert_called_once()
            self.assertEqual(identity.assigned_learners(self.coach), people)
            self.assertEqual(resolve.call_count, 2, "Each roster gets its own fresh grant check")

    def test_shared_denial_is_memoized_only_within_roster(self):
        query = Mock()
        query.annotate.return_value.filter.return_value = query
        people = [self.a, replace(self.b, coach_email=self.a.coach_email)]
        with patch.object(identity, "active_profiles", return_value=query), \
             patch.object(identity, "eligible_learners", side_effect=lambda _: iter(people)), \
             patch.object(identity, "coach_for", side_effect=[AccessError(), self.coach]) as resolve:
            self.assertEqual({p.account_id for p in identity.cohort_members("c1")}, {11, 12})
            resolve.assert_called_once()
            self.assertEqual({p.account_id for p in identity.cohort_members("c1")}, {11, 12, 21})
            self.assertEqual(resolve.call_count, 2)

    def test_permission_revocation_is_seen_by_the_next_roster(self):
        query = Mock()
        query.annotate.return_value.filter.return_value = query
        with patch.object(identity, "active_profiles", return_value=query), \
             patch.object(identity, "eligible_learners", side_effect=lambda _: iter([self.a])), \
             patch.object(identity, "coach_for", side_effect=[self.coach, AccessError()]):
            self.assertIn(self.coach, identity.cohort_members("c1"))
            self.assertNotIn(self.coach, identity.cohort_members("c1"))


class CoachClassChatTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.a = Principal(11, 101, "learner", "A", "c1", cohort_name="Class One")
        self.b = Principal(12, 102, "learner", "B", "c1", cohort_name="Class One")
        self.c = Principal(13, 103, "learner", "C", "c2", cohort_name="Class Two")
        self.coach = Principal(21, 201, "coach", "Coach", email="coach@example.test")
        self.other = Principal(22, 202, "coach", "Other", email="other@example.test")
        self.rosters = {"c1":[self.a, self.b, self.coach, self.other], "c2":[self.c, self.coach]}
        self.roster_patch = patch.object(identity, "cohort_members", side_effect=lambda cid:self.rosters.get(cid, []))
        self.roster_patch.start()
        self.addCleanup(self.roster_patch.stop)
        self.group = Thread.objects.create(key="cohort:c1", kind="cohort", cohort_id="c1")
        self.other_group = Thread.objects.create(key="cohort:c2", kind="cohort", cohort_id="c2")

    def call(self, fn, user=None, data=None, **kwargs):
        request = (self.factory.get("/") if data is None else
                   self.factory.post("/", json.dumps(data), content_type="application/json",
                                     HTTP_X_REQUESTED_WITH="XMLHttpRequest"))
        with patch.object(identity, "authenticate", return_value=user or self.coach):
            return fn(request, **kwargs)

    def test_coach_can_join_read_history_and_send_to_assigned_class(self):
        Message.objects.create(thread=self.group, account_id=12, sender_name="B",
                               body="Existing class discussion", client_id=uuid.uuid4())
        response = self.call(views.threads, data={"kind":"cohort", "cohortId":"c1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["cohortId"], "c1")
        self.assertEqual(json.loads(response.content)["name"], "Class One")
        read = self.call(views.messages, thread_id=self.group.pk)
        self.assertEqual(json.loads(read.content)["messages"][0]["body"], "Existing class discussion")
        send = self.call(views.messages, data={"body":"Class update", "clientId":str(uuid.uuid4())},
                         thread_id=self.group.pk)
        self.assertEqual(send.status_code, 201)

    def test_coach_send_notifies_exact_class_including_other_coach_not_whole_caseload(self):
        with patch.object(identity, "peer_directory", side_effect=AssertionError("Caseload is not class recipients")):
            response = self.call(views.messages, data={"body":"Class update", "clientId":str(uuid.uuid4())},
                                 thread_id=self.group.pk)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(set(Notification.objects.values_list("account_id", flat=True)), {11, 12, 22})
        self.assertTrue(all(n.body == "You have a new KBC message." for n in Notification.objects.all()))

    def test_learner_class_send_notifies_eligible_coaches(self):
        response = self.call(views.messages, user=self.a,
                             data={"body":"Question", "clientId":str(uuid.uuid4())}, thread_id=self.group.pk)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(set(Notification.objects.values_list("account_id", flat=True)), {12, 21, 22})

    def test_outsider_cannot_join_read_send_or_mark_class_read(self):
        for fn, data, kwargs in (
            (views.threads, {"kind":"cohort", "cohortId":"c2"}, {}),
            (views.messages, None, {"thread_id":self.other_group.pk}),
            (views.messages, {"body":"x", "clientId":str(uuid.uuid4())}, {"thread_id":self.other_group.pk}),
            (views.read_thread, {"messageId":1}, {"thread_id":self.other_group.pk}),
        ):
            with self.subTest(fn=fn.__name__):
                self.assertEqual(self.call(fn, user=self.other, data=data, **kwargs).status_code, 403)
        self.assertEqual(Message.objects.count(), 0)
        self.assertEqual(Notification.objects.count(), 0)

    def test_legacy_learner_join_preserved_and_cross_class_join_refused(self):
        self.assertEqual(self.call(views.threads, user=self.a, data={"kind":"cohort"}).status_code, 200)
        self.assertEqual(self.call(views.threads, user=self.a,
                                  data={"kind":"cohort", "cohortId":"c2"}).status_code, 403)

    def test_last_assignment_removal_revokes_existing_thread_and_inbox(self):
        notice = Notification.objects.create(account_id=21, key="revoked", category="cohort_messages",
            body="You have a new KBC message.", source={"kind":"message", "threadId":str(self.group.pk)})
        self.rosters["c1"] = [self.a, self.b, self.other]
        self.assertEqual(self.call(views.messages, thread_id=self.group.pk).status_code, 403)
        self.assertEqual(self.call(views.messages, data={"body":"x", "clientId":str(uuid.uuid4())},
                                  thread_id=self.group.pk).status_code, 403)
        with patch.object(identity, "cohort_directory", return_value=[{"id":"c2", "name":"Class Two"}]):
            listed = json.loads(self.call(views.threads).content)["threads"]
        self.assertEqual([row["id"] for row in listed], [str(self.other_group.pk)])
        self.assertEqual(json.loads(self.call(views.inbox).content)["notifications"], [])
        self.assertTrue(Notification.objects.filter(pk=notice.pk).exists())

    def test_revocation_is_rechecked_inside_send_transaction(self):
        with patch.object(identity, "participants", side_effect=[[self.a, self.coach], AccessError()]):
            result = self.call(views.messages, data={"body":"x", "clientId":str(uuid.uuid4())},
                               thread_id=self.group.pk)
        self.assertEqual(result.status_code, 403)
        self.assertEqual(Message.objects.count(), 0)
        self.assertEqual(Notification.objects.count(), 0)

    def test_cohort_send_keeps_idempotency_and_account_owned_sender(self):
        payload = {"body":"Hello", "clientId":str(uuid.uuid4())}
        first = self.call(views.messages, data=payload, thread_id=self.group.pk)
        second = self.call(views.messages, data=payload, thread_id=self.group.pk)
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(Message.objects.get().account_id, self.coach.account_id)
        self.assertEqual(Notification.objects.count(), 3)

    def test_coach_cannot_read_private_peer_thread_or_dm_unassigned_classmate(self):
        peer = Thread.objects.create(key="peer:c1:101:102", kind="peer", cohort_id="c1", learner_a=101, learner_b=102)
        with patch.object(identity, "active_learner", side_effect=lambda sid:{101:self.a, 102:self.b}[sid]):
            self.assertEqual(self.call(views.messages, thread_id=peer.pk).status_code, 403)
            with patch.object(identity, "coach_for", return_value=self.other):
                self.assertEqual(self.call(views.threads, data={"kind":"coach", "recipientId":"102"}).status_code, 403)

    def test_cohort_id_cannot_be_used_to_change_private_thread_scope(self):
        for kind in ("peer", "coach"):
            self.assertEqual(self.call(views.threads, data={"kind":kind, "recipientId":"101", "cohortId":"c1"}).status_code, 400)

    def test_directory_keeps_existing_fields_and_adds_current_groups(self):
        with patch.object(identity, "peer_directory", return_value=[{"id":"101", "name":"A"}]), \
             patch.object(identity, "cohort_directory", return_value=[{"id":"c1", "name":"Class One"}]):
            payload = json.loads(self.call(views.directory).content)
        self.assertEqual(payload, {"people":[{"id":"101", "name":"A"}], "coach":None,
                                  "groups":[{"id":"c1", "name":"Class One"}]})

    def test_revoked_class_membership_suppresses_queued_push(self):
        now = timezone.now()
        notice = Notification.objects.create(account_id=21, key="queued", category="cohort_messages",
            body="You have a new KBC message.", source={"kind":"message", "threadId":str(self.group.pk)})
        choices = default_preferences()
        choices["cohort_messages"]["push"] = True
        Preference.objects.create(account_id=21, categories=choices)
        device = Device.objects.create(account_id=21, session_id="synthetic", token="synthetic-device-token")
        delivery = Delivery.objects.create(notification=notice, device=device, next_attempt_at=now)
        sender = Mock()
        self.rosters["c1"] = [self.a, self.b, self.other]
        with patch.object(worker, "principal", return_value=self.coach), patch.object(worker.LoginSession, "objects") as sessions:
            sessions.filter.return_value.exists.return_value = True
            self.assertEqual(worker.dispatch_one(delivery.pk, sender, now), "suppressed")
        sender.send.assert_not_called()

