/**
 * The tutor workspace's four states.
 *
 * It shows two things and nothing else: the modules the tutor is assigned to,
 * and their next live session. What makes that worth testing is the states
 * around it, because the data has two independent ways of being absent and they
 * need different words:
 *
 *  - nothing identifies the account as a tutor      -> "not linked"
 *  - linked, but no future occurrence on any module -> "nothing scheduled"
 *
 * Collapsing those into one empty state was the trap: an unlinked account would
 * be told its timetable is empty, which is a lie about a fixable configuration
 * problem.
 *
 * The identity itself is resolved server-side from email OR name, so what the
 * page owes is sending both — pinned below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { TutorWorkspace } from '@/api/tutorWorkspace';

const fetchTutorWorkspace = vi.fn();
const fetchModuleStructure = vi.fn();
const authValue = vi.fn();

vi.mock('@/api/tutorWorkspace', () => ({
  fetchTutorWorkspace: (...args: unknown[]) => fetchTutorWorkspace(...args),
  fetchModuleStructure: (...args: unknown[]) => fetchModuleStructure(...args),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));
// The shell drags in the sidebar, header and learner nav gate; none of that is
// what these tests are about.
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children, pageTitle }: { children: React.ReactNode; pageTitle: string }) => (
    <div><h1>{pageTitle}</h1>{children}</div>
  ),
}));

const { default: TutorDashboard } = await import('../page');

const MODULE = {
  moduleCatalogueId: 'MOD-1',
  title: 'M1',
  description: '',
  programmeName: 'MSN',
  cohortName: 'C1',
  groupName: 'G1-sat',
  colour: '#2563eb',
  totalOtjh: '12.00',
  sessionsNumber: 5,
  startDate: '2026-08-01',
  endDate: '2026-09-05',
  sessionWeekDay: 'Saturday',
  sessionStartTime: '09:00',
  sessionEndTime: '11:00',
  nextSession: null,
};

const SESSION = {
  liveSessionId: 'LIVE-1',
  moduleCatalogueId: 'MOD-1',
  moduleTitle: 'Module 1',
  sessionNumber: 4,
  scheduledStart: '2036-08-28T07:30:00',
  scheduledEnd: '2036-08-28T09:30:00',
  timezone: 'GMT Standard Time',
  durationMinutes: 120,
  repeatPattern: 'weekly',
  repeatOccurrences: 5,
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
  status: 'scheduled',
};

function resolvesTo(payload: Partial<TutorWorkspace>) {
  fetchTutorWorkspace.mockResolvedValue({
    linked: true, matchedBy: 'email', tutor: null, modules: [], nextSession: null, ...payload,
  });
}

function renderPage() {
  return render(<MemoryRouter><TutorDashboard /></MemoryRouter>);
}

beforeEach(() => {
  fetchTutorWorkspace.mockReset();
  fetchModuleStructure.mockReset();
  fetchModuleStructure.mockResolvedValue({ weeks: [] });
  authValue.mockReturnValue({
    auth: { account: { email: 'tutor@kbc.test', displayName: 'test tutor' } },
    isInitialized: true,
  });
});

describe('tutor workspace', () => {
  it('sends both the account email and its name, since either can match', async () => {
    // The login account and the curriculum tutor profile share no key, so the
    // server needs both and decides which one resolves.
    resolvesTo({});
    renderPage();
    await waitFor(() => expect(fetchTutorWorkspace).toHaveBeenCalled());
    expect(fetchTutorWorkspace.mock.calls[0][0]).toEqual({
      email: 'tutor@kbc.test',
      name: 'test tutor',
    });
  });

  it('still asks when the account has a name but no email', async () => {
    authValue.mockReturnValue({
      auth: { account: { email: '', displayName: 'test tutor' } },
      isInitialized: true,
    });
    resolvesTo({});
    renderPage();
    await waitFor(() => expect(fetchTutorWorkspace).toHaveBeenCalled());
    expect(fetchTutorWorkspace.mock.calls[0][0]).toEqual({ email: '', name: 'test tutor' });
  });

  it('says nothing is linked, rather than showing an empty timetable', async () => {
    resolvesTo({ linked: false, matchedBy: '' });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No modules are linked to this account/)).toBeTruthy());
    // Names both keys that failed to match, and where to fix it — an unlinked
    // account is a configuration problem somebody can act on.
    expect(screen.getByText('test tutor')).toBeTruthy();
    expect(screen.getByText('tutor@kbc.test')).toBeTruthy();
    expect(screen.getByText(/Staff profiles/)).toBeTruthy();
    // And must not claim there is nothing scheduled; that is a different state.
    expect(screen.queryByText(/No upcoming session scheduled/)).toBeNull();
  });

  it('shows the next session with its own time zone named, not converted', async () => {
    resolvesTo({ modules: [MODULE], nextSession: SESSION });
    renderPage();
    await waitFor(() => expect(screen.getByText('Next session')).toBeTruthy());
    expect(screen.getByText('Module 1')).toBeTruthy();
    expect(screen.getByText('GMT Standard Time')).toBeTruthy();
    expect(screen.getByText('120 min')).toBeTruthy();
    // "4 of 5" — the occurrence's place in its series.
    expect(screen.getByText('4 of 5')).toBeTruthy();
  });

  it('offers the meeting link when the session has one', async () => {
    resolvesTo({ modules: [MODULE], nextSession: SESSION });
    renderPage();
    const join = await waitFor(() => screen.getByText(/Join the meeting/).closest('a'));
    expect(join?.getAttribute('href')).toBe(SESSION.joinUrl);
    // Opens out of the SPA: it is a Teams URL, not an in-app route.
    expect(join?.getAttribute('target')).toBe('_blank');
  });

  it('renders the module details from the curriculum record', async () => {
    resolvesTo({ modules: [MODULE], nextSession: null });
    renderPage();
    await waitFor(() => expect(screen.getByText('M1')).toBeTruthy());
    expect(screen.getByText('MSN · C1 · G1-sat')).toBeTruthy();
    expect(screen.getByText('Saturday 09:00–11:00')).toBeTruthy();
    expect(screen.getByText('12h')).toBeTruthy();
    // Regex, not a literal: en-GB abbreviates September as "Sep" or "Sept"
    // depending on the ICU data the running Node was built with.
    expect(screen.getByText(/1 Aug 2026 → 5 Sept? 2026/)).toBeTruthy();
  });

  it('distinguishes "nothing scheduled" from "no modules"', async () => {
    resolvesTo({ modules: [MODULE], nextSession: null });
    renderPage();
    await waitFor(() => expect(screen.getByText('No upcoming session scheduled')).toBeTruthy());
    // With a module assigned, the explanation points at the session schedule…
    expect(screen.getByText(/None of your modules has a future live session/)).toBeTruthy();
  });

  it('…and points at the assignment when there are no modules at all', async () => {
    resolvesTo({ modules: [], nextSession: null });
    renderPage();
    await waitFor(() => expect(screen.getByText(/no modules assigned/i)).toBeTruthy());
  });

  it('surfaces a load failure instead of rendering as empty', async () => {
    fetchTutorWorkspace.mockRejectedValue(new Error('Database error: boom'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Could not load your workspace')).toBeTruthy());
    expect(screen.getByText('Database error: boom')).toBeTruthy();
  });

  it('does not call the API before the session has resolved', () => {
    authValue.mockReturnValue({ auth: { account: null }, isInitialized: false });
    renderPage();
    expect(fetchTutorWorkspace).not.toHaveBeenCalled();
  });

  it('does not call the API when the account has neither email nor name', () => {
    authValue.mockReturnValue({
      auth: { account: { email: '', displayName: '' } },
      isInitialized: true,
    });
    renderPage();
    expect(fetchTutorWorkspace).not.toHaveBeenCalled();
  });

  describe('opening a module', () => {
    const WEEKS = [
      {
        id: 'WEEK-1',
        weekNumber: 1,
        title: 'Week 1',
        summary: 'Getting started',
        components: [
          {
            id: 'COMP-1',
            type: 'powerpoint',
            title: 'Fouda-PPT',
            description: '',
            expectedOtjh: 2,
            points: 15,
            reflectionRequired: false,
            workplaceEvidenceRequired: false,
            tutorValidationRequired: true,
          },
        ],
      },
      { id: 'WEEK-2', weekNumber: 2, title: 'Week 2', summary: '', components: [] },
    ];

    it('does not fetch a module structure until the card is opened', async () => {
      resolvesTo({ modules: [MODULE] });
      renderPage();
      await waitFor(() => expect(screen.getByText('M1')).toBeTruthy());
      // A tutor with several modules should not wait on every module's weeks to
      // see any of them.
      expect(fetchModuleStructure).not.toHaveBeenCalled();
    });

    it('loads the weeks and components on open', async () => {
      fetchModuleStructure.mockResolvedValue({ weeks: WEEKS });
      resolvesTo({ modules: [MODULE] });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(screen.getByText('M1')).toBeTruthy());
      await user.click(screen.getByText('M1'));

      await waitFor(() => expect(screen.getByText('Week 1')).toBeTruthy());
      expect(fetchModuleStructure.mock.calls[0][0]).toBe('MOD-1');
      expect(screen.getByText('Fouda-PPT')).toBeTruthy();
      expect(screen.getByText('Slides')).toBeTruthy();
      expect(screen.getByText('2h')).toBeTruthy();
      // Requirement chips appear only for the flags actually set.
      expect(screen.getByText('Your validation')).toBeTruthy();
      expect(screen.queryByText('Evidence')).toBeNull();
      // A week with nothing in it says so rather than looking broken.
      expect(screen.getByText('Nothing added yet')).toBeTruthy();
    });

    it('reuses the structure when the card is closed and reopened', async () => {
      fetchModuleStructure.mockResolvedValue({ weeks: WEEKS });
      resolvesTo({ modules: [MODULE] });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(screen.getByText('M1')).toBeTruthy());
      await user.click(screen.getByText('M1'));
      await waitFor(() => expect(screen.getByText('Week 1')).toBeTruthy());
      await user.click(screen.getByText('M1'));
      await user.click(screen.getByText('M1'));
      await waitFor(() => expect(screen.getByText('Week 1')).toBeTruthy());
      expect(fetchModuleStructure).toHaveBeenCalledTimes(1);
    });

    it("shows the module's own session and its join link inside the card", async () => {
      resolvesTo({ modules: [{ ...MODULE, nextSession: SESSION }] });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(screen.getByText('M1')).toBeTruthy());
      await user.click(screen.getByText('M1'));

      await waitFor(() => expect(screen.getByText('Next live session')).toBeTruthy());
      const join = screen.getByText('Join').closest('a');
      expect(join?.getAttribute('href')).toBe(SESSION.joinUrl);
    });

    it('says so when the module itself has nothing scheduled', async () => {
      // Independent of the other modules: this one has no session even though
      // another might.
      resolvesTo({ modules: [MODULE] });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(screen.getByText('M1')).toBeTruthy());
      await user.click(screen.getByText('M1'));
      await waitFor(() =>
        expect(screen.getByText(/No live session is scheduled against this module/)).toBeTruthy(),
      );
    });

    it('surfaces a structure load failure inside the card', async () => {
      fetchModuleStructure.mockRejectedValue(new Error('Database error: nope'));
      resolvesTo({ modules: [MODULE] });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => expect(screen.getByText('M1')).toBeTruthy());
      await user.click(screen.getByText('M1'));
      await waitFor(() => expect(screen.getByText('Database error: nope')).toBeTruthy());
    });
  });
});
