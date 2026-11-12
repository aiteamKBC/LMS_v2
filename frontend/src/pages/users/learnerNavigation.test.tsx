import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchEnrolmentUsers } from '@/api/enrolmentUsers';
import type { UserListRow } from './types';
import UsersListPage from './page';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock('@/pages/users/presentation/EnrolmentWorkspaceShell', () => ({ EnrolmentWorkspaceShell: ({ children }: { children: ReactNode }) => children }));
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

beforeEach(() => {
  vi.stubGlobal('AppIcon', AppIcon);
  // Any unexpected request stays offline, including invitation actions.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected request'); }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function Destination() {
  return <p data-testid="destination">{useLocation().pathname}</p>;
}

function DirectoryQuery() { return <output data-testid="directory-query">{useLocation().search}</output>; }

it('searches case owners, keeps the choice as a draft until Apply, and clears it without losing other URL parameters', async () => {
  vi.mocked(fetchEnrolmentUsers).mockResolvedValue(Array.from({ length: 10 }, (_, index): UserListRow => ({
    id: `${200 + index}`, uuid: null, name: `Example learner ${index + 1}`, type: 'User', source: 'apprenticeship',
    email: `example${index + 1}@example.test`, group: '', subscriptionStatus: 'FullUser',
    subscriptionVerified: true, learningPlan: false, hasSignedIn: true, programmeStatus: 'Delivery',
    caseOwner: `Owner ${String(index + 1).padStart(2, '0')}`,
  })));
  render(<MemoryRouter initialEntries={['/users?keep=example']}><UsersListPage /><DirectoryQuery /></MemoryRouter>);
  await screen.findByText('Example learner 1');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  const owner = screen.getByRole('combobox', { name: 'Case owner' });
  fireEvent.click(owner);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search case owner…' }), { target: { value: 'Owner 09' } });
  expect(screen.queryByRole('option', { name: 'Owner 01' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'Owner 09' }));
  expect(owner).toHaveTextContent('Owner 09'); expect(owner).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(screen.getByText('Example learner 1')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await screen.findByText('Example learner 9');
  expect(screen.queryByText('Example learner 1')).not.toBeInTheDocument();
  expect(screen.getByTestId('directory-query')).toHaveTextContent('caseOwner=Owner+09');
  expect(screen.getByTestId('directory-query')).toHaveTextContent('keep=example');
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  await screen.findByText('Example learner 1');
  expect(owner).toHaveTextContent('All case owners');
  expect(screen.getByTestId('directory-query')).not.toHaveTextContent('caseOwner=');
  expect(screen.getByTestId('directory-query')).toHaveTextContent('keep=example');
});

it.each(['commercial', 'apprenticeship'] as const)('opens the %s learner Dashboard from the admin directory', async source => {
  const learner: UserListRow = {
    id: '132', uuid: null, name: 'Test learner', type: 'User', source,
    email: 'learner@example.test', group: '', subscriptionStatus: 'FullUser',
    subscriptionVerified: true, learningPlan: false, hasSignedIn: true, programmeStatus: 'Delivery',
  };
  vi.mocked(fetchEnrolmentUsers).mockResolvedValue([learner]);
  render(<MemoryRouter initialEntries={['/users']}><Routes>
    <Route path="/users" element={<UsersListPage />} />
    <Route path="*" element={<Destination />} />
  </Routes></MemoryRouter>);
  fireEvent.click(await screen.findByTitle("Open Test learner's learner page"));
  expect(await screen.findByTestId('destination')).toHaveTextContent(`/workspace/learner/${source}/132`);
});

it('keeps the learning plan available in more actions and restores keyboard focus on Escape', async () => {
  vi.mocked(fetchEnrolmentUsers).mockResolvedValue([{
    id: '133', uuid: null, name: 'Example Learner', type: 'User', source: 'apprenticeship',
    email: 'example@example.test', group: '', subscriptionStatus: 'FullUser', subscriptionVerified: true,
    learningPlan: true, hasLearningPlan: true, hasSignedIn: true, programmeStatus: 'Active', reference: 'EX-133',
  }]);
  render(<MemoryRouter initialEntries={['/users']}><UsersListPage /></MemoryRouter>);
  const toggle = await screen.findByLabelText('More actions for Example Learner');
  const plan = screen.getByTitle("Edit Example Learner's learning plan");
  expect(plan).not.toBeVisible();
  fireEvent.click(toggle);
  expect(plan).toBeVisible();
  plan.focus();
  fireEvent.keyDown(plan, { key: 'Escape' });
  expect(plan).not.toBeVisible();
  expect(toggle).toHaveFocus();
  expect(screen.getByText('EX-133')).toBeInTheDocument();
});
