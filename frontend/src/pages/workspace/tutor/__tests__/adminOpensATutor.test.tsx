/**
 * What an administrator gets at /workspace/tutor.
 *
 * Before this, an admin landed on their own tutor workspace — which is nobody's
 * — and was told no modules were linked to their account. True, and useless.
 * Now they choose from a card per tutor, and the page asks about that tutor's
 * identity instead of their own.
 *
 * A tutor's own visit is unchanged, which is the other half of the contract and
 * is pinned here rather than assumed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const fetchTutorWorkspace = vi.fn();
const fetchModuleStructure = vi.fn();
const fetchStaffUsers = vi.fn();
const fetchCurriculumTutors = vi.fn();
const authValue = vi.fn();

vi.mock('@/api/tutorWorkspace', () => ({
  fetchTutorWorkspace: (...args: unknown[]) => fetchTutorWorkspace(...args),
  fetchModuleStructure: (...args: unknown[]) => fetchModuleStructure(...args),
}));
vi.mock('@/api/staffUsers', () => ({ fetchStaffUsers: () => fetchStaffUsers() }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumTutors: () => fetchCurriculumTutors() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));
// Renders the subtitle as well as the title: "Choose a tutor..." is the
// subtitle, and it is how the page says it is showing the picker.
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children, pageTitle, pageSubtitle }: { children: React.ReactNode; pageTitle: string; pageSubtitle?: string }) => (
    <div><h1>{pageTitle}</h1><p>{pageSubtitle}</p>{children}</div>
  ),
}));

const { default: TutorDashboard } = await import('../page');

const ADMIN = { email: 'admin@kbc.test', displayName: 'Demo Admin', access: 'super-admin' };
const TUTOR_ACCOUNT = { email: 'rachel@kbc.test', displayName: 'Rachel Myers', access: 'tutor' };

const EMPTY_WORKSPACE = { linked: true, tutor: { name: 'Rachel Myers' }, modules: [], nextSession: null };

function renderPage() {
  return render(<MemoryRouter><TutorDashboard /></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  authValue.mockReturnValue({ auth: { account: ADMIN }, isInitialized: true });
  fetchStaffUsers.mockResolvedValue([
    { id: 1, name: 'Rachel Myers', email: 'rachel@kbc.test', position: 'Tutor', access: 'tutor' },
  ]);
  fetchCurriculumTutors.mockResolvedValue([
    { id: 'p1', name: 'Rachel Myers', email: 'rachel@kbc.test', jobTitle: 'Business Admin Tutor', moduleCount: 6, groupCount: 3 },
  ]);
  fetchTutorWorkspace.mockResolvedValue(EMPTY_WORKSPACE);
});

describe('an administrator at the tutor workspace', () => {
  it('is offered a card per tutor rather than their own empty workspace', async () => {
    renderPage();

    expect(await screen.findByText('Rachel Myers')).toBeTruthy();
    expect(screen.getByText('Choose a tutor to open their workspace')).toBeTruthy();
    // The admin's own account is never asked about — it is nobody's workspace.
    expect(fetchTutorWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByText(/No modules are linked/)).toBeNull();
  });

  it('opens the picked tutor, asking about them and not the admin', async () => {
    renderPage();
    await screen.findByText('Rachel Myers');

    await userEvent.click(screen.getByText('Rachel Myers'));

    await waitFor(() => expect(fetchTutorWorkspace).toHaveBeenCalled());
    expect(fetchTutorWorkspace).toHaveBeenCalledWith(
      { email: 'rachel@kbc.test', name: 'Rachel Myers' },
      expect.anything(),
    );
    expect(await screen.findByText(/Viewing/)).toBeTruthy();
  });

  it('goes back to the cards from the tutor being viewed', async () => {
    renderPage();
    await screen.findByText('Rachel Myers');
    await userEvent.click(screen.getByText('Rachel Myers'));
    await screen.findByText(/Viewing/);

    await userEvent.click(screen.getByText('All tutors'));

    expect(await screen.findByText('Choose a tutor to open their workspace')).toBeTruthy();
  });

  it('tells the admin the TUTOR is unlinked, not their own account', async () => {
    fetchTutorWorkspace.mockResolvedValue({ linked: false, tutor: null, modules: [], nextSession: null });
    renderPage();
    await screen.findByText('Rachel Myers');

    await userEvent.click(screen.getByText('Rachel Myers'));

    expect(await screen.findByText(/No modules are linked to this tutor yet/)).toBeTruthy();
  });

  it('leaves a tutor’s own visit alone', async () => {
    authValue.mockReturnValue({ auth: { account: TUTOR_ACCOUNT }, isInitialized: true });
    renderPage();

    await waitFor(() => expect(fetchTutorWorkspace).toHaveBeenCalled());
    expect(fetchTutorWorkspace).toHaveBeenCalledWith(
      { email: 'rachel@kbc.test', name: 'Rachel Myers' },
      expect.anything(),
    );
    // No picker: a tutor has exactly one workspace and it is theirs.
    expect(screen.queryByText('Choose a tutor to open their workspace')).toBeNull();
  });
});
