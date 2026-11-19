// Build first. Serve the built app in memory with synthetic responses only:
// no server, database, credentials, or live API requests are used.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, resolve, sep, join } from 'node:path';
import console from 'node:console';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';

const output = resolve('out');
assert(existsSync(resolve(output, 'index.html')), 'Run npm run build first');
const screenshots = mkdtempSync(join(tmpdir(), 'student-home-layout-'));
const executablePath = [chromium.executablePath(),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert(executablePath, 'A local Chromium browser is required');
const origin = 'http://student-home.offline';
const account = { id: 990071, subjectId: 990071, role: 'learner', subjectType: 'learner',
  displayName: 'Alex Morgan', email: 'alex@example.test', learnerType: 'apprenticeship',
  hasPassword: true, permissions: [], hasLegacyRecord: false };
const profile = { id: 990071, name: account.displayName, email: account.email,
  programme: 'Example Programme', programmeStatus: 'Active', learnerType: 'apprenticeship',
  isActive: true, studentActivityAvailable: true, accessGate: { blocked: false, reasons: [] },
  learningAccess: { blocked: false }, components: [], modules: [] };
const week = { weekStart: '2026-11-16', weekEnd: '2026-11-22', modules: [], deadlines: [], otjh: {}, homeProgress: {
  period: { start: '2026-01-01', end: '2026-11-19', timezone: 'Europe/London' },
  otjh: { actual: 42, submitted: 10, planned: 100, percent: 42, missingPlannedActivities: 0 },
  activities: { completed: 21, total: 50 }, assignments: { completed: 3, total: 6 },
  lectures: { completed: 8, total: 10 }, modules: { completed: 1, total: 5 }, undatedActivities: 0,
} };
const schedule = { modules: [], moduleLinks: {}, months: {}, actual: [], actualAvailable: true,
  coach: { name: 'Example coach', bookingUrl: null }, contractStatus: '', generatedAt: '2026-11-19T09:00:00Z',
  sessions: [{ id: 'session-one', title: 'Example workshop', start: '2026-11-24T10:00:00Z', status: 'scheduled' }], reviews: [] };
const contentTypes = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (/^\/(?:[^/]*_api|api|curriculum)\//.test(url.pathname)) {
      let json = { results: [], items: [], events: [], forms: [] };
      if (url.pathname === '/login_api/me/') json = { user: account };
      else if (url.pathname === '/login_api/learner-entry/') json = { classification: 'new', required: false, canAccess: true };
      else if (url.pathname.endsWith('/first-session/')) json = { access: 'open', booked: true, event: null, startsOn: '2026-01-01', caseOwner: null };
      else if (/\/learner-(summary|detail)\//.test(url.pathname)) json = profile;
      else if (url.pathname.includes('/training-plan-dashboard/')) json = url.searchParams.get('section') === 'upcoming'
        ? { events: [{ id: 'session-one', type: 'session', title: 'Example workshop', date: '2026-11-24T10:00:00Z' }] } : schedule;
      else if (url.pathname.includes('/overview-week/')) json = week;
      else if (url.pathname.includes('/metrics/')) json = { programme: { completed: 21, total: 50, percent: 42, status: 'ready' }, ksb: { status: 'ready' }, otjh: {} };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    }
    if (route.request().method() !== 'GET') return route.abort();
    const asset = resolve(output, `.${decodeURIComponent(url.pathname)}`);
    assert(asset.startsWith(output + sep), 'Asset must remain inside build output');
    const file = existsSync(asset) && extname(asset) ? asset : resolve(output, 'index.html');
    return route.fulfill({ status: 200, contentType: contentTypes[extname(file)] || 'application/octet-stream', body: readFileSync(file) });
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-11-19T09:00:00Z'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[2560, 1440], [1920, 1080], [1280, 800], [1024, 768], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/learner/home`);
    await page.getByRole('heading', { name: 'Alex', exact: false }).waitFor().catch(async error => {
      console.log('Page:', await page.locator('body').innerText());
      console.log('Runtime errors:', errors);
      await page.screenshot({ path: join(screenshots, 'failure.png'), fullPage: true });
      throw error;
    });
    await page.getByRole('progressbar', { name: 'OTJ progress' }).waitFor();
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.screenshot({ path: join(screenshots, `${width}.png`), fullPage: true });
    const bounds = await page.evaluate(() => {
      const { document, innerWidth, getComputedStyle } = globalThis;
      const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, right: r.right }; };
      const shield = document.querySelector('[aria-label="Learning actions"]');
      const scene = document.getElementById('student-main');
      const hero = document.getElementById('welcome-heading').parentElement;
      const safeguarding = document.querySelector('a[href*="safeguarding"]');
      return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
        scene: box(scene), shield: box(shield), hero: box(hero), safeguarding: box(safeguarding),
        quoteAlign: getComputedStyle(scene.querySelector('blockquote p')).textAlign,
        shieldTitleAlign: getComputedStyle(shield.querySelector('a:nth-of-type(2) strong')).textAlign };
    });
    console.log(`${width} layout: ${JSON.stringify(bounds)}`);
    assert(!bounds.overflow, `${width}: horizontal overflow`);
    assert(bounds.shield.x >= -1 && bounds.shield.right <= width + 1, `${width}: shield must stay inside viewport`);
    if (width > 1150) {
      assert(bounds.shield.width <= bounds.scene.width * .35, `${width}: shared CSS expanded the shield`);
      assert(Math.abs(bounds.shield.x + bounds.shield.width / 2 - width / 2) < 2, `${width}: shield must remain centered`);
      assert(bounds.hero.width <= bounds.scene.width * .29, `${width}: welcome panel must keep its column width`);
      assert(bounds.safeguarding.width < width * .4, `${width}: safeguarding must remain a side panel`);
    }
    assert.equal(bounds.shieldTitleAlign, 'right', `${width}: right-hand shield text alignment`);
    assert.equal(bounds.quoteAlign, 'center', `${width}: quote text alignment`);
    for (const name of ['Monthly Submission', 'Dashboard', 'Attend or Report Absence', 'Book for Monthly Coaching Session']) {
      await page.getByRole('link', { name: new RegExp(`^${name}`) }).click({ trial: true });
    }
    console.log(`PASS ${width}x${height}: bounds, alignment and action hit targets`);
  }
  // Workspace containers still fill their shell. Nested cards and public pages
  // retain their own dimensions and alignment after scoping the shared rule.
  const normalLayout = await page.evaluate(() => {
    const { document, getComputedStyle } = globalThis;
    const main = document.createElement('main');
    main.className = 'workspace-main';
    main.style.width = '200px';
    main.innerHTML = '<section class="page-container" style="width:100px;padding:0"><article style="width:80px"><p style="text-align:right">Workspace card</p></article></section>';
    document.getElementById('root').append(main);
    const result = { main: main.getBoundingClientRect().width, child: main.firstElementChild.getBoundingClientRect().width,
      card: main.querySelector('article').getBoundingClientRect().width,
      align: getComputedStyle(main.querySelector('p')).textAlign };
    main.className = '';
    result.publicMain = main.getBoundingClientRect().width;
    result.publicChild = main.firstElementChild.getBoundingClientRect().width;
    main.remove();
    return result;
  });
  assert.equal(normalLayout.child, normalLayout.main);
  assert.equal(normalLayout.card, 80);
  assert.equal(normalLayout.align, 'right');
  assert.equal(normalLayout.publicMain, 200);
  assert.equal(normalLayout.publicChild, 100);
  assert.deepEqual(errors, [], 'No page JavaScript errors');
  console.log(`PASS other-page alignment and runtime errors. Screenshots: ${screenshots}`);
} finally {
  console.log(`Screenshots: ${screenshots}`);
  await browser.close();
}
