/** Owner-approved directory identity is Created_users.id, not shared email. */
import { describe, expect, it } from 'vitest';
import { directoryCategory, matches, mergeDirectoryRows } from '../page.helpers';
import type { UserListRow, UsersFilter } from '../types';

function row(over: Partial<UserListRow> = {}): UserListRow {
  return {
    id: '1', uuid: null, name: 'Example User', type: 'User', source: 'commercial',
    email: 'shared@example.test', group: 'Group A', programme: 'Programme A', cohort: 'Cohort A',
    subscriptionStatus: 'FullUser', subscriptionVerified: true, learningPlan: true,
    programmeStatus: 'Delivery', ...over,
  };
}

describe('Created_users directory identity', () => {
  it('retains different IDs sharing an email, regardless of email case', () => {
    const users = [row(), row({ id: '2', email: 'SHARED@example.test' })];
    expect(mergeDirectoryRows(users)).toEqual(users);
  });

  it('deduplicates only the same Created_users ID, even if the kind changed', () => {
    const first = row();
    expect(mergeDirectoryRows([first, row({ source: 'apprenticeship' })])).toEqual([first]);
  });

  it('does not add independent staff or employer records or merge their fields', () => {
    const user = row({ name: '', group: '', programme: '', cohort: '', programmeStatus: '' });
    const staff = row({ id: '50', source: 'staff', type: 'Admin' });
    const employer = row({ id: '51', source: 'employer', type: 'Employer' });
    expect(mergeDirectoryRows([staff, user, employer])).toEqual([user]);
    expect(mergeDirectoryRows([staff, employer])).toEqual([]);
  });

  it('keeps blank emails and does not conflate UUIDs or names with physical IDs', () => {
    const users = [row({ email: '' }), row({ id: '2', email: '' })];
    expect(mergeDirectoryRows(users)).toEqual(users);
  });

  it('preserves server order and all API/export fields without mutating a row', () => {
    const users = [row({ id: '9' }), row({ id: '2' })];
    const snapshot = structuredClone(users);
    const result = mergeDirectoryRows(users);
    expect(result).toEqual(snapshot);
    expect(result[0]).toBe(users[0]);
    expect(result.map(user => user.id)).toEqual(['9', '2']);
  });

  it('lets an imported replacement win for its ID without dropping another shared-email user', () => {
    const updated = row({ name: 'Updated User' });
    const other = row({ id: '2' });
    expect(mergeDirectoryRows([updated, row(), other])).toEqual([updated, other]);
  });

  it.each(['User', 'Employer', 'Referrer', 'Admin', 'Caseowner'] as const)(
    'preserves Created_users Type %s without adding another source role', type => {
      const user = row({ type });
      expect(mergeDirectoryRows([user])[0].type).toBe(type);
      expect(matches(user, { type, page: 1, pageSize: 8 })).toBe(true);
    },
  );

  it.each([
    ['User', 'learners'], ['Referrer', 'learners'], ['Caseowner', 'learners'],
    ['Admin', 'admins'], ['Employer', 'employers'],
  ] as const)('counts Type %s in the %s summary', (type, category) => {
    expect(directoryCategory(row({ type }))).toBe(category);
  });
});

describe('directory filters preserve authoritative row values', () => {
  it.each([
    ['name', { userName: 'example' }, { userName: 'other' }],
    ['email', { email: 'shared@' }, { email: 'missing@' }],
    ['programme', { programme: ' programme a ' }, { programme: 'Programme B' }],
    ['cohort', { cohort: 'cohort a' }, { cohort: 'Cohort B' }],
    ['group', { groups: ['group a'] }, { groups: ['Group B'] }],
    ['registration status', { statuses: ['FullUser'] }, { statuses: ['Invited'] }],
    ['programme status', { programmeStatus: 'Delivery' }, { programmeStatus: 'Active' }],
  ] as [string, Partial<UsersFilter>, Partial<UsersFilter>][])('%s filter', (_name, matching, different) => {
    expect(matches(row(), { page: 1, pageSize: 8, ...matching })).toBe(true);
    expect(matches(row(), { page: 1, pageSize: 8, ...different })).toBe(false);
  });
});
