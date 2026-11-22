import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeepDiveRecord } from '@/api/deepDive';
import DeepDivePage from './DeepDivePage';

const mocks = vi.hoisted(() => ({
  directory: vi.fn(), board: vi.fn(), summaries: vi.fn(), detail: vi.fn(), ilr: vi.fn(),
}));
vi.mock('@/api/enrolmentUsers', () => ({
  fetchEnrolmentUsers: mocks.directory, fetchEnrolmentBoard: mocks.board,
}));
vi.mock('@/api/deepDive', () => ({
  fetchDeepDiveSummaries: mocks.summaries, fetchDeepDiveRecord: mocks.detail,
  fetchDeepDiveIlrContact: mocks.ilr, importDeepDiveWorkbook: vi.fn(),
  markDeepDiveRecordReviewed: vi.fn(), sha256File: vi.fn(),
  syncDeepDiveFromCreatedUsers: vi.fn(), updateDeepDiveRecord: vi.fn(), workbookToDeepDiveRows: vi.fn(),
}));

const summary = {
  id: '00000000-0000-4000-8000-000000000001', identityKey: 'lms:42',
  sourceFileName: '', sourceFileHash: '', sourceSheet: 'Created_users', sourceRow: 42,
  lmsLearnerId: '42', firstName: 'Synthetic', surname: 'Learner', fullName: 'Synthetic Learner',
  dateOfBirth: '', uln: '', qualification: '', level: '', startDate: '', practicalEndDate: '',
  apprenticeshipEndDate: '', plannedGatewayDate: '', plannedEpaDate: '', postcode: 'CT1 1AA', observer: '',
  reviewedBy: '', notes: '', operational: {}, raw: { email: 'learner@example.test', programme: 'Programme' },
  version: 1, updatedBy: '', reviewedAt: null, createdAt: null, updatedAt: null,
} satisfies DeepDiveRecord;

afterEach(() => { cleanup(); Object.values(mocks).forEach((value) => value.mockReset()); });

it('shows the learner table before the directory resolves and loads full details on selection', async () => {
  mocks.directory.mockReturnValue(new Promise(() => {}));
  mocks.summaries.mockResolvedValue({ count: 1, records: [summary] });
  mocks.board.mockResolvedValue(null);
  mocks.ilr.mockResolvedValue({ uln: '1000000001', postcode: 'CT1 1AA' });
  let resolveDetail!: (record: DeepDiveRecord) => void;
  mocks.detail.mockReturnValue(new Promise<DeepDiveRecord>((resolve) => { resolveDetail = resolve; }));

  render(<DeepDivePage />);
  expect(await screen.findByRole('button', { name: 'View details →' })).toBeVisible();
  expect(mocks.directory).toHaveBeenCalledTimes(1);
  expect(mocks.detail).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'View details →' }));
  await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith(summary.id));
  expect(screen.getByText('Loading Deep Dive details…')).toBeVisible();
  await act(async () => { resolveDetail({ ...summary, operational: { mcm: { last: 'Recorded', next: '', lastCompleted: '', dates: [] } } }); });
  expect(screen.getByRole('button', { name: /Operational snapshot/ })).toBeVisible();
});

it('keeps Deep Dive records visible when the separate learner directory fails', async () => {
  mocks.directory.mockRejectedValue(new Error('Directory unavailable'));
  mocks.summaries.mockResolvedValue({ count: 1, records: [summary] });

  render(<DeepDivePage />);

  expect(await screen.findByRole('button', { name: 'View details →' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Learner directory: Directory unavailable');
});

it('orders learners by postcode and puts missing postcodes last', async () => {
  mocks.directory.mockReturnValue(new Promise(() => {}));
  mocks.summaries.mockResolvedValue({ count: 3, records: [
    { ...summary, id: '3', fullName: 'Missing Postcode', postcode: '' },
    { ...summary, id: '2', fullName: 'Maidstone Learner', postcode: 'ME1 1AA' },
    { ...summary, id: '1', fullName: 'Canterbury Learner', postcode: 'CT10 2BB' },
  ] });

  render(<DeepDivePage />);

  const rows = await screen.findAllByRole('row');
  const rowIndex = (name: string) => rows.findIndex((row) => row.textContent?.includes(name));
  expect(screen.queryByText(/Postcode area/)).not.toBeInTheDocument();
  expect(rowIndex('Canterbury Learner')).toBeLessThan(rowIndex('Maidstone Learner'));
  expect(rowIndex('Maidstone Learner')).toBeLessThan(rowIndex('Missing Postcode'));
});
