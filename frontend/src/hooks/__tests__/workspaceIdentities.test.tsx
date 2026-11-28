import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCoachIdentity } from '../useCoachIdentity';
import { useTutorIdentity } from '../useTutorIdentity';

const state = vi.hoisted(() => ({ primary: 'coach', grants: ['coach', 'tutor'] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: {
  account: { access: state.primary, accesses: state.grants,
    email: 'staff@example.test', displayName: 'Test Staff' },
}, isInitialized: true }) }));
vi.mock('@/hooks/useCoachViewAs', () => ({ useCoachViewAs: () => ({
  email: 'selected@example.test', name: 'Selected coach', adminEmail: 'staff@example.test',
}) }));
vi.mock('@/lib/tutorViewAs', () => ({ subscribeTutorViewAs: () => () => {},
  tutorViewAs: () => selection,
}));
const selection = { email: 'selected@example.test', name: 'Selected tutor', adminEmail: 'staff@example.test' };

describe('identity after switching granted workspaces', () => {
  beforeEach(() => { state.primary = 'coach'; state.grants = ['coach', 'tutor']; });

  it.each(['coach', 'tutor', 'record-monitor', 'enrolment'])('uses the signed-in identity with %s as primary', primary => {
    state.primary = primary;
    const { result } = renderHook(() => ({ coach: useCoachIdentity(), tutor: useTutorIdentity() }));
    expect(result.current.coach).toMatchObject({ email: 'staff@example.test', hasCoachAccess: true, canChooseCoach: false, isViewingAsCoach: false });
    expect(result.current.tutor).toMatchObject({ email: 'staff@example.test', ownsTutorWorkspace: true, canChooseTutor: false, isViewingAsTutor: false });
  });

  it('does not invent a coaching or tutoring identity without a grant', () => {
    state.primary = 'support'; state.grants = ['support', 'enrolment'];
    const { result } = renderHook(() => ({ coach: useCoachIdentity(), tutor: useTutorIdentity() }));
    expect(result.current.coach).toMatchObject({ email: '', hasCoachAccess: false });
    expect(result.current.tutor).toMatchObject({ email: '', ownsTutorWorkspace: false });
  });

  it('keeps Advanced Admin excluded despite additional grants', () => {
    state.primary = 'advanced-admin';
    const { result } = renderHook(() => ({ coach: useCoachIdentity(), tutor: useTutorIdentity() }));
    expect(result.current.coach).toMatchObject({ email: '', hasCoachAccess: false });
    expect(result.current.tutor).toMatchObject({ email: '', ownsTutorWorkspace: false });
  });

  it('preserves the Super Admin view-as selections', () => {
    state.primary = 'super-admin'; state.grants = ['super-admin'];
    const { result } = renderHook(() => ({ coach: useCoachIdentity(), tutor: useTutorIdentity() }));
    expect(result.current.coach).toMatchObject({ email: 'selected@example.test', canChooseCoach: true, isViewingAsCoach: true });
    expect(result.current.tutor).toMatchObject({ email: 'selected@example.test', canChooseTutor: true, isViewingAsTutor: true });
  });
});
