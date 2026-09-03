/**
 * Staff recognition page — the picker hands back a REAL enrolment learner id
 * now (not a mock 'en-01' roster id), and the server derives the awarder
 * from the session. This guards both: submitting uses the picked learner's
 * real id and sends no client-side `awardedBy`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';

(globalThis as unknown as { AppIcon: typeof AppIcon }).AppIcon = AppIcon;

const fetchRecognitions = vi.fn();
const createRecognition = vi.fn();
const authValue = vi.fn();
const toastSpies = { success: vi.fn(), warning: vi.fn() };

vi.mock('@/api/engagement', () => ({
  fetchRecognitions: (...args: unknown[]) => fetchRecognitions(...args),
  createRecognition: (...args: unknown[]) => createRecognition(...args),
  updateRecognition: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => toastSpies }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// The real picker fetches the enrolment directory itself — irrelevant to
// this page's own logic, so it's replaced with a one-click stub that hands
// back a fixed real learner, exactly like a staff member picking one.
vi.mock('@/pages/engagement/LearnerPickerModal', () => ({
  LearnerPickerModal: ({ open, onSelect }: { open: boolean; onSelect: (l: unknown) => void }) =>
    open ? (
      <button onClick={() => onSelect({ id: '61', name: 'Daniel Walsh', email: 'daniel@kbc.test', cohort: 'Sept 2025 Kent', programme: 'MSN' })}>
        Pick Daniel Walsh
      </button>
    ) : null,
}));

const { default: RecognitionPage } = await import('../page');

beforeEach(() => {
  fetchRecognitions.mockReset();
  createRecognition.mockReset();
  toastSpies.success.mockReset();
  toastSpies.warning.mockReset();
  authValue.mockReturnValue({ auth: { account: { displayName: 'Rewan Yasser', position: 'Engagement Manager' } } });
  fetchRecognitions.mockResolvedValue([]);
});

function renderPage() {
  return render(<MemoryRouter><RecognitionPage /></MemoryRouter>);
}

describe('staff recognition page', () => {
  it('awards a recognition using the picked learner\'s real id, with no client-side awardedBy', async () => {
    createRecognition.mockResolvedValue({
      id: 'rec-1', learnerId: '61', learner: 'Daniel Walsh', avatarImg: undefined,
      programmeCode: 'MSN', programme: 'MSN', cohort: 'Sept 2025 Kent', type: 'badge',
      title: 'Perfect Attendance', description: 'Hit every session this month', category: 'Attendance',
      points: 50, public: true, awardedBy: 'Rewan Yasser', awardedAt: '31 Aug 2026',
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchRecognitions).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Award Recognition/i }));
    await user.click(screen.getByText('Select a learner…'));
    await user.click(screen.getByText('Pick Daniel Walsh'));
    await user.type(screen.getByPlaceholderText('e.g. Perfect Attendance'), 'Perfect Attendance');
    await user.type(screen.getByPlaceholderText('What did they do to earn it?'), 'Hit every session this month');
    await user.type(screen.getByPlaceholderText('e.g. Attendance'), 'Attendance');

    const submitButtons = screen.getAllByRole('button', { name: /Award Recognition/i });
    await user.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => expect(createRecognition).toHaveBeenCalled());
    const input = createRecognition.mock.calls[0][0];
    expect(input.learnerId).toBe('61');
    expect(input.learnerName).toBe('Daniel Walsh');
    expect(input.programme).toBe('MSN');
    expect(input.cohort).toBe('Sept 2025 Kent');
    expect(input).not.toHaveProperty('awardedBy');
  });

  it('blocks submission without a learner selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchRecognitions).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Award Recognition/i }));
    await user.type(screen.getByPlaceholderText('e.g. Perfect Attendance'), 'Perfect Attendance');
    await user.type(screen.getByPlaceholderText('What did they do to earn it?'), 'Hit every session this month');
    await user.type(screen.getByPlaceholderText('e.g. Attendance'), 'Attendance');

    const submitButtons = screen.getAllByRole('button', { name: /Award Recognition/i });
    await user.click(submitButtons[submitButtons.length - 1]);

    expect(screen.getByText('Choose the learner being recognised')).toBeTruthy();
    expect(createRecognition).not.toHaveBeenCalled();
  });
});
