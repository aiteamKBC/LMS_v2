import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';
import routes from '../config';

const routeObjects: RouteObject[] = routes;

function flatten(items: RouteObject[]): RouteObject[] {
  return items.flatMap(route => [route, ...flatten(route.children ?? [])]);
}

describe('merged Curriculum and shared routes', () => {
  it('keeps each absolute path once, including the learner component route', () => {
    const paths = flatten(routeObjects).flatMap(route => route.path?.startsWith('/') ? [route.path] : []);
    expect(paths.filter(path => path === '/learner/component/:kind/:id/:componentId')).toHaveLength(1);
    expect(paths).toHaveLength(new Set(paths).size);
  });

  it('keeps Curriculum authoring and the incoming coaching quality tools behind the auth layout', () => {
    const protectedLayout = routeObjects.find(route => !route.path && route.children);
    const protectedPaths = flatten(protectedLayout?.children ?? []).map(route => route.path);
    for (const path of [
      '/curriculum/free-courses', '/curriculum/library', '/curriculum/quality',
      '/curriculum/module-builder', '/curriculum/week-builder', '/curriculum/bulk-attendance',
      '/curriculum/coaching-recordings', '/curriculum/coaching-recordings/reviews', '/curriculum/quality/forms',
    ]) {
      expect(protectedPaths.filter(candidate => candidate === path), path).toHaveLength(1);
      expect(routeObjects.some(route => route.path === path), path).toBe(false);
    }
  });
});
