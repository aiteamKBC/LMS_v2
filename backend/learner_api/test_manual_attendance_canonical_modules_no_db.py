"""Manual attendance completion reads modules without removed columns.

curriculum.modules no longer has deleted_at or is_programme_deleted. The
reader's module query must ask only for module_catalogue_id and title by id,
including in the ORM-generated (quoted) SQL. Completion results, card mapping,
the component query and occurrence reads are otherwise unchanged. No database:
managers are replaced by recorders; the real query is only compiled, never run.
"""
from types import SimpleNamespace
from unittest.mock import patch

from django.db.models import Model
from django.test import SimpleTestCase

from curriculum_api.models import ModuleAuthoringModule

from .manual_attendance_completion import read_manual_completion
from .tests_manual_attendance_completion import NOW, adjustment, component, occurrence

REMOVED = ('deleted_at', 'is_programme_deleted', 'deleted_via_parent', 'programme_name')


class Query:
    """Records one ORM chain and answers with fixture rows."""

    def __init__(self, rows):
        self.rows, self.filters, self.fields = rows, {}, ()

    def using(self, alias):
        self.alias = alias
        return self

    def filter(self, **kwargs):
        self.filters.update(kwargs)
        return self

    def values_list(self, *fields):
        self.fields = fields
        wanted = set(self.filters.get('module_catalogue_id__in') or [])
        return [row for row in self.rows if row[0] in wanted]

    def values(self, *fields):
        self.fields = fields
        wanted = set(self.filters.get('module_catalogue_id__in') or [])
        return [row for row in self.rows if row['module_catalogue_id'] in wanted]


class ManualCompletionModuleQueryTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch.object(Model, 'save', side_effect=AssertionError('write during an attendance read')))

    def read(self, module_rows, component_rows, adjustments=None, candidates=None, occurrences=None):
        self.modules, self.cards = Query(module_rows), Query(component_rows)
        occurrence_rows = [occurrence()] if occurrences is None else occurrences
        with patch('coach_api.models.CoachAttendanceSourceAdjustment.objects') as corrections, \
                patch('coach_api.models.CoachManualAttendance.objects') as records, \
                patch('curriculum_api.models.ModuleAuthoringModule.objects', self.modules), \
                patch('curriculum_api.models.ModuleAuthoringComponent.objects', self.cards), \
                patch('learner_api.attendance_lectures.read_native_occurrences',
                      return_value=occurrence_rows) as native, \
                patch('learner_api.manual_attendance_completion.timezone.now', return_value=NOW):
            corrections.filter.return_value = [adjustment()] if adjustments is None else adjustments
            records.filter.return_value = []
            result = read_manual_completion(candidates or [{'componentId': 'C1', 'moduleId': 'M1'}],
                                            SimpleNamespace(pk=7, enrolment_id=70, email='synthetic@example.invalid'))
        self.native = native
        return result

    def test_the_module_query_asks_only_for_ids_and_titles(self):
        self.read([('M1', 'Module one')], [component()])
        self.assertEqual(self.modules.alias, 'enrolment')
        self.assertEqual(self.modules.filters, {'module_catalogue_id__in': ['M1']})
        self.assertEqual(self.modules.fields, ('module_catalogue_id', 'title'))

    def test_the_orm_generated_sql_never_names_a_removed_column(self):
        self.read([('M1', 'Module one')], [component()])
        # Compile exactly what the reader asked for; nothing is executed.
        query = ModuleAuthoringModule._meta.base_manager.filter(**self.modules.filters).values_list(*self.modules.fields)
        sql = str(query.query)
        for column in REMOVED:
            self.assertNotIn(column, sql)
            self.assertNotIn(f'"{column}"', sql)
        self.assertIn('"module_catalogue_id"', sql)
        self.assertIn('"title"', sql)

    def test_completion_results_and_card_mapping_are_unchanged(self):
        result = self.read([('M1', 'Module one')], [component()])
        self.assertEqual(result, {('C1', 'M1'): (True, NOW)})
        # The component query and its own deletion filters are not changed here.
        self.assertEqual(self.cards.filters, {
            'module_catalogue_id__in': {'M1': 'Module one'}, 'type__in': ['live_session', 'live-session'],
            'deleted_at__isnull': True, 'is_programme_deleted': False})
        self.native.assert_called_once()
        self.assertEqual(self.native.call_args.kwargs, {'module_ids': ['M1']})

    def test_absence_and_ambiguous_cards_keep_their_existing_results(self):
        self.assertEqual(self.read([('M1', 'Module one')], [component()], adjustments=[adjustment(status='absent')]),
                         {('C1', 'M1'): (False, NOW)})
        self.assertEqual(self.read([('M1', 'Module one')], [component(), component(id='C2')]), {})

    def test_a_missing_module_contributes_no_cards_or_occurrences(self):
        # M2 is requested but has no curriculum row: only M1 is read further.
        result = self.read([('M1', 'Module one')], [component(), component(id='C9', module_catalogue_id='M2')],
                           candidates=[{'componentId': 'C1', 'moduleId': 'M1'}, {'componentId': 'C9', 'moduleId': 'M2'}])
        self.assertEqual(self.modules.filters, {'module_catalogue_id__in': ['M1', 'M2']})
        self.assertEqual(self.native.call_args.kwargs, {'module_ids': ['M1']})
        self.assertEqual(result, {('C1', 'M1'): (True, NOW)})

    def test_no_curriculum_modules_means_no_occurrence_read(self):
        result = self.read([], [component()])
        self.assertEqual(result, {})
        self.native.assert_not_called()

    def test_no_attendance_records_reads_no_curriculum_at_all(self):
        with patch('coach_api.models.CoachAttendanceSourceAdjustment.objects') as corrections, \
                patch('coach_api.models.CoachManualAttendance.objects') as records, \
                patch('curriculum_api.models.ModuleAuthoringModule.objects') as modules:
            corrections.filter.return_value = []
            records.filter.return_value = []
            self.assertEqual(read_manual_completion([{'moduleId': 'M1'}], SimpleNamespace(pk=7, enrolment_id=70)), {})
        modules.using.assert_not_called()
