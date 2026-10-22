import type { MockApi } from './network';

export const learner = { id: 701, subjectId: 701, subjectType: 'learner', role: 'learner',
  hasPassword: true, lastLoginAt: null, permissions: [],
  email: 'synthetic-learner@example.invalid', displayName: 'Synthetic learner',
  learnerType: 'commercial', programme: 'Synthetic programme', hasLegacyRecord: false };
export const staff = { id: 801, subjectId: 801, subjectType: 'staff', role: 'staff',
  hasPassword: true, lastLoginAt: null, permissions: [],
  email: 'synthetic-staff@example.invalid', displayName: 'Synthetic staff', access: 'enrolment',
  accesses: ['enrolment', 'curriculum'], accessWorkspaces: [
    { access: 'enrolment', home: '/users' },
    { access: 'curriculum', home: '/curriculum' },
  ] };

export function session(api: MockApi, account: unknown = learner) {
  api.on('GET', '/login_api/me/', () => ({ body: { user: account } }));
  api.on('POST', '/login_api/logout/', () => ({ body: { ok: true } }));
}

export const firstLogin = {
  required: true, completedAt: null, signatoryName: 'Synthetic learner', hasSavedSignature: false,
  programmeStatus: 'Fresh user', csrfToken: 'synthetic-csrf', details: {
    title: 'Mr', dateOfBirth: '2000-05-17', phone: '07700900123', country: 'United Kingdom',
    postcode: 'CT11AA', addressLine1: '1 Synthetic Street', addressLine2: '', townCity: 'Canterbury', county: 'Kent',
  },
};

export const catalogue = {
  learner: { id: '701', kind: 'commercial', name: 'Synthetic learner', programme: 'Synthetic programme', cohort: '', group: '' },
  summary: { current: { subjects: 1, total: 2, completed: 1, percent: 50 },
    previous: { subjects: 0, total: 0, completed: 0, percent: 0 }, subjectCount: 1 },
  modules: [{ id: 'current:SYNTHETIC-M', title: 'Synthetic module', source: 'current', moduleId: 'SYNTHETIC-M',
    activityCount: 2, completedActivityCount: 1, progress: 50, status: 'In progress',
    nextTitle: 'Synthetic reading', finalTestPassed: false, actualHours: 1 }],
  otjh: { actual: 1, planned: 10 }, upcoming: [], hasMoreUpcoming: false,
};

export const editablePlan = {
  learner: { id: '701', name: 'Synthetic learner', programme: 'Synthetic programme',
    programmeId: 'SYNTHETIC-P', cohort: 'Synthetic cohort', group: 'Synthetic group' },
  plan: [], preset: [], available: [], saved: true, freeCourses: [], meetings: [],
  totals: { moduleCount: 0, moduleHours: 0, meetingCount: 0, meetingHours: 0, totalHours: 0 },
};
