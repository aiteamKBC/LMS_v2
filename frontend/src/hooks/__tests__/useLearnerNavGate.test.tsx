/**
 * The learner sidebar must never show a menu the learner isn't entitled to,
 * not even for one frame.
 *
 * An onboarding learner who sees the full delivery nav paint and then collapse
 * to their two items is being shown a workspace they cannot use — every one of
 * those pages needs a running training plan.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fetchLearnerDetail = vi.fn();
vi.mock('@/api/learnerDetail', () => ({
  fetchLearnerDetail: (...args: unknown[]) => fetchLearnerDetail(...args),
}));

const getRememberedLearner = vi.fn();
vi.mock('../useMyLearner', () => ({
  getRememberedLearner: () => getRememberedLearner(),
}));

import { useLearnerNavGate, syncLearnerStatus } from '../useLearnerNavGate';
import type { SidebarNavItem } from '@/components/feature/Sidebar';

const FULL_NAV: SidebarNavItem[] = [
  { id: 'learner-overview', label: 'Overview', icon: 'ri-home-line', href: '/workspace/learner' },
  { id: 'learner-onboarding', label: 'My Enrolment', icon: 'ri-file-user-line', href: '/learner/onboarding' },
  { id: 'learner-compliance-documents', label: 'Compliance documents', icon: 'ri-file-line', href: '/learner/compliance-documents' },
  { id: 'learner-attendance', label: 'Attendance', icon: 'ri-calendar-line', href: '/learner/attendance' },
  {
    id: 'learner-group-monthly',
    label: 'My Progress',
    icon: 'ri-loop-left-line',
    href: '',
    children: [
      { id: 'learner-progress-reviews', label: 'Progress Review', icon: 'ri-file-chart-line', href: '/learner/progress-reviews' },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  // The module-level cache survives between tests in a file, so each test uses
  // its own learner id rather than trying to reach in and clear it.
  getRememberedLearner.mockReturnValue({ kind: 'commercial', id: '1' });
  fetchLearnerDetail.mockResolvedValue({ programmeStatus: 'Onboarding' });
});

describe('useLearnerNavGate', () => {
  it('shows no menu at all rather than the wrong one while the status loads', () => {
    getRememberedLearner.mockReturnValue({ kind: 'commercial', id: 'first-visit' });
    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    // Not the full nav — that is precisely the menu an onboarding learner would
    // then watch disappear.
    expect(result.current).toEqual([]);
  });

  it('keeps commercial learners out of the enrolment and compliance tabs', async () => {
    getRememberedLearner.mockReturnValue({ kind: 'commercial', id: 'onboarding-1' });
    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    await waitFor(() => expect(result.current.map((i) => i.id)).toEqual(['learner-overview']));
  });

  it('paints the trimmed menu on the first frame after a reload', async () => {
    getRememberedLearner.mockReturnValue({ kind: 'commercial', id: 'reloaded' });
    const first = renderHook(() => useLearnerNavGate('learner', FULL_NAV));
    await waitFor(() => expect(first.result.current).not.toEqual([]));
    first.unmount();

    // A reload empties the module cache; sessionStorage is what survives it.
    sessionStorage.setItem('learner_status:commercial:reloaded', 'Onboarding');
    sessionStorage.setItem('learner_kind:reloaded', 'commercial');
    fetchLearnerDetail.mockClear();

    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    // Synchronously correct — no full-nav frame, and no refetch.
    expect(result.current.map((i) => i.id)).toEqual(['learner-overview']);
    expect(fetchLearnerDetail).not.toHaveBeenCalled();
  });

  it('falls back to the full nav when the status cannot be fetched', async () => {
    getRememberedLearner.mockReturnValue({ kind: 'commercial', id: 'unreachable' });
    fetchLearnerDetail.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    await waitFor(() => expect(result.current).toEqual(
      FULL_NAV.filter((item) => !['learner-onboarding', 'learner-compliance-documents'].includes(item.id)),
    ));
    // A dropped request must not be remembered, or one flaky lookup pins the
    // full menu on an onboarding learner for the rest of the session.
    expect(sessionStorage.getItem('learner_status:commercial:unreachable')).toBeNull();
  });

  it('leaves other roles untouched and never looks a learner up for them', () => {
    const { result } = renderHook(() => useLearnerNavGate('coach', FULL_NAV));

    expect(result.current).toBe(FULL_NAV);
    expect(fetchLearnerDetail).not.toHaveBeenCalled();
  });

  it('gives a learner in delivery their reduced menu, not the full one', async () => {
    getRememberedLearner.mockReturnValue({ kind: 'apprenticeship', id: 'delivery-1' });
    fetchLearnerDetail.mockResolvedValue({ programmeStatus: 'Delivery' });
    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    await waitFor(() => expect(result.current.map((i) => i.id)).toEqual([
      'learner-overview',
      'learner-onboarding',
      'learner-compliance-documents',
    ]));
  });

  it('gives a learner being taught the full menu', async () => {
    getRememberedLearner.mockReturnValue({ kind: 'apprenticeship', id: 'active-1' });
    fetchLearnerDetail.mockResolvedValue({ programmeStatus: 'Active' });
    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    await waitFor(() => expect(result.current).toEqual(FULL_NAV));
  });

  it('leaves a learner whose enrolment has not started with only their overview', async () => {
    getRememberedLearner.mockReturnValue({ kind: 'apprenticeship', id: 'fresh-1' });
    fetchLearnerDetail.mockResolvedValue({ programmeStatus: 'Fresh user' });
    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    await waitFor(() => expect(result.current.map((i) => i.id)).toEqual(['learner-overview']));
  });

  it('restores the menu when a status change is synced mid-session', async () => {
    // The cache never expires, so without this a learner promoted off
    // 'Fresh user' would keep the one-item menu — and the waiting page — until
    // they opened a new browser session.
    getRememberedLearner.mockReturnValue({ kind: 'apprenticeship', id: 'promoted-1' });
    fetchLearnerDetail.mockResolvedValue({ programmeStatus: 'Fresh user' });
    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    await waitFor(() => expect(result.current.map((i) => i.id)).toEqual(['learner-overview']));

    act(() => syncLearnerStatus('apprenticeship', 'promoted-1', 'Active'));

    await waitFor(() => expect(result.current).toEqual(FULL_NAV));
  });

  it('does not strip the menu when the status lookup fails', async () => {
    // The catch path sets '' — which the backend treats as "Fresh user" for
    // display. If the gate did the same, one dropped request would tell a
    // learner mid-programme that their enrolment had not started. Locking
    // someone out of their own workspace is the worse error, so an unknown
    // status must keep the full menu.
    getRememberedLearner.mockReturnValue({ kind: 'apprenticeship', id: 'failed-lookup-1' });
    fetchLearnerDetail.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useLearnerNavGate('learner', FULL_NAV));

    await waitFor(() => expect(result.current).toEqual(FULL_NAV));
  });
});
