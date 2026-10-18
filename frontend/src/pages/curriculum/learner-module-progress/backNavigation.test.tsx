import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LearnerModuleProgressPage from './page';

const { fetchImpact } = vi.hoisted(() => ({ fetchImpact: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/mocks/navigation', () => ({ curriculumNavItems: [] }));
vi.mock('@/lib/curriculumApi', () => ({
  fetchCurriculumScopeLearnerKsbImpact: fetchImpact,
  fetchCurriculumScopeLearnerRoster: vi.fn(async () => ({ assignedLearners: [] })),
  saveCurriculumActivityStatus: vi.fn(),
  fetchCurriculumActivityStatusHistory: vi.fn(async () => ({ history: [] })),
}));

const CATALOGUE = '/curriculum/module-builder?programme=Business+Management&cohort=COHORT-1&group=GROUP-1&q=leadership&learners=MOD-1';

function Catalogue() {
  const location = useLocation();
  return <output data-testid="catalogue-location">{location.pathname}{location.search}</output>;
}

function openProgress(state?: unknown) {
  const router = createMemoryRouter([
    { path: '/curriculum/learner-module-progress', element: <LearnerModuleProgressPage /> },
    { path: '*', element: <Catalogue /> },
  ], {
    initialEntries: [CATALOGUE, { pathname: '/curriculum/learner-module-progress', search: '?moduleId=MOD-1&enrolmentId=91', state }],
    initialIndex: 1,
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('Back to Students', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchImpact.mockReturnValue(new Promise(() => {}));
  });

  it('returns one step to the catalogue with its filters, search and learner list as they were', async () => {
    const router = openProgress({ from: 'module-builder' });
    fireEvent.click(screen.getByRole('link', { name: 'Back to Students' }));
    await waitFor(() => expect(screen.getByTestId('catalogue-location')).toHaveTextContent(CATALOGUE));
    // A real step back, not a new page on top of the progress view.
    expect(router.state.historyAction).toBe('POP');
  });

  it('still lands on the module when the page was not opened from the learner list', async () => {
    openProgress();
    const back = screen.getByRole('link', { name: 'Back to Students' });
    expect(back).toHaveAttribute('href', '/curriculum/module-builder?module=MOD-1');
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByTestId('catalogue-location')).toHaveTextContent('/curriculum/module-builder?module=MOD-1'));
  });

  it('leaves a modified click to the browser, so a new tab opens the module link', () => {
    openProgress({ from: 'module-builder' });
    const back = screen.getByRole('link', { name: 'Back to Students' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    back.dispatchEvent(event);
    expect(screen.queryByTestId('catalogue-location')).not.toBeInTheDocument();
  });
});
