import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { WorkspaceShell } from '../WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { rememberLearner } from '@/hooks/useMyLearner';
import { fetchLearnerSummary } from '@/api/learnerDetail';

const viewer = vi.hoisted(() => ({
  role: 'admin',
  denied: new Set<string>(),
  // Set only for the "reviewing my own record" cases below: a staff member or
  // administrator who is ALSO a learner (login/learner_enrolment.py).
  learnerRecordId: null as number | null,
  learnerRecordKind: null as string | null,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  auth: {
    account: {
      role: viewer.role,
      learnerRecordId: viewer.learnerRecordId,
      learnerRecordKind: viewer.learnerRecordKind,
    },
    user: { fullName: 'Reviewer' },
    roles: [],
  },
  isAdmin: viewer.role === 'admin',
  canSeeNavItem: (id: string) => !viewer.denied.has(id),
}) }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerSummary: vi.fn() }));
vi.mock('../GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('../CoachViewAsBar', () => ({ CoachViewAsBar: () => null }));
vi.mock('../Header', () => ({ Header: () => null }));

// Keep WorkspaceShell and its real navigation gate together, including the
// shell remount that happens when the router opens a different learner page.
function LearnerPage() {
  const { pathname } = useLocation();
  const config = roleNavMap.learner;
  return <WorkspaceShell key={pathname} role="learner" roleLabel={config.label} navItems={config.items} pageTitle="Learner page">
    <output data-testid="path">{pathname}</output>
  </WorkspaceShell>;
}

const sidebar = () => within(screen.getByRole('navigation', { name: 'Learner primary navigation' }));
const destinations = () => sidebar().getAllByRole('link').map(link => link.getAttribute('href'));
let learnerId = 0;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  viewer.denied.clear();
  viewer.learnerRecordId = null;
  viewer.learnerRecordKind = null;
});

it.each([
  ['admin', 'commercial', 'Delivery'],
  ['staff', 'commercial', 'Onboarding'],
  ['admin', 'apprenticeship', 'Onboarding'],
  ['staff', 'apprenticeship', 'Fresh user'],
] as const)('keeps the %s menu for %s visible from every page during %s', async (role, kind, programmeStatus) => {
  viewer.role = role;
  rememberLearner(kind, String(++learnerId));
  viewer.denied.add('learner-evidence');
  vi.mocked(fetchLearnerSummary).mockResolvedValue({ learnerType: kind, programmeStatus, studentActivityAvailable: false } as Awaited<ReturnType<typeof fetchLearnerSummary>>);
  render(<MemoryRouter initialEntries={['/learner/calendar']}><LearnerPage /></MemoryRouter>);

  // These links must already exist before ever visiting Dashboard.
  expect(sidebar().getByRole('link', { name: /^My Learning/ })).toBeVisible();
  expect(sidebar().getByRole('link', { name: 'Attendance' })).toBeVisible();
  const progressToggle = sidebar().getByRole('button', { name: 'My Progress' });
  if (progressToggle.getAttribute('aria-expanded') !== 'true') {
    await act(async () => { fireEvent.click(progressToggle); });
  }
  await waitFor(() => expect(sidebar().getByRole('link', { name: 'Monthly Logs' })).toBeVisible());
  expect(sidebar().queryByRole('link', { name: 'Evidence' })).toBeNull();
  const initialDestinations = destinations();
  expect(new Set(initialDestinations).size).toBe(initialDestinations.length);
  await act(async () => {});
  expect(fetchLearnerSummary).toHaveBeenCalled();
  expect(destinations()).toEqual(initialDestinations);

  if (kind === 'commercial') {
    // My Enrolment redirects commercial learners back to Dashboard. Offering
    // it would create two buttons that open the same page.
    expect(sidebar().queryByRole('link', { name: 'My Enrolment' })).toBeNull();
    expect(sidebar().queryByRole('link', { name: 'Compliance documents' })).toBeNull();
  } else {
    expect(sidebar().getByRole('link', { name: 'My Enrolment' })).toHaveAttribute('href', '/learner/onboarding');
    expect(sidebar().getByRole('link', { name: 'Compliance documents' })).toBeVisible();
  }

  for (const [label, path] of [['My Learning', '/learner/my-learning'], ['Dashboard', '/workspace/learner/dashboard'], ['Monthly Logs', '/learner/monthly-logs']]) {
    await act(async () => { fireEvent.click(sidebar().getByRole('link', { name: new RegExp(`^${label}`) })); });
    expect(screen.getByTestId('path')).toHaveTextContent(path);
    expect(destinations()).toEqual(initialDestinations);
    expect(sidebar().getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-current', 'page');
  }
});

it('gives an admin the REAL (reduced) menu on their OWN learner record, not the reviewing one', async () => {
  // A staff member or administrator who is also a learner reaches their own
  // record the same way a learner does — via their account's own
  // learnerRecordId/Kind matching the page they are on. That must get the
  // ordinary reduced menu (evidence hidden until Delivery, etc.), or an admin
  // studying their own programme could reach pages with no training plan
  // behind them yet.
  viewer.role = 'admin';
  viewer.learnerRecordId = 512;
  viewer.learnerRecordKind = 'commercial';
  rememberLearner('commercial', '512');
  vi.mocked(fetchLearnerSummary).mockResolvedValue({
    learnerType: 'commercial', programmeStatus: 'Onboarding', studentActivityAvailable: false,
  } as Awaited<ReturnType<typeof fetchLearnerSummary>>);
  render(<MemoryRouter initialEntries={['/learner/calendar']}><LearnerPage /></MemoryRouter>);
  await act(async () => {});

  // The reduced menu for a not-yet-started learner: My Learning is gone, not
  // merely denied by canSeeNavItem.
  expect(sidebar().queryByRole('link', { name: /^My Learning/ })).toBeNull();
});

it('still gives the full reviewing menu when the SAME admin opens a DIFFERENT learner', async () => {
  // The account has a learner record of its own, but this page is not it — the
  // enrolment workspace opened someone else's record for review.
  viewer.role = 'admin';
  viewer.learnerRecordId = 512;
  viewer.learnerRecordKind = 'commercial';
  rememberLearner('commercial', String(++learnerId));
  vi.mocked(fetchLearnerSummary).mockResolvedValue({
    learnerType: 'commercial', programmeStatus: 'Onboarding', studentActivityAvailable: false,
  } as Awaited<ReturnType<typeof fetchLearnerSummary>>);
  render(<MemoryRouter initialEntries={['/learner/calendar']}><LearnerPage /></MemoryRouter>);
  await act(async () => {});

  expect(sidebar().getByRole('link', { name: /^My Learning/ })).toBeVisible();
});
