import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('learner feedback routes', () => {
  it('opens the lecture queue and delivery, but redirects other feedback in production', async () => {
    const routes = await learnerFeedbackRoutes(false);
    expect(routes).toHaveLength(4);
    for (const route of routes) {
      const element = route.element as ReactElement<{ to?: string; replace?: boolean }>;
      if (route.path === '/learner/feedback' || route.path === '/learner/feedback/delivery/:deliveryId') {
        expect(element.props.to).toBeUndefined();
      } else {
        expect(element.props).toMatchObject({ to: '/workspace/learner', replace: true });
      }
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
