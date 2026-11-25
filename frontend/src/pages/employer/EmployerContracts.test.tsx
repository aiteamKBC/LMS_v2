import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import type { EmployerContractsResponse } from '@/api/employerContracts';
import { EmployerContracts } from './EmployerContracts';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/api/employerContracts', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/employerContracts')>(), fetchEmployerContracts: mocks.read,
}));
vi.mock('./EmployerDocumentPreview', () => ({ EmployerDocumentPreview: ({ target, onClose }: {
  target: { learnerId: string; item: { label: string } }; onClose: () => void;
}) => <div role="dialog" aria-label={`${target.learnerId}: ${target.item.label}`}><button onClick={onClose}>Close preview</button></div> }));
const learners = [{ id: '11', kind: 'apprenticeship', name: 'Alex Learner' }, { id: '12', kind: 'commercial', name: 'Morgan Learner' }] as EmployerLearnerCard[];
const data: EmployerContractsResponse = { sources: { lms: 'ready' }, contracts: [
  { id: '1', source: 'lms', label: 'Training Plan', date: '2026-11-20', signed: false, available: true,
    document: { id: '1', kind: 'training-plan', docType: 'training-plan', label: 'Training Plan', generatedAt: '2026-11-20', signed: false, signable: true, signedName: '', signedAt: null } },
  { id: '2', source: 'lms', label: 'Apprenticeship Agreement', date: '2026-11-01', signed: true, available: true,
    document: { id: '2', kind: 'agreement', docType: 'apprenticeship-agreement', label: 'Apprenticeship Agreement', generatedAt: '2026-11-01', signed: true, signable: true, signedName: 'Employer', signedAt: '2026-11-02' } },
] };
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(data); });
afterEach(cleanup);
const show = (employerId = '8', owners = learners) => render(<MemoryRouter><EmployerContracts employerId={employerId} learners={owners} /></MemoryRouter>);

it('shows LMS contracts and saved signature states for apprenticeship and commercial learners', async () => {
  show();
  const panel = within(await screen.findByRole('region', { name: 'Contracts (4)' }));
  expect(panel.getAllByText('Your signature needed')).toHaveLength(2);
  expect(panel.getAllByText('Your signature saved')).toHaveLength(2);
  expect(panel.queryByText('Aptem')).not.toBeInTheDocument();
  expect(panel.getByRole('button', { name: 'Open Morgan Learner: Apprenticeship Agreement' })).toBeVisible();
  await userEvent.click(panel.getByRole('button', { name: 'Open Alex Learner: Training Plan' }));
  expect(screen.getByRole('dialog', { name: '11: Training Plan' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps other learners contracts visible on a failed LMS read and allows retry', async () => {
  mocks.read.mockResolvedValueOnce({ contracts: [], sources: { lms: 'error' } });
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Some contracts could not be loaded.');
  expect(screen.getByRole('button', { name: 'Open Morgan Learner: Training Plan' })).toBeVisible();
  const signal = mocks.read.mock.calls[0][3] as AbortSignal;
  await userEvent.click(screen.getByRole('button', { name: 'Retry contracts' }));
  await screen.findByRole('region', { name: 'Contracts (4)' });
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not show a false empty state on failed reads', async () => {
  mocks.read.mockRejectedValue(new Error('offline'));
  show();
  await screen.findByRole('alert');
  expect(screen.queryByText('No contracts available for your learners.')).not.toBeInTheDocument();
});

it('aborts previous employer requests and ignores late results', async () => {
  let finish!: (value: EmployerContractsResponse) => void;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const page = show('8', learners.slice(0, 1));
  const oldSignal = mocks.read.mock.calls[0][3] as AbortSignal;
  mocks.read.mockResolvedValue({ contracts: [], sources: { lms: 'ready', aptem: 'ready' } });
  page.rerender(<MemoryRouter><EmployerContracts employerId="9" learners={learners.slice(1)} /></MemoryRouter>);
  await screen.findByText('No contracts available for your learners.');
  await act(async () => finish(data));
  expect(oldSignal.aborted).toBe(true);
  expect(screen.queryByText('Training Plan')).not.toBeInTheDocument();
});
