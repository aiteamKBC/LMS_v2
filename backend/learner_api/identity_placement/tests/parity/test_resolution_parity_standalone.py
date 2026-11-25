"""Behavior matrix for the extracted orchestration; all ports are synthetic."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.identity_placement.application.read_placement import (
    placement_ids,
    placement_profile,
    with_placements,
)
from learner_api.identity_placement.application.resolve_identity import (
    resolve_canonical_learner,
    resolve_profile_for_source,
)


class Missing(Exception):
    pass


class Ambiguous(Exception):
    pass


class State:
    def __init__(self, db=None):
        self.db = db


class Source:
    def __init__(self, pk=7, email="learner@example.test", db=None):
        self.pk = pk
        self.email = email
        self._state = State(db)


class IdentityResolutionParityTests(unittest.TestCase):
    def resolve(self, *, exact=None, email=None, profile_id=None, twins=(), heal=True, source=None):
        calls = []

        def read_exact(value, **options):
            calls.append(("exact", value, options))
            return exact

        def read_email(value, **options):
            calls.append(("email", value, options))
            return email

        def duplicates(value, source_pk):
            calls.append(("duplicates", value, source_pk))
            return list(twins)

        def repair(profile, source_pk):
            calls.append(("repair", profile, source_pk))
            profile.enrolment_id = source_pk

        def read_id(value, **options):
            calls.append(("profile_id", value, options))
            return profile_id

        def warn(value, source_pk, values):
            calls.append(("warn", value, source_pk, list(values)))

        result = resolve_profile_for_source(
            source or Source(),
            active_only=True,
            heal=heal,
            fields=("id", "enrolment_id"),
            read_exact=read_exact,
            read_unlinked_email=read_email,
            duplicate_enrolment_ids=duplicates,
            repair_link=repair,
            read_unlinked_profile_id=read_id,
            warn_ambiguous_email=warn,
        )
        return result, calls

    def test_exact_bridge_short_circuits_every_fallback(self):
        expected = SimpleNamespace(enrolment_id=7)
        result, calls = self.resolve(exact=expected)
        self.assertIs(result, expected)
        self.assertEqual(calls, [("exact", 7, {"active_only": True, "fields": ("id", "enrolment_id")})])

    def test_unlinked_email_preserves_optional_repair(self):
        expected = SimpleNamespace(enrolment_id=None)
        result, calls = self.resolve(email=expected)
        self.assertIs(result, expected)
        self.assertEqual(expected.enrolment_id, 7)
        self.assertEqual([call[0] for call in calls], ["exact", "email", "duplicates", "repair"])
        untouched = SimpleNamespace(enrolment_id=None)
        self.resolve(email=untouched, heal=False)
        self.assertIsNone(untouched.enrolment_id)

    def test_ambiguous_email_returns_missing_without_repair(self):
        expected = SimpleNamespace(enrolment_id=None)
        result, calls = self.resolve(email=expected, twins=(8, 9))
        self.assertIsNone(result)
        self.assertEqual([call[0] for call in calls], ["exact", "email", "duplicates", "warn"])
        self.assertIsNone(expected.enrolment_id)

    def test_blank_email_uses_only_the_existing_narrow_pk_fallback(self):
        expected = SimpleNamespace(enrolment_id=None)
        result, calls = self.resolve(source=Source(email=" "), profile_id=expected)
        self.assertIs(result, expected)
        self.assertEqual([call[0] for call in calls], ["exact", "profile_id"])

    def test_kind_validation_and_exact_reader_contract(self):
        calls = []
        expected = object()
        reader = lambda kind, enrolment_id: calls.append((kind, enrolment_id)) or expected
        self.assertIs(resolve_canonical_learner(
            "commercial", 7, valid_kinds={"commercial"}, missing_error=Missing,
            read_exact_kind=reader,
        ), expected)
        with self.assertRaises(Missing):
            resolve_canonical_learner(
                "other", 7, valid_kinds={"commercial"}, missing_error=Missing,
                read_exact_kind=reader,
            )
        self.assertEqual(calls, [("commercial", 7)])


class PlacementReadParityTests(unittest.TestCase):
    def test_single_read_uses_alias_and_instance_cache(self):
        source = Source(db="enrolment")
        expected = SimpleNamespace(programme_id="P", cohort_id="C", group_id="G")
        calls = []
        read = lambda value, using: calls.append((value, using)) or expected
        first = placement_profile(source, is_enrolment_source=lambda value: isinstance(value, Source), read_profile=read)
        second = placement_profile(source, is_enrolment_source=lambda value: isinstance(value, Source), read_profile=read)
        self.assertIs(first, expected)
        self.assertIs(second, expected)
        self.assertEqual(calls, [(7, "enrolment")])
        self.assertEqual(placement_ids(source, read_placement_profile=lambda value: first),
                         {"programme_id": "P", "cohort_id": "C", "group_id": "G"})

    def test_non_enrolment_and_unsaved_sources_do_not_query(self):
        other = SimpleNamespace(programme_id="P", cohort_id="C", group_id="G")
        read = lambda *args, **kwargs: self.fail("unexpected query")
        self.assertIs(placement_profile(other, is_enrolment_source=lambda value: False, read_profile=read), other)
        source = Source(pk=None)
        self.assertIsNone(placement_profile(source, is_enrolment_source=lambda value: True, read_profile=read))

    def test_batch_preserves_aliases_order_missing_and_ambiguity(self):
        first, missing, second = Source(7, db="one"), Source(8, db="one"), Source(9, db="two")
        profiles = {
            "one": [SimpleNamespace(enrolment_id=7)],
            "two": [SimpleNamespace(enrolment_id=9)],
        }
        calls = []

        def read(ids, using):
            calls.append((list(ids), using))
            return profiles[using]

        self.assertEqual(with_placements(
            [first, missing, second], read_profiles=read, ambiguous_error=Ambiguous,
        ), [first, missing, second])
        self.assertEqual(calls, [([7, 8], "one"), ([9], "two")])
        self.assertIsNone(missing.__dict__["_educational_placement"])
        profiles["one"] = [SimpleNamespace(enrolment_id=7), SimpleNamespace(enrolment_id=7)]
        with self.assertRaises(Ambiguous):
            with_placements([Source(7, db="one")], read_profiles=read, ambiguous_error=Ambiguous)


if __name__ == "__main__":
    unittest.main()
