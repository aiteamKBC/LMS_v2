/**
 * A locked sidebar item — the onboarding apprentice's Reviews before their
 * enrolment is submitted — is shown with its reason but cannot be followed.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceShell } from '../WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { rememberLearner } from '@/hooks/useMyLearner';
import { fetchLearnerSummary } from '@/api/learnerDetail';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  auth: { account: { role: 'learner' }, user: { fullName: 'Learner' }, roles: [] },
  isAdmin: false,
  canSeeNavItem: () => true,
}) }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerSummary: vi.fn() }));
vi.mock('../GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('../CoachViewAsBar', () => ({ CoachViewAsBar: () => null }));
vi.mock('../Header', () => ({ Header: () => null }));

let learnerId = 900;
const sidebar = () => within(screen.getByRole('navigation', { name: 'Learner primary navigation' }));

function renderOnboarding(onboardingStatus: string) {
  rememberLearner('apprenticeship', String(++learnerId));
  vi.mocked(fetchLearnerSummary).mockResolvedValue({
    learnerType: 'apprenticeship', programmeStatus: 'Onboarding', onboardingStatus, studentActivityAvailable: false,
  } as Awaited<ReturnType<typeof fetchLearnerSummary>>);
  const config = roleNavMap.learner;
  render(
    <MemoryRouter initialEntries={['/learner/onboarding']}>
      <WorkspaceShell role="learner" roleLabel={config.label} navItems={config.items} pageTitle="My Enrolment">
        <p>page</p>
      </WorkspaceShell>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it('shows Reviews locked, not as a link, before the enrolment is submitted', async () => {
  renderOnboarding('In progress');

  const reviews = await waitFor(() => sidebar().getByRole('link', { name: /^Reviews/ }));
  expect(reviews).toHaveAttribute('aria-disabled', 'true');
  expect(reviews).not.toHaveAttribute('href');
  expect(reviews).toHaveAccessibleName(/locked: Available once you submit your enrolment/);
  // The enrolment itself stays reachable.
  expect(sidebar().getByRole('link', { name: 'My Enrolment' })).toHaveAttribute('href', '/learner/onboarding');
});

it('links to Reviews once the enrolment is submitted', async () => {
  renderOnboarding('Submitted');

  const reviews = await waitFor(() => sidebar().getByRole('link', { name: 'Reviews' }));
  expect(reviews).toHaveAttribute('href', '/learner/onboarding/reviews');
  expect(reviews).not.toHaveAttribute('aria-disabled');
});
