import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, type RouteObject } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ role: 'learner' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  auth: { account: { role: session.role } }, isInitialized: true,
}) }));
vi.mock('../lazyRoute', () => ({ lazyRoute: () => () => <h1>Assigned feedback page</h1> }));

beforeEach(() => { session.role = 'learner'; });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function learnerFeedbackRoutes(enabled: boolean) {
  vi.stubEnv('DEV', enabled);
  const { default: routes } = await import('../config');
  const protectedLayout = routes.find(route => 'children' in route && !('path' in route && route.path));
  const feedbackPaths = new Set([
    '/learner/feedback',
    '/learner/feedback/:formId',
    '/learner/feedback/delivery/:deliveryId',
    '/learner/feedback/review/:reviewDeliveryId',
  ]);
  return (protectedLayout?.children || []).filter(route => 'path' in route && feedbackPaths.has(route.path || ''));
}

function openFeedbackRoute(route: RouteObject, query = '') {
  const pathname = (route.path || '').replace(/:\w+/g, '71');
  return render(<MemoryRouter initialEntries={[`${pathname}${query}`]}><Routes>
    <Route path={route.path} element={route.element} />
    <Route path="/workspace/learner" element={<h1>Learner home</h1>} />
  </Routes></MemoryRouter>);
}

describe('learner feedback routes', () => {
  it('releases the queue and owned delivery routes while keeping other feedback routes closed in production', async () => {
    const routes = await learnerFeedbackRoutes(false);
    expect(routes).toHaveLength(4);
    for (const route of routes) {
      const view = openFeedbackRoute(route);
      if (route.path === '/learner/feedback' || route.path === '/learner/feedback/delivery/:deliveryId') {
        expect(screen.getByRole('heading', { name: 'Assigned feedback page' })).toBeVisible();
      } else {
        expect(screen.getByRole('heading', { name: 'Learner home' })).toBeVisible();
      }
      view.unmount();
    }
  });

  it.each(['admin', 'staff'])('opens production review/general feedback for %s previewing a selected learner', async role => {
    session.role = role;
    const routes = await learnerFeedbackRoutes(false);
    for (const route of routes.filter(item => item.path?.endsWith('/:formId') || item.path?.endsWith('/:reviewDeliveryId'))) {
      const view = openFeedbackRoute(route, '?learnerId=125&kind=commercial&category=progress-review');
      expect(screen.getByRole('heading', { name: 'Assigned feedback page' })).toBeVisible();
      expect(screen.queryByRole('heading', { name: 'Learner home' })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it.each(['admin', 'staff', 'learner', 'employer'])('does not open unreleased feedback for %s without an authorized preview context', async role => {
    session.role = role;
    const routes = await learnerFeedbackRoutes(false);
    for (const route of routes.filter(item => item.path?.endsWith('/:formId') || item.path?.endsWith('/:reviewDeliveryId'))) {
      const view = openFeedbackRoute(route, role === 'learner' || role === 'employer' ? '?learnerId=125' : '');
      expect(screen.getByRole('heading', { name: 'Learner home' })).toBeVisible();
      view.unmount();
    }
  });

  it('keeps staff authoring and reporting routes available in production', async () => {
    vi.stubEnv('DEV', false);
    const { default: routes } = await import('../config');
    const protectedLayout = routes.find(route => 'children' in route && !('path' in route && route.path));
    const staffRoutes = (protectedLayout?.children || []).filter(route =>
      'path' in route && route.path?.startsWith('/engagement/reports/feedback'));
    expect(staffRoutes).toHaveLength(4);
    for (const route of staffRoutes) {
      expect((route.element as ReactElement<{ to?: string }>).props.to).toBeUndefined();
    }
  });

  it('renders learner feedback pages during local development', async () => {
    const routes = await learnerFeedbackRoutes(true);
    expect(routes).toHaveLength(4);
    for (const route of routes) {
      const element = route.element as ReactElement<{ to?: string }>;
      expect(element.props.to).toBeUndefined();
    }
  });
});
