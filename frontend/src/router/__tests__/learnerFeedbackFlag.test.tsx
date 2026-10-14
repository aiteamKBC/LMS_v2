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
  const protectedLayout = routes.find(route => !route.path && route.children);
  const feedbackPaths = new Set([
    '/learner/feedback',
    '/learner/feedback/:formId',
    '/learner/feedback/delivery/:deliveryId',
  ]);
  return (protectedLayout?.children || []).filter(route => feedbackPaths.has(route.path || ''));
}

describe('learner feedback routes', () => {
  it('redirects every learner feedback deep link in production', async () => {
    const routes = await learnerFeedbackRoutes(false);
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      const element = route.element as ReactElement<{ to?: string; replace?: boolean }>;
      expect(element.props).toMatchObject({ to: '/workspace/learner', replace: true });
    }
  });

  it('renders learner feedback pages during local development', async () => {
    const routes = await learnerFeedbackRoutes(true);
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      const element = route.element as ReactElement<{ to?: string }>;
      expect(element.props.to).toBeUndefined();
    }
  });
});
