import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { WorkspaceShell } from '../WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { rememberLearner } from '@/hooks/useMyLearner';
import { fetchLearnerSummary } from '@/api/learnerDetail';

const viewer = vi.hoisted(() => ({ role: 'admin', denied: new Set<string>() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  auth: { account: { role: viewer.role }, user: { fullName: 'Reviewer' }, roles: [] },
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
  fireEvent.click(sidebar().getByRole('button', { name: 'My Progress' }));
  expect(sidebar().getByRole('link', { name: 'Monthly Logs' })).toBeVisible();
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

  for (const [label, path] of [['My Learning', '/learner/my-learning'], ['Dashboard', '/workspace/learner'], ['Monthly Logs', '/learner/monthly-logs']]) {
    await act(async () => { fireEvent.click(sidebar().getByRole('link', { name: new RegExp(`^${label}`) })); });
    expect(screen.getByTestId('path')).toHaveTextContent(path);
    expect(destinations()).toEqual(initialDestinations);
    expect(sidebar().getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-current', 'page');
  }
});
