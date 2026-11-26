"""What the enrolment board hands the wizard to fill its blanks.

A new apprentice gives their address and a reusable signature on their first
sign-in (first_login_details). The board offers both back so Personal Details
does not ask again. ``SimpleTestCase``: the one raw read is patched, so nothing
here touches the database.
"""
from contextlib import contextmanager
from datetime import datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import board_wizard


class RecordAddressTests(SimpleTestCase):
    def test_joins_the_filled_lines_in_address_order(self):
        learner = SimpleNamespace(
            address_line_1="1 High Street", address_line_2="", address_line_3="Canterbury",
            address_line_4="Kent", current_postcode="CT1 1AA",
        )

        self.assertEqual(
            board_wizard.record_address(learner), "1 High Street, Canterbury, Kent, CT1 1AA"
        )

    def test_no_address_is_an_empty_string(self):
        self.assertEqual(board_wizard.record_address(SimpleNamespace()), "")


@contextmanager
def _no_savepoint(using=None):
    yield


class SavedSignatureTests(SimpleTestCase):
    def read(self, *, row=None, error=None):
        cursor = MagicMock()
        if error is not None:
            cursor.execute.side_effect = error
        cursor.fetchone.return_value = row
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch("django.db.transaction.atomic", _no_savepoint), \
             patch("django.db.connections", {"enrolment": connection}):
            return board_wizard.saved_signature(7)

    def test_returns_the_signature_and_the_uk_date_it_was_saved(self):
        # 23:30 UTC on 20 Sep is already 21 Sep in London (BST).
        saved_at = datetime(2026, 9, 20, 23, 30, tzinfo=dt_timezone.utc)

        self.assertEqual(
            self.read(row=("data:image/png;base64,AAAA", saved_at)),
            ("data:image/png;base64,AAAA", "2026-09-21"),
        )

    def test_no_saved_signature_is_empty(self):
        self.assertEqual(self.read(row=("", None)), ("", ""))
        self.assertEqual(self.read(row=None), ("", ""))

    def test_missing_columns_mean_no_saved_signature_rather_than_an_error(self):
        """The SQL that adds the columns may not be applied yet; the board must
        still load and the learner can sign by hand."""
        self.assertEqual(self.read(error=DatabaseError("column does not exist")), ("", ""))
