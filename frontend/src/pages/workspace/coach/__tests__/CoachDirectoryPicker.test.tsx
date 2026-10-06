import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CoachDirectoryPicker } from '../CoachDirectoryPicker';

const DIRECTORY = {
  coaches: [
    {
      id: 1, name: 'Amina Okoro', email: 'amina@kbc.test', caseloadCount: 24, activeLearnerCount: 19,
      performance: {
        available: true, attendanceRate: 76, progressReviewRate: 88, pendingMarking: 4, completedReviews: 11,
        otjh: { onTrack: 12, needAttention: 5, atRisk: 2 },
        progressReviews: { required: 8, completed: 7, overdue: 1 },
        monthlyCoaching: { required: 18, completed: 16, overdue: 2 },
      },
    },
    {
      id: 2, name: 'Test Coach', email: 'test.coach@kbc.test', caseloadCount: 2, activeLearnerCount: 2,
      performance: null,
    },
  ],
  caseloadCountsAvailable: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CoachDirectoryPicker', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('lists each coach with performance metrics and opens the one that is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(DIRECTORY)));
    const onSelect = vi.fn();
    render(<CoachDirectoryPicker onSelect={onSelect} />);

    const aminaCard = await screen.findByRole('button', { name: 'Open Amina Okoro workspace' });
    expect(within(aminaCard).getAllByText('19').length).toBeGreaterThan(0);
    expect(within(aminaCard).getByText('76%')).toBeTruthy();
    expect(within(aminaCard).getByText('88%')).toBeTruthy();
    expect(within(aminaCard).queryByText('REVIEWS DONE')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Open Test Coach workspace' }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test.coach@kbc.test', caseloadCount: 2 }),
    );
  });

  it('filters the cards by name or email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(DIRECTORY)));
    render(<CoachDirectoryPicker onSelect={vi.fn()} />);
    await screen.findByRole('button', { name: 'Open Amina Okoro workspace' });

    await userEvent.type(screen.getByPlaceholderText('Search associate or coach'), 'test.coach');

    expect(screen.queryByRole('button', { name: 'Open Amina Okoro workspace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Test Coach workspace' })).toBeTruthy();
  });

  it('shows no PR rate when the coach has no progress reviews in the last 12 weeks', async () => {
    const coach = {
      ...DIRECTORY.coaches[0],
      name: 'Asmaa Hamazeen',
      email: 'asmaa@kbc.test',
      performance: {
        ...DIRECTORY.coaches[0].performance,
        progressReviewRate: null,
        progressReviews: { required: 0, completed: 0, overdue: 0 },
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      coaches: [coach],
      caseloadCountsAvailable: true,
    })));
    render(<CoachDirectoryPicker onSelect={vi.fn()} />);

    const card = await screen.findByRole('button', { name: 'Open Asmaa Hamazeen workspace' });
    const metric = within(card).getByText('PR RATE').parentElement;
    expect(metric?.textContent).toBe('PR RATE--');
    expect(within(card).queryByText('0%')).toBeNull();
  });

  it("surfaces the server's message rather than an empty grid", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ message: 'Unable to load the coach directory.' }, 503),
    ));
    render(<CoachDirectoryPicker onSelect={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Unable to load the coach directory.')).toBeTruthy());
  });

  it('shows no caseload numbers when the caseload database is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ ...DIRECTORY, caseloadCountsAvailable: false }),
    ));
    render(<CoachDirectoryPicker onSelect={vi.fn()} />);
    await screen.findByRole('button', { name: 'Open Amina Okoro workspace' });

    expect(screen.queryByText('24')).toBeNull();
    expect(screen.getByText(/Caseload numbers are unavailable/)).toBeTruthy();
  });
});
