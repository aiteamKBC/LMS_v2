// Build first. Serves built assets through browser request interception, without
// starting a server or connecting to a database, Microsoft, or other services.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const output = resolve('out');
assert(existsSync(resolve(output, 'index.html')), 'Run npm run build first');
const executablePath = [process.env.COACH_BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
assert(executablePath, 'A local Chromium browser is required');
const profile = mkdtempSync(resolve(tmpdir(), 'lms-coach-browser-'));
const browser = spawn(executablePath, ['--headless=new', '--no-first-run', '--disable-background-networking',
  '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const sleep = ms => new Promise(done => setTimeout(done, ms));
for (let attempt = 0; !existsSync(resolve(profile, 'DevToolsActivePort')); attempt++) {
  assert(attempt < 100, 'Browser debugging endpoint did not start');
  await sleep(100);
}
const port = readFileSync(resolve(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
await new Promise(done => socket.addEventListener('open', done, { once: true }));
let sequence = 0;
const pending = new Map();
function command(method, params = {}) {
  return new Promise((resolveResult, reject) => {
    const id = ++sequence;
    pending.set(id, { resolveResult, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async expression => {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true });
  assert(!result.exceptionDetails, 'Browser evaluation failed');
  return result.result.value;
};
const errors = [];
socket.addEventListener('message', async event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolveResult(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  else if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    const route = {
      request: () => ({ url: () => request.url }),
      abort: () => command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }),
      fulfill: ({ status, contentType, body }) => command('Fetch.fulfillRequest', { requestId, responseCode: status,
        responseHeaders: [{ name: 'Content-Type', value: contentType }], body: Buffer.from(body).toString('base64') }),
    };
    try { await intercept(route); } catch (error) { errors.push(error.message); await route.abort(); }
  }
});
await command('Runtime.enable');
await command('Page.enable');
await command('Network.setBypassServiceWorker', { bypass: true });
await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
const owner = { name: 'Coach Example', email: 'coach@example.test' };
async function intercept(route) {
  const url = new URL(route.request().url());
  if (url.origin !== 'http://coach.offline') return route.abort();
  if (/^\/(?:[^/]*_api|api|curriculum)\//.test(url.pathname)) {
    let json = { owner, learners: [], events: [], items: [], results: [], records: [],
      summary: {}, filters: {}, pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
      attendance: { learners: [] }, marking: { items: [] }, meetings: { events: [] },
      people: [], totals: { people: 0, sessions: 0, events: 0, changes: 0 } };
    if (url.pathname === '/login_api/me/') json = { user: { id: 99, email: owner.email,
      displayName: owner.name, role: 'staff', access: 'coach', accesses: ['coach'],
      subjectType: 'staff', subjectId: 99, hasPassword: true, permissions: [] } };
    if (url.pathname === '/coach_api/coach/attendance/options') json = {
      programmes: [{ id: 'programme-example', name: 'Example programme',
        groups: [{ id: 'group-example', name: 'Example group', cohort: 'Example cohort' }] }],
    };
    if (url.pathname === '/coach_api/coach/attendance/context') json = {
      programme: { id: 'programme-example', name: 'Example programme' },
      group: { id: 'group-example', name: 'Example group', cohort: 'Example cohort' },
      learners: [{ id: '42', name: 'Example learner with a long name', email: 'learner@example.test',
        status: 'active', recent: [{ date: '2026-10-01', status: 'present' }] }],
      sessions: [{ id: 'occ-1', date: '2026-10-01', time: '09:00', title: 'Example teaching session' }],
    };
    if (url.pathname === '/coach_api/coach/attendance/details') json = {
      learner: { id: '42', name: 'Example learner with a long name', email: 'learner@example.test',
        programme: 'Example programme', cohort: 'Example cohort', group: 'Example group' },
      coach: owner, tutor: null,
      summary: { sessions: 1, present: 1, absent: 0, attendanceRate: 100 },
      records: [{ id: 'microsoft-teams:occ-1', title: 'Example teaching session',
        module: 'Example module', date: '2026-10-01', status: 'present', absenceReport: null }],
      pagination: { page: 1, pageSize: 20, total: 1, hasMore: false },
    };
    if (url.pathname === '/coach_api/coach/reviews/example') json = {
      instance: { id: 'example', reviewTemplateId: 'template-example', learnerId: 42,
        programmeId: 'programme-example', occurrenceNumber: 1, targetDate: '2026-10-01',
        status: 'in-progress', startedAt: '2026-10-01T09:00:00Z', completedAt: null },
      template: { id: 'template-example', name: 'Example coaching review',
        signatures: { advisor: true, participant: true, employer: false, referrer: false },
        visibleTo: { advisor: true, participant: true, employer: false, referrer: false },
        recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
      sections: [{ id: 'section-example', title: 'Next steps', estimatedMinutes: 5, displayOrder: 1,
        enabled: true, fields: [{ id: 'field-example', title: 'Agreed action', fieldType: 'text',
          required: true, displayOrder: 1, configuration: {}, answer: 'Review the next module' }] }],
      signatures: { advisor: { required: true, signed: false }, participant: { required: true, signed: false },
        employer: { required: false, signed: false }, referrer: { required: false, signed: false } },
      manualOverride: null,
    };
    if (url.pathname.startsWith('/curriculum/') || url.pathname.includes('/groups') || url.pathname.includes('/programmes')) json = { results: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  }
  const asset = resolve(output, `.${decodeURIComponent(url.pathname)}`);
  assert(asset.startsWith(output + sep), 'Asset must remain inside build output');
  const file = existsSync(asset) && extname(asset) ? asset : resolve(output, 'index.html');
  const contentType = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }[extname(file)] || 'application/octet-stream';
  return route.fulfill({ status: 200, contentType, body: readFileSync(file) });
}

const page = {
  setViewportSize: ({ width, height }) => command('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false }),
  goto: url => command('Page.navigate', { url }),
  waitForTimeout: sleep,
};

const routes = ['/workspace/coach', '/coach/caseload', '/coach/case-files', '/coach/attendance',
  '/coach/absence-reports', '/coach/catchup-queue', '/coach/marking-queue', '/coach/ai-marking',
  '/coach/monthly-coaching', '/coach/timetable', '/coach/monthly-cycle', '/coach/progress-reviews',
  '/coach/ksb-impact', '/coach/otjh-reports', '/coach/monthly-reports', '/coach/evidence-validation',
  '/coach/audit-trail', '/coach/reports'];
routes.push('/coach/attendance/42');
routes.push('/coach/learner-case-file', '/coach/marking-queue/example', '/coach/meetings/mcr%3Aexample',
  '/coach/progress-reviews/mcr%3Aexample', '/coach/review-instances/example',
  '/coach/audit-trail/people/learner%40example.test');
const failures = [];
const fixtureErrors = [];
let checks = 0;
try {
  for (const route of process.env.COACH_ROUTES?.split(',') || routes) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`http://coach.offline${route}`);
    await sleep(400);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate('!!document.querySelector(\'.workspace-shell[data-workspace-role="coach"] .workspace-main\')')) break;
      await sleep(100);
    }
    await page.waitForTimeout(800);
    if (route === '/coach/timetable') {
      await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Week')?.click()`);
      await sleep(150);
    }
    for (const width of [320, 390, 768, 1024, 1280, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      // The shell animates its sidebar margin for 300ms at the breakpoint.
      await page.waitForTimeout(350);
      const overflow = await evaluate(`(() => {
        const main = document.querySelector('.workspace-main');
        if (!main) return null;
        return { actual: main.scrollWidth, available: main.clientWidth,
          body: document.documentElement.scrollWidth, viewport: innerWidth,
          computed: { width: getComputedStyle(main).width, display: getComputedStyle(main).display,
            parentWidth: main.parentElement.clientWidth, padding: getComputedStyle(main).padding },
          outside: [...main.children].filter(el => el.getBoundingClientRect().right > main.getBoundingClientRect().left + main.clientWidth + 2)
            .map(el => ({ tag: el.tagName, classes: el.className, position: getComputedStyle(el).position,
              right: el.getBoundingClientRect().right, width: getComputedStyle(el).width })) };
      })()`);
      if (!overflow) {
        fixtureErrors.push({ route, detail: await evaluate('document.body.textContent.slice(0, 2000)') });
        break;
      }
      if (overflow.actual > overflow.available + 2 || overflow.body > width + 2)
        failures.push({ route, width, ...overflow });
      checks++;
    }
  }
  if (process.env.COACH_SCREENSHOT_DIR) {
    mkdirSync(process.env.COACH_SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://coach.offline/coach/reports');
    await sleep(1500);
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(process.env.COACH_SCREENSHOT_DIR, 'coach-mobile.png'), Buffer.from(screenshot.data, 'base64'));
  }
  console.log(JSON.stringify({ checks, failures, fixtureErrors, runtimeErrors: [...new Set(errors)],
    scope: 'Real coach routes with synthetic API fixtures, mostly empty states plus attendance and review form examples. No live services.' }, null, 2));
  assert.equal(failures.length, 0, 'Coach content must not overflow its viewport');
  assert.equal(fixtureErrors.length, 0, 'Offline route fixtures must render the coach shell');
  assert.equal(errors.length, 0, 'Offline route fixtures must render without runtime errors');
} finally {
  socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' }));
  await sleep(100);
  socket.close();
  browser.kill();
}
