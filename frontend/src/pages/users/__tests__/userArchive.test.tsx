import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchEnrolmentUsers, setEnrolmentUserArchived, deleteEnrolmentUser } from '@/api/enrolmentUsers';
import { fetchStaffUsers } from '@/api/staffUsers';
import type { UserListRow } from '../types';
import UsersListPage from '../page';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('@/pages/users/presentation/EnrolmentWorkspaceShell', () => ({ EnrolmentWorkspaceShell: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/api/enrolmentUsers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/enrolmentUsers')>(),
  fetchEnrolmentUsers: vi.fn(), setEnrolmentUserArchived: vi.fn(), deleteEnrolmentUser: vi.fn(),
}));
vi.mock('@/api/attendanceLectures', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/attendanceLectures')>(),
  fetchAttendanceModes: vi.fn(async () => ({ available: true, modes: {} })),
}));
vi.mock('@/api/staffUsers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/staffUsers')>(),
  fetchStaffUsers: vi.fn(async () => [{
    id: '7', uuid: null, name: 'Staff member', type: 'Tutor', email: 'staff@example.test', group: '',
    subscriptionStatus: 'FullUser', subscriptionVerified: true, learningPlan: false, hasSignedIn: true,
  }]),
}));
vi.mock('@/api/employers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/employers')>(), listEmployers: vi.fn(async () => ({ results: [] })),
}));
vi.mock('@/api/curriculum', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/curriculum')>(),
  fetchProgrammes: vi.fn(async () => []), fetchCohorts: vi.fn(async () => []), fetchGroups: vi.fn(async () => []),
}));

const learner = (id: string, name: string, status = 'FullUser', source: UserListRow['source'] = 'apprenticeship'): UserListRow => ({
  id, uuid: null, name, type: 'User', source, email: `${id}@example.test`, group: '',
  subscriptionStatus: status, subscriptionVerified: status === 'FullUser', learningPlan: false, hasSignedIn: true,
  programmeStatus: 'Active',
});
let records: UserListRow[];
beforeEach(() => {
  vi.stubGlobal('AppIcon', AppIcon);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected request'); }));
  records = [learner('11', 'Current learner'), learner('12', 'Archived learner', 'Archived', 'commercial')];
  vi.mocked(fetchEnrolmentUsers).mockImplementation(async () => [...records]);
  vi.mocked(setEnrolmentUserArchived).mockImplementation(async (id, archived) => {
    records = records.map(row => row.id === id ? { ...row, subscriptionStatus: archived ? 'Archived' : 'FullUser' } : row);
  });
  vi.mocked(deleteEnrolmentUser).mockImplementation(async id => { records = records.filter(row => row.id !== id); });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const view = (url = '/users') => render(<MemoryRouter initialEntries={[url]}><UsersListPage /></MemoryRouter>);
const archive = () => fireEvent.click(screen.getByRole('button', { name: /^Archive \(/ }));
const users = () => fireEvent.click(screen.getByRole('button', { name: /^Users \(/ }));
const menu = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `More actions for ${name}` }));
};
const confirm = (name: string) => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));

it.each(['11', '12'])('finds an exact email outside programme filters or in the archive (%s) after an explicit action', async id => {
  view(`/users?programme=Other+programme&search=${id}@example.test`);
  const show = await screen.findByRole('button', { name: 'Show existing learner' });
  expect(screen.queryByRole('button', { name: /More actions for/ })).not.toBeInTheDocument();
  fireEvent.click(show);
  const name = id === '11' ? 'Current learner' : 'Archived learner';
  expect(await screen.findByRole('button', { name: `More actions for ${name}` })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Show existing learner' })).not.toBeInTheDocument();
});

it('does not treat different emails or similar learner names as an existing-email match', async () => {
  records = [
    { ...learner('11', 'Example Alpha'), email: 'alpha@example.test' },
    { ...learner('12', 'Example Alpha Two'), email: 'alpha.two@example.test' },
  ];
  view('/users?search=alpha.three@example.test');
  await screen.findByText('No users match your filters.');
  expect(screen.queryByRole('button', { name: 'Show existing learner' })).not.toBeInTheDocument();
});

it('keeps archived learners out of the users list and preserves the archive view in the URL', async () => {
  view();
  expect(await screen.findByText('Current learner')).toBeVisible();
  expect(screen.queryByText('Archived learner')).not.toBeInTheDocument();
  archive();
  expect(await screen.findByText('Archived learner')).toBeVisible();
  expect(screen.queryByText('Current learner')).not.toBeInTheDocument();
  expect(screen.queryByText('Staff member')).not.toBeInTheDocument();
  cleanup();
  view('/users?view=archive');
  expect(await screen.findByText('Archived learner')).toBeVisible();
});

it.each(['apprenticeship', 'commercial'] as const)('archives and restores a %s learner after confirmation', async source => {
  records[0] = { ...records[0], source };
  view();
  await menu('Current learner');
  expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Move to archive' }));
  expect(setEnrolmentUserArchived).not.toHaveBeenCalled();
  confirm('Move to archive');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(setEnrolmentUserArchived).toHaveBeenCalledWith('11', true);
  expect(screen.queryByText('Current learner')).not.toBeInTheDocument();
  archive();
  await menu('Current learner');
  fireEvent.click(screen.getByRole('button', { name: 'Restore user' }));
  confirm('Restore user');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(setEnrolmentUserArchived).toHaveBeenLastCalledWith('11', false);
  expect(screen.queryByText('Current learner')).not.toBeInTheDocument();
  users();
  expect(await screen.findByText('Current learner')).toBeVisible();
});

it('cancels deletion without writing, then deletes only the confirmed archived learner', async () => {
  view('/users?view=archive');
  await menu('Archived learner');
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('This cannot be undone');
  confirm('Cancel');
  expect(deleteEnrolmentUser).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'More actions for Archived learner' })).toHaveFocus();
  await menu('Archived learner');
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  confirm('Delete permanently');
  await waitFor(() => expect(deleteEnrolmentUser).toHaveBeenCalledWith('12'));
  expect(await screen.findByText('No archived users.')).toBeVisible();
  users();
  expect(await screen.findByText('Current learner')).toBeVisible();
});

it.each(['archive', 'restore', 'delete'] as const)('keeps the dialog open and shows %s failures without changing the list', async action => {
  const label = action === 'archive' ? 'Move to archive' : action === 'restore' ? 'Restore user' : 'Delete permanently';
  if (action === 'delete') vi.mocked(deleteEnrolmentUser).mockRejectedValueOnce(new Error('Operation failed'));
  else vi.mocked(setEnrolmentUserArchived).mockRejectedValueOnce(new Error('Operation failed'));
  view(action === 'archive' ? '/users' : '/users?view=archive');
  await menu(action === 'archive' ? 'Current learner' : 'Archived learner');
  fireEvent.click(screen.getByRole('button', { name: label }));
  confirm(label);
  expect(await screen.findByRole('alert')).toHaveTextContent('Operation failed');
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: label })).toBeEnabled();
});

it('excludes independent staff records and their archive actions from the canonical directory', async () => {
  view();
  await screen.findByRole('button', { name: 'More actions for Current learner' });
  expect(screen.queryByRole('button', { name: 'More actions for Staff member' })).not.toBeInTheDocument();
  expect(fetchStaffUsers).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Move to archive' })).not.toBeInTheDocument();
});

it('counts canonical account types within the selected active or archived population', async () => {
  records.push({ ...learner('13', 'Canonical admin'), type: 'Admin' });
  records.push({ ...learner('14', 'Canonical employer'), type: 'Employer' });
  view();
  await screen.findByRole('button', { name: 'More actions for Canonical admin' });
  const metric = (label: string) => screen.getByRole('button', { name: new RegExp(label) });
  expect(metric('Total users')).toHaveTextContent('3');
  expect(metric('Learners')).toHaveTextContent('1');
  expect(metric('Admins')).toHaveTextContent('1');
  expect(metric('Employers')).toHaveTextContent('1');
  archive();
  await screen.findByRole('button', { name: 'More actions for Archived learner' });
  expect(metric('Total users')).toHaveTextContent('1');
  expect(metric('Learners')).toHaveTextContent('1');
  expect(metric('Admins')).toHaveTextContent('0');
  expect(metric('Employers')).toHaveTextContent('0');
});

it('keeps the archive selected when clearing filters', async () => {
  view('/users?view=archive&search=missing');
  await screen.findByText('No users match your filters.');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(await screen.findByText('Archived learner')).toBeVisible();
  expect(screen.getByRole('button', { name: /^Archive \(/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('Current learner')).not.toBeInTheDocument();
});

it('returns to the previous page when its last learner is archived', async () => {
  vi.mocked(fetchStaffUsers).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  records = Array.from({ length: 9 }, (_, index) => learner(String(index + 20), `Learner ${index + 1}`));
  view('/users?page=2');
  await menu('Learner 9');
  fireEvent.click(screen.getByRole('button', { name: 'Move to archive' }));
  confirm('Move to archive');
  expect(await screen.findByText('Learner 1')).toBeVisible();
  expect(screen.queryByText('Learner 9')).not.toBeInTheDocument();
});
