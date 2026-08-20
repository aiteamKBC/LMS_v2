import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CoachDirectoryPicker } from '../CoachDirectoryPicker';

const DIRECTORY = {
  coaches: [
    { id: 1, name: 'Amina Okoro', email: 'amina@kbc.test', caseloadCount: 24, activeLearnerCount: 19 },
    { id: 2, name: 'Test Coach', email: 'test.coach@kbc.test', caseloadCount: 2, activeLearnerCount: 2 },
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

  it('lists each coach with their caseload and reports the one that is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(DIRECTORY)));
    const onSelect = vi.fn();
    render(<CoachDirectoryPicker onSelect={onSelect} />);

    expect(await screen.findByText('Amina Okoro')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('19')).toBeTruthy();

    await userEvent.click(screen.getByText('Test Coach'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test.coach@kbc.test', caseloadCount: 2 }),
    );
  });

  it('filters the cards by name or email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(DIRECTORY)));
    render(<CoachDirectoryPicker onSelect={vi.fn()} />);
    await screen.findByText('Amina Okoro');

    await userEvent.type(screen.getByPlaceholderText('Search name or email...'), 'test.coach');

    expect(screen.queryByText('Amina Okoro')).toBeNull();
    expect(screen.getByText('Test Coach')).toBeTruthy();
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
    await screen.findByText('Amina Okoro');

    expect(screen.queryByText('24')).toBeNull();
    expect(screen.getByText(/Caseload numbers are unavailable/)).toBeTruthy();
  });
});
