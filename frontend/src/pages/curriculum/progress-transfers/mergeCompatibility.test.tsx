import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/progressTransfer';
import { TransferRequests } from './page';

vi.mock('@/api/progressTransfer', () => ({ getTransferRequests: vi.fn(), getTransferReview: vi.fn(), approveTransferRequest: vi.fn() }));
const request: api.AdminTransfer = {
  requestId: 'MERGE-1', learnerId: '7', learnerKind: 'commercial', learnerName: 'Synthetic learner', programme: 'Synthetic programme',
  status: 'pending', requestedAt: '2026-11-10T09:00:00Z', approvedAt: null,
  modules: [{ courseRef: 'legacy:50', moduleId: 'M1', oldTitle: 'Original module', newTitle: 'New module', percent: 40, hours: 2 }],
};
const show = () => render(<MemoryRouter><TransferRequests /></MemoryRouter>);
afterEach(() => vi.resetAllMocks());

describe('enrolment merge compatibility with current transfer behavior', () => {
  it('retains an unmatched old component, preserves existing retained records and sends the reviewed request', async () => {
    const approved = { ...request, status: 'approved' as const };
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce({ requests: [request], nextOffset: null, csrfToken: 'list-csrf' })
      .mockResolvedValue({ requests: [approved], nextOffset: null, csrfToken: 'list-csrf' });
    vi.mocked(api.approveTransferRequest).mockResolvedValue(approved);
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'current-review', csrfToken: 'review-csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module', completedTargetIds: ['BASE'], retainedCompletedIds: ['RETAINED'],
      sources: [{ sourceActivityRef: 'material:unmatched', title: 'Legacy specialist activity', type: 'unknown', week: 'Week 1', automaticTargetId: null }],
      targets: [{ componentId: 'BASE', title: 'Existing activity', type: 'reading', week: 'Week 1', plannedHours: 1 }],
    }] });
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Review transfer request MERGE-1' }));
    const retain = await screen.findByRole('checkbox', { name: /No equivalent component in the new module/ });
    const approve = screen.getByRole('button', { name: 'Approve transfer' });
    expect(approve).toBeDisabled(); expect(api.approveTransferRequest).not.toHaveBeenCalled();
    fireEvent.click(retain);
    const counts = within(screen.getByRole('region', { name: 'Component counts for New module' }));
    expect(counts.getByText('Total components').parentElement).toHaveTextContent('3');
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('3');
    expect(counts.getByText('Existing completions').parentElement).toHaveTextContent('2');
    expect(counts.getByText('Progress after merge (preview): 100%')).toBeVisible();
    expect(approve).toBeEnabled(); fireEvent.click(approve);
    await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('MERGE-1', 'review-csrf', {
      reviewToken: 'current-review', mappings: [{ moduleId: 'M1', sourceActivityRef: 'material:unmatched', retain: true }],
    }));
    expect(await screen.findByText(/Progress merged successfully/)).toBeVisible();
  });

  it('adds an extra destination to a verified source link without counting or submitting that link twice', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'list-csrf' });
    vi.mocked(api.approveTransferRequest).mockRejectedValue(new Error('Synthetic retry required'));
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'current-review', csrfToken: 'review-csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module', completedTargetIds: ['BASE'],
      sources: [{ sourceActivityRef: 'material:verified', title: 'Verified source', type: 'reading', week: 'Week 1', automaticTargetId: 'BASE' }],
      targets: [{ componentId: 'BASE', title: 'Verified destination', type: 'reading', week: 'Week 1', plannedHours: 1 },
        { componentId: 'EXTRA', title: 'Additional destination', type: 'reading', week: 'Week 2', plannedHours: 1 }],
    }] });
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Review transfer request MERGE-1' }));
    const choices = within(await screen.findByRole('group', { name: 'Match Verified source (material:verified) in New module' }));
    fireEvent.click(choices.getByRole('button', { name: 'Choose components' }));
    fireEvent.click(choices.getByRole('button', { name: /^Week 2/ }));
    expect(choices.queryByRole('checkbox', { name: /Verified destination/ })).not.toBeInTheDocument();
    fireEvent.click(choices.getByRole('checkbox', { name: /Additional destination/ }));
    fireEvent.click(choices.getByRole('button', { name: 'Done' }));
    const counts = within(screen.getByRole('region', { name: 'Component counts for New module' }));
    expect(counts.getByText('Completed components').parentElement).toHaveTextContent('2');
    expect(counts.getByText('Matched from old LMS').parentElement).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: 'Approve transfer' }));
    await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('MERGE-1', 'review-csrf', {
      reviewToken: 'current-review', mappings: [{ moduleId: 'M1', sourceActivityRef: 'material:verified', targetComponentId: 'EXTRA' }],
    }));
  });

  it('displays the stored merged percentage and retained history without inventing a destination', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [{ ...request, status: 'approved', approvedAt: '2026-11-10T10:00:00Z', modules: [{
      ...request.modules[0], mergedPercent: 100, componentCounts: { total: 1, matched: 0, completed: 1, remaining: 0 },
      componentMatches: [{ sourceActivityRef: 'material:retained', sourceTitle: 'Retained legacy activity', targetComponentId: null, targetTitle: null, manual: false, retained: true }],
    }] }], nextOffset: null, csrfToken: 'list-csrf' });
    show(); await screen.findByText('No requests waiting for approval.');
    fireEvent.click(screen.getByRole('tab', { name: /^Approved/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Details for request MERGE-1' }));
    expect(screen.getByText('Progress at merge: 100%')).toBeVisible();
    expect(screen.getByText('No equivalent in the new module')).toBeVisible();
    expect(screen.getByText('Retained legacy activity')).toBeVisible();
    expect(api.getTransferReview).not.toHaveBeenCalled(); expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });
});
