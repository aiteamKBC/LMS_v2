import { describe, expect, it } from 'vitest';
import { matchRoutes, type RouteObject } from 'react-router-dom';
import routes from '../config';
import { roleNavMap } from '@/mocks/navigation';

describe('extra activity entry points', () => {
  it.each(['commercial', 'apprenticeship'])('reuses the existing learner form for %s without losing the old deep link', kind => {
    const direct = matchRoutes<RouteObject>(routes, '/learner/extra-activities');
    const existing = matchRoutes<RouteObject>(routes, `/learner/monthly-submission/${kind}/125/extra-activities`);
    expect(existing?.at(-1)?.params).toMatchObject({ kind, id: '125' });
    expect(direct?.at(-1)?.route.element).toEqual(existing?.at(-1)?.route.element);
    expect(direct?.[0]?.route).toBe(existing?.[0]?.route);
    expect(direct?.[0]?.route.path).toBeUndefined();
  });
  it('keeps the coach list and review under the authenticated layout', () => {
    const list = matchRoutes<RouteObject>(routes, '/coach/extra-activities');
    const review = matchRoutes<RouteObject>(routes, '/coach/extra-activities/submission-id');
    expect(review?.at(-1)?.params.submissionId).toBe('submission-id');
    expect(review?.at(-1)?.route.path).toBe('/coach/extra-activities/:submissionId');
    expect(list?.[0]?.route).toBe(review?.[0]?.route);
    expect(list?.[0]?.route.path).toBeUndefined();
    expect(list?.[0]?.route.element).toBeDefined();
  });
  it('adds visible entries while retaining Monthly Submission and Marking', () => {
    const learnerLinks = roleNavMap.learner.items.flatMap(item => [item, ...(item.children || [])]);
    expect(learnerLinks.find(item => item.label === 'Extra activities')?.href).toBe('/learner/extra-activities');
    expect(learnerLinks.some(item => item.href === '/learner/monthly-submission')).toBe(true);
    expect(roleNavMap.coach.items.find(item => item.label === 'Extra activities')?.href).toBe('/coach/extra-activities');
    expect(roleNavMap.coach.items.some(item => item.href === '/coach/marking-queue')).toBe(true);
  });
});
