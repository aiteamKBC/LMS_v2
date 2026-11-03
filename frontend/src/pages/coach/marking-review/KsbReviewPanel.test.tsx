import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { KsbReviewPanel, type KsbReview } from './KsbReviewPanel';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const review: KsbReview = { status: 'pending', revision: 'r1', programme: 'Programme Six',
  sourceId: 'standard:six', originalCodes: ['B4.1'],
  items: [{ code: 'B7', description: 'Professional behaviour for Programme Six' }] };

describe('programme KSB correction', () => {
  it('requires an explicit choice and reason, retaining the original claim', async () => {
    const onSaved = vi.fn();
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ status: 'accepted' })));
    render(<KsbReviewPanel submissionId="s1" review={review} onSaved={onSaved} />);
    expect(screen.getByText(/B4.1/)).toBeVisible();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save KSB correction' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select the relevant programme KSBs');
    expect(coachFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /B7/ }));
    fireEvent.change(screen.getByLabelText('Reason for KSB correction'), { target: { value: 'Evidence meets this programme criterion.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save KSB correction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/marking-queue/s1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ action: 'review_ksbs', revision: 'r1', sourceId: 'standard:six',
        ksbCodes: ['B7'], reason: 'Evidence meets this programme criterion.' }),
    }));
  });

  it('retains choices when a concurrent correction is rejected', async () => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ detail: 'Reload the changed submission.' }), { status: 409 }));
    const onSaved = vi.fn();
    render(<KsbReviewPanel submissionId="s1" review={review} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Reason for KSB correction'), { target: { value: 'My explanation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save KSB correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload the changed submission.');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByLabelText('Reason for KSB correction')).toHaveValue('My explanation');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows completed correction history without another write action', () => {
    render(<KsbReviewPanel submissionId="s1" review={{ ...review, status: 'completed',
      reviewedBy: 'Synthetic coach', correctionReason: 'Reviewed against Programme Six.' }} onSaved={vi.fn()} />);
    expect(screen.getByText(/Synthetic coach/)).toBeVisible();
    expect(screen.getByText(/B4.1/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });
});
