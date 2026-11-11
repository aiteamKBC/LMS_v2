// Synthetic, fully intercepted data. Never connect the recorder to a real API.
const pathModule = require('node:path');
const learners = Array.from({ length: 6 }, (_, index) => ({
  id: String(index + 1), uuid: null, name: `Demo Learner ${index + 1}`, email: `learner${index + 1}@example.test`,
  source: 'apprenticeship', type: 'User', programme: 'Business Administration', cohort: 'Autumn intake', group: 'Group A',
  caseOwner: 'Demo Coach', reference: `DEMO-${index + 1}`, subscriptionStatus: 'FullUser', subscriptionVerified: true,
  programmeStatus: 'Onboarding', learningPlan: true, hasLearningPlan: true, hasSignedIn: true,
}));
const board = {
  user: { id: '1', name: 'Demo Learner 1', reference: 'DEMO-1', owner: 'Demo Coach', employer: 'Example Organisation' },
  contact: { email: 'learner1@example.test', phone: '07000 000000', dob: '01/01/2000', groupMembership: 'Group A', hasMandate: false, address: 'Example address' },
  activity: { aptemUsage: '00:00', daysTillNextReporting: 0, logins: 1, tasksAddedByUser: 0, uncompletedTasks: 0, adviceItemsAccessed: 0, actionPlans: 'No plans created' },
  programme: { type: 'Apprenticeship', name: 'Business Administration', cohort: 'Autumn intake', status: 'Onboarding', startDate: '01/11/2026', endDate: '01/11/2027', enrolledAt: '01/10/2026', enrolledBy: 'Demo Administrator', onboardingStatus: 'In progress' },
  subProgrammes: [], aims: [], previousProgrammes: [], functionalSkills: { english: { assessments: [], exempt: false, evidence: [] }, maths: { assessments: [], exempt: false, evidence: [] }, ict: { assessments: [], exempt: false, evidence: [] } },
  managedJobs: [], tracker: [], milestones: [], notes: [{ id: 'N1', text: 'Demonstration enrolment record', administrator: 'Demo Administrator', dateTime: '01/11/2026' }],
  courseProgress: [], contacts: [], activities: [{ id: 'A1', date: '01/11/2026', timeAndStatus: 'Completed', event: 'Enrolment record created' }],
  complianceDocuments: [], reviewDocuments: [], documents: [], competencies: [{ id: 'K1', name: 'Effective communication', version: 'Developing' }],
  subscription: { startDate: '01/11/2026', endDate: '01/11/2027', status: 'Active' }, auditTrail: [], trainingPlan: [],
};
const links = { first_session: 'https://example.test/first-session', support_session: 'https://example.test/support', coaching_session: '', progress_review: 'https://example.test/review', one_to_one: '' };
const coaches = [{ id: 1, version: 1, name: 'Demo Coach', slug: 'demo-coach', links }, { id: 2, version: 1, name: 'Example Coach', slug: 'example-coach', links: { ...links, coaching_session: 'https://example.test/coaching' } }];
const requests = learners.slice(0, 3).map((learner, index) => ({ requestId: `R00${index + 1}`, learnerId: learner.id, learnerKind: 'apprenticeship', learnerName: learner.name, programme: learner.programme, status: index === 2 ? 'approved' : 'pending', requestedAt: '2026-11-01T09:00:00Z', approvedAt: index === 2 ? '2026-11-02T12:00:00Z' : null, modules: [{ courseRef: `legacy:${index + 1}`, moduleId: 'M1', oldTitle: 'Workplace practice', newTitle: 'Applied workplace skills', percent: 40, hours: 2.5 }] }));
const course = { id: 'pl.999.study.M1', moduleId: 'M1', title: 'Professional Development', progressPercent: 25, trackableDone: 2, trackableTotal: 8, reviewCoach: 'Demo Coach' };

async function installMockApi(context, base, log) {
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (url.origin !== base) {
      if (url.href === 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/16480272afc94729b2911a62d1bbf85d.webp') {
        return route.fulfill({ path: pathModule.resolve(__dirname, '../../public/kbc-logo.png'), contentType: 'image/png' });
      }
      return route.abort();
    }
    if (!/^\/(?:[^/?]*_api|api|media)(?:\/|\?|$)/.test(path)) return route.continue();
    if (!['GET', 'HEAD'].includes(req.method())) {
      log.writes.push({ method: req.method(), path });
      // No writes are forwarded, including incidental activity logs and wizard saves.
      return route.fulfill({ json: { ok: true, answers: null, draft: null, meta: {} } });
    }
    const fulfill = json => route.fulfill({ json });
    if (path === '/login_api/me/') return fulfill({ user: { id: 999, email: 'admin@example.test', displayName: 'Demo Administrator', role: 'admin', access: 'super-admin', accessHome: '/workspace/admin', subjectType: 'staff', subjectId: 999, hasPassword: true, permissions: [] } });
    if (path === '/learner_api/enrolment-users/') return fulfill({ results: learners, count: learners.length });
    if (/^\/learner_api\/enrolment-users\/\d+\/$/.test(path)) return fulfill(board);
    if (path === '/learner_api/attendance-mode/') return fulfill({ available: true, modes: {} });
    if (path === '/login_api/admin/coach-directory/') return fulfill({ coaches });
    if (path === '/learner_api/progress-transfer/requests/') return fulfill({ requests, nextOffset: null, csrfToken: 'demo-csrf' });
    if (/\/progress-transfer\/requests\/R\d+\/$/.test(path)) return fulfill({ reviewToken: 'demo-review', csrfToken: 'demo-csrf', modules: [{ moduleId: 'M1', courseRef: 'legacy:1', title: 'Applied workplace skills', completedTargetIds: [], sources: [{ sourceActivityRef: 'material:1', title: 'Communication at work', week: 'Week 1', type: 'reading', automaticTargetId: 'C1' }], targets: [{ componentId: 'C1', title: 'Applied communication', week: 'Week 1', type: 'reading', plannedHours: 1 }] }] });
    if (path === '/learner_api/first-session-bookings/') return fulfill({ count: 3, results: learners.slice(0, 3).map((learner, index) => ({ id: index + 1, learnerId: Number(learner.id), source: learner.source, learnerName: learner.name, learnerEmail: learner.email, programme: learner.programme, caseOwner: { name: 'Demo Coach', email: 'coach@example.test' }, bookedAt: '2026-11-01T09:00:00Z', bookedDate: '2026-11-01', sessionDate: '2026-11-20', sessionTime: '10:00', durationMinutes: 30, meetingLink: 'https://example.test/meeting', state: ['scheduled', 'completed', 'cancelled'][index], status: '', syncState: 'synced' })) });
    if (path === '/learner_api/personal-learning/courses/') return fulfill({ courses: [course] });
    if (path.includes('/personal-learning/') && path.endsWith('/request/')) return fulfill({ subjectId: 'current:M1', detail: { id: course.id, components: [{ componentId: 'C1', component: 'Communication at work', type: 'reading', week: 'Week 1' }, { componentId: 'C2', component: 'Putting skills into practice', type: 'task', week: 'Week 2' }] }, metadata: {}, schedule: {}, sessions: [], activity: null });
    if (/\/enrolment_api\/(wizard-layout|eligibility-form-layout)\/$/.test(path)) return fulfill({ layout: null, version: null, updatedAt: '', updatedBy: '' });
    if (path.includes('/wizard-bootstrap/')) return fulfill({ board, ilr: { answers: null, draft: null, meta: {} }, ksbProfile: { standard: null, results: [] } });
    if (path.includes('/eligibility-evidence/')) return fulfill({ results: [], locked: false });
    if (path.includes('/extended-ilr/')) return fulfill({ answers: null, draft: null, meta: {} });
    if (path.includes('/reviews/') && path.endsWith('/onboarding/')) return fulfill({ programme: 'Business Administration', reviews: [], allIssued: false, allCompleted: false });
    if (path.includes('/ksb-profile/')) return fulfill({ standard: { id: 'P1', label: 'Business Administration' }, results: [{ id: 'K1', theme: 'Communication', kind: 'Knowledge', codes: ['K1'], title: 'Effective communication' }] });
    if (path.includes('/curriculum/programmes/')) return fulfill({ results: ['Business Administration'] });
    if (path.includes('/curriculum/cohorts/')) return fulfill({ results: ['Autumn intake'] });
    if (path.includes('/curriculum/groups/')) return fulfill({ results: ['Group A'] });
    if (path.includes('/curriculum/modules/')) return fulfill({ results: [{ id: 'M1', title: 'Applied workplace skills' }] });
    if (path.includes('/curriculum/weeks/')) return fulfill({ results: [{ id: 'W1', title: 'Getting started', weekNumber: 1 }] });
    if (path.includes('/curriculum/components/')) return fulfill({ results: [{ id: 'C1', title: 'Communication at work', type: 'reading', expectedOtjh: 1 }] });
    log.other.add(path);
    // Read-only demonstration responses; these requests never reach the backend.
    if (/\/documents\//.test(path)) return fulfill({ results: [], documents: [] });
    if (/agreement|ilr-document|training-plan-document/.test(path)) return fulfill(null);
    if (/inclusion/.test(path)) return fulfill({ answered: false, completed: false, available: true });
    return fulfill({ results: [], count: 0, slots: [], ok: true });
  });
}
module.exports = { installMockApi, board };
