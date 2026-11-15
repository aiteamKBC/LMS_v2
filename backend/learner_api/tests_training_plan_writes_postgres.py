"""Phase-1 writer integration checks.

Run only against the disposable Neon branch through the repository's guarded
``USE_SECURITY_TEST_BRANCH`` mode.  These tests intentionally exercise real
PostgreSQL transactions, row locks, FK constraints and unique positions.
"""

from __future__ import annotations

import copy
import json
import threading
import unittest
import uuid
from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.db import close_old_connections, connections
from django.test import RequestFactory, TestCase

from curriculum_api.models import (
    ModuleAuthoringComponent,
    ModuleAuthoringModule,
    ModuleAuthoringWeek,
)
from learner_api.models import (
    EnrolmentUser,
    LearnerProfile,
    LearnerProgressEntry,
    LearnerTrainingPlanComponent,
    LearnerTrainingPlanModule,
    LearnerTrainingPlanWeek,
)
from learner_api.training_plan_writes import (
    TrainingPlanAuthorization,
    TrainingPlanAuthorizationError,
    TrainingPlanDependencyConflict,
    TrainingPlanReparentingConflict,
    TrainingPlanValidationError,
    TrainingPlanVersionConflict,
    empty_training_plan_version,
    reconcile_training_plan,
    training_plan_snapshot,
)
from learner_api import learning_plan as learning_plan_editor


DB = "enrolment"


def _payload_for(learner_id: int):
    modules = list(
        LearnerTrainingPlanModule._base_manager.using(DB)
        .filter(learner_id=learner_id)
        .order_by("position", "id")
    )
    weeks = list(
        LearnerTrainingPlanWeek._base_manager.using(DB)
        .filter(plan_module_id__in=[row.id for row in modules])
        .order_by("position", "id")
    )
    components = list(
        LearnerTrainingPlanComponent._base_manager.using(DB)
        .filter(plan_week_id__in=[row.id for row in weeks])
        .order_by("position", "id")
    )
    weeks_by_module = defaultdict(list)
    components_by_week = defaultdict(list)
    for week in weeks:
        weeks_by_module[week.plan_module_id].append(week)
    for component in components:
        components_by_week[component.plan_week_id].append(component)
    return [
        {
            "moduleId": module.curriculum_module_id,
            "weeks": [
                {
                    "weekId": week.curriculum_week_id,
                    "components": [
                        {"componentId": component.curriculum_component_id}
                        for component in components_by_week[week.id]
                    ],
                }
                for week in weeks_by_module[module.id]
            ],
        }
        for module in modules
    ]


class CanonicalTrainingPlanWriterPostgresTests(TestCase):
    databases = {DB}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not settings.USE_SECURITY_TEST_BRANCH:
            raise AssertionError("Refusing writer tests outside guarded security-branch mode.")
        if connections[DB].vendor != "postgresql":
            raise AssertionError("Phase-1 writer integration tests require PostgreSQL.")

    @classmethod
    def setUpTestData(cls):
        components = list(
            ModuleAuthoringComponent.objects.using(DB)
            .order_by("module_catalogue_id", "week_id", "display_order", "id")
            .values("id", "week_id", "module_catalogue_id")[:10000]
        )
        by_module = defaultdict(lambda: defaultdict(list))
        for component in components:
            by_module[component["module_catalogue_id"]][component["week_id"]].append(
                component["id"]
            )
        eligible_modules = {
            row["module_catalogue_id"]: row["programme_id"]
            for row in ModuleAuthoringModule.objects.using(DB)
            .filter(module_catalogue_id__in=by_module)
            .exclude(programme_id=None)
            .values("module_catalogue_id", "programme_id")
        }
        candidate = next(
            (
                item for item in by_module.items()
                if item[0] in eligible_modules
                and len(item[1]) >= 2
                and max(map(len, item[1].values())) >= 2
            ),
            None,
        )
        if candidate is None:
            raise AssertionError("The isolated PostgreSQL snapshot has no suitable Curriculum hierarchy.")
        cls.module_id, week_map = candidate
        cls.week_ids = list(week_map)[:2]
        component_week = next(week_id for week_id, values in week_map.items() if len(values) >= 2)
        if component_week != cls.week_ids[0]:
            cls.week_ids.remove(component_week)
            cls.week_ids.insert(0, component_week)
        cls.component_ids = list(week_map[cls.week_ids[0]])[:2]

        module_record = ModuleAuthoringModule.objects.using(DB).get(pk=cls.module_id)
        other = (
            ModuleAuthoringModule.objects.using(DB)
            .exclude(pk=cls.module_id)
            .exclude(programme_id=module_record.programme_id)
            .exclude(programme_id=None)
            .first()
        )
        if other is None:
            raise AssertionError("The isolated snapshot needs at least two Curriculum modules.")
        cls.other_module_id = other.pk
        cls.module_programme_id = module_record.programme_id
        cls.other_programme_id = other.programme_id

        suffix = uuid.uuid4().hex
        cls.learner = LearnerProfile._base_manager.using(DB).create(
            full_name="Phase One Writer Test",
            email=f"phase1-writer-{suffix}@example.invalid",
            phone_number="",
            lifecycle_status="active",
            learner_type="commercial",
            programme_status="",
            programme_id=None,
        )
        cls.placed_learner = LearnerProfile._base_manager.using(DB).create(
            full_name="Phase One Cross Programme Test",
            email=f"phase1-cross-{suffix}@example.invalid",
            phone_number="",
            lifecycle_status="active",
            learner_type="commercial",
            programme_status="",
            programme_id=cls.module_programme_id,
        )
        cls.editor_source = EnrolmentUser.all_learners.using(DB).create(
            username="Phase Two Editor Test",
            email=f"phase2-editor-{suffix}@example.invalid",
            learner_type="commercial",
            programme_status="Active",
            programme_id=cls.module_programme_id,
        )
        cls.editor_learner = LearnerProfile._base_manager.using(DB).create(
            enrolment_id=cls.editor_source.pk,
            full_name="Phase Two Editor Test",
            email=f"phase2-editor-profile-{suffix}@example.invalid",
            phone_number="",
            lifecycle_status="active",
            learner_type="commercial",
            programme_status="Active",
            programme_id=None,
        )

    def _auth(self, learner=None):
        return TrainingPlanAuthorization.for_learner((learner or self.learner).id)

    def _tree(self):
        return [
            {
                "moduleId": self.module_id,
                "weeks": [
                    {
                        "weekId": self.week_ids[0],
                        "components": [
                            {"componentId": self.component_ids[0]},
                            {"componentId": self.component_ids[1]},
                        ],
                    },
                    {"weekId": self.week_ids[1], "components": []},
                ],
            }
        ]

    def test_initial_create_repeat_update_and_stable_ids(self):
        first = reconcile_training_plan(self.learner.id, self._tree(), authorization=self._auth())
        first_ids = (
            first.plan[0]["id"],
            first.plan[0]["weeks"][0]["id"],
            first.plan[0]["weeks"][0]["components"][0]["id"],
        )
        self.assertTrue(first.changed)
        self.assertEqual(first.changes["modules"]["created"], 1)

        repeated = reconcile_training_plan(
            self.learner.id,
            self._tree(),
            authorization=self._auth(),
            expected_version=first.plan_version,
        )
        repeated_ids = (
            repeated.plan[0]["id"],
            repeated.plan[0]["weeks"][0]["id"],
            repeated.plan[0]["weeks"][0]["components"][0]["id"],
        )
        self.assertFalse(repeated.changed)
        self.assertEqual(repeated.plan_version, first.plan_version)
        self.assertEqual(repeated_ids, first_ids)

        updated_tree = self._tree()
        updated_tree.append({"moduleId": self.other_module_id, "weeks": []})
        updated = reconcile_training_plan(
            self.learner.id,
            updated_tree,
            authorization=self._auth(),
            expected_version=repeated.plan_version,
        )
        self.assertEqual(updated.plan[0]["id"], first_ids[0])
        self.assertEqual(updated.plan[0]["weeks"][0]["id"], first_ids[1])
        self.assertEqual(updated.plan[0]["weeks"][0]["components"][0]["id"], first_ids[2])
        self.assertEqual(updated.changes["modules"]["created"], 1)

    def test_module_week_component_insert_reorder_and_remove_preserve_ids(self):
        created = reconcile_training_plan(self.learner.id, self._tree(), authorization=self._auth())
        original_module_id = created.plan[0]["id"]
        original_week_ids = [row["id"] for row in created.plan[0]["weeks"]]
        original_component_ids = [
            row["id"] for row in created.plan[0]["weeks"][0]["components"]
        ]

        reordered = self._tree()
        reordered[0]["weeks"].reverse()
        reordered[0]["weeks"][1]["components"].reverse()
        reordered.insert(0, {"moduleId": self.other_module_id, "weeks": []})
        result = reconcile_training_plan(
            self.learner.id,
            reordered,
            authorization=self._auth(),
            expected_version=created.plan_version,
            reorder=True,
        )
        retained = next(row for row in result.plan if row["moduleId"] == self.module_id)
        self.assertEqual(retained["id"], original_module_id)
        self.assertEqual(
            {row["id"] for row in retained["weeks"]}, set(original_week_ids)
        )
        component_week = next(row for row in retained["weeks"] if row["weekId"] == self.week_ids[0])
        self.assertEqual(
            [row["id"] for row in component_week["components"]],
            list(reversed(original_component_ids)),
        )
        self.assertGreater(result.changes["weeks"]["moved"], 0)
        self.assertGreater(result.changes["components"]["moved"], 0)

        removal = [
            {
                "moduleId": self.module_id,
                "weeks": [{"weekId": self.week_ids[0], "components": []}],
            }
        ]
        removed = reconcile_training_plan(
            self.learner.id,
            removal,
            authorization=self._auth(),
            expected_version=result.plan_version,
        )
        self.assertEqual(removed.plan[0]["id"], original_module_id)
        self.assertEqual(removed.changes["modules"]["deleted"], 1)
        self.assertEqual(removed.changes["weeks"]["deleted"], 1)
        self.assertEqual(removed.changes["components"]["deleted"], 2)

    def test_modules_without_weeks_weeks_without_components_and_empty_plan(self):
        no_weeks = [{"moduleId": self.other_module_id, "weeks": []}]
        created = reconcile_training_plan(self.learner.id, no_weeks, authorization=self._auth())
        self.assertEqual(created.plan[0]["weeks"], [])

        no_components = [
            {
                "moduleId": self.module_id,
                "weeks": [{"weekId": self.week_ids[0], "components": []}],
            }
        ]
        updated = reconcile_training_plan(
            self.learner.id,
            no_components,
            authorization=self._auth(),
            expected_version=created.plan_version,
        )
        self.assertEqual(updated.plan[0]["weeks"][0]["components"], [])

        emptied = reconcile_training_plan(
            self.learner.id,
            [],
            authorization=self._auth(),
            expected_version=updated.plan_version,
        )
        self.assertEqual(emptied.plan, ())

    def test_nullable_placement_and_cross_programme_assignments(self):
        self.assertIsNone(self.learner.programme_id)
        nullable = reconcile_training_plan(
            self.learner.id,
            [{"moduleId": self.module_id, "weeks": []}],
            authorization=self._auth(),
        )
        self.assertEqual(nullable.plan[0]["moduleId"], self.module_id)

        cross = reconcile_training_plan(
            self.placed_learner.id,
            [{"moduleId": self.other_module_id, "weeks": []}],
            authorization=self._auth(self.placed_learner),
        )
        self.assertEqual(cross.plan[0]["moduleId"], self.other_module_id)
        self.assertNotEqual(self.placed_learner.programme_id, self.other_programme_id)

    def test_invalid_fk_hierarchy_duplicate_and_unauthorized_roll_back(self):
        initial = reconcile_training_plan(self.learner.id, self._tree(), authorization=self._auth())
        before = _payload_for(self.learner.id)

        cases = (
            (
                [{"moduleId": "missing-phase1-module", "weeks": []}],
                "unknown_curriculum_assignment",
            ),
            (
                [{"moduleId": self.other_module_id, "weeks": [{"weekId": self.week_ids[0], "components": []}]}],
                "invalid_curriculum_hierarchy",
            ),
            (
                [self._tree()[0], self._tree()[0]],
                "duplicate_module_assignment",
            ),
        )
        for payload, code in cases:
            with self.subTest(code=code):
                with self.assertRaises(TrainingPlanValidationError) as caught:
                    reconcile_training_plan(
                        self.learner.id,
                        payload,
                        authorization=self._auth(),
                        expected_version=initial.plan_version,
                    )
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(_payload_for(self.learner.id), before)

        with self.assertRaises(TrainingPlanAuthorizationError):
            reconcile_training_plan(
                self.learner.id,
                [],
                authorization=TrainingPlanAuthorization.for_learner(self.placed_learner.id),
            )
        self.assertEqual(_payload_for(self.learner.id), before)

    def test_stale_version_is_rejected_after_locked_version_check(self):
        empty = reconcile_training_plan(self.learner.id, [], authorization=self._auth())
        first = reconcile_training_plan(
            self.learner.id,
            [{"moduleId": self.module_id, "weeks": []}],
            authorization=self._auth(),
            expected_version=empty.plan_version,
        )
        with self.assertRaises(TrainingPlanVersionConflict) as caught:
            reconcile_training_plan(
                self.learner.id,
                [{"moduleId": self.other_module_id, "weeks": []}],
                authorization=self._auth(),
                expected_version=empty.plan_version,
            )
        self.assertEqual(caught.exception.code, "stale_plan_version")
        self.assertEqual(caught.exception.details["currentPlanVersion"], first.plan_version)
        self.assertEqual(_payload_for(self.learner.id), [{"moduleId": self.module_id, "weeks": []}])

    def test_position_gaps_survive_normal_reconcile_and_explicit_reorder_is_id_stable(self):
        payload = [
            {"moduleId": self.module_id, "weeks": []},
            {"moduleId": self.other_module_id, "weeks": []},
        ]
        created = reconcile_training_plan(self.learner.id, payload, authorization=self._auth())
        stable_ids = [row["id"] for row in created.plan]
        LearnerTrainingPlanModule._base_manager.using(DB).filter(
            pk=stable_ids[1]
        ).update(position=5)

        preserved = reconcile_training_plan(self.learner.id, payload, authorization=self._auth())
        self.assertFalse(preserved.changed)
        self.assertEqual([row["position"] for row in preserved.plan], [1, 5])

        reordered = reconcile_training_plan(
            self.learner.id,
            payload,
            authorization=self._auth(),
            expected_version=preserved.plan_version,
            reorder=True,
        )
        self.assertEqual([row["position"] for row in reordered.plan], [1, 2])
        self.assertEqual([row["id"] for row in reordered.plan], stable_ids)
        repeated = reconcile_training_plan(
            self.learner.id,
            payload,
            authorization=self._auth(),
            expected_version=reordered.plan_version,
            reorder=True,
        )
        self.assertFalse(repeated.changed)
        self.assertEqual(repeated.plan_version, reordered.plan_version)

    def test_editor_patch_is_versioned_id_stable_and_projects_canonical_json(self):
        view = learning_plan_editor.canonical_learning_plan
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__

        def patch_plan(module_ids, version, *, account=None):
            request = RequestFactory().patch(
                f"/learner_api/learning-plan/{self.editor_source.pk}/",
                data=json.dumps({
                    "modules": [{"moduleId": module_id} for module_id in module_ids],
                    "expectedPlanVersion": version,
                }),
                content_type="application/json",
            )
            request.login_account = account or SimpleNamespace(role="staff")
            with patch(
                "learner_api.learning_plan._serialize",
                side_effect=lambda learner, canonical_plan, plan_version: {
                    "plan": list(canonical_plan), "planVersion": plan_version,
                },
            ), patch(
                "learner_api.learning_plan._invalidate_training_plan_caches"
            ) as invalidate, patch(
                "learner_api.subject_cache.bump_learners"
            ), patch(
                "learner_api.read_model_signals.enqueue_learner_home_refresh"
            ), patch(
                "config.cache_versions.bump"
            ):
                with self.captureOnCommitCallbacks(using=DB, execute=True):
                    response = view(request, self.editor_source.pk)
            return response, invalidate

        empty = training_plan_snapshot(self.editor_learner.pk, using=DB)
        self.assertEqual(empty.plan, ())
        self.assertEqual(empty.plan_version, empty_training_plan_version())

        first_response, first_invalidate = patch_plan([self.module_id], empty.plan_version)
        self.assertEqual(first_response.status_code, 200)
        first = training_plan_snapshot(self.editor_learner.pk, using=DB)
        first_component_week = next(
            week for week in first.plan[0]["weeks"] if week["components"]
        )
        first_ids = (
            first.plan[0]["id"],
            first_component_week["id"],
            first_component_week["components"][0]["id"],
        )
        first_invalidate.assert_called_once()

        self.editor_source.refresh_from_db(using=DB)
        self.assertEqual(self.editor_source.training_plan[0]["moduleId"], self.module_id)
        self.assertNotIn("assignmentMode", self.editor_source.training_plan[0])
        self.assertTrue(self.editor_source.modules)

        repeated_response, _ = patch_plan([self.module_id], first.plan_version)
        self.assertEqual(repeated_response.status_code, 200)
        repeated = training_plan_snapshot(self.editor_learner.pk, using=DB)
        repeated_component_week = next(
            week for week in repeated.plan[0]["weeks"] if week["components"]
        )
        repeated_ids = (
            repeated.plan[0]["id"],
            repeated_component_week["id"],
            repeated_component_week["components"][0]["id"],
        )
        self.assertEqual(repeated_ids, first_ids)

        reordered_response, _ = patch_plan(
            [self.other_module_id, self.module_id], repeated.plan_version
        )
        self.assertEqual(reordered_response.status_code, 200)
        reordered = training_plan_snapshot(self.editor_learner.pk, using=DB)
        retained = next(row for row in reordered.plan if row["moduleId"] == self.module_id)
        self.assertEqual(retained["id"], first_ids[0])

        stale_response, stale_invalidate = patch_plan(
            [self.module_id], repeated.plan_version
        )
        self.assertEqual(stale_response.status_code, 409)
        stale_invalidate.assert_not_called()
        self.assertEqual(
            training_plan_snapshot(self.editor_learner.pk, using=DB).plan_version,
            reordered.plan_version,
        )

        empty_response, empty_invalidate = patch_plan([], reordered.plan_version)
        self.assertEqual(empty_response.status_code, 400)
        empty_invalidate.assert_not_called()
        self.assertEqual(
            training_plan_snapshot(self.editor_learner.pk, using=DB).plan_version,
            reordered.plan_version,
        )

        denied_response, denied_invalidate = patch_plan(
            [self.module_id], reordered.plan_version,
            account=SimpleNamespace(role="learner", subject_id=self.editor_source.pk + 1),
        )
        self.assertEqual(denied_response.status_code, 403)
        denied_invalidate.assert_not_called()


class CanonicalTrainingPlanHistoryProtectionPostgresTests(TestCase):
    databases = {DB}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not settings.USE_SECURITY_TEST_BRANCH:
            raise AssertionError("Refusing history tests outside guarded security-branch mode.")
        if connections[DB].vendor != "postgresql":
            raise AssertionError("History-protection integration tests require PostgreSQL.")

    def test_progress_dependency_blocks_cascade_and_keeps_link(self):
        # Choose the smallest linked plan so this safety proof remains focused
        # and does not transfer a very large learner plan over the test link.
        with connections[DB].cursor() as cursor:
            cursor.execute(
                '''
                with plan_sizes as (
                    select plan_module.learner_id, count(plan_component.id) as component_count
                    from "Learner".learner_training_plan_modules plan_module
                    left join "Learner".learner_training_plan_weeks plan_week
                      on plan_week.plan_module_id = plan_module.id
                    left join "Learner".learner_training_plan_components plan_component
                      on plan_component.plan_week_id = plan_week.id
                    group by plan_module.learner_id
                )
                select progress.id, progress.learner_id, progress.plan_component_id
                from "Learner".learner_progress_entries progress
                join plan_sizes on plan_sizes.learner_id = progress.learner_id
                where progress.plan_component_id is not null
                order by plan_sizes.component_count, progress.id
                limit 1
                '''
            )
            row = cursor.fetchone()
        linked = (
            {"id": row[0], "learner_id": row[1], "plan_component_id": row[2]}
            if row else None
        )
        self.assertIsNotNone(linked, "The isolated snapshot must retain linked historical progress.")
        payload = _payload_for(linked["learner_id"])
        target_component_id = (
            LearnerTrainingPlanComponent._base_manager.using(DB)
            .values_list("curriculum_component_id", flat=True)
            .get(pk=linked["plan_component_id"])
        )
        target_module_index = target_week_index = None
        for module_index, module in enumerate(payload):
            for week_index, week in enumerate(module["weeks"]):
                if any(item["componentId"] == target_component_id for item in week["components"]):
                    target_module_index = module_index
                    target_week_index = week_index
                    break
            if target_module_index is not None:
                break
        self.assertIsNotNone(target_module_index)

        direct = copy.deepcopy(payload)
        target_week = direct[target_module_index]["weeks"][target_week_index]
        target_week["components"] = [
            item for item in target_week["components"]
            if item["componentId"] != target_component_id
        ]
        parent_week = copy.deepcopy(payload)
        del parent_week[target_module_index]["weeks"][target_week_index]
        parent_module = copy.deepcopy(payload)
        del parent_module[target_module_index]

        for removal_kind, requested in (
            ("component", direct),
            ("week", parent_week),
            ("module", parent_module),
        ):
            with self.subTest(removal_kind=removal_kind):
                with self.assertRaises(TrainingPlanDependencyConflict) as caught:
                    reconcile_training_plan(
                        linked["learner_id"],
                        requested,
                        authorization=TrainingPlanAuthorization.for_staff(),
                    )
                self.assertEqual(caught.exception.code, "historical_progress_dependency")
                self.assertGreaterEqual(caught.exception.details["progressCount"], 1)
                self.assertTrue(
                    LearnerProgressEntry._base_manager.using(DB)
                    .filter(pk=linked["id"], plan_component_id=linked["plan_component_id"])
                    .exists()
                )
                self.assertTrue(
                    LearnerTrainingPlanComponent._base_manager.using(DB)
                    .filter(pk=linked["plan_component_id"])
                    .exists()
                )

    def test_existing_historical_reparenting_blocks_implicit_rebuild(self):
        with connections[DB].cursor() as cursor:
            cursor.execute(
                '''
                select plan_module.learner_id
                from "Learner".learner_training_plan_components plan_component
                join "Learner".learner_training_plan_weeks plan_week
                  on plan_week.id = plan_component.plan_week_id
                join "Learner".learner_training_plan_modules plan_module
                  on plan_module.id = plan_week.plan_module_id
                join curriculum.components component
                  on component.id = plan_component.curriculum_component_id
                where component.week_id is distinct from plan_week.curriculum_week_id
                group by plan_module.learner_id
                order by count(*), plan_module.learner_id
                limit 1
                '''
            )
            row = cursor.fetchone()
        self.assertIsNotNone(
            row, "The isolated Development snapshot must retain a historical placement."
        )
        learner_id = row[0]
        before = training_plan_snapshot(learner_id, using=DB)
        before_component_ids = {
            component["id"]
            for module in before.plan
            for week in module["weeks"]
            for component in week["components"]
        }

        with self.assertRaises(TrainingPlanReparentingConflict) as caught:
            reconcile_training_plan(
                learner_id,
                _payload_for(learner_id),
                authorization=TrainingPlanAuthorization.for_staff(),
                expected_version=before.plan_version,
                reorder=True,
                using=DB,
            )

        self.assertEqual(caught.exception.code, "historical_component_reparenting")
        self.assertTrue(caught.exception.details["implicitMutationBlocked"])
        self.assertGreater(caught.exception.details["planComponentCount"], 0)
        after = training_plan_snapshot(learner_id, using=DB)
        after_component_ids = {
            component["id"]
            for module in after.plan
            for week in module["weeks"]
            for component in week["components"]
        }
        self.assertEqual(after.plan_version, before.plan_version)
        self.assertEqual(after_component_ids, before_component_ids)


class CanonicalTrainingPlanConcurrencyPostgresTests(unittest.TestCase):
    def test_two_writers_with_one_version_yield_one_success_and_one_stale_conflict(self):
        if not settings.USE_SECURITY_TEST_BRANCH:
            self.fail("Refusing concurrency writes outside guarded security-branch mode.")
        if connections[DB].vendor != "postgresql":
            self.fail("Concurrency integration tests require PostgreSQL.")

        module_ids = list(
            ModuleAuthoringModule.objects.using(DB)
            .values_list("module_catalogue_id", flat=True)[:2]
        )
        self.assertEqual(len(module_ids), 2)
        suffix = uuid.uuid4().hex
        learner = LearnerProfile._base_manager.using(DB).create(
            full_name="Phase One Concurrency Test",
            email=f"phase1-concurrency-{suffix}@example.invalid",
            phone_number="",
            lifecycle_status="active",
            learner_type="commercial",
            programme_status="",
        )
        try:
            initial = reconcile_training_plan(
                learner.id,
                [],
                authorization=TrainingPlanAuthorization.for_staff(),
            )
            barrier = threading.Barrier(2)
            outcomes = []
            outcome_lock = threading.Lock()

            def write(module_id):
                close_old_connections()
                try:
                    barrier.wait(timeout=10)
                    result = reconcile_training_plan(
                        learner.id,
                        [{"moduleId": module_id, "weeks": []}],
                        authorization=TrainingPlanAuthorization.for_staff(),
                        expected_version=initial.plan_version,
                    )
                    outcome = ("success", result.plan[0]["moduleId"])
                except TrainingPlanVersionConflict as exc:
                    outcome = ("stale", exc.code)
                except Exception as exc:  # surfaced by the outcome assertion below
                    outcome = ("error", type(exc).__name__)
                finally:
                    close_old_connections()
                with outcome_lock:
                    outcomes.append(outcome)

            threads = [threading.Thread(target=write, args=(module_id,)) for module_id in module_ids]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=30)
            self.assertTrue(all(not thread.is_alive() for thread in threads))
            self.assertCountEqual([item[0] for item in outcomes], ["success", "stale"])
            self.assertIn(_payload_for(learner.id)[0]["moduleId"], module_ids)
        finally:
            LearnerProfile._base_manager.using(DB).filter(pk=learner.id).delete()

