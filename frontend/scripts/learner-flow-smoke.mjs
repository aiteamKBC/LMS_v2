// Offline browser regression: every API is fulfilled in memory; unknown requests fail closed.
// Run against `vite preview --host 127.0.0.1 --port 4318` after building.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:4318';
const executablePath = process.env.LEARNER_SMOKE_BROWSER || [
  chromium.executablePath(),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
assert(executablePath, 'Install a Playwright browser or set LEARNER_SMOKE_BROWSER');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(20000);
const errors = [];
const unknown = new Set();
let role = 'admin';
let learner = null;
let submission = null;
let planSaved = false;
let failNextBooking = true;
let failNextCompletion = true;
const quizAttempts = [];
const componentProgress = [];
const writes = [];
const programme = 'Launch Test Programme';
const moduleTitle = 'Launch Test Module';
const component = (id, type, week, fields = {}) => ({ componentId: id, moduleId: 'M1', module: moduleTitle,
  weekId: `W${week}`, week: `Week ${week}`, component: id, type, expectedOtjh: 1, ksbMappings: [], ...fields });
const components = [
  component('Reading in October', 'reading', 1, { description: 'Read the project guidance.', contentHtml: '<p>Project guidance for this learner.</p>', hasReadingContent: true }),
  component('Assigned project', 'assignment', 5, { assignmentBrief: 'Describe your project results and explain the business impact.' }),
  component('Awaiting authored question', 'assignment', 8),
  component('Launch quiz', 'quiz', 9, { isQuiz: true, reflectionRequired: false, quizMeta: { quizId: 10, questions: 1, duration: 10, timeUnit: 'minutes' } }),
];
const assignedModule = { moduleId: 'M1', moduleTitle, programmeId: 'P1', programmeName: programme, groupName: 'Test Group', hours: 3, startDate: '2026-10-05', endDate: '2026-12-10' };
const detail = () => ({ id: '125', name: learner?.name || 'Launch Learner', email: 'launch@example.test', phone: '',
  learnerType: 'commercial', programme, programmeStatus: 'Active', cohort: 'October 2026', group: 'Test Group',
  employer: '', lineManager: '', isActive: true, modules: [moduleTitle], week: components.map(item => ({ module: item.module, moduleId: item.moduleId, week: item.week, weekId: item.weekId })), components, ksbs: [], quizAttempts,
  videoProgress: [], componentProgress, componentMarkingStatus: {}, activityFeed: [], totalExpectedOtjh: 3,
  studentActivityAvailable: false, learningAccess: { blocked: false, reasons: [], startDate: '2026-09-01', outstandingDocuments: [] } });
const session = (source, sequence) => ({ id: `${source}:125:${sequence}:2026-11-01`, eventKey: `${source}:125:${sequence}:2026-11-01`,
  title: 'Programme session', source, type: source === 'mcr' ? 'coaching' : 'review', sequence, status: 'not-scheduled',
  date: '2026-11-01', targetDate: '2026-11-01', scheduledDate: null, scheduledTime: null, durationMinutes: 60,
  coachName: 'Launch Coach', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '' });
const events = [session('progress-review', 1), session('progress-review', 2), session('mcr', 1)];
function payload(url, method, body) {
  const path = url.pathname;
  if (path === '/login_api/me/') return { user: { id: role === 'admin' ? 1 : 125, email: `${role}@example.test`, displayName: role === 'admin' ? 'Test Admin' : learner.name,
    role, subjectType: role === 'admin' ? 'staff' : 'learner', subjectId: role === 'admin' ? 1 : 125, learnerType: 'commercial',
    hasPassword: true, lastLoginAt: null, permissions: [] } };
  if (path === '/learner_api/enrolment-users/') {
    if (method === 'POST') {
      learner = { ...body, id: '125', name: body.username, uuid: null, source: body.learnerType, type: 'User',
        subscriptionStatus: 'FullUser', subscriptionVerified: true, programmeStatus: 'Delivery', learningPlan: true,
        invitation: { accountCreated: true, awaitingInvitation: true, invited: false, emailSent: false } };
      return learner;
    }
    return { count: learner ? 1 : 0, results: learner ? [learner] : [] };
  }
  if (path === '/learner_api/learning-plan/125/') {
    if (method === 'PATCH') { assert.deepEqual(body.modules, [{ moduleId: 'M1' }]); planSaved = true; learner.hasLearningPlan = true; }
    return { learner: { id: '125', name: learner.name, programme, programmeId: 'P1', cohort: learner.cohort, group: learner.group, programmeStatus: 'Delivery' },
      plan: [assignedModule], preset: [assignedModule], available: [], programmes: [{ programmeId: 'P1', programmeName: programme, moduleCount: 1 }], saved: planSaved, totals: { moduleCount: 1, totalHours: 3 } };
  }
  if (path.includes('/curriculum/programmes/')) return { results: [programme] };
  if (path.includes('/curriculum/cohorts/')) return { results: ['October 2026'] };
  if (path.includes('/curriculum/groups/')) return { results: ['Test Group'] };
  if (path.includes('/curriculum/cache-epoch/')) return { epoch: 0, changes: [] };
  if (/\/(staff-users|employers|organisations)\//.test(path)) return { results: [], count: 0 };
  if (/\/learner-(detail|summary)\//.test(path)) { assert(planSaved, 'Curriculum cannot appear before the staff plan save'); return detail(); }
  if (path.includes('/subject-covers/')) return { covers: {}, current_subjects: [{ id: 'M1', title: moduleTitle }], builder_subjects: {}, modules: {},
    activity_dates: Object.fromEntries(components.map((item, i) => [item.componentId, { date: ['2026-10-08', '2026-11-05', '2026-12-03'][i], month: ['2026-10', '2026-11', '2026-12'][i], date_source: 'module-schedule' }])) };
  if (path.includes('/overview-week/')) return { weekStart: '2026-09-07', weekEnd: '2026-09-13', timezone: 'Europe/London', planSubjects: [], modules: [], deadlines: [], undatedActivities: 0, expectedHours: null, missingExpectedHours: 0, otjh: { actual: 0, historical: 0, new: 0, undatedHistoricalRows: 0 } };
  if (path.includes('/training-plan-dashboard/')) return { months: {}, actual: [], actualAvailable: false,
    modules: [{ id: 'M1', title: moduleTitle, start_date: '2026-10-05', end_date: '2026-12-10', programme_name: programme, cohort_name: 'October 2026', group_name: 'Test Group', description: '', tutor_name: '', coach_name: 'Launch Coach' }],
    moduleLinks: {}, sessions: [], reviews: [], coach: { name: 'Launch Coach', bookingUrl: null }, contractStatus: 'not-available', generatedAt: '' };
  if (path.includes('/reflection/submissions/')) {
    if (method === 'POST') { submission = { ...body, id: 'draft-1', status: 'draft', locked: false, submittedAt: null }; return { id: submission.id, status: submission.status }; }
    return { statuses: submission ? [{ activityType: submission.activityType, activityId: submission.activityId, status: submission.status }] : [], assignments: [],
      submission: submission?.activityId === url.searchParams.get('activityId') ? submission : null };
  }
  // Quality-service contract only; real validation rules are exercised by the backend suite.
  if (path === '/learner_api/reflection/assignment/check/') {
    assert.equal(body.learnerId, '125'); assert.equal(body.activityId, 'Assigned project');
    return { checks: Array.from({ length: 13 }, (_, i) => ({ key: `check-${i}`, label: `Requirement ${i + 1}`, passed: true })) };
  }
  if (path === '/learner_api/components/Assigned%20project/complete/') {
    assert.equal(url.searchParams.get('learnerId'), '125'); assert.equal(url.searchParams.get('kind'), 'commercial');
    assert.equal(body.timeTakenSeconds, 3600); assert.equal(body.timeEntrySource, 'input');
    assert.equal(body.trackingToken, 'offline-token'); assert.equal(submission?.activityId, 'Assigned project');
    submission = { ...submission, status: 'submitted_for_tutor_review', locked: true, submittedAt: new Date().toISOString() };
    const record = { ...body, kind: 'component', componentId: 'Assigned project', attempt: 1, timeTaken: '01:00:00', submittedAt: submission.submittedAt, verifiedSeconds: 3600 };
    componentProgress.push(record);
    return { record, componentTitle: 'Assigned project', componentType: 'assignment', module: moduleTitle, week: 'Week 5' };
  }
  if (path === '/learner_api/quizzes/10/') return { id: 10, title: 'Launch quiz', module: moduleTitle, programme, weekId: 'W9', duration: 10, timeUnit: 'minutes', passingGrade: 80, randomizeQuestions: false, randomizeAnswers: false,
    questions: [{ id: 1, text: 'Which is the correct project outcome?', type: 'single_choice', points: 1, sortOrder: 0, explanation: null, answers: [{ id: 1, text: 'Measured improvement' }, { id: 2, text: 'No measurement' }] }] };
  if (path === '/learner_api/quizzes/10/submit/') {
    assert.equal(url.searchParams.get('learnerId'), '125');
    const passed = body.answers['1'] === 1;
    const attempt = { kind: 'quiz', quizId: 10, attempt: quizAttempts.length + 1, passed, grade: passed ? 1 : 0, achievedScore: passed ? 1 : 0, totalScore: 1, questions: [], submittedAt: new Date().toISOString(), startedAt: body.startedAt, timeTaken: '00:01', verifiedSeconds: 1 };
    quizAttempts.push(attempt);
    return { attempt, breakdown: [], earned: passed ? 1 : 0, possible: 1, grade: attempt.grade, achievedScore: attempt.achievedScore, totalScore: 1, passed, timeTaken: '00:01', quizName: 'Launch quiz' };
  }
  if (path.includes('/review-history/')) return { learnerId: 125, category: 'progress-review', reviews: [] };
  if (path.includes('/calendar-connections/')) return { connections: [], busy: [], errors: [], connectedProviders: [] };
  if (/\/calendar\/commercial\/125\/(book|reschedule)\/$/.test(path)) {
    const event = events.find(event => event.eventKey === body.eventKey);
    assert(event, 'The selected programme slot must be preserved');
    Object.assign(event, { status: 'scheduled', date: body.scheduledDate, scheduledDate: body.scheduledDate, scheduledTime: body.scheduledTime, durationMinutes: body.durationMinutes, invited: true, meetingLink: 'https://teams.example.test/offline-meeting' });
    return { event };
  }
  if (path.includes('/coach/')) return { coachName: 'Launch Coach', coachEmail: 'coach@example.test' };
  if (path.includes('/calendar/')) return { learner: { kind: 'commercial', id: 125 }, events };
  if (path.includes('/evidence/')) return { results: [] };
  if (path === '/learner_api/time-tracking/start/') return { trackingToken: 'offline-token', startedAt: new Date().toISOString(), sessionId: 'offline-session', countingMode: body.countingMode };
  if (path.includes('/metrics/')) { const completed = quizAttempts.some(attempt => attempt.passed) ? 1 : 0; return { migrated: false, programme: { completed, total: components.length, percent: completed / components.length * 100, status: 'ready' }, ksb: { completed: 0, total: 0, percent: null, status: 'empty', codes: [] }, otjh: { historical: 0, new: 0, actual: 0, planned: 3 } }; }
  throw new Error(`${method} ${path}`);
}
await context.route('**/*', async route => {
  const req = route.request(); const url = new URL(req.url());
  if (url.origin !== origin) return route.abort();
  if (!['fetch', 'xhr'].includes(req.resourceType()) && req.method() === 'GET' && !url.pathname.includes('_api/')) return route.continue();
  if (url.pathname.includes('/profile-photo/')) return route.fulfill({ status: 204 });
  if (url.pathname.endsWith('/book/') && req.method() === 'POST' && failNextBooking) {
    failNextBooking = false;
    return route.fulfill({ status: 503, json: { error: 'Booking temporarily unavailable. Please try again.' } });
  }
  if (url.pathname.endsWith('/Assigned%20project/complete/') && req.method() === 'POST' && failNextCompletion) {
    failNextCompletion = false;
    return route.fulfill({ status: 503, json: { error: 'Submission temporarily unavailable. Please try again.' } });
  }
  try {
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const data = payload(url, req.method(), body);
    if (req.method() !== 'GET') writes.push({ method: req.method(), path: url.pathname, body });
    return route.fulfill({ json: data });
  } catch (error) { unknown.add(error.message); return route.fulfill({ status: 501, json: { error: 'Unmodelled offline request' } }); }
});
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
try {
  await page.goto(`${origin}/users`);
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create user', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Create user', exact: true }).last().click();
  await page.getByLabel(/^First name/).fill('Launch');
  await page.getByLabel(/^Surname/).fill('Learner');
  await page.getByLabel(/^Email/).fill('launch@example.test');
  await page.locator('#cu-programme').selectOption(programme);
  await page.locator('#cu-cohort').selectOption('October 2026');
  await page.locator('#cu-group').selectOption('Test Group');
  await page.getByRole('button', { name: /^Create$/ }).click();
  await expect(page.getByRole('cell', { name: 'LL Launch Learner', exact: true })).toBeVisible();
  assert.equal(learner.programme, programme);
  console.log('PASS create learner with programme/cohort/group and refresh directory');
  await page.getByRole('button', { name: 'Add learning plan', exact: true }).click();
  await expect(page.getByText(moduleTitle, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save learning plan', exact: true }).click();
  await expect.poll(() => planSaved).toBe(true);
  await expect(page.getByRole('button', { name: 'Edit learning plan', exact: true })).toBeVisible();
  console.log('PASS staff saves the assigned module and the directory reflects the saved plan');

  role = 'learner';
  await page.goto(`${origin}/learner/modules/commercial/125`);
  await page.getByRole('button', { name: 'Assignments', exact: true }).click();
  await expect(page).toHaveURL(/tab=assignments/);
  await page.reload();
  await expect(page.getByText('Assigned project', { exact: true })).toBeVisible();
  await expect(page.getByText('Awaiting brief', { exact: true })).toBeVisible();
  await page.goto(`${origin}/learner/monthly-submission/commercial/125/${encodeURIComponent('Awaiting authored question')}`);
  await expect(page.getByText("This component can't be completed here yet.", { exact: true })).toBeVisible();
  assert.equal(submission, null, 'A direct URL must not start an empty assignment');
  await page.goto(`${origin}/learner/modules/commercial/125?tab=assignments`);
  await page.getByRole('link', { name: 'Start assignment' }).click();
  await expect(page.getByText('Describe your project results and explain the business impact.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: /Your answer/ }).fill('My saved project answer belongs to this learner and this assignment.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => submission?.assignmentAnswer).toContain('My saved project answer');
  await page.goto(`${origin}/learner/modules/commercial/125?tab=assignments`);
  await page.getByRole('link', { name: 'Continue draft' }).click();
  await expect(page.getByRole('textbox', { name: /Your answer/ })).toHaveValue('My saved project answer belongs to this learner and this assignment.');
  console.log('PASS assigned work, missing brief, start, save, list status and reopen draft');
  await page.getByRole('button', { name: /3 KSBs & hours claimed/ }).click();
  await page.getByRole('textbox', { name: 'Hours spent', exact: true }).fill('1');
  const outsideHours = page.getByRole('checkbox', { name: 'I confirm that I completed this activity outside UK working hours.' });
  if (await outsideHours.isVisible()) await outsideHours.check();
  await page.getByRole('button', { name: /8 Coaching & presentation/ }).click();
  await expect(page.getByRole('button', { name: 'Submit assignment', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Recheck submission requirements', exact: true }).click();
  await page.getByRole('button', { name: 'Submit assignment', exact: true }).click();
  await expect(page.getByText('Submission temporarily unavailable. Please try again.', { exact: true })).toBeVisible();
  assert.equal(submission.status, 'draft'); assert.equal(componentProgress.length, 0);
  await page.getByRole('button', { name: 'Submit assignment', exact: true }).click();
  await expect(page.getByText('Submission preview', { exact: true })).toBeVisible();
  assert.equal(componentProgress.length, 1);
  assert.equal(submission.status, 'submitted_for_tutor_review');
  await page.goto(`${origin}/learner/modules/commercial/125?tab=assignments`);
  await page.getByRole('link', { name: 'Open submission' }).click();
  await page.getByRole('button', { name: /1 Assignment answer/ }).click();
  await expect(page.getByRole('textbox', { name: /Your answer/ })).toBeDisabled();
  console.log('PASS final assignment submission failure/retry, one completion, preview and locked list status');
  submission = { ...submission, status: 'referred', locked: false, coachFeedback: 'Explain the measured outcome.' };
  await page.goto(`${origin}/learner/modules/commercial/125?tab=assignments`);
  await page.getByRole('link', { name: 'Revise assignment' }).click();
  await page.getByRole('button', { name: /1 Assignment answer/ }).click();
  await page.getByRole('textbox', { name: /Your answer/ }).fill('Revised project answer with the measured outcome.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => submission?.assignmentAnswer).toBe('Revised project answer with the measured outcome.');
  console.log('PASS submitted work is locked; returned work can be revised and saved');
  const savedProject = components.find(item => item.componentId === 'Assigned project');
  const originalBrief = savedProject.assignmentBrief;
  savedProject.assignmentBrief = '';
  await page.goto(`${origin}/learner/modules/commercial/125?tab=assignments`);
  await expect(page.getByText('The assignment brief is currently unavailable. You can still open your saved work.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Continue draft', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Your answer/ })).toHaveValue('Revised project answer with the measured outcome.');
  savedProject.assignmentBrief = originalBrief;
  console.log('PASS saved assignment work stays accessible after the tutor removes its brief');

  await page.goto(`${origin}/learner/modules/commercial/125?subject=current%3AM1`);
  for (const month of ['October 2026', 'November 2026', 'December 2026']) await expect(page.getByText(month, { exact: true })).toBeVisible();
  console.log('PASS components remain visible in three future months');
  for (const passed of [false, true]) {
    await page.goto(`${origin}/learner/quiz/commercial/125/10?module=${encodeURIComponent(moduleTitle)}&week=Week%209`);
    await page.getByRole('button', { name: 'Start Quiz', exact: true }).click();
    await page.getByRole('button', { name: passed ? /Measured improvement/ : /No measurement/ }).click();
    await page.getByRole('button', { name: 'Finish Quiz', exact: true }).click();
    await expect(page.getByRole('heading', { name: passed ? 'Quiz Passed!' : 'Quiz Not Passed', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Training Plan', exact: true }).click();
  }
  await page.goto(`${origin}/learner/modules/commercial/125?tab=quizzes`);
  await expect(page.getByRole('cell', { name: 'Completed', exact: true })).toBeVisible();
  console.log('PASS quiz failed attempt, retry, passed attempt and refreshed list status');
  for (const [path, region, count] of [['progress-reviews', 'Progress Review sessions', 2], ['monthly-coaching', 'Monthly Coaching Meetings', 1]]) {
    await page.goto(`${origin}/learner/${path}`);
    const sessions = page.getByRole('region', { name: region });
    await expect(sessions).toBeVisible();
    await expect(sessions.getByRole('link', { name: 'View', exact: true })).toHaveCount(count);
    await sessions.getByRole('link', { name: 'View', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /Back to (Progress Review|coaching meetings)/ })).toBeVisible();
    await expect(page.getByText('Launch Coach', { exact: true }).first()).toBeVisible();
    console.log(`PASS ${path}: assigned sessions and detail navigation`);
  }
  const review = events[0];
  await page.goto(`${origin}/learner/calendar?event=${encodeURIComponent(review.eventKey)}&action=schedule`);
  await expect(page.getByRole('heading', { name: 'Schedule Progress Review', exact: true })).toBeVisible();
  await page.locator('input[type=date]').fill('2026-11-02');
  await page.locator('input[type=time]').fill('10:00');
  await page.getByRole('button', { name: 'Book Session', exact: true }).first().click();
  await expect(page.getByText('Booking temporarily unavailable. Please try again.', { exact: true })).toBeVisible();
  assert.equal(review.status, 'not-scheduled');
  await page.getByRole('button', { name: 'Book Session', exact: true }).first().click();
  const booked = page.getByRole('dialog');
  await expect(booked.getByText('10:00–11:00', { exact: true })).toBeVisible();
  await booked.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await page.locator('input[type=time]').fill('11:30');
  await page.getByRole('button', { name: 'Save New Time', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('11:30–12:30', { exact: true })).toBeVisible();
  await page.goto(`${origin}/learner/progress-reviews`);
  await expect(page.getByRole('region', { name: 'Progress Review sessions' }).getByRole('table')).toContainText('02 Nov 2026');
  console.log('PASS booking failure, retry, reschedule and refreshed progress-review date');
  await page.goto(`${origin}/learner/calendar?event=${encodeURIComponent(review.eventKey)}`);
  await expect(page.getByRole('dialog').getByText('11:30–12:30', { exact: true })).toBeVisible();
  review.scheduledTime = '14:30';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog').getByText('14:30–15:30', { exact: true })).toBeVisible();
  console.log('PASS an open calendar appointment follows a later coach change');
  await page.goto(`${origin}/learner/modules/commercial/125?tab=assignments`);
  await expect(page.getByText('Assigned project', { exact: true })).toBeVisible();
  components.splice(components.findIndex(item => item.componentId === 'Assigned project'), 1);
  components.push(component('New assigned task', 'assignment', 10, { assignmentBrief: 'Explain the next project milestone.' }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('New assigned task', { exact: true })).toBeVisible();
  await expect(page.getByText('Assigned project', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Start assignment', exact: true }).click();
  await expect(page.getByText('Explain the next project milestone.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Your answer/ })).toHaveValue('');
  console.log('PASS removed work disappears and newly assigned work opens after focus refresh');
  assert.deepEqual([...unknown], [], 'Every API call must have an explicit fixture');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert(writes.every(write => ['/learner_api/enrolment-users/', '/learner_api/learning-plan/125/', '/learner_api/reflection/submissions/', '/learner_api/reflection/assignment/check/', '/learner_api/components/Assigned%20project/complete/', '/learner_api/time-tracking/start/', '/learner_api/quizzes/10/submit/', '/learner_api/calendar/commercial/125/book/', '/learner_api/calendar/commercial/125/reschedule/'].includes(write.path)));
  assert(writes.filter(write => write.path === '/learner_api/reflection/submissions/').every(write => write.body.learnerId === '125' && write.body.activityId === 'Assigned project'));
  console.log(`PASS isolated browser flow (${writes.length} in-memory writes; zero live writes)`);
} catch (error) {
  console.error('Unknown requests:', [...unknown]);
  console.error('Runtime errors:', errors);
  console.error('Visible page:', (await page.locator('body').innerText()).slice(0, 12000));
  throw error;
} finally { await browser.close(); }
