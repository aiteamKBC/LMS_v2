// Isolated visual fixtures: all API calls are intercepted; never sign a real record.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.STUDENT_HOME_PREVIEW_URL || 'http://127.0.0.1:3000';
const out = resolve('test-results/student-home');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const account = { id: 990071, subjectId: 990071, role: 'learner', subjectType: 'learner', displayName: 'Alex Morgan', email: 'alex@example.test', learnerType: 'apprenticeship', hasPassword: true, permissions: [], hasLegacyRecord: false };
const profile = { id: 990071, name: 'Alex Morgan', email: account.email, programme: 'Business Administration', programmeStatus: 'Active', learnerType: 'apprenticeship', isActive: true, studentActivityAvailable: true, accessGate: { blocked: false, reasons: [] }, learningAccess: { blocked: false }, components: [], modules: [] };
const today = new Date();
const date = days => new Date(today.getTime() + days * 86400000).toISOString();
const schedule = { modules: [], moduleLinks: {}, months: {}, actual: [], actualAvailable: true, coach: { name: 'Assigned coach', bookingUrl: null }, contractStatus: '', generatedAt: today.toISOString(),
  sessions: [{ id: 'session-one', title: 'Business administration workshop', start: date(3), status: 'scheduled' }],
  reviews: [{ id: 'review-one', title: 'Progress review', source: 'progress-review', scheduledDate: date(2).slice(0,10), status: 'scheduled' }] };
const week = { weekStart: date(0).slice(0,10), modules: [{ id: 'module-one', completed: 2, total: 5 }], deadlines: [{ id: 'assignment-one', title: 'Workplace project', date: date(1).slice(0,10), type: 'assignment' }], otjh: {} };
week.homeProgress = {
  period: { start: date(-90).slice(0,10), end: date(3).slice(0,10), timezone: 'Europe/London' },
  otjh: { actual: 42, submitted: 10, planned: 100, percent: 42, missingPlannedActivities: 0 },
  activities: { completed: 21, total: 50 }, assignments: { completed: 3, total: 6 },
  lectures: { completed: 8, total: 10 }, modules: { completed: 1, total: 5 }, undatedActivities: 0,
};
let blocked = false;
const requests = [];
try {
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!/^\/(?:[\w-]+_api|api)\//.test(url.pathname)) return route.continue();
    requests.push(url.pathname);
    let json = {};
    if (url.pathname === '/login_api/me/') json = { user: account };
    else if (url.pathname === '/login_api/learner-entry/') json = { classification: blocked ? 'existing' : 'new', required: blocked, canAccess: !blocked, totalMonths: 2, completedMonths: 0 };
    else if (url.pathname.includes('/learner-summary/') || url.pathname.includes('/learner-detail/')) json = profile;
    else if (url.pathname.includes('/metrics/')) json = { programme: { completed: 21, total: 50, percent: 42, status: 'ready' }, ksb: { status: 'ready' }, otjh: {} };
    else if (url.pathname.includes('/training-plan-dashboard/')) json = schedule;
    else if (url.pathname.includes('/overview-week/')) json = week;
    else if (url.pathname.includes('/attendance/')) json = { attendance: { learnerId: 990071, present: 8, sessions: 10 } };
    else if (url.pathname.includes('/old-otjh/me/summary/')) json = { is_legacy: true, can_access_lms: !blocked, months: [], needs_start: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [name, width, height] of [['desktop',1920,1080], ['laptop',1280,800], ['tablet',1024,768], ['mobile',390,844], ['small-mobile',320,740]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/learner/home`);
    await page.getByRole('heading', { name: 'Alex' }).waitFor().catch(async error => {
      console.log('Visible page:', (await page.locator('body').innerText()).slice(0, 2000));
      console.log('Page errors:', errors); console.log('Requested APIs:', requests);
      await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true });
      throw error;
    });
    await page.getByRole('progressbar', { name: 'OTJ progress' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`${name}: horizontal overflow`);
    for (const label of ['Continue Learning','Monthly Submission','Dashboard','Attend or Report Absence','Book for Monthly Coaching Session']) {
      const link = page.getByRole('link', { name: new RegExp(`^${label}`) });
      await link.scrollIntoViewIfNeeded();
      await link.click({ trial: true });
    }
    console.log(`${name}: personal content, layout and five action hit targets passed`);
  }
  blocked = true;
  await page.goto(`${base}/learner/my-learning`);
  const dialog = page.getByRole('dialog', { name: 'Review and sign your previous learning record' });
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  if (!await dialog.isVisible()) throw new Error('Escape bypassed signing gate');
  await page.getByRole('link', { name: 'Review and sign', exact: true }).focus();
  await page.keyboard.press('Tab');
  if (!await page.getByRole('link', { name: 'Contact support' }).evaluate(node => node === document.activeElement)) throw new Error('Focus escaped the mandatory dialog');
  await page.screenshot({ path: resolve(out, 'mandatory-signing.png'), fullPage: true });
  console.log('Direct learning route: mandatory dialog, Escape resistance and keyboard focus trap passed');
  if (requests.some(path => /learner-summary\/[^/]+\/(?!990071\/)/.test(path))) throw new Error('Wrong learner identity requested');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Screenshots: ${out}`);
} finally { await browser.close(); }
