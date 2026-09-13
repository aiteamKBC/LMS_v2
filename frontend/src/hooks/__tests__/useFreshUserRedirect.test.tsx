/**
 * A fresh learner record reached by an EXPLICIT address must not lose its id.
 *
 * A staff member or administrator who is also a learner (see
 * login/learner_enrolment.py) opens their own record from the workspace
 * switcher at an explicit URL — /workspace/learner/commercial/513 — because
 * their signed-in SESSION says "staff", not "learner". The bare
 * /workspace/learner route resolves the learner from that session instead, so
 * redirecting a fresh record to the bare route stripped the id and landed the
 * person on a demo or remembered learner rather than the account they had just
 * opened.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { FRESH_ROUTE, useFreshUserRedirect } from '../useOnboardingRedirect';

function wrapperAt(path: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
}

describe('useFreshUserRedirect', () => {
  it('does not redirect away from the record it was opened at', () => {
    const { result } = renderHook(
      () => ({ fresh: useFreshUserRedirect('Fresh user'), location: useLocation() }),
      { wrapper: wrapperAt('/workspace/learner/commercial/513') },
    );

    expect(result.current.fresh).toBe(true);
    // Still on the explicit address -- not bounced to the bare route, which
    // would have resolved a different learner from the signed-in session.
    expect(result.current.location.pathname).toBe('/workspace/learner/commercial/513');
  });

  it('still redirects a bookmark to some OTHER page to the bare overview', () => {
    const { result } = renderHook(
      () => ({ fresh: useFreshUserRedirect('Fresh user'), location: useLocation() }),
      { wrapper: wrapperAt('/learner/training-plan') },
    );

    expect(result.current.fresh).toBe(true);
    expect(result.current.location.pathname).toBe(FRESH_ROUTE);
  });

  it('leaves an ordinary signed-in learner at the bare route untouched', () => {
    const { result } = renderHook(
      () => ({ fresh: useFreshUserRedirect('Fresh user'), location: useLocation() }),
      { wrapper: wrapperAt(FRESH_ROUTE) },
    );

    expect(result.current.fresh).toBe(true);
    expect(result.current.location.pathname).toBe(FRESH_ROUTE);
  });

  it('does nothing once the record has actually started', () => {
    const { result } = renderHook(
      () => ({ fresh: useFreshUserRedirect('Delivery'), location: useLocation() }),
      { wrapper: wrapperAt('/workspace/learner/commercial/513') },
    );

    expect(result.current.fresh).toBe(false);
    expect(result.current.location.pathname).toBe('/workspace/learner/commercial/513');
  });
});
