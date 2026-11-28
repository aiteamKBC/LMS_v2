// Real local HTTP server + configured database. No mocked API responses.
// Requires the explicitly authorised test identities in .cache/learner-readiness.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 60000 });

const root = new URL('../../.cache/learner-readiness/', import.meta.url);
const credentialFile = new URL('live_credentials.json', root);
const credentials = JSON.parse(readFileSync(credentialFile, 'utf8'));
assert(!credentials.disabled, 'This QA run has been closed. Provision fresh authorised test identities before rerunning.');
const origin = 'http://127.0.0.1:3000';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [];
const failures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.status() >= 400 && response.url().includes('_api/')) failures.push({ status: response.status(), url: new URL(response.url()).pathname });
});
const save = () => writeFileSync(credentialFile, JSON.stringify(credentials, null, 2));
async function login(role) {
  await page.goto(`${origin}/login`);
  await page.locator('input[type=email]').fill(credentials[`${role}Email`]);
  await page.locator('input[type=password]').fill(credentials[`${role}Password`]);
  const response = page.waitForResponse(r => r.url().endsWith('/login_api/login/') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /sign in/i }).filter({ hasNotText: 'Microsoft' }).click();
  assert.equal((await response).status(), 200, 'Real sign-in succeeds');
  console.log(`PASS real ${role} sign-in`);
}
async function api(path, method = 'GET', data) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  if (path.startsWith('/coach_api/') && method !== 'GET') headers['X-CSRFToken'] = (await api('/coach_api/csrf')).csrfToken;
  const response = await context.request.fetch(`${origin}${path}`, { method, data, headers, timeout: 90000 });
  assert(response.headers()['content-type']?.includes('json'), `${method} ${path}: ${response.status()} returned non-JSON`);
  const body = await response.json();
  assert(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(body).slice(0, 800)}`);
  return body;
}

try {
  const phase = process.argv[2] || 'create';
  if (phase === 'create') {
    await login('admin');
    await page.goto(`${origin}/users`);
    if (!credentials.learnerId) {
      await page.getByRole('button', { name: 'Create user', exact: true }).click();
      await page.getByRole('button', { name: 'Create user', exact: true }).last().click();
      await page.getByLabel(/^First name/).fill('QA');
      await page.getByLabel(/^Surname/).fill(credentials.marker);
      await page.getByLabel(/^Email/).fill(credentials.learnerEmail);
      await page.locator('#cu-programme').selectOption('Marketing Executive Level 4');
      await page.locator('#cu-cohort').selectOption('October 2026');
      await page.locator('#cu-group').selectOption('G1');
      const response = page.waitForResponse(r => r.url().endsWith('/learner_api/enrolment-users/') && r.request().method() === 'POST');
      await page.getByRole('button', { name: /^Create$/ }).click();
      const createdResponse = await response;
      const created = await createdResponse.json();
      assert.equal(createdResponse.status(), 201, JSON.stringify(created));
      credentials.learnerId = created.id;
      credentials.learnerKind = created.source || 'commercial';
      save();
      assert.equal(created.invitation.accountCreated, true);
      assert.equal(created.invitation.emailSent, false);
      console.log('PASS learner created by UI, account provisioned, no external mail', created.id, credentials.learnerKind);
    }
    await page.getByPlaceholder('Search by name or email...').fill(credentials.marker);
    await page.getByRole('button', { name: /^Apply/ }).click();
    const row = page.getByRole('row').filter({ hasText: credentials.marker }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /(?:Add|Edit) learning plan/ }).click();
    await expect(page.getByText('Marketing Impact and Planning', { exact: true })).toBeVisible();
    const response = page.waitForResponse(r => r.url().includes(`/learning-plan/${credentials.learnerId}/`) && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save learning plan', exact: true }).click();
    assert.equal((await response).status(), 200);
    await expect(row.getByRole('button', { name: 'Edit learning plan', exact: true })).toBeVisible();
    const plan = await api(`/learner_api/learning-plan/${credentials.learnerId}/`);
    credentials.moduleIds = plan.plan.map(m => m.moduleId);
    save();
    assert(credentials.moduleIds.includes('MOD-20260912105734147219'));
    console.log('PASS plan assigned by UI and reloaded from database', plan.plan.length);
    const detail = await api(`/learner_api/learner-detail/${credentials.learnerKind}/${credentials.learnerId}/?content=summary`);
    writeFileSync(new URL('live_learner_detail.json', root), JSON.stringify(detail, null, 2));
    console.log('PASS live learner detail', { programme: detail.programme, status: detail.programmeStatus, components: detail.components.length, assignments: detail.components.filter(c => c.type === 'assignment').length });
  }
  if (phase === 'invite') {
    await login('admin');
    if (!credentials.invitationToken) {
    const invited = await api('/login_api/accounts/invite/', 'POST', { subjectType: 'learner', subjectId: Number(credentials.learnerId) });
    assert.equal(invited.emailSent, false, 'Console transport is explicit until a test recipient is provided');
    console.log('PASS invitation issued in real database; delivery intentionally disabled');
    const log = readFileSync(new URL('../../backend/.codex-live-server.log', import.meta.url), 'utf8');
    const links = [...log.matchAll(/http:\/\/127\.0\.0\.1:3000\/set-password\?token=([A-Za-z0-9_-]+)/g)];
    assert(links.length, 'Local debug invitation link available');
    credentials.invitationToken = links.at(-1)[1];
    save();
    }
    await api('/login_api/logout/', 'POST', {});
    await page.goto(`${origin}/set-password?token=${credentials.invitationToken}`);
    await page.locator('input[type=password]').first().fill(credentials.learnerPassword);
    await page.locator('input[type=password]').last().fill(credentials.learnerPassword);
    const response = page.waitForResponse(r => r.url().endsWith('/login_api/accept-invitation/') && r.request().method() === 'POST');
    await page.getByRole('button', { name: /Set password|Activate account/ }).click();
    assert.equal((await response).status(), 200);
    console.log('PASS learner sets password from actual single-use invitation through UI');
    await login('learner');
    const me = await api('/login_api/me/');
    assert.equal(String(me.user.subjectId), String(credentials.learnerId));
    credentials.passwordAccepted = true;
    save();
  }
  if (phase === 'learner-read') {
    await login('learner');
    const base = `${credentials.learnerKind}/${credentials.learnerId}`;
    const detail = await api(`/learner_api/learner-detail/${base}/?content=summary`);
    const cover = await api(`/learner_api/subject-covers/${credentials.learnerId}/`);
    const calendar = await api(`/learner_api/calendar/${base}/`);
    writeFileSync(new URL('live_calendar.json', root), JSON.stringify(calendar, null, 2));
    writeFileSync(new URL('live_covers.json', root), JSON.stringify(cover, null, 2));
    console.log('PASS learner-owned data', { components: detail.components.length, events: calendar.events?.length, activityDates: Object.keys(cover.activity_dates || {}).length, gate: detail.learningAccess });
    await page.goto(`${origin}/learner/modules/${base}?tab=assignments`);
    await expect(page.getByRole('button', { name: 'Assignments', exact: true })).toBeVisible();
    await expect(page.getByText('Awaiting brief', { exact: true }).first()).toBeVisible();
    const assignmentRows = await page.locator('tbody tr').count();
    console.log('PASS learner sees assigned tasks before submitting', assignmentRows);
    await page.reload();
    await expect(page).toHaveURL(/tab=assignments/);
    for (const path of ['progress-reviews', 'monthly-coaching', 'calendar', 'evidence', 'attendance', 'monthly-logs']) {
      await page.goto(`${origin}/learner/${path}`);
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      writeFileSync(new URL(`live_page_${path}.txt`, root), await page.locator('body').innerText());
      console.log('PASS learner page renders against live backend', path);
    }
  }
  if (phase === 'activate-test') {
    await login('admin');
    const fields = await api(`/learner_api/enrolment-users/${credentials.learnerId}/fields/`);
    assert.equal(fields.email, credentials.learnerEmail);
    assert(fields.username.includes(credentials.marker), 'Only the labelled QA learner can be activated');
    await api(`/learner_api/enrolment-users/${credentials.learnerId}/`, 'PATCH', { programmeStatus: 'Active' });
    await api(`/learner_api/learners/${credentials.learnerId}/coach/`, 'PATCH', { coachName: 'QA Learner Launch Administrator', coachEmail: credentials.adminEmail });
    const detail = await api(`/learner_api/learner-detail/${credentials.learnerKind}/${credentials.learnerId}/?content=summary`);
    writeFileSync(new URL('live_learner_detail.json', root), JSON.stringify(detail, null, 2));
    assert.equal(detail.programmeStatus, 'Active');
    console.log('PASS explicit staff activation and test coach assignment; this does not certify email-triggered activation');
    console.log('Active learner data', { ksbs: detail.ksbs.length, quizzes: detail.components.filter(c => c.isQuiz && c.quizMeta?.questions > 0).length });
  }
  if (phase === 'test-material') {
    await login('admin');
    if (!credentials.testModuleId) {
      const result = await api('/curriculum_api/curriculum/modules/', 'POST', {
        catalogueId: `QA-${credentials.marker}`, title: `QA ${credentials.marker} activities`,
        programmeName: 'Marketing Executive Level 4', startDate: '2026-09-10', endDate: '2026-11-30',
        status: 'draft', weekStructure: [{ title: 'QA Week 1', weekNumber: 1, components: [
          { title: 'QA Campaign reading', type: 'reading', expectedOtjh: 0.5, reflectionRequired: false,
            settings: { readingContent: '<p>Compare campaign results with agreed objectives. Record the starting measurements, review the audience response and explain one improvement supported by evidence.</p>' } },
          { title: 'QA Campaign assignment', type: 'assignment', expectedOtjh: 1, reflectionRequired: false,
            settings: { assignmentBrief: 'Evaluate a campaign against its objectives. Present evidence, explain what you learned, identify improvements and propose measurable next actions.' } },
        ] }],
      });
      credentials.testModuleId = result.moduleCatalogueId;
      credentials.testWeekId = result.module.weekStructure[0].id;
      save();
      console.log('PASS authored isolated real test module');
    }
    if (!credentials.testQuizId) {
      const quiz = await api('/quiz_api/quizzes/', 'POST', { title: `QA ${credentials.marker} quiz`, programme: 'Marketing Executive Level 4', module: `QA ${credentials.marker} activities`, status: 'published' });
      credentials.testQuizId = quiz.id;
      save();
      await api(`/quiz_api/quizzes/${quiz.id}/questions/`, 'POST', { questions: [{ text: 'Which result demonstrates campaign improvement?', questionType: 'single_choice', answers: [
        { text: 'Measured improvement against the objective', isCorrect: true }, { text: 'No measurement of the outcome', isCorrect: false },
      ] }] });
      await api(`/quiz_api/quizzes/${quiz.id}/course-links/`, 'PATCH', { moduleAssignments: [{ moduleCatalogueId: credentials.testModuleId, weekId: credentials.testWeekId }] });
      console.log('PASS published and assigned a real quiz with one authored question');
    }
    await api(`/learner_api/learning-plan/${credentials.learnerId}/`, 'PATCH', { modules: [...credentials.moduleIds, credentials.testModuleId].map(moduleId => ({ moduleId })) });
    const detail = await api(`/learner_api/learner-detail/${credentials.learnerKind}/${credentials.learnerId}/?content=summary`);
    credentials.testAssignmentId = detail.components.find(c => c.component.includes('QA Campaign assignment'))?.componentId;
    credentials.testReadingId = detail.components.find(c => c.component.includes('QA Campaign reading'))?.componentId;
    save();
    assert(credentials.testAssignmentId && credentials.testReadingId);
    assert(detail.components.some(c => c.quizMeta?.quizId === credentials.testQuizId));
    writeFileSync(new URL('live_learner_detail.json', root), JSON.stringify(detail, null, 2));
    console.log('PASS new reading, assignment and quiz propagate through saved learning plan');
  }
  if (phase === 'assignment') {
    await login('learner');
    const base = `${credentials.learnerKind}/${credentials.learnerId}`;
    assert(credentials.testAssignmentId);
    const query = new URLSearchParams({ learnerKind: credentials.learnerKind, learnerId: String(credentials.learnerId), activityType: 'assignment', activityId: credentials.testAssignmentId });
    const load = async () => (await api(`/learner_api/reflection/submissions/?${query}`)).submission;
    const sentence = 'In this QA campaign exercise I compared the agreed objectives with measured audience responses, checked the evidence and used the findings to propose a practical improvement for the next reporting period.';
    const answer = [
      'This is an explicitly labelled QA assignment for testing the learner submission workflow. I planned a small awareness campaign with an agreed audience, a defined budget and a measurable objective. Before launching the campaign, I recorded the baseline response rate and checked that the message addressed a specific audience need.',
      'I compared two sample messages using the same reporting period. I recorded engagement and conversion results in a campaign report, then compared those results with the original objective. I reviewed possible limitations in the sample and avoided claiming that a small improvement proved a permanent change.',
      'Based on the evidence, I proposed a clearer call to action, a focused audience segment and a scheduled review of results. I explained the decision to the project team and agreed the next measurement date. This exercise improved my ability to connect campaign planning, evidence and business outcomes.',
    ].join('\n');
    await page.goto(`${origin}/learner/modules/${base}?tab=assignments`);
    const row = page.getByRole('row').filter({ hasText: 'QA Campaign assignment' });
    await row.getByRole('link').click();
    const step = async number => { await page.getByRole('button', { name: new RegExp(`^${number} `) }).click(); };
    await step(1);
    await page.getByRole('textbox', { name: /Your answer/ }).fill(answer);
    for (const prefix of [/^I learned/, /^I understood/, /^I gained skills/]) await page.getByRole('textbox', { name: prefix }).fill(sentence);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect.poll(async () => (await load())?.assignmentAnswer).toBe(answer);
    await page.goto(`${origin}/learner/modules/${base}?tab=assignments`);
    await page.getByRole('row').filter({ hasText: 'QA Campaign assignment' }).getByRole('link', { name: 'Continue draft' }).click();
    await step(1);
    await expect(page.getByRole('textbox', { name: /Your answer/ })).toHaveValue(answer);
    console.log('PASS live assignment answer and draft survive leaving and reopening');
    await step(2);
    if (!(await load())?.monthlyAssignment?.evidence?.length) {
      await page.getByRole('textbox', { name: 'Evidence link name' }).fill('QA Campaign evidence');
      await page.getByRole('textbox', { name: 'Evidence URL' }).fill('https://example.com/qa-campaign-evidence');
      await page.getByRole('button', { name: 'Add link', exact: true }).click();
    }
    await step(3);
    await page.getByRole('textbox', { name: 'Hours spent', exact: true }).fill('1');
    const outside = page.getByRole('checkbox', { name: 'I confirm that I completed this activity outside UK working hours.' });
    if (await outside.isVisible()) await outside.check();
    if (!await page.getByRole('textbox', { name: 'How did you apply this KSB?' }).count()) {
      await page.getByRole('button', { name: 'Add programme KSBs', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Choose programme KSBs' });
      await picker.getByRole('textbox', { name: 'Search programme KSBs' }).fill('Marketing Concepts & Theories');
      await picker.getByRole('checkbox').first().check();
      await picker.getByRole('button', { name: 'Add selected KSBs', exact: true }).click();
    }
    await page.getByRole('textbox', { name: 'How did you apply this KSB?' }).first().fill(sentence);
    for (const name of ['QA Campaign evidence', 'I have reviewed the planned hours and KSBs against my actual learning.', 'This activity developed new knowledge.', 'This activity developed new skills or behaviours.', 'My employer accepts sharing this evidence, and it contains no confidential information.']) {
      await page.getByRole('checkbox', { name, exact: true }).check();
    }
    await step(4);
    for (const name of [/^Reflect on your LMS/, /^How does the learning fit together/]) await page.getByRole('textbox', { name }).fill(sentence);
    await step(5);
    for (const name of [/^Impact on your career/, /^Impact on your job/, /^Impact on employer/, /^Measurable business outcomes/]) await page.getByRole('textbox', { name }).fill(sentence);
    await page.getByRole('checkbox', { name: 'I can explain how my employer has benefited from this learning.' }).check();
    await step(6);
    for (const name of [/^Your action plan/, /^How has this prepared you/]) await page.getByRole('textbox', { name }).fill(sentence);
    await step(7);
    const checked = page.waitForResponse(r => r.url().endsWith('/reflection/assignment/check/'));
    await page.getByRole('button', { name: 'Run quality checks', exact: true }).click();
    const checks = await (await checked).json();
    assert(checks.checks.filter(c => !c.passed).every(c => ['meeting', 'presentation'].includes(c.key)), JSON.stringify(checks));
    console.log('PASS real evidence, KSB, hours and written-answer quality checks');
    await step(8);
    if (!(await load())?.monthlyAssignment?.meetingKey) {
      await page.getByLabel('Date', { exact: true }).fill('2026-09-21');
      await page.getByLabel('Time', { exact: true }).fill('10:00');
      const booked = page.waitForResponse(r => r.url().endsWith(`/calendar/${base}/book/`), { timeout: 90000 });
      await page.getByRole('button', { name: 'Book 60-minute MCM', exact: true }).click();
      const response = await booked;
      const result = await response.json();
      assert(response.ok(), JSON.stringify(result));
      credentials.meetingKey = result.event.eventKey;
      save();
      console.log('PASS real MCM booking persisted', { invitationSent: result.event.invited, warning: result.warning || null });
    }
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Generate full-month presentation', exact: true }).click();
    await page.getByRole('checkbox', { name: 'I have reviewed the slides and they accurately represent my own work.' }).check();
    const deck = page.waitForResponse(r => r.url().endsWith('/reflection/assignment/presentation/') && r.request().method() === 'POST');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PowerPoint (.pptx)', exact: true }).click();
    const exported = await deck;
    assert(exported.ok(), 'Actual PowerPoint export succeeds');
    const downloaded = await download;
    assert.equal(await downloaded.failure(), null);
    const file = readFileSync(await downloaded.path());
    assert.equal(file.subarray(0, 2).toString(), 'PK');
    writeFileSync(new URL('live_assignment.pptx', root), file);
    const verified = page.waitForResponse(r => r.url().endsWith('/reflection/assignment/check/'));
    await page.getByRole('button', { name: 'Recheck submission requirements', exact: true }).click();
    const verifiedResponse = await verified;
    const quality = await verifiedResponse.json();
    const exportPayload = exported.request().postDataJSON();
    const checkPayload = verifiedResponse.request().postDataJSON();
    console.log('Presentation consistency', {
      changedFields: Object.keys(exportPayload).filter(key => JSON.stringify(exportPayload[key]) !== JSON.stringify(checkPayload[key])),
      changedMonthlyFields: Object.keys(exportPayload.monthlyAssignment).filter(key => JSON.stringify(exportPayload.monthlyAssignment[key]) !== JSON.stringify(checkPayload.monthlyAssignment[key])),
      exportedToken: Boolean(exported.headers()['x-presentation-token']), checkedToken: Boolean(checkPayload.monthlyAssignment.presentationToken), reviewed: checkPayload.monthlyAssignment.presentationReviewed,
    });
    assert.equal(quality.checks.length, 13);
    assert(quality.checks.every(c => c.passed), JSON.stringify(quality));
    const completion = page.waitForResponse(r => r.url().includes(`/components/${credentials.testAssignmentId}/complete/`));
    await page.getByRole('button', { name: 'Submit assignment', exact: true }).click();
    const completed = await completion;
    assert(completed.ok(), JSON.stringify(await completed.json()));
    const saved = await load();
    assert.equal(saved.status, 'submitted_for_tutor_review');
    credentials.submissionId = saved.id;
    save();
    console.log('PASS 13 real checks, actual PPTX export and final database submission', saved.id);
    await page.goto(`${origin}/learner/modules/${base}?tab=assignments`);
    await page.getByRole('row').filter({ hasText: 'QA Campaign assignment' }).getByRole('link', { name: 'Open submission' }).click();
    await step(1);
    await expect(page.getByRole('textbox', { name: /Your answer/ })).toBeDisabled();
    console.log('PASS submitted assignment is visible and locked after reload');
  }
  if (phase === 'quiz-and-months') {
    await login('admin');
    const authored = await api(`/learner_api/learner-detail/${credentials.learnerKind}/${credentials.learnerId}/?content=summary`);
    const quizComponent = authored.components.find(c => c.quizMeta?.quizId === credentials.testQuizId);
    assert.equal(quizComponent.moduleId, credentials.testModuleId);
    if (quizComponent.componentId && quizComponent.reflectionRequired !== false) await api(`/curriculum_api/curriculum/components/${quizComponent.componentId}/`, 'PATCH', { reflectionRequired: false });
    else if (!quizComponent.componentId) {
      const structureUrl = `/curriculum_api/curriculum/modules/${credentials.testModuleId}/structure/`;
      const structure = await api(structureUrl);
      assert(structure.title.includes(credentials.marker));
      structure.weekStructure[0].components.push({ title: `QA ${credentials.marker} quiz`, type: 'quiz', reflectionRequired: false, settings: { linkedQuizId: credentials.testQuizId } });
      await api(structureUrl, 'PATCH', structure);
    }
    await api('/login_api/logout/', 'POST', {});
    await login('learner');
    const base = `${credentials.learnerKind}/${credentials.learnerId}`;
    await page.goto(`${origin}/learner/modules/${base}?subject=${encodeURIComponent('current:MOD-20260912105734147219')}`);
    for (const month of ['October 2026', 'November 2026', 'December 2026', 'June 2027']) await expect(page.getByText(month, { exact: true })).toBeVisible();
    console.log('PASS real assigned Marketing components visible across future months through June 2027');
    for (const passed of [false, true]) {
      await page.goto(`${origin}/learner/quiz/${base}/${credentials.testQuizId}?module=${encodeURIComponent(`QA ${credentials.marker} activities`)}&week=QA%20Week%201`);
      await page.getByRole('button', { name: 'Start Quiz', exact: true }).click();
      await page.getByRole('button', { name: passed ? /Measured improvement/ : /No measurement/ }).click();
      await page.getByRole('button', { name: 'Finish Quiz', exact: true }).click();
      await expect(page.getByRole('heading', { name: passed ? 'Quiz Passed!' : 'Quiz Not Passed', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back to Training Plan', exact: true }).click();
      console.log('PASS actual quiz attempt persisted', passed ? 'passed' : 'not passed');
    }
    await page.goto(`${origin}/learner/modules/${base}?tab=quizzes`);
    await expect(page.getByRole('row').filter({ hasText: `QA ${credentials.marker} quiz` })).toContainText('Completed');
    const detail = await api(`/learner_api/learner-detail/${base}/?content=summary`);
    const attempts = detail.quizAttempts.filter(a => String(a.quizId) === String(credentials.testQuizId));
    assert(attempts.some(a => a.passed === true) && attempts.some(a => a.passed === false));
    console.log('PASS quiz list reflects stored failed and passed attempts');
  }
  if (phase === 'coach-return' || phase === 'coach-accept') {
    await login('admin');
    await api(`/learner_api/learners/${credentials.learnerId}/coach/`, 'PATCH', { coachName: 'QA Learner Launch Coach', coachEmail: credentials.coachEmail });
    await api('/login_api/logout/', 'POST', {});
    await login('coach');
    const decision = phase === 'coach-return' ? 'referred' : 'accepted';
    const url = `/coach_api/coach/marking-queue/${credentials.submissionId}`;
    const before = await api(url);
    assert.equal(String(before.item.learnerId), String(credentials.learnerId));
    await api(url, 'PATCH', { decision, feedback: 'QA workflow review: explain the measured campaign improvement and its evidence.', reviewedBy: 'QA Learner Launch Administrator' });
    assert.equal((await api(url)).item.status, decision);
    await api('/login_api/logout/', 'POST', {});
    await login('learner');
    await page.goto(`${origin}/learner/modules/${credentials.learnerKind}/${credentials.learnerId}?tab=assignments`);
    const row = page.getByRole('row').filter({ hasText: 'QA Campaign assignment' });
    await row.getByRole('link', { name: decision === 'referred' ? 'Revise assignment' : 'Open submission', exact: true }).click();
    await page.getByRole('button', { name: /^1 / }).click();
    const answer = page.getByRole('textbox', { name: /Your answer/ });
    if (decision === 'referred') {
      await expect(answer).toBeEnabled();
      await answer.fill(`${await answer.inputValue()}\nFollowing the QA coach feedback, I included a measured improvement and an explicit link to the supporting report.`);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    } else await expect(answer).toBeDisabled();
    console.log('PASS actual coach decision reaches learner and updates edit access', decision);
  }
  if (phase === 'reading') {
    await login('learner');
    await page.goto(`${origin}/learner/component/${credentials.learnerKind}/${credentials.learnerId}/${credentials.testReadingId}`);
    await expect(page.getByText('Compare campaign results with agreed objectives.', { exact: false }).first()).toBeVisible();
    writeFileSync(new URL('live_reading_page.txt', root), await page.locator('body').innerText());
    console.log('PASS real reading content opens');
    await page.getByRole('textbox', { name: 'Minutes spent', exact: true }).fill('30');
    const outside = page.getByRole('checkbox', { name: 'I confirm that I completed this activity outside UK working hours.' });
    if (await outside.isVisible()) await outside.check();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('button', { name: /^Input / }).click();
    const completed = page.waitForResponse(r => r.url().includes(`/components/${credentials.testReadingId}/complete/`));
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    assert((await completed).ok());
    await page.reload();
    const detail = await api(`/learner_api/learner-detail/${credentials.learnerKind}/${credentials.learnerId}/?content=summary`);
    const progress = detail.componentProgress.filter(p => p.componentId === credentials.testReadingId);
    assert(progress.length > 0);
    assert(progress.some(p => Number(p.claimedSeconds) === 1800 || p.reportedTime === '30:00' || p.reportedTime === '0.5'));
    console.log('PASS actual reading completion and entered time survive reload');
  }
  if (phase === 'evidence') {
    await login('learner');
    const base = `${credentials.learnerKind}/${credentials.learnerId}`;
    await page.goto(`${origin}/learner/evidence`);
    const file = readFileSync(new URL('live_assignment.pptx', root));
    let saved = { id: credentials.evidenceId };
    if (!saved.id) {
    await page.getByRole('button', { name: 'Upload Evidence', exact: true }).click();
    await page.getByPlaceholder(/Customer segmentation analysis/).fill(`QA ${credentials.marker} presentation evidence`);
    await page.locator('input[type=file]').setInputFiles({ name: 'QA-campaign-presentation.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: file });
    const upload = page.waitForResponse(r => r.url().includes(`/evidence/${base}/upload/`));
    await page.getByRole('button', { name: 'Submit Evidence', exact: true }).click();
    const response = await upload;
    saved = await response.json();
    assert(response.ok(), JSON.stringify(saved));
    assert.equal(saved.status, 'approved');
    credentials.evidenceId = saved.id; save();
    }
    await page.reload();
    await page.getByRole('searchbox', { name: 'Search evidence' }).fill(credentials.marker);
    await expect(page.getByText(`QA ${credentials.marker} presentation evidence`, { exact: true }).first()).toBeVisible();
    const { url } = await api(`/learner_api/evidence/${base}/${saved.id}/download/`);
    const downloaded = await context.request.get(url);
    assert(downloaded.ok(), 'Actual cloud download succeeds');
    assert.deepEqual(await downloaded.body(), file);
    console.log('PASS actual evidence UI upload, persistent library item and identical cloud download');
  }
  if (phase === 'calendar') {
    await login('learner');
    const base = `${credentials.learnerKind}/${credentials.learnerId}`;
    for (const [path, region, count] of [['progress-reviews', 'Progress Review sessions', 4], ['monthly-coaching', 'Monthly Coaching Meetings', 12]]) {
      await page.goto(`${origin}/learner/${path}`);
      const sessions = page.getByRole('region', { name: region });
      await expect(sessions).toBeVisible();
      await expect(sessions.getByRole('link', { name: 'View', exact: true }).first()).toBeVisible();
      await sessions.getByRole('link', { name: 'View', exact: true }).first().click();
      await expect(page.getByRole('button', { name: /Back to (Progress Review|coaching meetings)/ })).toBeVisible();
      console.log('PASS real planned review detail opens', path);
    }
    await page.goto(`${origin}/learner/progress-reviews`);
    await page.getByRole('region', { name: 'Progress Review sessions' }).getByRole('link', { name: 'Schedule', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Schedule Progress Review', exact: true }).click();
    await page.locator('input[type=date]').fill('2026-11-30');
    await page.locator('input[type=time]').fill('10:00');
    await page.getByRole('button', { name: 'Book Session', exact: true }).first().click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Reschedule', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Reschedule', exact: true }).click();
    await page.locator('input[type=time]').fill('11:30');
    await page.getByRole('button', { name: 'Save New Time', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('11:30–12:30', { exact: true })).toBeVisible();
    const calendar = await api(`/learner_api/calendar/${base}/`);
    assert(calendar.events.some(e => e.scheduledDate === '2026-11-30' && e.scheduledTime?.startsWith('11:30')));
    await page.goto(`${origin}/learner/progress-reviews`);
    await expect(page.getByRole('region', { name: 'Progress Review sessions' })).toContainText('30 Nov 2026');
    console.log('PASS real progress-review booking, rescheduling and refreshed review list');
  }
  if (phase === 'final-check') {
    await login('admin');
    const edited = await api(`/curriculum_api/curriculum/components/${credentials.testReadingId}/`, 'PATCH', { reflectionRequired: false });
    assert.equal(edited.updated, true);
    console.log('PASS component edit after limiting the read to its own module');
    await api('/login_api/logout/', 'POST', {});
    await login('learner');
    const base = `${credentials.learnerKind}/${credentials.learnerId}`;
    const detail = await api(`/learner_api/learner-detail/${base}/?content=summary`);
    const metrics = await api(`/learner_api/metrics/${base}/`);
    writeFileSync(new URL('live_final_detail.json', root), JSON.stringify(detail, null, 2));
    writeFileSync(new URL('live_final_metrics.json', root), JSON.stringify(metrics, null, 2));
    assert.equal(String(detail.id), String(credentials.learnerId));
    assert(detail.componentProgress.some(p => p.componentId === credentials.testReadingId));
    assert(detail.quizAttempts.some(p => String(p.quizId) === String(credentials.testQuizId) && p.passed));
    for (const path of ['/learner_api/learner-detail/commercial/499/', '/learner_api/evidence/commercial/499/', '/learner_api/calendar/commercial/499/']) {
      const response = await context.request.get(`${origin}${path}`);
      assert([403, 404].includes(response.status()), `${path}: learner cannot read another enrolment`);
    }
    const epoch = await api('/curriculum_api/curriculum/cache-epoch/');
    assert.deepEqual(epoch.changes, []);
    console.log('PASS stored progress, learner ownership denials and permitted refresh counter');
  }
  if (phase === 'ksb') {
    await login('admin');
    await api(`/curriculum_api/curriculum/components/${credentials.testReadingId}/`, 'PATCH', { points: 1 });
    const url = `/curriculum_api/curriculum/components/${credentials.testReadingId}/ksb-mappings/`;
    const mappings = await api(url);
    if (!mappings.results.length) await api(url, 'POST', { code: 'K1.1', classification: 'main', weight_class: 'hard', weight: 1 });
    await api('/login_api/logout/', 'POST', {});
    await login('learner');
    const base = `${credentials.learnerKind}/${credentials.learnerId}`;
    const detail = await api(`/learner_api/learner-detail/${base}/?content=summary`);
    const reading = detail.components.find(c => c.componentId === credentials.testReadingId);
    assert(reading.ksbMappings.some(k => k.code === 'K1.1'));
    const metrics = await api(`/learner_api/metrics/${base}/`);
    writeFileSync(new URL('live_final_metrics.json', root), JSON.stringify(metrics, null, 2));
    assert(metrics.ksb.completed > 0, JSON.stringify(metrics.ksb));
    console.log('PASS authored KSB mapping reaches learner and completed reading updates KSB progress');
  }
  assert.deepEqual(errors, [], 'No UI runtime errors');
  console.log('Browser HTTP failures', JSON.stringify(failures));
} catch (error) {
  writeFileSync(new URL(`live_failure_${process.argv[2]}.txt`, root), await page.locator('body').innerText());
  writeFileSync(new URL('live_failure_page.txt', root), await page.locator('body').innerText());
  console.error('Browser failures:', JSON.stringify(failures));
  await page.screenshot({ path: new URL('live_failure.png', root).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  throw error;
} finally { await browser.close(); }
