"""otjh_summary_bulk without "Learner".learners.programme (removed column).

The owner query now derives ``programme`` from l.programme_id through
curriculum.programmes. ``programme`` only feeds coach_api.migrated_reviews
.programme_key, which prefers the stable programme id, so hours, targets and
review allowances cannot change for a learner with a programme id. No
database: ``canonical.query`` answers each SELECT from fixtures.
"""
from datetime import date
from unittest.mock import patch

from django.db.models import Model
from django.test import SimpleTestCase

from coach_api.migrated_reviews import programme_key
from learner_api import canonical_learning as canonical

# Review allowance per template key, standing in for the migrated templates.
REVIEW_HOURS = {'id:PROG-1': 3.0, 'name:marketing': 5.0, None: 1.0}
TARGETS = [{'learner_id': 30, 'report_month': '2026-09', 'target_hours': 12.5},
           {'learner_id': 30, 'report_month': '2026-10', 'target_hours': 7.5}]


def owner(**overrides):
    row = dict(id=30, enrolment_id=80, aptem_id=900, programme_id='PROG-1', programme='Marketing',
               email='synthetic@example.test', start_date=date(2025, 1, 1), end_date=date(2027, 1, 1),
               learner_type='commercial', account_record_id=80, account_email='synthetic@example.test',
               account_aptem_id=900, progress_transfer_active=False)
    row.update(overrides)
    return row


class Database:
    """Answers the reader's SELECTs by statement; refuses anything else."""

    def __init__(self, owners):
        self.owners, self.statements = owners, []

    def __call__(self, sql, params=None, *args, **kwargs):
        text = ' '.join(sql.split())
        self.statements.append(text)
        if not text.upper().startswith(('SELECT', 'WITH')):
            raise AssertionError(f'non-SELECT statement: {text}')
        if 'FROM "Learner".learners l LEFT JOIN enrolment."Created_users" u' in text:
            return [dict(row) for row in self.owners]
        if 'to_regclass' in text:
            return [{'name': None}]
        if 'accepted IS TRUE' in text and 'GROUP BY learner_id' in text:
            return [{'learner_id': 30, 'actual_seconds': 36000}]
        if 'learner_monthly_targets' in text:
            return [dict(row) for row in TARGETS]
        return []


def review_hours(owners):
    """planned_hours_bulk's template choice, without the template tables."""
    # Like planned_hours_bulk: an unauthored key falls back to the default template.
    return {row['enrolment_id']: REVIEW_HOURS.get(programme_key(row.get('programme_id'), row.get('programme')),
                                                  REVIEW_HOURS[None])
            for row in owners}


class OtjhSummaryProgrammeTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch.object(Model, 'save', side_effect=AssertionError('write while reading OTJH')))
        self.enterContext(patch('coach_api.migrated_otjh.planned_hours_bulk', side_effect=review_hours))

    def summary(self, owners):
        database = Database(owners)
        with patch.object(canonical, 'query', side_effect=database):
            result = canonical.otjh_summary_bulk([80])
        return result, database.statements

    def test_owner_sql_derives_programme_from_its_id(self):
        _, statements = self.summary([owner()])
        sql = statements[0]
        self.assertNotIn('l.programme,', sql)
        self.assertNotRegex(sql, r'\bl\.programme\b(?!_id)')
        self.assertIn('(SELECT CASE WHEN count(*) = 1 THEN min(p.name) END FROM curriculum.programmes p '
                      'WHERE p.programme_id = l.programme_id AND btrim(coalesce(l.programme_id, \'\')) <> \'\') '
                      'AS programme', sql)
        # A scalar subquery, never a join that could repeat the profile row.
        self.assertNotIn('JOIN curriculum.programmes', sql)
        for column in ('l.id', 'l.enrolment_id', 'l.aptem_id', 'l.programme_id', 'l.email', 'l.start_date',
                       'l.end_date', 'l.learner_type', 'u.id AS account_record_id', 'u."Email" AS account_email',
                       'u.aptem_id AS account_aptem_id', 'AS progress_transfer_active'):
            self.assertIn(column, sql)
        for removed in ('programme_name', 'l.cohort', 'l.group_name', 'l.coach_rag'):
            self.assertNotIn(removed, sql)

    def test_hours_targets_and_review_allowance_match_for_a_programme_id(self):
        # Old rows carried the stored label; new rows carry the curriculum name
        # (or NULL). With a programme id the result is identical either way.
        legacy, _ = self.summary([owner(programme='Marketing')])
        for derived in ('Marketing Executive', None):
            with self.subTest(derived=derived):
                current, _ = self.summary([owner(programme=derived)])
                self.assertEqual(current, legacy)
        facts = legacy[80]
        self.assertEqual(facts['actual'], 10.0)
        self.assertEqual(facts['review_planned'], 3.0)
        # The summary's own contract; "remaining" is derived by its consumers from
        # planned and actual, both covered by the equality above.
        self.assertEqual(set(facts), {'profile_id', 'start_date', 'end_date', 'historical', 'new', 'actual',
                                      'completed_actual', 'planned', 'review_planned'})
        self.assertEqual(facts['planned'], 23.0)  # 12.5 + 7.5 monthly targets + 3.0 review allowance

    def test_monthly_targets_are_unchanged_by_the_programme_field(self):
        results = []
        for label in ('Marketing', None):
            database = Database([owner(programme=label)])
            with patch.object(canonical, 'query', side_effect=database), \
                    patch.object(canonical, 'metrics_from_records', wraps=canonical.metrics_from_records) as metrics:
                canonical.otjh_summary_bulk([80])
            results.append(metrics.call_args.args)
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0][1], {'2026-09': 12.5, '2026-10': 7.5})

    def test_blank_or_unknown_programme_id_uses_the_default_review_template(self):
        # The subquery yields NULL for a blank or unmatched id; programme_key is
        # then None and the default ("", family) templates apply.
        for programme_id in ('', None, 'UNKNOWN'):
            with self.subTest(programme_id=programme_id):
                result, _ = self.summary([owner(programme_id=programme_id, programme=None)])
                self.assertEqual(result[80]['review_planned'], REVIEW_HOURS[None])
                self.assertEqual(result[80]['actual'], 10.0)

    def test_duplicate_programme_ids_cannot_duplicate_the_profile_row(self):
        # Duplicated programme ids make the subquery NULL; the profile stays a
        # single row, so its hours remain available.
        result, statements = self.summary([owner(programme=None)])
        self.assertIn('CASE WHEN count(*) = 1 THEN min(p.name) END', statements[0])
        self.assertIsNotNone(result[80])
        self.assertEqual(result[80]['actual'], 10.0)

    def test_duplicate_or_mismatched_identities_stay_unavailable(self):
        for owners in ([owner(), owner(id=31)], [owner(account_aptem_id=901)],
                       [owner(account_email='other@example.test')]):
            with self.subTest(owners=len(owners)):
                result, statements = self.summary(owners)
                self.assertIsNone(result[80])
                self.assertEqual(len(statements), 1)

    def test_profile_actual_hours_reads_the_same_actual(self):
        from types import SimpleNamespace
        from learner_api.canonical_hours import profile_actual_hours
        database = Database([owner(programme=None)])
        with patch.object(canonical, 'query', side_effect=database):
            actual = profile_actual_hours(SimpleNamespace(id=30, enrolment_id=80))
        self.assertEqual(actual, 10.0)
        self.assertTrue(all(statement.upper().startswith(('SELECT', 'WITH')) for statement in database.statements))
