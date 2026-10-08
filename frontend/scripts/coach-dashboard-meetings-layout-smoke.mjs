// Offline tablet layout smoke for Coach Dashboard > Upcoming Meetings.
// Build first. All API calls use synthetic responses; no live services are contacted.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';

const output = resolve('out');
assert(existsSync(resolve(output, 'index.html')), 'Run npm run build first');
const executablePath = [
  chromium.executablePath(),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
assert(executablePath, 'A local Chromium browser is required');

const origin = 'http://coach-dashboard.offline';
const owner = { name: 'Coach Example', email: 'coach@example.test' };
const learner = {
  id: '42', name: 'Akm al Khan Ray', initials: 'AK', programme: 'Example programme', programmeStatus: 'Active',
  otjh: { completed: 12, targetToDate: 10, planned: 100, progress: 100, ragStatus: 'on-track' },
  activities: { completed: 3, total: 4, progress: 75 }, attendance: { rate: 95 },
  startDate: '2026-01-12', lastActivity: { date: '2026-09-30' }, lastPr: null, lastMcm: null,
};
const contentTypes = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 768, height: 1024 }, serviceWorkers: 'block' });
await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'));
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (/^\/(?:[^/]*_api|api|curriculum)\//.test(url.pathname)) {
    let json = { results: [], items: [], events: [] };
    if (url.pathname === '/login_api/me/') json = { user: { id: 99, email: owner.email,
      displayName: owner.name, role: 'staff', access: 'coach', accesses: ['coach'],
      subjectType: 'staff', subjectId: 99, hasPassword: true, permissions: [] } };
    if (url.pathname === '/coach_api/coach/dashboard/summary') json = {
      owner, summary: { totalLearners: 1, otjh: { atRisk: 0, needAttention: 0 }, pendingMarking: 0,
        meetingsThisWeek: { pr: 0, mcm: 0, catchUps: 0 } },
      learnerPopup: { all: [{ id: learner.id, name: learner.name, initials: learner.initials,
        programmeStatus: learner.programmeStatus, programme: learner.programme, group: 'Example group',
        otjh: { completed: 12, target: 10, planned: 100, ragStatus: 'on-track' } }], atRisk: [] },
      markingPopup: { count: 0, items: [] },
      meetingsPopup: { pr: { count: 0, items: [] }, mcm: { count: 0, items: [] }, catchUps: { count: 0, items: [] } },
    };
    if (url.pathname === '/coach_api/coach/dashboard/learners') json = {
      results: [learner], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };
    if (url.pathname === '/coach_api/coach/dashboard/meetings') {
      const date = url.searchParams.get('from') || '2026-10-12';
      json = { meetings: { range: { from: date, to: url.searchParams.get('to') || date }, events: [{
        id: 'mcm-tablet', eventKey: 'mcr:42:tablet', type: 'mcm', date, time: '11:00', durationMinutes: 60,
        learner: { id: learner.id, name: learner.name }, title: 'Monthly Coaching', programme: learner.programme,
        group: 'Example group', status: 'scheduled',
      }] }, errors: {} };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  }

  const asset = resolve(output, `.${decodeURIComponent(url.pathname)}`);
  assert(asset.startsWith(output + sep), 'Asset must remain inside build output');
  const file = existsSync(asset) && extname(asset) ? asset : resolve(output, 'index.html');
  return route.fulfill({ status: 200, contentType: contentTypes[extname(file)] || 'application/octet-stream', body: readFileSync(file) });
});

const results = [];
try {
  await page.goto(`${origin}/workspace/coach`);
  await page.getByRole('tab', { name: 'Upcoming Meetings' }).click();
  const region = page.getByRole('region', { name: 'Upcoming meetings and live sessions' });
  await region.waitFor({ state: 'visible' });
  await region.locator('tbody tr[data-meeting-row="true"] td:nth-child(3)').getByText(learner.name, { exact: true }).waitFor({ state: 'visible' });

  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.waitForTimeout(400);
    const layout = await region.evaluate(element => {
      const identity = element.querySelector('tbody tr[data-meeting-row="true"] td:nth-child(3) > div');
      const name = identity?.querySelector('span > span');
      if (!identity || !name) return null;
      const nameStyle = getComputedStyle(name);
      const lineHeight = Number.parseFloat(nameStyle.lineHeight);
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        scrollable: element.scrollWidth > element.clientWidth + 1,
        identityWidth: identity.getBoundingClientRect().width,
        nameWidth: name.getBoundingClientRect().width,
        nameLines: Number.isFinite(lineHeight) && lineHeight > 0 ? Math.ceil(name.getBoundingClientRect().height / lineHeight) : null,
      };
    });
    assert(layout, `Meeting row must render at ${width}px`);
    assert(layout.pageWidth <= layout.viewportWidth + 1, `Page must not overflow at ${width}px`);
    assert(layout.scrollable, `Meeting table must scroll horizontally at ${width}px`);
    assert(layout.identityWidth >= 179, `Learner identity must remain at least 180px wide at ${width}px`);
    assert(layout.nameWidth >= 100, `Learner name must retain a readable width at ${width}px: ${JSON.stringify(layout)}`);
    assert(layout.nameLines === null || layout.nameLines <= 2, `Learner name must not stack letter-by-letter at ${width}px`);
    await region.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    assert(await region.evaluate(element => element.scrollLeft > 0), `Meeting table must accept horizontal scrolling at ${width}px`);
    results.push({ width, ...layout });
  }

  assert.deepEqual(runtimeErrors, [], 'Dashboard must render without browser runtime errors');
  console.log(JSON.stringify({ passed: true, results, runtimeErrors, scope: 'Offline synthetic Coach Dashboard meeting fixture' }, null, 2));
} finally {
  await browser.close();
}
