"""Names and addresses when importing staff from a plain email list.

The list is the only source of a name, so the parsing is the whole of the
import's judgement: everything else is fixed defaults. Two things it must not do
is invent a family name where the address has none, and lose a name part where
the address has more than one dot.
"""
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from .management.commands.import_admin_staff import parse_name, read_emails


class ParseNameTests(SimpleTestCase):
    def test_a_dotted_address_splits_into_first_and_family(self):
        self.assertEqual(
            parse_name("Mahmoud.Fouda@kentbusinesscollege.com"), ("Mahmoud", "Fouda"),
        )

    def test_lower_case_addresses_are_capitalised(self):
        # The list mixes cases: "adeyemi.adeshina@" and "Omar.Badr@".
        self.assertEqual(
            parse_name("adeyemi.adeshina@kentbusinesscollege.com"), ("Adeyemi", "Adeshina"),
        )

    def test_a_shared_mailbox_gets_no_invented_family_name(self):
        # "office@", "quality@", "Events@" are mailboxes, not people. An empty
        # family name is honest; guessing one would put a fiction in the
        # directory.
        for local in ("office", "quality", "Events", "admin"):
            first, last = parse_name(f"{local}@kentbusinesscollege.com")
            self.assertEqual(last, "", local)
            self.assertEqual(first, local.title(), local)

    def test_a_first_name_only_address_keeps_the_first_name(self):
        self.assertEqual(parse_name("Youmna@kentbusinesscollege.com"), ("Youmna", ""))

    def test_only_the_first_dot_splits_the_name(self):
        # A double-barrelled family name must not be truncated to its first
        # part, which a naive split on every dot would do.
        self.assertEqual(
            parse_name("mele.marron.smith@kentbusinesscollege.com"),
            ("Mele", "Marron.Smith"),
        )

    def test_a_blank_address_yields_no_name(self):
        for value in (None, "", "   ", "@kentbusinesscollege.com"):
            self.assertEqual(parse_name(value), ("", ""), repr(value))


class ReadEmailsTests(SimpleTestCase):
    def _file(self, text):
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".md", delete=False, encoding="utf-8",
        )
        handle.write(text)
        handle.close()
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        return handle.name

    def test_the_heading_line_is_ignored(self):
        # The file starts "admin users:", which is a label rather than an
        # address — skipped because it has no "@".
        path = self._file("admin users:\na.b@example.com\n")

        self.assertEqual(read_emails(path), ["a.b@example.com"])

    def test_blank_lines_and_trailing_punctuation_are_tolerated(self):
        path = self._file("\na.b@example.com,\n\nc.d@example.com;\n")

        self.assertEqual(read_emails(path), ["a.b@example.com", "c.d@example.com"])

    def test_repeats_are_collapsed_case_insensitively(self):
        # The same mailbox listed twice must not become two staff records.
        path = self._file("A.B@example.com\na.b@example.com\n")

        self.assertEqual(read_emails(path), ["A.B@example.com"])

    def test_order_is_preserved(self):
        # So the report reads in the same order as the file the user supplied.
        path = self._file("z.z@example.com\na.a@example.com\n")

        self.assertEqual(read_emails(path), ["z.z@example.com", "a.a@example.com"])
