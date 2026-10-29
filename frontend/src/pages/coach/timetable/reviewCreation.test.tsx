import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type { ReactNode } from 'react';
import TimetablePage from './page';
import { fetchCoachReviewSlots, fetchLearnerAdditionReviewTemplates, createLearnerReviewAddition } from '@/api/reviewInstances';
import { coachFetch } from '@/lib/coachFetch';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.invalid', name: 'Coach', isInitialized: true }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/features/coach/shared/coachSessionCache', () => ({ coachSessionKey: () => 'test', readCoachSessionCache: () => null, writeCoachSessionCache: vi.fn() }));
vi.mock('@/api/reviewInstances', async importOriginal => ({ ...await importOriginal<typeof import('@/api/reviewInstances')>(), fetchCoachReviewSlots: vi.fn(), fetchLearnerAdditionReviewTemplates: vi.fn(), createLearnerReviewAddition: vi.fn() }));

const policy = (canAddReview: boolean) => ({
  learnerId: 21, programmeId: 'P1', canAddReview,
  reviewSource: canAddReview ? 'curriculum' as const : 'aptem' as const,
  detail: canAddReview ? undefined : 'This learner uses Aptem Reviews. Choose an imported Review.',
  // Even an inconsistent/stale template list must not override the server gate.
  templates: [{ id: 'T-PR', name: 'Progress Review', reviewTypeId: 'PR', reviewTypeCode: 'progress_review', reviewTypeName: 'Progress Review' }],
});

async function openReview() {
  render(<MemoryRouter><TimetablePage /></MemoryRouter>);
  await waitFor(() => expect(coachFetch).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole('button', { name: 'Create session' }));
  fireEvent.click(screen.getByRole('button', { name: /Review Add an extra Review/ }));
  await waitFor(() => expect(fetchLearnerAdditionReviewTemplates).toHaveBeenCalledWith('21', expect.any(AbortSignal)));
}

describe('Review creation source boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
  vi.mocked(fetchCoachReviewSlots).mockResolvedValue(['09:00', '10:00', '15:00']);
    vi.stubGlobal('React', React);
    vi.stubGlobal('AppIcon', () => null);
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({
      events: [], schedulerQueues: { catchUp: [{
        id: 'synthetic-catch-up', eventKey: 'synthetic-catch-up', source: 'catch-up',
        learnerId: '21', learner: 'Synthetic learner', status: 'not-scheduled',
        date: '2099-11-19', startHour: 10, duration: 1,
      }] },
    }), { status: 200 }));
  });

  it('disables both creation actions using Aptem server metadata', async () => {
    vi.mocked(fetchLearnerAdditionReviewTemplates).mockResolvedValue(policy(false));
    await openReview();
    expect(await screen.findByText(policy(false).detail!)).toBeVisible();
    expect(screen.getByRole('button', { name: /^Add Review$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add & Schedule' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: 'Progress Review' })).not.toBeInTheDocument();
    expect(createLearnerReviewAddition).not.toHaveBeenCalled();
  });

  it('keeps Native creation available after source verification and selection', async () => {
    vi.mocked(fetchLearnerAdditionReviewTemplates).mockResolvedValue(policy(true));
    await openReview();
    await screen.findByRole('option', { name: 'Progress Review' });
    fireEvent.change(screen.getByLabelText('Review', { selector: 'select' }), { target: { value: 'T-PR' } });
    fireEvent.change(screen.getByLabelText('Target date'), { target: { value: '2099-11-19' } });
    fireEvent.change(screen.getByLabelText('Meeting date (for Add & Schedule)'), { target: { value: '2099-11-19' } });
    expect(screen.getByLabelText('Target date')).toHaveValue('2099-11-19');
    expect(await screen.findByRole('option', { name: '15:00' })).toBeVisible();
    expect(screen.getByLabelText('Meeting time (UK time, Europe/London)').tagName).toBe('SELECT');
    await waitFor(() => expect(fetchCoachReviewSlots).toHaveBeenCalledWith('21', '2099-11-19', 60, expect.any(Object)));
    expect(screen.getByRole('button', { name: /^Add Review$/ })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Meeting time (UK time, Europe/London)'), { target: { value: '15:00' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add & Schedule' })).toBeEnabled());
  });

  it('does not allow creation when source verification fails', async () => {
    vi.mocked(fetchLearnerAdditionReviewTemplates).mockRejectedValue(new Error('Unavailable'));
    await openReview();
    expect(await screen.findByText('Review availability could not be checked. Please try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Add Review$/ })).toBeDisabled();
    expect(createLearnerReviewAddition).not.toHaveBeenCalled();
  });
});
