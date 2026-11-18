import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { read, utils } from 'xlsx';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchEnrolmentUsers } from '@/api/enrolmentUsers';
import { fetchAttendanceModes } from '@/api/attendanceLectures';
import type { UserListRow } from '../types';
import { createDirectoryWorkbook } from '../exportDirectory';
import UsersListPage from '../page';

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/pages/users/presentation/EnrolmentWorkspaceShell', () => ({ EnrolmentWorkspaceShell: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/api/enrolmentUsers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/enrolmentUsers')>(), fetchEnrolmentUsers: vi.fn(),
}));
vi.mock('@/api/attendanceLectures', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/attendanceLectures')>(), fetchAttendanceModes: vi.fn(),
}));
vi.mock('@/api/staffUsers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/staffUsers')>(),
  fetchStaffUsers: vi.fn(async () => [{ ...learner('staff', 'Staff example'), type: 'Tutor', learningPlan: false }]),
}));
vi.mock('@/api/employers', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/employers')>(),
  listEmployers: vi.fn(async () => ({ results: [{ id: 'employer', name: 'Employer example', email: 'employer@example.test', employerGroupNames: ['Example company'] }] })),
}));
vi.mock('@/api/curriculum', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/curriculum')>(),
  fetchProgrammes: vi.fn(async () => []), fetchCohorts: vi.fn(async () => []), fetchGroups: vi.fn(async () => []),
}));

function learner(id: string, name = `Include learner ${id}`): UserListRow {
  return {
    id, uuid: null, name, type: 'User', source: Number(id) % 2 ? 'apprenticeship' : 'commercial',
    email: `${id}@example.test`, group: 'Example group', programme: 'Course A', cohort: 'Cohort A',
    caseOwner: 'Owner example', subscriptionStatus: 'FullUser', subscriptionVerified: true,
    learningPlan: true, hasLearningPlan: true, hasSignedIn: true, programmeStatus: 'Active',
  };
}

const createUrl = vi.fn<(blob: Blob) => string>();
let downloads: { filename: string; href: string }[];
beforeEach(() => {
  vi.stubGlobal('AppIcon', AppIcon);
  auth.isAdmin = true;
  downloads = [];
  createUrl.mockReset().mockReturnValue('blob:enrolment-export');
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ filename: this.download, href: this.href });
  });
  // All requests stay offline, including any accidentally invoked integration.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected request'); }));
  vi.mocked(fetchEnrolmentUsers).mockResolvedValue([
    ...Array.from({ length: 10 }, (_, index) => learner(String(index + 1))),
    { ...learner('11'), programme: 'Other course' }, learner('12', 'Excluded by search'),
  ]);
  vi.mocked(fetchAttendanceModes).mockResolvedValue({ available: true, modes: { '1': { mode: 'lazy', requestedMode: null } } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function view(route = '/users') {
  return render(<MemoryRouter initialEntries={[route]}><UsersListPage /></MemoryRouter>);
}
async function exportedRows() {
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(downloads[0]).toEqual({ filename: 'enrolment-users.xlsx', href: 'blob:enrolment-export' });
  const blob = createUrl.mock.calls[0][0];
  expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  const workbook = read(buffer, { type: 'array' });
  expect(workbook.SheetNames).toEqual(['Enrolment']);
  return utils.sheet_to_json<string[]>(workbook.Sheets.Enrolment, { header: 1 });
}

it.each([true, false])('exports all filtered pages from the directory (admin=%s)', async isAdmin => {
  auth.isAdmin = isAdmin;
  view('/users?search=Include&programme=Course+A&summary=learners&page=2');
  await screen.findByText('Include learner 9');
  expect(screen.queryByText('Include learner 1')).not.toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Export' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.click(button);
  const rows = await exportedRows();
  expect(rows).toHaveLength(11);
  expect(rows[0]).toEqual(['User', 'Type', 'Email', 'Group', 'Programme', 'Cohort', 'Case owner', 'Subscription status', 'Learning plan', 'Programme status', 'Attendance mode']);
  expect(rows.slice(1).map(row => row[0])).toEqual(Array.from({ length: 10 }, (_, i) => `Include learner ${i + 1}`));
  expect(rows[1]).toEqual(['Include learner 1', 'User', '1@example.test', 'Example group', 'Course A', 'Cohort A', 'Owner example', 'FullUser', 'Yes', 'Active', 'Recorded']);
  expect(rows[2][10]).toBe('Live Sessions');
});

it('exports only learners matching the attendance filter', async () => {
  view('/users?attendanceMode=lazy');
  await screen.findByText('Include learner 1');
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect((await exportedRows()).slice(1).map(row => row[0])).toEqual(['Include learner 1']);
});

it('includes staff and employers with their learner-only columns blank', async () => {
  view();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  const rows = await exportedRows();
  expect(rows).toHaveLength(15);
  for (const name of ['Staff example', 'Employer example']) {
    const row = rows.find(cells => cells[0] === name)!;
    expect(row.slice(4, 7)).toEqual(['', '', '']);
    expect(row.slice(8, 11)).toEqual(['', '', '']);
  }
});

it.each(['loading', 'modes loading', 'error', 'empty'])('does not download when the directory is %s', async state => {
  if (state === 'loading') vi.mocked(fetchEnrolmentUsers).mockReturnValue(new Promise(() => {}));
  if (state === 'modes loading') vi.mocked(fetchAttendanceModes).mockReturnValue(new Promise(() => {}));
  if (state === 'error') vi.mocked(fetchEnrolmentUsers).mockRejectedValue(new Error('Directory unavailable'));
  view(state === 'empty' ? '/users?search=NoMatchingRows' : '/users');
  if (state === 'error') await screen.findByText('Directory unavailable');
  if (state === 'empty') await screen.findByText('No users match your filters.');
  if (state === 'modes loading') await screen.findByText('Include learner 1');
  const button = screen.getByRole('button', { name: 'Export' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(createUrl).not.toHaveBeenCalled();
});

it('shows a download error and allows retry without guessing failed attendance modes', async () => {
  vi.mocked(fetchAttendanceModes).mockRejectedValue(new Error('Unavailable'));
  createUrl.mockImplementationOnce(() => { throw new Error('Download failed'); });
  view();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not export users. Please try again.');
  expect(downloads).toHaveLength(0);
  createUrl.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect((await exportedRows())[1][10]).toBe('Unavailable');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('preserves Unicode, leading zeroes and formula-like values as plain Excel text', () => {
  const values = ['=1+1', '+SUM(1,2)', '-1', '@SUM(1,2)', '00123', 'متعلم، "مثال"\nNext line'];
  const workbook = read(createDirectoryWorkbook(values.map((name, index) => learner(String(index), name)), {}), { type: 'array' });
  values.forEach((value, index) => {
    const cell = workbook.Sheets.Enrolment[`A${index + 2}`];
    expect(cell.v).toBe(value);
    expect(cell.t).toBe('s');
    expect(cell.f).toBeUndefined();
  });
});
