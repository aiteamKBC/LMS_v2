// Real app and workspace chrome; all API responses are synthetic and isolated.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = 'http://127.0.0.1:3000';
const output = resolve('test-results/learning-layout');
await mkdir(output, { recursive: true });
const titles = ['Leadership foundations', 'Marketing impact and planning', 'Social media marketing', 'Project controls and professional practice'];
const weekStarts = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
const weekEnds = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'];
const activities = titles.flatMap((group_name, group) => Array.from({ length: 8 }, (_, position) => ({
  activity_id: `la:${group + 1}:${position}`, source_activity_id: position, group_id: group + 1, group_name,
  activity: ['Introduction to your module', 'Core concepts and examples', 'Apply your learning', 'Reflect on your progress'][position % 4], category: 'reading',
  position, completed: position < [3, 0, 8, 5][group], date: weekStarts[Math.floor(position / 2)], month: weekStarts[Math.floor(position / 2)].slice(0, 7),
  week_start: weekStarts[Math.floor(position / 2)], week_end: weekEnds[Math.floor(position / 2)],
  actual: .5, planned: 1, hours_mapped: true, planned_hours_mapped: true,
})));
const detail = { id: '125', name: 'Alex Learner', email: 'alex@example.test', phone: '', learnerType: 'commercial', programme: 'Business Leadership',
  programmeStatus: 'Active', cohort: 'September 2026', group: 'Group 1', employer: 'Example Company', isActive: true, modules: [], week: [], components: [],
  ksbs: [], quizAttempts: [], videoProgress: [], componentProgress: [], activityFeed: [], studentActivityAvailable: true,
  learningAccess: { blocked: false, reasons: [], startDate: '2026-09-01' } };
const history = { learner_name: detail.name, activities, subjects: titles.map((name, i) => ({ id: i + 1, name })), actual_total: 16, planned_total: 32, covers: {} };
const metadata = { covers: {}, current_subjects: [], builder_subjects: Object.fromEntries(titles.map((title, i) => [`legacy:${i + 1}`, { id: `M${i + 1}`, title }])) };
const schedule = { modules: titles.map((title, i) => ({ id: `M${i + 1}`, title, start_date: '2026-09-01', end_date: '2026-10-01', description: '',
  programme_name: detail.programme, cohort_name: detail.cohort, group_name: detail.group, tutor_name: '', coach_name: '' })),
  moduleLinks: metadata.builder_subjects, sessions: [], reviews: [], coach: { name: '', bookingUrl: null }, months: {}, actual: [], contractStatus: '' };
const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert(executablePath, 'A local browser is required for visual tests');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
const page = await context.newPage();
await page.clock.setFixedTime(new Date('2026-09-13T12:00:00Z'));
const unexpected = [], runtimeErrors = [], widths = [2518, 1920, 1440, 1280, 1024, 768, 390, 320];
let releaseHistory;
let historyGate = new Promise(resolve => { releaseHistory = resolve; });
let failReads = false;
page.on('pageerror', e => runtimeErrors.push(e.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname;
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
  if (!/^\/(?:[^/]*_api|api)\//.test(path)) return route.continue();
  assert.equal(request.method(), 'GET', `No live writes: ${path}`);
  if (failReads && path.startsWith('/learner_api/')) return route.abort('connectionfailed');
  let json;
  if (path === '/login_api/me/') json = { user: { id: 125, email: detail.email, displayName: detail.name, role: 'learner', subjectType: 'learner', subjectId: 125,
    learnerType: 'commercial', hasPassword: true, lastLoginAt: null, permissions: [], hasLegacyRecord: false } };
  else if (/\/learner-(summary|detail)\//.test(path)) json = detail;
  else if (path.includes('/subject-covers/')) json = metadata;
  else if (path.includes('/student-activity/')) { await historyGate; json = history; }
  else if (path.includes('/metrics/')) json = { migrated: true, programme: { completed: 16, total: 32, percent: 50, status: 'ready' },
    ksb: { completed: 0, total: 0, percent: null, status: 'empty' }, otjh: { actual: 16, planned: 32, historical: 16, new: 0 } };
  else if (path.includes('/training-plan-dashboard/')) json = schedule;
  else if (path.includes('/overview-week/')) json = { weekStart: '2026-09-07', weekEnd: '2026-09-13', modules: [], deadlines: [], otjh: {} };
  else if (path.includes('/cache-epoch/')) json = { epoch: 0, changes: [] };
  else if (path.includes('/profile-photo/')) return route.fulfill({ status: 204 });
  else { unexpected.push(path); return route.fulfill({ status: 503, json: { error: 'Unmodelled test request' } }); }
  return route.fulfill({ json });
});

async function assertFits(width) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Page fits at ${width}`);
  const content = page.getByRole('region', { name: 'Your subjects' });
  await expect(content.locator('article')).toHaveCount(4);
  const overflow = await content.locator('article').evaluateAll(cards => cards.some(card => card.scrollWidth > card.clientWidth + 1));
  assert.equal(overflow, false, `Cards fit at ${width}`);
  await expect.poll(() => page.evaluate(() => {
    const title = [...document.querySelectorAll('h1')].find(node => node.textContent === 'My Learning');
    const subjects = document.querySelector('[aria-label="Your subjects"]');
    return Math.abs(title.getBoundingClientRect().x - subjects.getBoundingClientRect().x);
  }), { message: `Header and subjects align at ${width}` }).toBeLessThanOrEqual(2);
}

try {
  await page.goto(`${origin}/learner/my-learning`);
  await expect(page.getByRole('status', { name: 'Loading subjects' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'loading.png'), animations: 'disabled' });
  releaseHistory(); historyGate = Promise.resolve();
  await expect(page.getByRole('region', { name: 'Your subjects' }).locator('article')).toHaveCount(4);
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1080 });
    await assertFits(width);
    await page.screenshot({ path: resolve(output, `catalogue-${width}.png`), animations: 'disabled' });
  }
  await page.getByRole('region', { name: 'Your subjects' }).locator('article').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'catalogue-mobile-card.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await assertFits(1440);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertFits(390);
  await page.getByRole('region', { name: 'Your subjects' }).locator('article').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'list-mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('heading', { name: 'My Learning', exact: true, level: 1 }).scrollIntoViewIfNeeded();
  await page.getByRole('textbox', { name: 'Search modules or activities' }).fill('Leadership');
  const before = page.locator('[aria-label="Your subjects"]');
  await expect(before.locator('article')).toHaveCount(1);
  failReads = true;
  // Simulate returning to the page while the network has failed.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert').filter({ hasText: 'Connection interrupted' })).toBeVisible();
  await expect(before.locator('article')).toHaveCount(1);
  await expect(page.locator('input[aria-label="Search modules or activities"]')).toHaveValue('Leadership');
  await page.screenshot({ path: resolve(output, 'connection-retained.png'), animations: 'disabled' });
  failReads = false;
  await page.getByRole('alert').filter({ hasText: 'Connection interrupted' }).getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Connection interrupted' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search modules or activities' })).toHaveValue('Leadership');
  await page.goto(`${origin}/learner/learning-plan/modules?subject=legacy%3A1`);
  await expect(page.getByRole('list', { name: 'Leadership foundations weekly timeline' })).toBeVisible();
  await expect(page.getByText('1 of 4 weeks complete', { exact: true })).toBeVisible();
  await expect(page.getByText('Continue week', { exact: true })).toHaveCount(1);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1080 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Map fits at ${width}`);
    const cards = page.getByRole('list', { name: 'Leadership foundations weekly timeline' }).getByRole('button');
    await expect(cards).toHaveCount(4);
    assert.equal(await cards.evaluateAll(items => items.some(card => card.scrollWidth > card.clientWidth + 1)), false, `Week contents fit at ${width}`);
    const gaps = await cards.evaluateAll(items => items.slice(1).map((card, i) => card.getBoundingClientRect().top - items[i].getBoundingClientRect().bottom));
    assert(gaps.every(gap => gap >= 32), `Every week is a separate stop on the journey at ${width}: ${gaps}`);
    await page.screenshot({ path: resolve(output, `map-${width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('textbox', { name: 'Search modules or activities' }).fill('Week 2');
  await expect(page.getByRole('list', { name: 'Leadership foundations weekly timeline' }).getByRole('button')).toHaveCount(1);
  await expect(page.getByText('1 of 4 weeks complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Open Week 2:/ }).click();
  await expect(page.getByRole('region', { name: 'Week 2 materials' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to timeline' }).click();
  await expect(page.getByRole('list', { name: 'Leadership foundations weekly timeline' }).getByRole('button')).toHaveCount(4);
  await page.getByRole('link', { name: 'Open subject', exact: true }).click();
  await expect(page).toHaveURL(/my-learning.*subject=legacy%3A1/);
  assert.deepEqual(unexpected, [], 'All API requests are modelled');
  assert.deepEqual(runtimeErrors, [], 'No browser runtime errors');
  console.log(JSON.stringify({ passed: true, widths, output, networkRecovery: true }));
} catch (error) {
  console.error(JSON.stringify({ unexpected, runtimeErrors, page: await page.locator('body').innerText().catch(() => '') }));
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  throw error;
} finally { releaseHistory(); await browser.close(); }
