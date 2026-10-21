"""Sync error categories. Pure functions: no Django setup, DB or network."""
import json
import unittest

import test_session_results_no_db  # noqa: F401 - registers the curriculum_api package without Django
from curriculum_api.session_sync_issues import CATEGORIES, category_for, parse_sync_error, sync_issues


def archive_error(kind='recording', artifact='ART-1', stage='downloading', error='HTTPStatusError', status=None, disk=False):
    status_label = f', HTTP {status}' if status else ''
    return (f'Could not archive {kind} {artifact} during {stage} ({error}{status_label}'
            f"{', temporary disk full' if disk else ''}). Check worker logs and access.")


class CategoryTests(unittest.TestCase):
    def test_graph_statuses_map_to_their_own_category(self):
        for status, category in [(404, 'not_found'), (403, 'access_denied'), (401, 'authentication'),
                                 (429, 'rate_limited'), (500, 'service_unavailable'), (503, 'service_unavailable'),
                                 (408, 'network'), (400, 'unknown')]:
            with self.subTest(status=status):
                issue = parse_sync_error(archive_error(status=status))
                self.assertEqual(issue['category'], category)
                self.assertEqual(issue['httpStatus'], status)
                self.assertEqual((issue['fileType'], issue['artifactId'], issue['stage']), ('recording', 'ART-1', 'downloading'))

    def test_transport_failures_are_network_and_storage_failures_are_storage(self):
        self.assertEqual(parse_sync_error(archive_error(error='ReadTimeout'))['category'], 'network')
        self.assertEqual(parse_sync_error(archive_error(error='ConnectError'))['category'], 'network')
        # A file already downloaded but not saved is a storage problem, whatever the status.
        self.assertEqual(parse_sync_error(archive_error(stage='uploading', error='HttpResponseError', status=404))['category'], 'storage')
        self.assertEqual(parse_sync_error(archive_error(stage='preparing', error='ServiceRequestError'))['category'], 'storage')
        self.assertEqual(parse_sync_error(archive_error(error='OSError', disk=True))['category'], 'storage')
        self.assertEqual(parse_sync_error(archive_error(error='RuntimeError'))['category'], 'unknown')

    def test_every_returned_category_is_declared(self):
        for status in (None, 401, 403, 404, 408, 429, 500):
            self.assertIn(category_for(status), CATEGORIES)

    def test_older_and_job_level_strings_are_classified(self):
        interim = parse_sync_error('Teams could not find recording ART-9 (HTTP 404). It may have been deleted or moved.')
        self.assertEqual((interim['category'], interim['artifactId']), ('not_found', 'ART-9'))
        graph = parse_sync_error('Attendance reporting sync failed (HTTP 403)')
        self.assertEqual((graph['category'], graph['fileType'], graph['httpStatus']), ('access_denied', 'attendance', 403))
        self.assertEqual(parse_sync_error('Could not archive attendance for session 4.')['sessionNumber'], 4)
        self.assertEqual(parse_sync_error('Could not prepare transcript timing for T-1. Check worker logs.')['artifactId'], 'T-1')
        self.assertEqual(parse_sync_error('Curriculum recording link repair failed.')['category'], 'link_repair')
        legacy = parse_sync_error('Storage unavailable.')
        self.assertEqual((legacy['category'], legacy['detail']), ('unknown', 'Storage unavailable.'))
        self.assertIsNone(parse_sync_error('  '))


class SyncIssueTests(unittest.TestCase):
    def rows(self):
        ready = [{'id': f'R{n}', 'session_number': n, 'artifact_type': 'recording', 'status': 'ready',
                  'last_error': '', 'updated_at': '2026-10-01T10:00:00+00:00'} for n in range(1, 18)]
        failed = {'id': 'ART-404', 'session_number': 3, 'artifact_type': 'recording', 'status': 'failed',
                  'last_error': archive_error(artifact='ART-404', status=404), 'updated_at': '2026-10-20T09:00:00+00:00'}
        return ready + [failed]

    def test_partial_success_reports_only_the_failed_file_with_its_session(self):
        job = {'state': 'failed', 'finished_at': '2026-10-20T09:01:00+00:00',
               'last_error': archive_error(artifact='ART-404', status=404)}
        issues = sync_issues(job, self.rows())
        self.assertEqual(len(issues), 1)
        issue = issues[0]
        self.assertEqual((issue['category'], issue['artifactId'], issue['sessionNumber']), ('not_found', 'ART-404', 3))
        self.assertEqual(issue['occurredAt'], '2026-10-20T09:00:00+00:00')
        self.assertNotIn('https://', json.dumps(issues))

    def test_a_later_successful_sync_clears_the_issues(self):
        for state in ('complete', 'running', 'queued'):
            with self.subTest(state=state):
                self.assertEqual(sync_issues({'state': state, 'last_error': 'x'}, self.rows()), [])

    def test_a_file_saved_since_the_error_is_not_reported_again(self):
        rows = self.rows()
        rows[-1]['status'] = 'ready'
        job = {'state': 'failed', 'last_error': archive_error(artifact='ART-404', status=404)}
        self.assertEqual(sync_issues(job, rows), [])

    def test_job_level_problems_are_added_once_without_duplicating_file_rows(self):
        job = {'state': 'failed', 'finished_at': '2026-10-20T09:01:00+00:00', 'last_error': '; '.join([
            'Recording sync failed (HTTP 429)', archive_error(artifact='ART-404', status=404),
            'Recording sync failed (HTTP 429)', 'Curriculum recording link repair failed.'])}
        issues = sync_issues(job, self.rows())
        self.assertEqual([item['category'] for item in issues], ['not_found', 'rate_limited', 'link_repair'])
        self.assertEqual(issues[1]['occurredAt'], '2026-10-20T09:01:00+00:00')

    def test_a_truncated_last_part_is_dropped(self):
        long = '; '.join(['Recording sync failed (HTTP 503)'] + ['x' * 1500])[:1500]
        issues = sync_issues({'state': 'failed', 'last_error': long}, [])
        self.assertEqual([item['category'] for item in issues], ['service_unavailable'])


if __name__ == '__main__':
    unittest.main()
