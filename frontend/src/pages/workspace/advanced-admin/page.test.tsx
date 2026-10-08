import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { advancedAdminLearners, type AdvancedAdminLearner } from '@/api/advancedAdmin';
import AdvancedAdminWorkspace from './page';

vi.mock('@/api/advancedAdmin', () => ({ advancedAdminLearners: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { displayName: 'Reviewer' } } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const learners: AdvancedAdminLearner[] = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  name: `Learner ${String(index + 1).padStart(2, '0')}`,
  programme: index === 10 ? 'Project Controls Professional Level 6' : 'Marketing Executive Level 4',
  programmeCode: index === 10 ? 'PCP' : 'ME',
  programmeStatus: 'Active', cohort: 'Jun 2026', group: 'Sample group', coach: 'Sample coach', lmsLinked: true,
}));

beforeEach(() => vi.mocked(advancedAdminLearners).mockResolvedValue({ count: learners.length, learners }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('reveals learners after the first ten with See More', async () => {
  render(<MemoryRouter><AdvancedAdminWorkspace /></MemoryRouter>);
  expect(await screen.findByText('Learner 01')).toBeVisible();
  expect(screen.getByText('10 of 12 learners')).toBeVisible();
  expect(screen.queryByText('Learner 11')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'See More' }));
  expect(screen.getByText('12 of 12 learners')).toBeVisible();
  expect(screen.getByText('Learner 11')).toBeVisible();
  expect(screen.getByText('Learner 12')).toBeVisible();
});

it('searches and filters the whole approved list before See More is clicked', async () => {
  render(<MemoryRouter><AdvancedAdminWorkspace /></MemoryRouter>);
  expect(await screen.findByText('Learner 01')).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText('Search learners'), { target: { value: 'Learner 12' } });
  expect(screen.getByText('Learner 12')).toBeVisible();
  expect(screen.getByText('1 of 12 learners')).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText('Search learners'), { target: { value: '' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Programme' }), { target: { value: 'PCP' } });
  expect(screen.getByText('Learner 11')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'See More' })).not.toBeInTheDocument();
});
