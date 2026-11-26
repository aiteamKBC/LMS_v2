import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import CoachExtraActivitiesPage from './page';
import { readExtraActivities, readExtraLearners } from './api';

vi.mock('./api', () => ({ readExtraActivities: vi.fn(), readExtraLearners: vi.fn() }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.test', name: 'Actual Coach', isInitialized: true }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
const learner = { id: 7, kind: 'apprenticeship' as const, name: 'Synthetic learner', programme: 'Programme' };
beforeEach(() => {
  vi.mocked(readExtraLearners).mockReset().mockResolvedValue([learner]);
  vi.mocked(readExtraActivities).mockReset().mockResolvedValue({ items: [{ id: 's1', learnerId: '7', learnerKind: 'apprenticeship', learner: learner.name,
    title: 'External workshop', hours: '2', month: '2026-10', status: 'accepted', addedBy: 'Actual Coach', reviewedBy: 'Actual Coach', submittedAt: '' }], total: 1, hasNext: false });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('lists only extra activities with clear provenance, filters them and opens the dedicated review route', async () => {
  render(<MemoryRouter><CoachExtraActivitiesPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'External workshop' })).toBeVisible();
  expect(screen.getByText('Extra activity')).toBeVisible();
  expect(screen.getByText('Added by: Actual Coach')).toBeVisible();
  expect(screen.getByRole('link', { name: 'View and review activity' })).toHaveAttribute('href', '/coach/extra-activities/s1');
  expect(screen.queryByRole('button', { name: /Add activity|Record and approve/i })).toBeNull();
  expect(screen.queryByLabelText('Activity title')).toBeNull();
  expect(screen.queryByText('Optional evidence uploader')).toBeNull();
  expect(within(screen.getByRole('region', { name: 'Extra activity filters' })).getByText(/Learners add their own activities and evidence/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Learner'), { target: { value: '7' } });
  await waitFor(() => expect(vi.mocked(readExtraActivities).mock.calls.at(-1)?.[0].get('learner')).toBe('7'));
  expect(screen.queryByRole('button', { name: /Add activity|Record and approve/i })).toBeNull();
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'pending' } });
  await waitFor(() => expect(vi.mocked(readExtraActivities).mock.calls.at(-1)?.[0].get('status')).toBe('pending'));
});
it('keeps read failures visible and retries without reporting a false empty list', async () => {
  vi.mocked(readExtraActivities).mockRejectedValueOnce(new Error('Service unavailable'));
  render(<MemoryRouter><CoachExtraActivitiesPage /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
  expect(screen.queryByText('No extra activities match these filters.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry activities' }));
  expect(await screen.findByRole('heading', { name: 'External workshop' })).toBeVisible();
});

it('keeps month filters and pagination available without opening a creation form', async () => {
  vi.mocked(readExtraActivities).mockResolvedValue({ items: [], total: 26, hasNext: true });
  render(<MemoryRouter><CoachExtraActivitiesPage /></MemoryRouter>);
  await screen.findByText('No extra activities match these filters.');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(vi.mocked(readExtraActivities).mock.calls.at(-1)?.[0].get('page')).toBe('2'));
  fireEvent.change(screen.getByLabelText('Activity month'), { target: { value: '2026-09' } });
  await waitFor(() => expect(vi.mocked(readExtraActivities).mock.calls.at(-1)?.[0].get('month')).toBe('2026-09'));
  expect(vi.mocked(readExtraActivities).mock.calls.at(-1)?.[0].get('page')).toBe('1');
  expect(screen.queryByRole('button', { name: /Add activity|Record and approve/i })).toBeNull();
});
