// Isolated UI check: all APIs are fixtures and external requests are blocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.MONTHLY_SUBMISSION_PREVIEW_URL || 'http://127.0.0.1:3000';
const out = resolve('test-results/monthly-submission');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const account = { id: 990072, subjectId: 990072, role: 'learner', subjectType: 'learner', displayName: 'Alex Morgan',
  email: 'alex@example.test', learnerType: 'apprenticeship', hasPassword: true, permissions: [], hasLegacyRecord: false };
const assignment = (id, title, week, question) => ({ componentId: id, component: title, type: 'assignment',
  moduleId: 'M1', module: 'Martech', week, expectedOtjh: 7, assignmentBrief: question,
  ksbMappings: [{ code: 'K1', description: 'Interpret data and insight', weight: 1 }, { code: 'S3', description: 'Apply analytical tools', weight: 1 }] });
const components = [
  assignment('A1', 'Data, insight and analytics', 'Data, Insight and Analytics', 'How can data and customer insight improve your organisation’s marketing decisions?\n\nUse a real workplace example to explain how you collected and analysed data, identified an opportunity and measured the impact of your recommendations. Include supporting evidence and reflect on what you learned.'),
  assignment('A2', 'Digital analytics review', 'Digital and Web Analytics', 'Evaluate the analytics tools used in your organisation and explain how you would improve reporting.'),
  assignment('A3', 'Marketing strategy', 'Strategic Planning', 'Create an evidence-based marketing plan for your organisation.'),
];
// Native browser downloads bypass request interception. Serve this disposable
// fixture through Vite so we can verify the downloaded bytes as well as preview.
const attachmentPath = `/monthly-submission-fixture-${process.pid}.txt`;
const attachmentFile = resolve('public', attachmentPath.slice(1));
const attachmentText = 'Assignment instructions: explain how customer insight improves marketing decisions. Include supporting workplace evidence.';
components[0].resourceUrl = attachmentPath;
components[0].fileName = 'Assignment instructions.txt';
const profile = { id: '990072', name: 'Alex Morgan', email: account.email, programme: 'Marketing Executive', programmeStatus: 'Active',
  learnerType: 'apprenticeship', isActive: true, accessGate: { blocked: false, reasons: [] }, learningAccess: { blocked: false },
  components, modules: ['Martech'], week: [], ksbs: [], activityFeed: [], quizAttempts: [], videoProgress: [], componentProgress: [], totalExpectedOtjh: 21,
  componentMarkingStatus: { A2: { status: 'accepted', reviewedBy: 'Sam Taylor', reviewedAt: '2026-09-13T12:00:00Z',
    feedback: Array.from({ length: 14 }, (_, index) => `${index + 1}. Your analysis connects the reporting tools to a clear business need. The evidence demonstrates how you measured outcomes and used customer insight to improve marketing decisions.`).join('\n\n') + '\n\nFinal recommendation: keep tracking the results of your improvements.' } } };
const errors = [];
const requests = [];
try {
  await writeFile(attachmentFile, attachmentText, 'utf8');
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!/^\/(?:[\w-]+_api|api)\//.test(url.pathname)) return route.continue();
    requests.push({ path: url.pathname, method: route.request().method() });
    let json = {};
    if (url.pathname === '/login_api/me/') json = { user: account };
    else if (url.pathname === '/login_api/learner-entry/') json = { classification: 'new', required: false, canAccess: true };
    else if (/\/learner-(summary|detail)\//.test(url.pathname)) json = profile;
    else if (url.pathname.includes('/old-otjh/me/summary/')) json = { is_legacy: false, can_access_lms: true, months: [], needs_start: false };
    else if (url.pathname.includes('/subject-covers/')) json = { covers: {}, activity_dates: {
      A1: { date: '2026-09-09', month: '2026-09', date_source: 'builder_week' },
      A2: { date: '2026-09-16', month: '2026-09', date_source: 'builder_week' },
      A3: { date: '2026-10-07', month: '2026-10', date_source: 'builder_week' },
    } };
    else if (url.pathname.includes('/training-plan-dashboard/')) json = { contractStatus: 'ready', months: {
      '2026-09': { label: '', topics: ['Data, Insight and Analytics'], planned: 42, source: 'contract' },
      '2026-10': { label: '', topics: ['Marketing strategy'], planned: 30, source: 'contract' },
    } };
    else if (url.pathname.includes('/reflection/submissions/')) json = { statuses: [{ activityType: 'assignment', activityId: 'A1', status: 'draft' }, { activityType: 'assignment', activityId: 'A2', status: 'accepted' }] };
    else if (url.pathname.includes('/calendar/')) json = { events: [], learner: { kind: 'apprenticeship', id: 990072 } };
    else if (url.pathname.includes('/calendar-connections/')) json = { connections: [] };
    else if (url.pathname.includes('/coach/')) json = { coachName: 'Sam Taylor', coachEmail: 'sam@example.test' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  for (const [name, width, height] of [['desktop', 1600, 1050], ['tablet', 820, 1000], ['mobile', 390, 844], ['small-mobile', 320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/learner/monthly-submission?month=2026-09`);
    await page.getByRole('link', { name: 'Continue assignment' }).waitFor({ timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.getByRole('region', { name: 'Assignments for September 2026' }).getByRole('button').count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
    const hero = await page.getByRole('region', { name: 'September 2026', exact: true }).boundingBox();
    const content = await page.locator('main').last().boundingBox();
    assert(hero.width >= content.width - 55, `${name}: assignment card should span the content width`);
    await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
    await page.getByRole('button', { name: 'View file', exact: true }).click();
    await page.getByText(attachmentText, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: attachment preview overflow`);
    await page.screenshot({ path: resolve(out, `${name}-attachment.png`), fullPage: true });
    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download file', exact: true }).click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'Assignment instructions.txt');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString('utf8'), attachmentText, 'Download must contain the assignment file');
    await page.getByRole('button', { name: 'Hide preview' }).click();
    assert.equal(await page.getByText(attachmentText, { exact: true }).count(), 0);
    console.log(`${name}: attachment preview and downloaded file contents passed`);
    await page.getByRole('link', { name: 'Book 1:1 coach support' }).click({ trial: true });
    if (['desktop', 'mobile'].includes(name)) {
      await page.getByRole('region', { name: 'Assignments for September 2026' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(out, `${name}-assignments.png`), fullPage: true });
    }
    await page.getByRole('button', { name: /Digital analytics review/ }).click();
    const expand = page.getByRole('button', { name: 'View full feedback' });
    await expand.waitFor();
    const feedback = page.locator(`[id="${await expand.getAttribute('aria-controls')}"]`);
    const collapsedHeight = (await feedback.boundingBox()).height;
    assert(await feedback.evaluate(node => node.scrollHeight > node.clientHeight), 'Long feedback must start collapsed');
    await page.getByRole('region', { name: 'Assignment marking result' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, `${name}-feedback.png`), fullPage: true });
    await expand.click();
    await page.getByRole('button', { name: 'Show less feedback' }).waitFor();
    assert((await feedback.boundingBox()).height > collapsedHeight, 'Expanding should reveal the rest of the correction');
    assert(await feedback.evaluate(node => node.scrollHeight <= node.clientHeight + 1), 'Expanded feedback must not clip any text');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: expanded feedback overflow`);
    await page.getByRole('button', { name: 'Show less feedback' }).click();
    await page.getByRole('button', { name: 'View full feedback' }).waitFor();
    console.log(`${name}: marking feedback expands and collapses correctly`);
    console.log(`${name}: month grouping, full-width card, support target and overflow checks passed`);
  }
  await page.getByRole('button', { name: /Digital analytics review/ }).click();
  await page.getByText('Evaluate the analytics tools used in your organisation and explain how you would improve reporting.').waitFor();
  await page.getByRole('button', { name: /October 2026/ }).click();
  await page.getByRole('region', { name: 'October 2026', exact: true }).waitFor();
  assert((await page.getByRole('link', { name: 'Start assignment' }).getAttribute('href')).endsWith('/A3?month=2026-10'));
  await page.getByRole('link', { name: 'Book 1:1 coach support' }).click();
  await page.getByRole('heading', { name: 'Book a Coach Session' }).waitFor();
  const notes = page.getByPlaceholder('Add anything your coach should know before the session...');
  await notes.waitFor();
  assert((await notes.inputValue()).includes('Marketing strategy\nOctober 2026'));
  assert.equal(requests.filter(request => request.method !== 'GET').length, 0, 'Opening support must not create a booking');
  assert.deepEqual(errors, []);
  console.log(`Month switching and contextual Student Support booking passed. Screenshots: ${out}`);
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.log('Failure page:', page.url(), (await page.locator('body').innerText()).slice(-5000));
    await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true });
  }
  throw error;
} finally { await browser.close(); await unlink(attachmentFile).catch(() => {}); }
