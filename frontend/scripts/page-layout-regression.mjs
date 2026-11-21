// Run from frontend: node scripts/page-layout-regression.mjs
// Uses the real app/CSS with synthetic API replies. No .env, backend proxy,
// external requests, service workers, WebSockets or real account/session data.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import AutoImport from 'unplugin-auto-import/vite';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const out = await mkdtemp(join(tmpdir(), 'lms-page-layout-'));
const only = process.argv.find(value => value.startsWith('--case='))?.slice(7);
const server = await createServer({
  root, configFile: false, envDir: false, cacheDir: join(out, 'vite-cache'),
  plugins: [react(), AutoImport({ dts: false, imports: ['react', {
    'react-router-dom': ['Link', 'Navigate', 'useNavigate', 'useLocation', 'useParams', 'useSearchParams'],
    '@/components/feature/AppIcon': ['AppIcon'],
  }] })],
  resolve: { alias: { '@': resolve(root, 'src') } },
  define: { __BASE_PATH__: '"/"', __IS_PREVIEW__: false, __READDY_PROJECT_ID__: '""', __READDY_VERSION_ID__: '""', __READDY_AI_DOMAIN__: '""' },
  server: { host: '127.0.0.1', port: 0, proxy: {}, hmr: false },
});

const account = { id: 990071, subjectId: 990071, role: 'admin', subjectType: 'staff', displayName: 'Example Admin', email: 'admin@example.test', hasPassword: true, permissions: [], hasLegacyRecord: false };
const progress = {
  period: { start: '2026-01-01', end: '2026-11-19' },
  otjh: { actual: 42, submitted: 10, planned: 100, percent: 42, missingPlannedActivities: 0 },
  activities: { completed: 21, total: 50 }, assignments: { completed: 3, total: 6 },
  lectures: { completed: 8, total: 10 }, modules: { completed: 1, total: 5 }, undatedActivities: 0,
};

async function rectangle(locator) {
  const box = await locator.boundingBox();
  assert(box, 'Expected a visible element');
  return box;
}
function close(actual, expected, label) {
  assert(Math.abs(actual - expected) <= 3, `${label}: expected ${Math.round(expected)}px, got ${Math.round(actual)}px`);
}
async function centeredCard(page, locator, maxWidth, padding = 16) {
  const box = await rectangle(locator);
  const width = page.viewportSize().width;
  close(box.width, Math.min(maxWidth, width - padding * 2), 'Card width');
  close(box.x + box.width / 2, width / 2, 'Card centre');
}
async function home(page) {
  await page.getByRole('heading', { name: 'Example' }).waitFor();
  await page.getByRole('progressbar', { name: 'OTJ progress' }).waitFor();
  const scene = await rectangle(page.locator('#student-main'));
  const shield = await rectangle(page.getByRole('region', { name: 'Learning actions' }));
  const viewport = page.viewportSize();
  if (viewport.width > 1150) {
    const headerHeight = await page.locator('#root header').first().evaluate(el => el.getBoundingClientRect().height);
    close(shield.width, Math.min(scene.width * .349, (viewport.height - headerHeight) * .69685), 'Learner shield width');
    close(shield.x + shield.width / 2, scene.x + scene.width / 2, 'Learner shield centre');
    const side = await rectangle(page.getByRole('link', { name: 'Inclusion & Safeguarding' }));
    assert(side.width < scene.width * .3, 'Safeguarding must remain a compact side action');
    const intro = await rectangle(page.locator('section[aria-labelledby="welcome-heading"]'));
    close(intro.width, scene.width * .28, 'Welcome area width');
  } else {
    assert(shield.width <= Math.min(460, scene.width), 'Mobile shield must fit its column');
  }
  for (const label of ['Continue Learning', 'Monthly Submission', 'Dashboard', 'Attend or Report Absence', 'Book for Monthly Coaching Session']) {
    await page.getByRole('link', { name: new RegExp(`^${label}`) }).click({ trial: true });
  }
}

const cases = [
  { name: 'learner-home', path: '/workspace/learner/commercial/990071', auth: true, check: home },
  { name: 'apprentice-home', path: '/workspace/learner/apprenticeship/990071', auth: true, check: home },
  { name: 'lecture-feedback', path: '/lecture-feedback', check: page => centeredCard(page, page.locator('main > section'), 420) },
  { name: 'event-feedback', path: '/event-feedback', check: page => centeredCard(page, page.locator('main > section'), 896) },
  { name: 'event-rsvp', path: '/event-rsvp', check: page => centeredCard(page, page.locator('main > section'), 896) },
  { name: 'event-check-in', path: '/event-check-in', check: page => centeredCard(page, page.locator('main > section'), 512) },
  { name: 'coach-booking', path: '/coach-booking/example-coach', check: async page => {
    const box = await rectangle(page.locator('main > div').first());
    assert(box.width <= 1203, 'Coach bookings must keep their maximum width');
    close(box.x + box.width / 2, page.viewportSize().width / 2, 'Bookings centre');
  } },
  { name: 'lms-introduction', path: '/lms-introduction', check: async page => {
    const box = await rectangle(page.locator('main > div').first());
    assert(box.width <= 1203, 'LMS introduction must keep its maximum width');
    close(box.x + box.width / 2, page.viewportSize().width / 2, 'Introduction centre');
  } },
  ...['login', 'forgot-password'].map(name => ({ name, path: `/${name}`, check: async page => {
    const align = await page.locator('main footer').evaluate(el => globalThis.getComputedStyle(el).textAlign);
    assert.equal(align, 'center', `${name}: footer alignment`);
  } })),
  { name: 'qr-attendance', path: '/qr-attendance', check: async page => {
    // The QR page deliberately uses a left-aligned heading beside its icon on mobile.
    const expectedAlignment = page.viewportSize().width <= 767 ? 'left' : 'center';
    assert.equal(await page.locator('.qr-attendance-heading').evaluate(el => globalThis.getComputedStyle(el).textAlign), expectedAlignment);
    if (page.viewportSize().width > 1150) {
      assert((await rectangle(page.locator('.qr-attendance-content'))).width < page.viewportSize().width * .5, 'QR card must keep its own width');
    }
  } },
  { name: 'engagement-reports', path: '/engagement/reports', auth: true, check: async page => {
    const shell = await rectangle(page.locator('.workspace-main'));
    // The scrolling shell's border box includes its vertical scrollbar.
    const availableWidth = await page.locator('.workspace-main').evaluate(el => el.clientWidth);
    const content = await rectangle(page.locator('.workspace-main > div').first());
    close(content.width, availableWidth, 'Reports content width');
    close(content.x, shell.x, 'Reports content alignment');
  } },
];
const selected = cases.filter(item => !only || item.name === only);
assert(selected.length, `Unknown case: ${only}`);
let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  let passed = 0;
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    for (const item of selected) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.route('**/*', async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.origin !== base) return route.abort();
        if (/^\/(?:[\w-]+_api|api)\//.test(url.pathname) || ['fetch', 'xhr'].includes(request.resourceType())) {
          let json = {};
          if (/\/csrf\/?$/.test(url.pathname)) json = { csrfToken: 'synthetic-layout-test-token' };
          else if (url.pathname === '/login_api/me/') json = { user: item.auth ? account : null };
          else if (/\/public\/coaches\//.test(url.pathname)) json = { name: 'Example Coach', slug: 'example-coach', links: { first_session: '', support_session: '', coaching_session: '', progress_review: '', one_to_one: '' } };
          else if (/learner-summary|learner-detail/.test(url.pathname)) json = {
            id: 990071, name: 'Example Learner', email: 'learner@example.test', programme: 'Example Programme', programmeStatus: 'Active',
            learnerType: item.name === 'apprentice-home' ? 'apprenticeship' : 'commercial', isActive: true, studentActivityAvailable: true,
            accessGate: { blocked: false, reasons: [] }, learningAccess: { blocked: false }, components: [], modules: [],
          };
          else if (/first-login/.test(url.pathname)) json = { required: false };
          else if (/my-forms/.test(url.pathname)) json = { forms: [] };
          else if (/training-plan-dashboard/.test(url.pathname)) json = { modules: [], moduleLinks: {}, months: {}, actual: [], actualAvailable: true, coach: { name: 'Example Coach' }, sessions: [], reviews: [], events: [] };
          else if (/overview-week/.test(url.pathname)) json = { weekStart: '2026-11-16', weekEnd: '2026-11-22', modules: [], deadlines: [], otjh: {}, events: [], homeProgress: progress };
          else if (/public/.test(url.pathname)) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Example link is unavailable.' }) });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
        }
        if (request.method() !== 'GET') return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base + item.path, { waitUntil: 'networkidle', timeout: 90000 });
        await page.locator('main').first().waitFor();
        await page.evaluate(() => globalThis.document.fonts.ready);
        await item.check(page);
        assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1), false, `${item.name}: horizontal page overflow`);
        assert.deepEqual(errors, [], `${item.name}: unexpected page errors`);
        await page.screenshot({ path: join(out, `${item.name}-${viewport.width}.png`) });
        console.log(`PASS ${item.name} ${viewport.width}px`); passed++;
      } catch (error) {
        await page.screenshot({ path: join(out, `${item.name}-${viewport.width}-failure.png`) });
        throw error;
      } finally { await context.close(); }
    }
  }
  console.log(`${passed} layout checks passed. Screenshots: ${out}`);
} finally { await browser?.close(); await server.close(); }
