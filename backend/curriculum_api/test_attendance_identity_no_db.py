"""Run directly with Python. No Django setup, database, credentials or network.

Covers the Teams account check: the Microsoft account behind each attendance
row compared with the LMS email it counts for. A display name is never proof,
and the directory lookup only ever reads from Microsoft.
"""
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules['curriculum_api'] = package
from curriculum_api.attendance_identity import (RESOLUTION_KEY, identity_check, keep_directory_lookup, needs_directory_lookup,  # noqa: E402
                                                resolve_directory_accounts, staff_roles)

HOME = 'tenant-home'


def row(row_id, *, email='', name='Someone', role='Attendee', identity=None, seconds=600, extra=None):
    raw = {'identity': identity} if identity is not None else {}
    raw.update(extra or {})
    return {'id': row_id, 'email': email, 'display_name': name, 'role': role,
            'total_attendance_seconds': seconds, 'intervals': [], 'raw_data': raw}


def signed_in(object_id, name='Someone', tenant=HOME):
    return {'id': object_id, 'displayName': name, 'tenantId': tenant}


def anonymous(guest_id, name='Someone'):
    return {'id': guest_id, 'displayName': name, 'tenantId': None}


LEARNERS = {'ann@college.invalid': {'name': 'Ann Learner', 'learnerProfileId': 1},
            'bob@college.invalid': {'name': 'Bob Learner', 'learnerProfileId': 2}}


def check(records, *, aliases=None, links=None, name_match=None, staff=None, organizer=''):
    return identity_check(records, learners=LEARNERS, aliases=aliases or {}, reviewed_links=links or {},
                          name_match=name_match or (lambda record: None), staff=staff or {},
                          organizer_email=organizer, home_tenant=HOME)


def by_name(result):
    return {person['name']: person for person in result['participants']}


class StatusTests(unittest.TestCase):
    def test_signed_in_with_the_lms_email_is_matched(self):
        result = check([row('A', email='ann@college.invalid', identity=signed_in('OID-A'))])
        person = by_name(result)['Ann Learner']
        self.assertEqual(person['status'], 'matched')
        self.assertEqual(person['expectedEmail'], 'ann@college.invalid')
        self.assertEqual(person['accounts'][0]['email'], 'ann@college.invalid')
        self.assertEqual(result['counts']['matched'], 1)

    def test_email_case_and_spacing_do_not_cause_a_mismatch(self):
        result = check([row('A', email=' ANN@College.invalid ', identity=signed_in('OID-A'))])
        self.assertEqual(by_name(result)['Ann Learner']['status'], 'matched')

    def test_staff_linked_alias_is_a_different_verified_account(self):
        result = check([row('A', email='ann.personal@other.invalid', identity=signed_in('OID-X', tenant='tenant-other'))],
                       aliases={'ann.personal@other.invalid': 'ann@college.invalid'})
        person = by_name(result)['Ann Learner']
        self.assertEqual(person['status'], 'different-account')
        self.assertEqual(person['linkedBy'], ['alias'])
        self.assertEqual(person['accounts'][0]['tenant'], 'external')
        self.assertIn('ann.personal@other.invalid', person['reason'])
        self.assertIn('Staff linked', person['reason'])

    def test_anonymous_joiner_who_typed_the_learner_email_is_not_matched(self):
        result = check([row('A', email='ann@college.invalid', identity=anonymous('G-1'))])
        person = by_name(result)['Ann Learner']
        self.assertEqual(person['status'], 'unverified-guest')
        self.assertEqual(person['accounts'][0]['email'], '')
        self.assertEqual(person['accounts'][0]['enteredEmail'], 'ann@college.invalid')
        self.assertIn('not verified', person['reason'])

    def test_name_only_link_of_an_anonymous_guest_is_never_proof(self):
        guest = row('G', name='Ann Learner', identity=anonymous('G-1', 'Ann Learner'))
        result = check([guest], name_match=lambda record: 'ann@college.invalid' if record is guest else None)
        person = by_name(result)['Ann Learner']
        self.assertEqual(person['status'], 'unverified-guest')
        self.assertEqual(person['linkedBy'], ['name'])
        self.assertIn('not proof of identity', person['reason'])

    def test_matching_display_name_alone_never_links_anyone(self):
        result = check([row('G', name='Ann Learner', identity=anonymous('G-1', 'Ann Learner'))])
        self.assertNotIn('learner', {person['kind'] for person in result['participants']})
        self.assertEqual(result['participants'][0]['status'], 'unmatched')
        self.assertEqual(result['participants'][0]['expectedEmail'], '')

    def test_duplicate_display_names_stay_separate_people(self):
        result = check([row('G1', name='Sam', identity=anonymous('G-1', 'Sam')),
                        row('G2', name='Sam', identity=anonymous('G-2', 'Sam'))])
        self.assertEqual(len(result['participants']), 2)
        self.assertEqual(result['counts']['unmatched'], 2)

    def test_repeat_joins_on_one_account_are_one_account(self):
        first = row('A1', email='ann@college.invalid', identity=signed_in('OID-A'))
        second = row('A2', email='ann@college.invalid', identity=signed_in('OID-A'))
        first['intervals'] = [{'joinDateTime': '2026-09-16T09:00:00Z', 'leaveDateTime': '2026-09-16T09:10:00Z'}]
        second['intervals'] = [{'joinDateTime': '2026-09-16T09:20:00Z', 'leaveDateTime': '2026-09-16T09:30:00Z'}]
        account = by_name(check([first, second]))['Ann Learner']['accounts']
        self.assertEqual(len(account), 1)
        self.assertEqual(account[0]['joins'], 2)
        self.assertEqual(account[0]['seconds'], 1200)
        self.assertEqual(account[0]['sourceRecordIds'], ['A1', 'A2'])

    def test_one_join_on_another_account_flags_the_learner(self):
        alias_join = row('A2', email='ann.home@other.invalid', identity=signed_in('OID-Z', tenant='tenant-other'))
        result = check([row('A1', email='ann@college.invalid', identity=signed_in('OID-A')), alias_join],
                       aliases={'ann.home@other.invalid': 'ann@college.invalid'})
        person = by_name(result)['Ann Learner']
        self.assertEqual(person['status'], 'different-account')
        self.assertEqual([account['status'] for account in person['accounts']], ['different-account', 'matched'])

    def test_external_tenant_without_an_email_is_unknown(self):
        link = row('X', name='Bob B', identity=signed_in('OID-EXT', 'Bob B', tenant='tenant-other'))
        result = check([link], links={'X': 'bob@college.invalid'})
        person = by_name(result)['Bob Learner']
        self.assertEqual(person['status'], 'unknown')
        self.assertIn('another organisation', person['reason'])
        self.assertEqual(result['lookupPending'], 0)

    def test_college_account_without_email_waits_for_the_directory_lookup(self):
        pending = row('X', identity=signed_in('OID-B'))
        result = check([pending], links={'X': 'bob@college.invalid'})
        self.assertEqual(by_name(result)['Bob Learner']['status'], 'unknown')
        self.assertEqual(result['lookupPending'], 1)
        resolved = row('X', identity=signed_in('OID-B'), extra={RESOLUTION_KEY: {
            'objectId': 'OID-B', 'status': 'resolved', 'mail': 'bob@college.invalid',
            'userPrincipalName': 'bob.upn@college.invalid', 'userType': 'Member'}})
        person = by_name(check([resolved], links={'X': 'bob@college.invalid'}))['Bob Learner']
        self.assertEqual(person['status'], 'matched')
        self.assertEqual(person['accounts'][0]['emailSource'], 'directory')

    def test_upn_counts_as_the_same_account(self):
        resolved = row('X', email='alias@college.invalid', identity=signed_in('OID-B'), extra={RESOLUTION_KEY: {
            'objectId': 'OID-B', 'status': 'resolved', 'mail': 'alias@college.invalid',
            'userPrincipalName': 'bob@college.invalid'}})
        result = check([resolved], aliases={'alias@college.invalid': 'bob@college.invalid'})
        self.assertEqual(by_name(result)['Bob Learner']['status'], 'matched')

    def test_lookup_saved_for_another_account_is_ignored(self):
        stale = row('X', identity=signed_in('OID-NEW'), extra={RESOLUTION_KEY: {
            'objectId': 'OID-OLD', 'status': 'resolved', 'mail': 'bob@college.invalid'}})
        self.assertEqual(by_name(check([stale], links={'X': 'bob@college.invalid'}))['Bob Learner']['status'], 'unknown')

    def test_row_without_identity_is_unknown(self):
        person = by_name(check([row('A', email='ann@college.invalid')]))['Ann Learner']
        self.assertEqual(person['status'], 'unknown')
        self.assertIn('did not report', person['reason'])

    def test_legacy_nested_identity_shapes(self):
        result = check([row('A', email='ann@college.invalid', identity={'user': signed_in('OID-A')}),
                        row('B', email='bob@college.invalid', identity={'guest': {'id': 'G', 'displayName': 'Bob'}})])
        people = by_name(result)
        self.assertEqual(people['Ann Learner']['status'], 'matched')
        self.assertEqual(people['Bob Learner']['status'], 'unverified-guest')

    def test_phone_dial_in_is_unverified(self):
        phone = row('P', identity={'@odata.type': '#microsoft.graph.communicationsPhoneIdentity', 'id': '+44', 'displayName': 'Phone'})
        self.assertEqual(check([phone])['participants'][0]['accounts'][0]['accountType'], 'phone dial-in')


class StaffTests(unittest.TestCase):
    STAFF = staff_roles({'organizer_email': 'Org@College.invalid', 'presenters': '["pres@college.invalid"]',
                         'co_organizers': [{'email': 'co@college.invalid'}]}, ['tutor@college.invalid', 'pres@college.invalid'])

    def test_staff_roles_come_from_lms_records(self):
        self.assertEqual(self.STAFF, {'org@college.invalid': ['Organiser'], 'co@college.invalid': ['Co-organiser'],
                                      'pres@college.invalid': ['Presenter', 'Tutor'], 'tutor@college.invalid': ['Tutor']})

    def test_organiser_presenter_coorganiser_and_tutor_are_checked(self):
        result = check([
            row('O', email='org@college.invalid', name='Org', role='Organizer', identity=signed_in('1', 'Org')),
            row('P', email='pres@college.invalid', name='Pres', role='Presenter', identity=signed_in('2', 'Pres')),
            row('C', email='co@college.invalid', name='Co', role='Coorganizer', identity=signed_in('3', 'Co')),
            row('T', email='tutor@college.invalid', name='Tut', role='Attendee', identity=signed_in('4', 'Tut')),
        ], staff=self.STAFF, organizer='org@college.invalid')
        people = by_name(result)
        self.assertEqual({name: person['status'] for name, person in people.items()},
                         {'Org': 'matched', 'Pres': 'matched', 'Co': 'matched', 'Tut': 'matched'})
        self.assertEqual(people['Pres']['roles'], ['Presenter', 'Tutor'])
        self.assertEqual({person['kind'] for person in result['participants']}, {'staff'})

    def test_organiser_role_on_another_account_is_a_different_account(self):
        result = check([row('O', email='someone@other.invalid', name='Org', role='Organizer',
                            identity=signed_in('9', 'Org', tenant='tenant-other'))],
                       staff=self.STAFF, organizer='org@college.invalid')
        person = result['participants'][0]
        self.assertEqual((person['kind'], person['status'], person['expectedEmail']),
                         ('staff', 'different-account', 'org@college.invalid'))

    def test_presenter_role_alone_never_makes_someone_staff(self):
        # "Everyone can present" gives every attendee the Presenter role.
        result = check([row('P', email='random@other.invalid', name='Pres', role='Presenter',
                            identity=signed_in('8', 'Pres', tenant='tenant-other'))], staff=self.STAFF)
        person = result['participants'][0]
        self.assertEqual((person['kind'], person['status']), ('unlinked', 'unmatched'))
        self.assertEqual(person['teamsRoles'], ['Presenter'])


class DirectoryLookupTests(unittest.TestCase):
    def setUp(self):
        self.calls, self.saved = [], {}

    def graph(self, responses):
        def request(method, path, **kwargs):
            self.calls.append((method, path, kwargs))
            response = responses[path.split('/')[1].split('?')[0]]
            if isinstance(response, Exception):
                raise response
            return response
        return request

    def save(self, record, raw):
        self.saved[record['id']] = raw

    def test_only_reads_college_accounts_once_each(self):
        rows = [row('A1', email='a@college.invalid', identity=signed_in('OID-A')),
                row('A2', identity=signed_in('OID-A')),
                row('G', identity=anonymous('G-1')),
                row('X', identity=signed_in('OID-X', tenant='tenant-other')),
                row('N')]
        counts = resolve_directory_accounts(rows, graph_request=self.graph({'OID-A': {
            'id': 'OID-A', 'mail': 'A@College.invalid', 'userPrincipalName': 'a@college.invalid', 'userType': 'Member'}}),
            save_raw=self.save, home_tenant=HOME)
        self.assertEqual([(method, path.split('?')[0]) for method, path, _ in self.calls], [('GET', 'users/OID-A')])
        self.assertEqual(set(self.saved), {'A1', 'A2'})
        self.assertEqual(self.saved['A2'][RESOLUTION_KEY]['mail'], 'a@college.invalid')
        self.assertEqual(self.saved['A2']['identity'], signed_in('OID-A'))
        self.assertEqual(counts, {'resolved': 2, 'notFound': 0, 'failed': 0, 'denied': False})
        self.assertFalse(any(kwargs for _method, _path, kwargs in self.calls))

    def test_saved_lookup_is_not_repeated(self):
        done = row('A', identity=signed_in('OID-A'), extra={RESOLUTION_KEY: {'objectId': 'OID-A', 'status': 'resolved'}})
        missing = row('B', identity=signed_in('OID-B'), extra={RESOLUTION_KEY: {'objectId': 'OID-B', 'status': 'not-found'}})
        failed = row('C', identity=signed_in('OID-C'), extra={RESOLUTION_KEY: {'objectId': 'OID-C', 'status': 'failed'}})
        self.assertEqual([needs_directory_lookup(item, HOME) for item in (done, missing, failed)], [False, False, True])

    def test_not_found_is_saved_and_failures_are_retried_later(self):
        rows = [row('A', identity=signed_in('OID-A')), row('B', identity=signed_in('OID-B'))]
        counts = resolve_directory_accounts(rows, graph_request=self.graph({
            'OID-A': RuntimeError('Microsoft Graph request failed: HTTP 404 code=Request_ResourceNotFound'),
            'OID-B': RuntimeError('Microsoft Graph request failed: HTTP 503')}), save_raw=self.save, home_tenant=HOME)
        self.assertEqual(self.saved['A'][RESOLUTION_KEY]['status'], 'not-found')
        self.assertNotIn('B', self.saved)
        self.assertEqual((counts['notFound'], counts['failed']), (1, 1))

    def test_resync_keeps_a_lookup_only_for_the_same_account(self):
        saved = {'objectId': 'OID-A', 'status': 'resolved', 'mail': 'a@college.invalid'}
        previous = {'identity': signed_in('OID-A'), RESOLUTION_KEY: saved}
        fresh = {'identity': signed_in('OID-A'), 'attendanceIntervals': []}
        self.assertEqual(keep_directory_lookup(previous, fresh)[RESOLUTION_KEY], saved)
        self.assertNotIn(RESOLUTION_KEY, fresh)
        changed = {'identity': signed_in('OID-B')}
        self.assertNotIn(RESOLUTION_KEY, keep_directory_lookup(previous, changed))
        self.assertNotIn(RESOLUTION_KEY, keep_directory_lookup({}, fresh))

    def test_permission_refusal_stops_after_one_call(self):
        rows = [row(str(index), identity=signed_in(f'OID-{index}')) for index in range(5)]
        responses = {f'OID-{index}': RuntimeError('Microsoft Graph request failed: HTTP 403') for index in range(5)}
        counts = resolve_directory_accounts(rows, graph_request=self.graph(responses), save_raw=self.save, home_tenant=HOME)
        self.assertTrue(counts['denied'])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.saved, {})


if __name__ == '__main__':
    with patch('socket.socket', side_effect=AssertionError('Network forbidden')):
        unittest.main(verbosity=2)
