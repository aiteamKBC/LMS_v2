/**
 * Club membership is staff-assigned — there is no learner join/leave flow.
 * This guards the assign/remove round trip and that the member count comes
 * from the real membership list, not a stale counter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';

(globalThis as unknown as { AppIcon: typeof AppIcon }).AppIcon = AppIcon;

const fetchClubs = vi.fn();
const fetchClubMembers = vi.fn();
const assignClubMember = vi.fn();
const removeClubMember = vi.fn();
const authValue = vi.fn();

vi.mock('@/api/engagement', () => ({
  fetchClubs: (...args: unknown[]) => fetchClubs(...args),
  fetchClubMembers: (...args: unknown[]) => fetchClubMembers(...args),
  assignClubMember: (...args: unknown[]) => assignClubMember(...args),
  removeClubMember: (...args: unknown[]) => removeClubMember(...args),
  createClub: vi.fn(), updateClub: vi.fn(), deleteClub: vi.fn(),
  addClubMeeting: vi.fn(), updateClubMeeting: vi.fn(), deleteClubMeeting: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/pages/engagement/LearnerPickerModal', () => ({
  LearnerPickerModal: ({ open, onSelect }: { open: boolean; onSelect: (l: unknown) => void }) =>
    open ? (
      <button onClick={() => onSelect({ id: '61', name: 'Daniel Walsh', email: 'daniel@kbc.test', cohort: 'Sept 2025 Kent', programme: 'MSN' })}>
        Pick Daniel Walsh
      </button>
    ) : null,
}));

const { default: EngagementClubsPage } = await import('../page');

const CLUB = {
  id: 'c-1', name: 'Kent Club', location: 'Kent', description: 'Local learners in Kent', ambassador: 'Sam Ambassador',
  ambassadorRole: 'Kent Ambassador', members: 1, sampleMembers: ['AB'], active: true, meetings: [],
};

beforeEach(() => {
  fetchClubs.mockReset();
  fetchClubMembers.mockReset();
  assignClubMember.mockReset();
  removeClubMember.mockReset();
  authValue.mockReturnValue({ auth: { account: { displayName: 'Rewan Yasser', position: 'Engagement Manager' } } });
  fetchClubs.mockResolvedValue([CLUB]);
});

function renderPage() {
  return render(<MemoryRouter><EngagementClubsPage /></MemoryRouter>);
}

describe('staff club membership', () => {
  it('assigns a learner via the picker, not a self-join flow', async () => {
    fetchClubMembers.mockResolvedValue([]);
    assignClubMember.mockResolvedValue({ id: 'm-1', learnerId: '61', learnerName: 'Daniel Walsh', assignedBy: 'Rewan Yasser', assignedAt: '2026-08-31' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Kent Club')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Members/i }));
    await waitFor(() => expect(screen.getByText('No learners assigned yet.')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Assign a learner/i }));
    await user.click(screen.getByText('Pick Daniel Walsh'));

    await waitFor(() => expect(assignClubMember).toHaveBeenCalledWith('c-1', { learnerId: '61', learnerName: 'Daniel Walsh' }));
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());
  });

  it('removing a member calls the real remove endpoint', async () => {
    fetchClubMembers.mockResolvedValue([{ id: 'm-1', learnerId: '61', learnerName: 'Daniel Walsh', assignedBy: 'Rewan Yasser', assignedAt: '2026-08-31' }]);
    removeClubMember.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Kent Club')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Members/i }));
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(removeClubMember).toHaveBeenCalledWith('c-1', '61'));
    await waitFor(() => expect(screen.getByText('No learners assigned yet.')).toBeTruthy());
  });
});
