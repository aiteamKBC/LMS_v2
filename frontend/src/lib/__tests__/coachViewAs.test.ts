import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN = 'admin@kbc.test';
const COACH = 'coach-a@kbc.test';

async function loadModule() {
  vi.resetModules();
  return import('../coachViewAs');
}

describe('coachViewAs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('leaves coach requests untouched when no coach is selected', async () => {
    const { withCoachViewAs } = await loadModule();

    expect(withCoachViewAs('/coach_api/coach/dashboard')).toBe('/coach_api/coach/dashboard');
  });

  it('adds the selected coach to coach-scoped URLs only', async () => {
    const { setCoachViewAs, withCoachViewAs } = await loadModule();
    setCoachViewAs({ email: COACH, name: 'Coach A' }, ADMIN);

    expect(withCoachViewAs('/coach_api/coach/dashboard'))
      .toBe(`/coach_api/coach/dashboard?viewAsCoach=${encodeURIComponent(COACH)}`);
    // Merged into an existing query rather than starting a second one.
    expect(withCoachViewAs('/coach_api/coach/caseload?summary=1'))
      .toBe(`/coach_api/coach/caseload?summary=1&viewAsCoach=${encodeURIComponent(COACH)}`);
    // Not coach-scoped: the caller's own CSRF token and the admin directory.
    expect(withCoachViewAs('/coach_api/csrf')).toBe('/coach_api/csrf');
    expect(withCoachViewAs('/coach_api/coaches')).toBe('/coach_api/coaches');
    expect(withCoachViewAs('/learner_api/learners/1/')).toBe('/learner_api/learners/1/');
  });

  it('does not add the parameter twice', async () => {
    const { setCoachViewAs, withCoachViewAs } = await loadModule();
    setCoachViewAs({ email: COACH, name: 'Coach A' }, ADMIN);

    const once = withCoachViewAs('/coach_api/coach/timetable');
    expect(withCoachViewAs(once)).toBe(once);
  });

  it('normalises the stored selection and survives a reload', async () => {
    const first = await loadModule();
    first.setCoachViewAs({ email: '  COACH-A@KBC.test ', name: '  Coach A  ' }, ' ADMIN@kbc.TEST ');

    const reloaded = await loadModule();
    expect(reloaded.coachViewAs()).toEqual({ email: COACH, name: 'Coach A', adminEmail: ADMIN });
  });

  it('clears a selection when the resolved account is not the admin who made it', async () => {
    const { setCoachViewAs, syncCoachViewAsAccount, coachViewAs } = await loadModule();
    setCoachViewAs({ email: COACH, name: 'Coach A' }, ADMIN);

    // The coach whose workspace it is: their own pages must not ask for a
    // named identity, which the server would refuse as a mismatch.
    syncCoachViewAsAccount({ email: COACH, access: 'coach' });
    expect(coachViewAs()).toBeNull();

    setCoachViewAs({ email: COACH, name: 'Coach A' }, ADMIN);
    // A different administrator on the same browser.
    syncCoachViewAsAccount({ email: 'other-admin@kbc.test', access: 'super-admin' });
    expect(coachViewAs()).toBeNull();

    setCoachViewAs({ email: COACH, name: 'Coach A' }, ADMIN);
    syncCoachViewAsAccount({ email: ADMIN, access: 'super-admin' });
    expect(coachViewAs()?.email).toBe(COACH);
  });

  it('notifies subscribers when the selection changes', async () => {
    const { setCoachViewAs, clearCoachViewAs, subscribeCoachViewAs } = await loadModule();
    const listener = vi.fn();
    const unsubscribe = subscribeCoachViewAs(listener);

    setCoachViewAs({ email: COACH, name: 'Coach A' }, ADMIN);
    // Selecting the same coach again is not a change.
    setCoachViewAs({ email: COACH, name: 'Coach A' }, ADMIN);
    clearCoachViewAs();
    unsubscribe();
    clearCoachViewAs();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
