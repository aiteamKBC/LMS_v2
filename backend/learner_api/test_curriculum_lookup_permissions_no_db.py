"""Role boundaries for staff curriculum pickers and learner KSB reads."""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import curriculum, module_shift
from .selectors.identity import EnrolmentId, ResolutionStatus


LOOKUPS = (
    (
        curriculum.programmes,
        "/learner_api/curriculum/programmes/",
        {},
        [{"name": "Programme A"}],
        {"results": ["Programme A"]},
    ),
    (
        curriculum.cohorts,
        "/learner_api/curriculum/cohorts/",
        {"programme": "Programme A"},
        [{"cohort_name": "Cohort A"}],
        {"results": ["Cohort A"]},
    ),
    (
        curriculum.groups,
        "/learner_api/curriculum/groups/",
        {"programme": "Programme A", "cohort": "Cohort A"},
        [{"group_name": "Group A"}],
        {"results": ["Group A"]},
    ),
    (
        curriculum.modules,
        "/learner_api/curriculum/modules/",
        {"programme": "Programme A"},
        [{"module_catalogue_id": "MOD-1", "title": "Module One"}],
        {"results": [{"id": "MOD-1", "title": "Module One"}]},
    ),
    (
        curriculum.weeks,
        "/learner_api/curriculum/weeks/",
        {"module": "MOD-1"},
        [{"id": "WEEK-1", "title": "Week One", "week_number": 1}],
        {"results": [{"id": "WEEK-1", "title": "Week One", "weekNumber": 1}]},
    ),
    (
        curriculum.components,
        "/learner_api/curriculum/components/",
        {"week": "WEEK-1"},
        [{"id": "COMP-1", "title": "Reading", "type": "reading", "expected_otjh": 1.5}],
        {
            "results": [
                {
                    "id": "COMP-1",
                    "title": "Reading",
                    "type": "reading",
                    "expectedOtjh": 1.5,
                }
            ]
        },
    ),
)


class CurriculumLookupPermissionTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def test_staff_and_admin_keep_the_existing_lookup_responses(self):
        for role in ("staff", "admin"):
            for view, path, query, rows, expected in LOOKUPS:
                with self.subTest(role=role, endpoint=view.__name__), \
                        patch(
                            "login.permissions.authenticate_request",
                            return_value=SimpleNamespace(role=role),
                        ), \
                        patch("learner_api.curriculum._rows", return_value=rows):
                    response = view(self.factory.get(path, query))
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content), expected)

    def test_learner_employer_and_anonymous_callers_are_refused_before_queries(self):
        for account, expected_status in (
            (SimpleNamespace(role="learner"), 403),
            (SimpleNamespace(role="employer"), 403),
            (None, 401),
        ):
            for view, path, query, _rows, _expected in LOOKUPS:
                row_reader = Mock()
                with self.subTest(account=account, endpoint=view.__name__), \
                        patch(
                            "login.permissions.authenticate_request",
                            return_value=account,
                        ), \
                        patch("learner_api.curriculum._rows", row_reader):
                    response = view(self.factory.get(path, query))
                    self.assertEqual(response.status_code, expected_status)
                    self.assertEqual(
                        json.loads(response.content)["code"],
                        "unauthenticated" if account is None else "forbidden",
                    )
                    row_reader.assert_not_called()

class ModuleShiftOptionPermissionTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def test_staff_and_admin_keep_the_existing_option_response(self):
        expected = {
            "cohort": {"id": "", "name": ""},
            "programme": {"id": "", "name": ""},
            "groups": [],
            "modules": [],
            "reason": "This module is no longer in the curriculum, so its programme cannot be found.",
        }
        for role in ("staff", "admin"):
            with self.subTest(role=role), \
                    patch(
                        "login.permissions.authenticate_request",
                        return_value=SimpleNamespace(role=role),
                    ), \
                    patch("learner_api.module_shift._module_row", return_value=None):
                response = module_shift.module_shift_options(
                    self.factory.get(
                        "/learner_api/module-shift/options/",
                        {"moduleId": "MOD-GONE"},
                    )
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content), expected)

    def test_learner_employer_and_anonymous_callers_are_refused_before_queries(self):
        for account, expected_status in (
            (SimpleNamespace(role="learner"), 403),
            (SimpleNamespace(role="employer"), 403),
            (None, 401),
        ):
            module_reader = Mock()
            with self.subTest(account=account), \
                    patch(
                        "login.permissions.authenticate_request",
                        return_value=account,
                    ), \
                    patch("learner_api.module_shift._module_row", module_reader):
                response = module_shift.module_shift_options(
                    self.factory.get(
                        "/learner_api/module-shift/options/",
                        {"moduleId": "MOD-1"},
                    )
                )
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(
                    json.loads(response.content)["code"],
                    "unauthenticated" if account is None else "forbidden",
                )
                module_reader.assert_not_called()


class KsbProfilePermissionTests(SimpleTestCase):
    expected = {
        "standard": {"id": "KSB-1", "label": "Programme A"},
        "results": [
            {
                "id": "K1",
                "theme": "Knowledge",
                "kind": "Knowledge",
                "codes": ["K1"],
                "title": "Know it",
            }
        ],
    }

    def setUp(self):
        self.factory = RequestFactory()
        self.learner = SimpleNamespace(
            role="learner",
            subject_type="learner",
            subject_id=42,
        )

    def request(self, programme="Programme A", *, account=None):
        request = self.factory.get(
            "/learner_api/curriculum/ksb-profile/",
            {"programme": programme},
        )
        request.login_account = account or self.learner
        return request

    @staticmethod
    def resolution(*, status=ResolutionStatus.RESOLVED, programme_id="PROG-A", programme="Programme A"):
        return {
            EnrolmentId(42): SimpleNamespace(
                status=status,
                profile={"programme_id": programme_id, "programme": programme}
                if status is ResolutionStatus.RESOLVED
                else None,
            )
        }

    def test_learner_can_read_own_programme_by_exact_name_or_id(self):
        for requested in ("Programme A", "PROG-A"):
            with self.subTest(requested=requested), \
                    patch(
                        "login.permissions.authenticate_request",
                        return_value=self.learner,
                    ), \
                    patch(
                        "learner_api.curriculum.resolve_many_for_enrolments",
                        return_value=self.resolution(),
                    ) as resolve, \
                    patch(
                        "learner_api.curriculum._rows",
                        return_value=[{"programme_id": "PROG-A", "name": "Programme A"}],
                    ) as rows, \
                    patch(
                        "learner_api.curriculum.ksb_profile_for_programme",
                        return_value=(self.expected["standard"], self.expected["results"]),
                    ) as profile:
                response = curriculum.ksb_profile(self.request(requested))

            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content), self.expected)
            resolve.assert_called_once()
            self.assertEqual(resolve.call_args.args[0], [EnrolmentId(42)])
            rows.assert_called_once()
            profile.assert_called_once_with("PROG-A")

    def test_learner_with_legacy_name_only_association_can_use_exact_canonical_alias(self):
        with patch(
            "login.permissions.authenticate_request",
            return_value=self.learner,
        ), patch(
            "learner_api.curriculum.resolve_many_for_enrolments",
            return_value=self.resolution(programme_id=""),
        ), patch(
            "learner_api.curriculum._rows",
            return_value=[{"programme_id": "PROG-A", "name": "Programme A"}],
        ), patch(
            "learner_api.curriculum.ksb_profile_for_programme",
            return_value=(self.expected["standard"], self.expected["results"]),
        ) as profile:
            response = curriculum.ksb_profile(self.request("PROG-A"))

        self.assertEqual(response.status_code, 200)
        profile.assert_called_once_with("PROG-A")

    def test_authorized_learner_keeps_existing_unmapped_programme_empty_state(self):
        with patch(
            "login.permissions.authenticate_request",
            return_value=self.learner,
        ), patch(
            "learner_api.curriculum.resolve_many_for_enrolments",
            return_value=self.resolution(),
        ), patch(
            "learner_api.curriculum._rows",
            return_value=[{"programme_id": "PROG-A", "name": "Programme A"}],
        ), patch(
            "learner_api.curriculum.ksb_profile_for_programme",
            return_value=(None, []),
        ):
            response = curriculum.ksb_profile(self.request())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"standard": None, "results": []})

    def test_other_programme_and_query_parameter_tampering_are_denied_opaquely(self):
        bodies = []
        for requested, programme_rows in (
            ("Programme B", [{"programme_id": "PROG-B", "name": "Programme B"}]),
            ("PROG-B", [{"programme_id": "PROG-B", "name": "Programme B"}]),
            ("UNKNOWN", []),
        ):
            profile = Mock()
            with self.subTest(requested=requested), patch(
                "login.permissions.authenticate_request",
                return_value=self.learner,
            ), patch(
                "learner_api.curriculum.resolve_many_for_enrolments",
                return_value=self.resolution(),
            ), patch(
                "learner_api.curriculum._rows",
                return_value=programme_rows,
            ), patch(
                "learner_api.curriculum.ksb_profile_for_programme",
                profile,
            ):
                response = curriculum.ksb_profile(self.request(requested))

            self.assertEqual(response.status_code, 403)
            bodies.append(json.loads(response.content))
            profile.assert_not_called()

        self.assertEqual(bodies, [bodies[0]] * len(bodies))
        self.assertEqual(bodies[0]["code"], "forbidden")

    def test_unresolved_or_ambiguous_canonical_identity_is_denied_before_programme_lookup(self):
        for status in (
            ResolutionStatus.MISSING,
            ResolutionStatus.AMBIGUOUS,
            ResolutionStatus.MISMATCH,
            ResolutionStatus.LEGACY_RESOLVED,
        ):
            rows = Mock()
            profile = Mock()
            with self.subTest(status=status), patch(
                "login.permissions.authenticate_request",
                return_value=self.learner,
            ), patch(
                "learner_api.curriculum.resolve_many_for_enrolments",
                return_value=self.resolution(status=status),
            ), patch("learner_api.curriculum._rows", rows), patch(
                "learner_api.curriculum.ksb_profile_for_programme",
                profile,
            ):
                response = curriculum.ksb_profile(self.request())

            self.assertEqual(response.status_code, 403)
            rows.assert_not_called()
            profile.assert_not_called()

    def test_missing_programme_association_and_wrong_subject_type_are_denied(self):
        cases = (
            (self.learner, self.resolution(programme_id="", programme="")),
            (
                SimpleNamespace(role="learner", subject_type="staff", subject_id=42),
                self.resolution(),
            ),
        )
        for account, resolution in cases:
            rows = Mock()
            with self.subTest(account=account), patch(
                "login.permissions.authenticate_request",
                return_value=account,
            ), patch(
                "learner_api.curriculum.resolve_many_for_enrolments",
                return_value=resolution,
            ), patch("learner_api.curriculum._rows", rows):
                response = curriculum.ksb_profile(self.request(account=account))

            self.assertEqual(response.status_code, 403)
            rows.assert_not_called()

    def test_ambiguous_programme_alias_is_denied(self):
        profile = Mock()
        with patch(
            "login.permissions.authenticate_request",
            return_value=self.learner,
        ), patch(
            "learner_api.curriculum.resolve_many_for_enrolments",
            return_value=self.resolution(),
        ), patch(
            "learner_api.curriculum._rows",
            return_value=[
                {"programme_id": "PROG-A", "name": "Programme A"},
                {"programme_id": "PROG-X", "name": "Programme A"},
            ],
        ), patch("learner_api.curriculum.ksb_profile_for_programme", profile):
            response = curriculum.ksb_profile(self.request())

        self.assertEqual(response.status_code, 403)
        profile.assert_not_called()

    def test_staff_and_admin_keep_existing_administrative_programme_access(self):
        for role in ("staff", "admin"):
            resolver = Mock()
            rows = Mock()
            with self.subTest(role=role), patch(
                "login.permissions.authenticate_request",
                return_value=SimpleNamespace(role=role, subject_type="staff", subject_id=7),
            ), patch(
                "learner_api.curriculum.resolve_many_for_enrolments",
                resolver,
            ), patch("learner_api.curriculum._rows", rows), patch(
                "learner_api.curriculum.ksb_profile_for_programme",
                return_value=(self.expected["standard"], self.expected["results"]),
            ) as profile:
                response = curriculum.ksb_profile(
                    self.request("Programme B", account=SimpleNamespace(
                        role=role,
                        subject_type="staff",
                        subject_id=7,
                    ))
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content), self.expected)
            resolver.assert_not_called()
            rows.assert_not_called()
            profile.assert_called_once_with("Programme B")

    def test_employer_and_anonymous_are_denied_before_any_lookup(self):
        for account, expected_status in (
            (SimpleNamespace(role="employer", subject_type="employer", subject_id=9), 403),
            (None, 401),
        ):
            resolver = Mock()
            profile = Mock()
            with self.subTest(account=account), patch(
                "login.permissions.authenticate_request",
                return_value=account,
            ), patch(
                "learner_api.curriculum.resolve_many_for_enrolments",
                resolver,
            ), patch(
                "learner_api.curriculum.ksb_profile_for_programme",
                profile,
            ):
                response = curriculum.ksb_profile(self.request())

            self.assertEqual(response.status_code, expected_status)
            self.assertEqual(
                json.loads(response.content)["code"],
                "unauthenticated" if account is None else "forbidden",
            )
            resolver.assert_not_called()
            profile.assert_not_called()

    def test_learner_authorisation_path_is_read_only_and_adds_two_targeted_queries(self):
        sql_seen = []
        owner = {
            "requested_enrolment_id": 42,
            "requested_position": 1,
            "account_match_count": 1,
            "id": 900,
            "enrolment_id": 42,
            "aptem_id": 123,
            "programme_id": "PROG-A",
            "name": "Learner One",
            "programme": "Programme A",
            "coach_name": "",
            "coach_email": "",
            "email": "learner@example.test",
            "start_date": None,
            "end_date": None,
            "learner_type": "apprenticeship",
            "account_record_id": 42,
            "account_email": "learner@example.test",
            "account_aptem_id": "123",
            "programme_planned_hours": None,
            "progress_transfer_active": False,
        }

        def read_rows(sql, params=None):
            sql_seen.append(sql)
            if "WITH requested(enrolment_id, position)" in sql:
                return [owner]
            return [{"programme_id": "PROG-A", "name": "Programme A"}]

        with patch(
            "login.permissions.authenticate_request",
            return_value=self.learner,
        ), patch("learner_api.curriculum._rows", side_effect=read_rows), patch(
            "learner_api.curriculum.ksb_profile_for_programme",
            return_value=(self.expected["standard"], self.expected["results"]),
        ):
            response = curriculum.ksb_profile(self.request())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(sql_seen), 2)
        for sql in sql_seen:
            lowered = sql.lower()
            self.assertTrue(lowered.lstrip().startswith(("select", "with")))
            self.assertNotIn("insert ", lowered)
            self.assertNotIn("update ", lowered)
            self.assertNotIn("delete ", lowered)
