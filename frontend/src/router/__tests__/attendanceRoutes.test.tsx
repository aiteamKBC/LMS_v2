import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';
import { matchRoutes } from 'react-router-dom';
import routes from '../config';

describe('attendance deep links', () => {
  it.each(['commercial', 'apprenticeship'])('matches the attendance page for %s and preserves learner identity', (kind) => {
    const matches = matchRoutes<RouteObject>(routes, `/learner/attendance/${kind}/125`);
    expect(matches?.at(-1)?.route.path).toBe('/learner/attendance/:kind/:id');
    expect(matches?.at(-1)?.params).toMatchObject({ kind, id: '125' });
    const bare = matchRoutes<RouteObject>(routes, '/learner/attendance');
    expect(matches?.at(-1)?.route.element).toEqual(bare?.at(-1)?.route.element);
    expect(matches?.[0]?.route).toBe(bare?.[0]?.route);
    expect(matches?.[0]?.route.path).toBeUndefined();
    expect(matches?.[0]?.route.element).toBeDefined();
  });

  it('preserves the existing attendance entry point', () => {
    expect(matchRoutes<RouteObject>(routes, '/learner/attendance')?.at(-1)?.route.path).toBe('/learner/attendance');
  });
});
