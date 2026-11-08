import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchEnrolmentUsers } from '@/api/enrolmentUsers';
import { fetchStaffUsers } from '@/api/staffUsers';
import { listEmployers } from '@/api/employers';
import { fetchAttendanceModes } from '@/api/attendanceLectures';
import UsersListPage from '../page';
import type { UserListRow } from '../types';
import * as directoryExport from '../directoryExport';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/api/enrolmentUsers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/enrolmentUsers')>(), fetchEnrolmentUsers: vi.fn(),
}));
vi.mock('@/api/staffUsers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/staffUsers')>(), fetchStaffUsers: vi.fn(async () => []),
}));
vi.mock('@/api/employers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/employers')>(), listEmployers: vi.fn(async () => ({ results: [] })),
}));
vi.mock('@/api/curriculum', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/curriculum')>(),
  fetchProgrammeOptions: vi.fn(async () => []), fetchCohortOptions: vi.fn(async () => []), fetchGroupOptions: vi.fn(async () => []),
}));
vi.mock('@/api/attendanceLectures', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/attendanceLectures')>(),
  fetchAttendanceModes: vi.fn(async () => ({ available: true, modes: {} })),
}));

beforeEach(() => {
  vi.stubGlobal('AppIcon', AppIcon);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network request'); }));
  vi.mocked(fetchAttendanceModes).mockResolvedValue({ available: true, modes: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function user(id: number, over: Partial<UserListRow> = {}): UserListRow {
  return { id: String(id), uuid: null, name: `Example User ${id}`, email: 'shared@example.test',
    type: 'User', source: 'commercial', group: 'Group A', programme: 'Programme A', cohort: 'Cohort A',
    subscriptionStatus: 'FullUser', subscriptionVerified: true, learningPlan: false,
    programmeStatus: 'Delivery', hasAccount: true, hasSignedIn: true, ...over };
}

async function show(users: UserListRow[]) {
  vi.mocked(fetchEnrolmentUsers).mockResolvedValue(users);
  render(<MemoryRouter initialEntries={['/users']}><UsersListPage /></MemoryRouter>);
  await screen.findByText(users[0].name);
}

function select(label: string): HTMLSelectElement {
  return screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('select')!;
}

function dropdown(label: string): HTMLButtonElement {
  return screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('button')!;
}

it('loads only Created_users and preserves separate IDs sharing email and empty placement', async () => {
  const users = [user(42, { programme: '', cohort: '', group: '', type: 'Admin' }), user(900)];
  await show(users);
  expect(screen.getByText('Example User 900')).toBeInTheDocument();
  expect(screen.getAllByText('shared@example.test')).toHaveLength(2);
  expect(screen.getByText('Showing 1 to 2 of 2 users')).toBeInTheDocument();
  expect(fetchStaffUsers).not.toHaveBeenCalled();
  expect(listEmployers).not.toHaveBeenCalled();
  const first = screen.getByText('Example User 42').closest('tr')!;
  expect(within(first).getByText('Admin')).toBeInTheDocument();
  expect(within(first).queryByText('Programme A')).not.toBeInTheDocument();
  expect(screen.getByTitle("Open Example User 42's learner page")).toBeInTheDocument();
});

it('keeps server ordering and pagination without deduplicating shared email', async () => {
  const users = Array.from({ length: 10 }, (_, i) => user(i + 1));
  await show(users);
  expect(screen.getByText('Showing 1 to 8 of 10 users')).toBeInTheDocument();
  const names = within(screen.getByRole('table')).getAllByText(/^Example User \d+$/).map(el => el.textContent);
  expect(names).toEqual(users.slice(0, 8).map(row => row.name));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('Example User 9')).toBeInTheDocument();
  expect(screen.getByText('Showing 9 to 10 of 10 users')).toBeInTheDocument();
  expect(screen.queryByText('Example User 1')).not.toBeInTheDocument();
});

it('exports all matching records on either page rather than only the eight visible rows', async () => {
  const download = vi.spyOn(directoryExport, 'exportUsersCsv').mockImplementation(() => {});
  const users = Array.from({ length: 10 }, (_, i) => user(i + 1));
  await show(users);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(download.mock.calls[0][0]).toEqual(users);
  expect(download.mock.calls[0][1](users[0])).toBe('Live Sessions');
  expect(fetchEnrolmentUsers).toHaveBeenCalledTimes(1);
});

it.each(['Example User 2', 'unique@example.test'])('searches authoritative name/email: %s', async term => {
  const download = vi.spyOn(directoryExport, 'exportUsersCsv').mockImplementation(() => {});
  await show([user(1), user(2, { email: 'unique@example.test' })]);
  fireEvent.change(screen.getByPlaceholderText('Search name, email, group or programme...'), { target: { value: term } });
  await waitFor(() => expect(screen.getByText('Showing 1 to 1 of 1 users')).toBeInTheDocument());
  expect(screen.getByText('Example User 2')).toBeInTheDocument();
  expect(screen.queryByText('Example User 1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(download.mock.calls[0][0].map(row => row.id)).toEqual(['2']);
});

it('applies programme, cohort, group and both independent status filters', async () => {
  const download = vi.spyOn(directoryExport, 'exportUsersCsv').mockImplementation(() => {});
  await show([user(1, { subscriptionStatus: 'Invited', subscriptionVerified: false }),
    user(2, { programme: 'Programme B', cohort: 'Cohort B', group: 'Group B', programmeStatus: 'Active' })]);
  fireEvent.change(select('Programme'), { target: { value: 'Programme A' } });
  await waitFor(() => expect(within(select('Cohort')).getByRole('option', { name: 'Cohort A' })).toBeInTheDocument());
  fireEvent.change(select('Cohort'), { target: { value: 'Cohort A' } });
  fireEvent.click(dropdown('Group'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Group A' }));
  fireEvent.click(dropdown('Status'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Invited' }));
  fireEvent.change(select('Programme status'), { target: { value: 'Delivery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(screen.getByText('Showing 1 to 1 of 1 users')).toBeInTheDocument());
  expect(screen.getByText('Example User 1')).toBeInTheDocument();
  expect(screen.queryByText('Example User 2')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(download.mock.calls[0][0].map(row => row.id)).toEqual(['1']);
});

it('exports a header-only matching set when search has no results', async () => {
  const download = vi.spyOn(directoryExport, 'exportUsersCsv').mockImplementation(() => {});
  await show([user(1)]);
  fireEvent.change(screen.getByPlaceholderText('Search name, email, group or programme...'), { target: { value: 'no-match' } });
  await screen.findByText('No users match your filters.');
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(download.mock.calls[0][0]).toEqual([]);
});

it('never exports after the authorised directory request is denied', async () => {
  const download = vi.spyOn(directoryExport, 'exportUsersCsv').mockImplementation(() => {});
  vi.mocked(fetchEnrolmentUsers).mockRejectedValue(new Error('Request failed (403)'));
  render(<MemoryRouter><UsersListPage /></MemoryRouter>);
  await screen.findByText('Request failed (403)');
  expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(download).not.toHaveBeenCalled();
});

it('exports the same Recorded and Live Sessions labels as the attendance column', async () => {
  const download = vi.spyOn(directoryExport, 'exportUsersCsv').mockImplementation(() => {});
  vi.mocked(fetchAttendanceModes).mockResolvedValue({ available: true, modes: { 1: { mode: 'lazy', requestedMode: null } } });
  const users = [user(1), user(2)];
  await show(users);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  const label = download.mock.calls[0][1];
  expect(label(users[0])).toBe('Recorded');
  expect(label(users[1])).toBe('Live Sessions');
});

it('uses the displayed dash for unavailable attendance and blocks an unresolvable attendance filter', async () => {
  const download = vi.spyOn(directoryExport, 'exportUsersCsv').mockImplementation(() => {});
  vi.mocked(fetchAttendanceModes).mockRejectedValue(new Error('Unavailable'));
  await show([user(1)]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(download.mock.calls[0][1](user(1))).toBe('—');
  fireEvent.change(select('Attendance mode'), { target: { value: 'lazy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
});

it('preserves all Created_users types and derives summary categories from that Type', async () => {
  await show(['User', 'Employer', 'Referrer', 'Admin', 'Caseowner'].map((type, i) => user(i + 1, { type })));
  expect(screen.getByText('Showing 1 to 5 of 5 users')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Admins/ }));
  expect(await screen.findByText('Showing 1 to 1 of 1 users')).toBeInTheDocument();
  expect(screen.getByText('Example User 4')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Employers/ }));
  expect(await screen.findByText('Example User 2')).toBeInTheDocument();
});

it('retains the export control and staff/employer creation menu without fetching their directory rows', async () => {
  await show([user(1)]);
  expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
  for (const name of ['Create admin', 'Create tutor', 'Create employer profile', 'Create organisation profile']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
  expect(fetchStaffUsers).not.toHaveBeenCalled();
  expect(listEmployers).not.toHaveBeenCalled();
});
