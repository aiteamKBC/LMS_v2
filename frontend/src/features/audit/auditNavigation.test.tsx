import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useSearch, useParams } from '@tanstack/react-router';
import { AuditLink, navigateAudit } from './auditNavigation';

afterEach(cleanup);
function Activity() {
  const search = useSearch({ strict: false });
  const params = useParams({ strict: false });
  return <output data-testid="destination">{JSON.stringify({ search, params })}</output>;
}

it('preserves search values and route parameters through the embedded router', async () => {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () =>
    <AuditLink to="/activity" search={{ learner: 'Synthetic reader', plan: 'P-1' }}>Open reading log</AuditLink> });
  const activity = createRoute({ getParentRoute: () => root, path: '/activity', component: Activity,
    validateSearch: (search: Record<string, unknown>) => search });
  const learner = createRoute({ getParentRoute: () => root, path: '/learner/$learnerId', component: Activity });
  // @ts-expect-error TanStack requires strictNullChecks; the host application has it disabled.
  const router = createRouter({ routeTree: root.addChildren([home, activity, learner]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole('link', { name: 'Open reading log' }));
  expect(await screen.findByTestId('destination')).toHaveTextContent('Synthetic reader');
  expect(router.state.location.search).toEqual({ learner: 'Synthetic reader', plan: 'P-1' });
  await act(async () => navigateAudit(router, { to: '/learner/$learnerId', params: { learnerId: '42' } }));
  expect(router.state.location.pathname).toBe('/learner/42');
  expect(screen.getByTestId('destination')).toHaveTextContent('42');
});
