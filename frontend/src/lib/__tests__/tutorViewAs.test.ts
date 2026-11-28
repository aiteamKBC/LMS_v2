/**
 * The tutor selection store.
 *
 * Smaller than coachViewAs's suite because the module is smaller — there is no
 * request parameter to pin, since the tutor workspace has no API to scope. What
 * is left is the part that would go wrong on a shared machine: a selection
 * belongs to the admin who made it, and nobody else inherits it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN = 'admin@kbc.test';
const OTHER_ADMIN = 'other.admin@kbc.test';
const TUTOR = 'tutor-a@kbc.test';

async function loadModule() {
  vi.resetModules();
  return import('../tutorViewAs');
}

describe('tutorViewAs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with nothing selected', async () => {
    const { tutorViewAs } = await loadModule();
    expect(tutorViewAs()).toBeNull();
  });

  it('remembers the tutor and who chose them', async () => {
    const { setTutorViewAs, tutorViewAs } = await loadModule();
    setTutorViewAs({ email: 'Tutor-A@KBC.test', name: 'Tutor A' }, ADMIN);

    expect(tutorViewAs()).toEqual({ email: TUTOR, name: 'Tutor A', adminEmail: ADMIN });
  });

  it('keeps the name empty rather than filling it with the address', async () => {
    // The two are separate identity keys: the workspace endpoint matches a name
    // against tutor profiles and against the tutor named on each module, so an
    // address masquerading as a name would search for somebody who is not there.
    const { setTutorViewAs, tutorViewAs } = await loadModule();
    setTutorViewAs({ email: TUTOR }, ADMIN);
    expect(tutorViewAs()).toEqual({ email: TUTOR, name: '', adminEmail: ADMIN });
  });

  it('accepts a tutor who has a name but no address', async () => {
    // Somebody added under Curriculum -> Staff profiles and never given a login.
    const { setTutorViewAs, tutorViewAs } = await loadModule();
    setTutorViewAs({ name: 'Priya Nair' }, ADMIN);
    expect(tutorViewAs()).toEqual({ email: '', name: 'Priya Nair', adminEmail: ADMIN });
  });

  it('ignores a selection identifying nobody, or made by nobody', async () => {
    const { setTutorViewAs, tutorViewAs } = await loadModule();
    setTutorViewAs({ email: '', name: '' }, ADMIN);
    setTutorViewAs({ email: TUTOR }, '');
    expect(tutorViewAs()).toBeNull();
  });

  it('survives a reload', async () => {
    const first = await loadModule();
    first.setTutorViewAs({ email: TUTOR, name: 'Tutor A' }, ADMIN);

    const second = await loadModule();
    expect(second.tutorViewAs()?.email).toBe(TUTOR);
  });

  it('clears on the way back to the picker', async () => {
    const { setTutorViewAs, clearTutorViewAs, tutorViewAs } = await loadModule();
    setTutorViewAs({ email: TUTOR, name: 'Tutor A' }, ADMIN);
    clearTutorViewAs();
    expect(tutorViewAs()).toBeNull();
  });

  it('drops a selection when another admin signs in', async () => {
    const { setTutorViewAs, syncTutorViewAsAccount, tutorViewAs } = await loadModule();
    setTutorViewAs({ email: TUTOR, name: 'Tutor A' }, ADMIN);

    syncTutorViewAsAccount({ email: OTHER_ADMIN, access: 'super-admin' });
    expect(tutorViewAs()).toBeNull();
  });

  it('drops a selection when a tutor signs in on the same browser', async () => {
    const { setTutorViewAs, syncTutorViewAsAccount, tutorViewAs } = await loadModule();
    setTutorViewAs({ email: TUTOR, name: 'Tutor A' }, ADMIN);

    // Otherwise the tutor would open a colleague's workspace by inheritance.
    syncTutorViewAsAccount({ email: TUTOR, access: 'tutor' });
    expect(tutorViewAs()).toBeNull();
  });

  it('keeps the selection for the admin who made it', async () => {
    const { setTutorViewAs, syncTutorViewAsAccount, tutorViewAs } = await loadModule();
    setTutorViewAs({ email: TUTOR, name: 'Tutor A' }, ADMIN);

    syncTutorViewAsAccount({ email: ADMIN, access: 'super-admin' });
    expect(tutorViewAs()?.email).toBe(TUTOR);
  });

  it('notifies subscribers when the selection changes', async () => {
    const { setTutorViewAs, subscribeTutorViewAs } = await loadModule();
    const listener = vi.fn();
    const unsubscribe = subscribeTutorViewAs(listener);

    setTutorViewAs({ email: TUTOR, name: 'Tutor A' }, ADMIN);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same value again is not a change, so no re-render is triggered.
    setTutorViewAs({ email: TUTOR, name: 'Tutor A' }, ADMIN);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setTutorViewAs({ email: 'someone.else@kbc.test', name: 'Other' }, ADMIN);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
