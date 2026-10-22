/** Phase 1 characterization only: mocked transport, no server or database. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiMe, isOwnLearnerRecord, type AuthUser } from '../auth';
import { postLoginRouteFor, workspacesFor } from '@/lib/routeAccess';
import { getRememberedLearner, rememberLearner, rememberSignedInLearner } from '@/hooks/useMyLearner';

const staff: AuthUser = {
  id: 17, subjectId: 83, subjectType: 'staff', role: 'staff',
  email: 'synthetic@example.test', displayName: null, hasPassword: true,
  lastLoginAt: null, permissions: [], access: 'coach', accesses: ['coach'],
  learnerRecordId: 271, learnerRecordKind: 'apprenticeship',
  accessWorkspaces: [
    { access: 'coach', home: '/workspace/coach', navRole: 'coach' },
    { access: 'learner', home: '/workspace/learner/apprenticeship/271', navRole: 'learner' },
  ],
};
const reply = (user: AuthUser) => new Response(JSON.stringify({ user }), { status: 200 });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected HTTP request'); }));
});
afterEach(() => {
  rememberSignedInLearner(undefined, undefined);
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('shares concurrent identity reads but rechecks grants on a later read', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = apiMe();
  const second = apiMe();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(reply(staff));
  expect(await Promise.all([first, second])).toEqual([staff, staff]);
  const changed = { ...staff, access: '', accesses: [], accessWorkspaces: [] };
  vi.mocked(fetch).mockResolvedValueOnce(reply(changed));
  expect(await apiMe()).toEqual(changed);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps the staff actor and linked enrolment separate through restoration and selection', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(reply(staff));
  const restored = (await apiMe())!;
  expect([restored.id, restored.subjectId, restored.learnerRecordId]).toEqual([17, 83, 271]);
  expect(postLoginRouteFor(restored)).toBe('/choose-workspace');
  expect(workspacesFor(restored)[1].home).toBe('/workspace/learner/apprenticeship/271');
  expect(isOwnLearnerRecord(restored, 'apprenticeship', '271')).toBe(true);
  for (const otherId of ['17', '83', '510']) {
    expect(isOwnLearnerRecord(restored, 'apprenticeship', otherId)).toBe(false);
  }
});

it('preserves nullable fields and omitted learner links without manufacturing a workspace', async () => {
  const { learnerRecordId: _id, learnerRecordKind: _kind, ...unlinked } = staff;
  const account = { ...unlinked, accessWorkspaces: [staff.accessWorkspaces![0]] };
  vi.mocked(fetch).mockResolvedValueOnce(reply(account));
  const restored = (await apiMe())!;
  expect(restored.displayName).toBeNull();
  expect(restored.lastLoginAt).toBeNull();
  expect(restored).not.toHaveProperty('learnerRecordId');
  expect(workspacesFor(restored)).toHaveLength(1);
  expect(isOwnLearnerRecord(restored, 'apprenticeship', '271')).toBe(false);
});

it('pins the enrolment ID despite a stale selection with a different profile ID', () => {
  rememberSignedInLearner('learner', 271, 'apprenticeship');
  rememberLearner('commercial', '510');
  expect(getRememberedLearner()).toEqual({ kind: 'apprenticeship', id: '271' });
  expect(fetch).not.toHaveBeenCalled();
});
