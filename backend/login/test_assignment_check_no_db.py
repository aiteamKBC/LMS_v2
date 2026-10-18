from unittest import TestCase

from login.assignment_check import absolute_month, assignment_record, group_assignment_records


class AssignmentCheckTests(TestCase):
    def test_only_assignment_records_qualify(self):
        self.assertTrue(assignment_record({'title': 'Case study', 'category_code': 'A'}))
        self.assertTrue(assignment_record({'title': 'Assignment 2', 'category': None}))
        self.assertTrue(assignment_record({'title': 'Assignment with marking', 'category': 'Assignment with marking'}))
        self.assertFalse(assignment_record({'title': 'Assignment brief', 'category': 'Assignment brief'}))
        self.assertFalse(assignment_record({'title': 'Assessment report', 'category': 'Assessment report'}))
        self.assertFalse(assignment_record({'title': 'Marking only', 'category': 'Marking'}))
        self.assertFalse(assignment_record({'title': 'Monthly coaching', 'category_code': 'C'}))
        self.assertFalse(assignment_record({'title': 'Assignment discussed', 'category_code': 'C'}))

    def test_absolute_month_rejects_relative_plan_months(self):
        self.assertEqual(absolute_month('October 2026'), '2026-10')
        self.assertEqual(absolute_month('2026-10-08'), '2026-10')
        self.assertIsNone(absolute_month('Month 10'))
        self.assertIsNone(absolute_month('10'))

    def test_file_and_assignment_records_share_one_component_row(self):
        records = [
            {'id': 10, 'title': 'Work sample.docx', 'category': 'Assignment',
             'activity_id': None, 'evidence_id': '201', 'calendar_month': '2026-10'},
            {'id': 11, 'title': 'Project assignment', 'category_code': 'A',
             'activity_id': '77', 'assignment_month': 'October 2026'},
        ]
        groups = group_assignment_records(records, {201: 77})
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['name'], 'Project assignment')
        self.assertEqual(groups[0]['month'], '2026-10')
        self.assertEqual(groups[0]['linkedComponentId'], 77)
        self.assertEqual(groups[0]['evidenceIds'], [201])
        self.assertEqual(groups[0]['sourceRecordIds'], [10, 11])

    def test_unlinked_records_keep_distinct_source_months(self):
        records = [
            {'id': 1, 'title': 'Assignment 1', 'assignment_month': '1'},
            {'id': 2, 'title': 'Assignment 1', 'assignment_month': '2'},
        ]
        groups = group_assignment_records(records, {})
        self.assertEqual(len(groups), 2)
        self.assertTrue(all(group['month'] is None for group in groups))

    def test_assignment_files_are_deduplicated_and_only_trusted_links_open(self):
        file_link = {
            'path': 'archive/Submission.docx', 'resolution': 'unique_path',
            'source_file_id': 'file-1', 'url': 'https://onedrive.live.com/example',
        }
        records = [
            {'id': 1, 'title': 'Project assignment', 'category_code': 'A',
             'assignment_month': 'October 2026',
             'evidence_links': [file_link, {
                 'path': 'archive/Pending.pdf', 'resolution': 'unresolved',
                 'url': 'https://onedrive.live.com/other',
             }, {
                 'path': 'archive/Unsafe.pdf', 'resolution': 'unique_path',
                 'source_file_id': 'file-2', 'url': 'https://onedrive.live.com.evil.test/file',
             }]},
            {'id': 2, 'title': 'Project assignment', 'category_code': 'A',
             'assignment_month': 'October 2026', 'evidence_links': [file_link]},
        ]
        groups = group_assignment_records(records, {})
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['sourceFiles'], [
            {'name': 'Submission.docx', 'url': 'https://onedrive.live.com/example'},
            {'name': 'Pending.pdf', 'url': None},
            {'name': 'Unsafe.pdf', 'url': None},
        ])
