import { createServer, loadConfigFromFile } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile, stat, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// From the repository root:
//   node frontend/scripts/recordings-help/record.mjs --check
//   node frontend/scripts/recordings-help/record.mjs --publish
//   node frontend/scripts/recordings-help/record.mjs --verify
// --publish installs all successful takes after decoding their start and end.
// Scratch files stay in node_modules/.cache; all APIs use synthetic fixtures.
// Set RECORDINGS_HELP_FFMPEG when Playwright's Windows ffmpeg is elsewhere.
const run = promisify(execFile);
const catalog = JSON.parse(await readFile(new URL('../../src/pages/curriculum/recordings/help/tutorials.json', import.meta.url), 'utf8'));
const english = Object.fromEntries(catalog.map(item => [item.id, item]));
const frontend = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const root = path.dirname(frontend).replaceAll('\\', '/');
const dir = `${frontend}/node_modules/.cache/recordings-help`;
const output = `${frontend}/public/help/recordings/v2`;
const publish = process.argv.includes('--publish');
const base = 'http://127.0.0.1:3077', date = '2026-11-12';
const check = process.argv.includes('--check');
const verifyOnly = process.argv.includes('--verify');
const only = process.argv.find(value => value.startsWith('--only='))?.slice(7);
const ffmpeg = process.env.RECORDINGS_HELP_FFMPEG || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/ffmpeg-1011/ffmpeg-win64.exe');
const at = hour => `${date}T${String(hour).padStart(2, '0')}:00:00Z`;
const module = { moduleId: 'M1', title: 'Digital Marketing Essentials', programme: 'Level 4 Marketing', cohort: 'November 2026', group: 'Demo Group A', archived: false, programmeActive: true };
const sessions = ['Marketing strategy & planning', 'Commercial intelligence', 'AI in marketing'].map((title, i) => ({
  ...module, occurrenceId: `O${i + 1}`, title, moduleTitle: module.title, weekId: `W${i + 1}`, weekNumber: i + 1, weekTitle: ['Strategy', 'Research', 'AI tools'][i], sessionNumber: i + 1, startsAt: at(9 + i * 2), endsAt: at(10 + i * 2),
}));
const library = { recordingCount: 3, attentionChecked: true, modules: [module], sessions, deliveries: [{ ...module, recordingCount: 3, attention: [], weeks: sessions.map((session, i) => ({
  weekId: session.weekId, weekNumber: i + 1, title: session.weekTitle, recordings: [{ id: `R${i + 1}`, seriesId: 'S1', occurrenceId: session.occurrenceId, sessionNumber: i + 1, startsAt: session.startsAt, recordedAt: session.startsAt, endsAt: session.endsAt, state: 'ready', status: 'available', duplicateCount: 0, hiddenFromLearners: false }],
})) }] };
const media = { state: 'ready', readyCount: 1, recordings: [{ id: 'demo-recording', state: 'ready', startsAt: at(9), endsAt: at(10), source: 'microsoft' }], check: { state: 'complete', checkedAt: at(15) } };
const meetings = [
  { meetingId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', calendarEventId: 'mcm', title: 'Monthly Coaching Meeting — Demo Learner', coachEmail: 'coach@example.invalid', eventKey: 'mcr:1', candidateEventKeys: [], learnerIds: ['1'], family: 'MCM', category: 'MCM', startsAt: at(9), endsAt: at(10), phase: 'ended', match: 'matched', readyToAction: true, media },
  { meetingId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', calendarEventId: 'pr', title: 'Progress Review — Demo Learner', coachEmail: 'coach@example.invalid', eventKey: 'pr:2', candidateEventKeys: [], learnerIds: ['1'], family: 'PR', category: 'PR', startsAt: at(11), endsAt: at(12), phase: 'ended', match: 'matched', readyToAction: true, media },
  { meetingId: 'cccccccccccccccccccccccccccccccc', calendarEventId: 'support', title: 'Student Support — Demo Learner', coachEmail: 'coach@example.invalid', eventKey: 'support:3', candidateEventKeys: [], learnerIds: ['1'], family: 'SUPPORT', category: 'SUPPORT', startsAt: at(13), endsAt: at(14), phase: 'ended', match: 'external', readyToAction: true, media: { state: 'missing', readyCount: 0, recordings: [], check: { state: 'complete', checkedAt: at(15), reason: 'no-recordings-returned' } } },
];
const requests = [], writes = [], errors = [], external = [];
function api(url) {
  const p = url.pathname;
  if (p === '/login_api/me/') return { user: { id: 9999, email: 'preview@example.invalid', displayName: 'Demo Curriculum Designer', role: 'staff', subjectType: 'staff', subjectId: 9999, hasPassword: true, permissions: [], access: 'curriculum', accesses: ['curriculum'], accessWorkspaces: [{ access: 'curriculum', home: '/curriculum', navRole: 'curriculum' }] } };
  if (p.endsWith('/session-recordings/')) return library;
  if (p.includes('/calendar-matches/')) return { status: 'verified', start: url.searchParams.get('start'), end: url.searchParams.get('end'), timeZone: url.searchParams.get('timeZone'), mailbox: 'tutor@example.invalid', accounts: ['tutor@example.invalid'], matched: sessions.map(s => ({ moduleId: s.moduleId, occurrenceId: s.occurrenceId, title: s.title })), unmatched: [] };
  if (p.includes('/coaching-recordings/calendar')) return { start: url.searchParams.get('start'), end: url.searchParams.get('end'), timeZone: url.searchParams.get('timeZone'), scope: 'all', partial: false, errors: [], coaches: [{ email: 'coach@example.invalid', name: 'Demo Coach' }], learners: [{ id: '1', name: 'Demo Learner', coachEmail: 'coach@example.invalid', learnerType: 'apprenticeship' }], meetings: url.searchParams.has('directoryOnly') ? [] : meetings, lmsOnly: [], cancelledBookings: [], coverage: { checkedCoachEmails: ['coach@example.invalid'], totalCoaches: 1, nextOffset: null }, sync: { pending: false, pendingCalendars: 0, pendingEvidence: 0, lastSuccessfulAt: at(15), directoryHash: 'demo', directoryUnchanged: false } };
  if (p.includes('/coaching-recordings/session')) return { eventKey: url.searchParams.get('eventKey'), media, partial: false, evidence: { state: 'matched', source: 'coaching-session', transcript: { content: 'Demo Coach: Let us review this month’s learning goals.\nDemo Learner: I completed the marketing plan and applied it at work.', durationSeconds: 3600, updatedAt: at(15), source: 'microsoft' }, analyses: [], transcriptCheck: { state: 'available', code: 'available' } }, attendance: { state: 'available', reportCount: 1, rows: [{ name: 'Demo Learner', email: 'learner@example.invalid', role: 'learner', status: 'attended', totalAttendanceSeconds: 3420, firstJoinedAt: at(9), lastLeftAt: at(10) }] } };
  if (p.includes('/coaching-recordings/saved-evidence')) return { state: 'matched', source: 'coaching-session', transcript: { content: 'Demo Coach: Let us review this month’s learning goals.\nDemo Learner: I completed the marketing plan and applied it at work.', durationSeconds: 3600, updatedAt: at(15), source: 'microsoft' }, analyses: [], transcriptCheck: { state: 'available', code: 'available' } };
  if (p.includes('/day-results/')) return { date: url.searchParams.get('date'), timeZone: url.searchParams.get('timeZone'), reportReady: true, reportCount: 1, attendance: [{ name: 'Demo Learner', email: 'learner@example.invalid', seconds: 3420, expected: true, status: 'present', attendance: 1, excused: false, catchupCompleted: false }, { name: 'Demo Learner 2', email: 'learner2@example.invalid', seconds: 0, expected: true, status: 'absent', attendance: 0, excused: false, catchupCompleted: false }], staff: [], artifacts: [], unplacedFileCount: 0 };
  if (p.includes('/session-results/')) return { sessions: sessions.map((s, i) => ({ id: s.occurrenceId, seriesId: 'S1', sessionNumber: i + 1, startsAt: s.startsAt, endsAt: s.endsAt, title: s.title, state: 'ready', reportReady: true, attendance: [], artifacts: [{ id: `R${i + 1}`, type: 'recording', state: 'ready' }] })) };
  if (p.includes('/quality/')) return { reviews: [], forms: [], nextOffset: null };
  if (p.includes('/announcements')) return { announcements: [] };
  return {};
}

process.chdir(frontend);
await mkdir(`${dir}/raw`, { recursive: true });
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'production' }, `${frontend}/vite.config.ts`);
loaded.config.server = { host: '127.0.0.1', port: 3077, strictPort: true, proxy: {}, watch: null, hmr: false, fs: { allow: [root] } };
loaded.config.cacheDir = `${dir}/vite-cache`;
loaded.config.resolve.dedupe = ['react', 'react-dom', 'react-router-dom'];
loaded.config.optimizeDeps.include.push('react', 'react-dom/client', 'react-router-dom');
loaded.config.plugins.unshift({ name: 'tutorial-local-fixtures', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url, base), p = url.pathname;
    if (/^\/(?:[a-z_]+_api|api)(?:\/|$)/.test(p)) {
      requests.push(p); res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'GET') { writes.push({ method: req.method, path: p }); res.statusCode = 405; res.end('{}'); return; }
      res.end(JSON.stringify(api(url))); return;
    }
    if (p.startsWith('/curriculum/')) {
      res.setHeader('Content-Type', 'text/html');
      server.transformIndexHtml(p, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/recordings-help/preview.tsx"></script></body></html>').then(html => res.end(html)); return;
    }
    if (p.startsWith('/tutorial-files/')) {
      if (p.endsWith('/verification')) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Playback verification</title>'); return; }
      const filename = path.basename(p);
      if (!/^[a-z0-9-]+\.webm$/.test(filename)) { res.statusCode = 404; res.end(); return; }
      readFile(`${dir}/${filename}`).then(data => { res.setHeader('Content-Type', 'video/webm'); res.end(data); }).catch(() => { res.statusCode = 404; res.end(); }); return;
    }
    next();
  });
} });
const server = await createServer({ ...loaded.config, configFile: false, root: frontend });
let browser;
let recordingStart = 0, chapters = [], sceneNumber = 0, totalScenes = 0, title = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, check ? 80 : ms));
const btn = (page, name) => page.getByRole('button', { name, exact: true });
async function point(page, locator) {
  const target = locator.first(); await expect(target).toBeVisible();
  await target.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await pause(350);
  const box = await target.boundingBox();
  if (!box) throw Error('Missing pointer target');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: check ? 1 : 16 });
  await page.evaluate(({ x, y }) => {
    let cursor = document.getElementById('tutorial-cursor');
    if (!cursor) { cursor = document.createElement('div'); cursor.id = 'tutorial-cursor'; document.body.append(cursor); }
    Object.assign(cursor.style, { position: 'fixed', left: `${x - 16}px`, top: `${y - 16}px`, width: '32px', height: '32px', border: '3px solid #f6ad30', borderRadius: '50%', background: '#f6ad3022', boxShadow: '0 0 0 6px #f6ad3025', zIndex: '2147483646', pointerEvents: 'none', transition: 'left .25s,top .25s' });
  }, { x, y });
  await pause(450); return target;
}
async function click(page, locator) { const target = await point(page, locator); await target.click(); await pause(400); }
async function choose(page, name, label) {
  const trigger = page.getByRole('combobox', { name, exact: true });
  if (await trigger.evaluate(el => el.tagName === 'SELECT')) { await point(page, trigger); await trigger.selectOption({ label }); }
  else { await click(page, trigger); await click(page, page.getByRole('option', { name: label, exact: true })); }
}
async function caption(page, heading, text) {
  await page.evaluate(({ heading, text, title, n, total }) => {
    let panel = document.getElementById('tutorial-caption');
    if (!panel) { panel = document.createElement('aside'); panel.id = 'tutorial-caption'; document.body.append(panel); }
    Object.assign(panel.style, { position: 'fixed', bottom: '16px', left: '28px', right: '28px', zIndex: '2147483647', background: '#211333f7', border: '1px solid #a18ab9', borderRadius: '18px', padding: '16px 26px', color: '#fff', fontFamily: 'Tahoma,Arial,sans-serif', boxShadow: '0 8px 32px #0004', pointerEvents: 'none', direction: 'ltr' });
    const drawer = document.querySelector('aside[aria-label="Lecture details"], aside[role="dialog"]');
    if (drawer) panel.style.right = `${innerWidth - drawer.getBoundingClientRect().left + 24}px`;
    panel.replaceChildren();
    const meta = document.createElement('div'); meta.textContent = `${title}  •  Step ${n} of ${total}  •  DEMONSTRATION DATA`;
    Object.assign(meta.style, { fontSize: '14px', color: '#d5b9f6', marginBottom: '6px' });
    const h = document.createElement('div'); h.textContent = heading; Object.assign(h.style, { fontSize: '25px', fontWeight: '700', marginBottom: '6px' });
    const p = document.createElement('div'); p.textContent = text; Object.assign(p.style, { fontSize: '22px', lineHeight: '1.6' });
    panel.append(meta, h, p);
  }, { heading, text, title, n: sceneNumber, total: totalScenes });
}
async function scene(page, action) {
  sceneNumber++;
  const { title: heading, text } = english[currentId].chapters[sceneNumber - 1];
  const start = (Date.now() - recordingStart) / 1000;
  await caption(page, heading, text);
  await action?.();
  await caption(page, heading, text);
  if (errors.length) throw Error(errors.join('\n'));
  await page.screenshot({ path: `${dir}/raw/${currentId}-${sceneNumber}.jpg`, type: 'jpeg', quality: 75 });
  chapters.push({ start, title: heading, text });
  console.log(`${currentId}: ${sceneNumber}/${totalScenes} ${heading}`);
  await pause(Math.max(6500, text.split(/\s+/).length * 300));
}
let currentId;
const tutorials = [
  { id: 'recordings-hub', path: '/curriculum/recordings-hub', async play(page) {
    await scene(page, () => point(page, page.getByRole('heading', { name: 'Coach & Tutor Recordings', exact: true })));
    await scene(page, () => point(page, page.getByRole('link', { name: 'Tutor Session Recordings', exact: true })));
    await scene(page, async () => { await click(page, page.getByRole('link', { name: 'Tutor Session Recordings', exact: true })); await expect(page.getByRole('group', { name: 'Recordings view' })).toBeVisible(); } );
    await page.goto(base + '/curriculum/recordings-hub', { waitUntil: 'networkidle' });
    await scene(page, () => point(page, page.getByRole('link', { name: 'Coach Meetings & Recordings', exact: true })));
    await scene(page, async () => { await click(page, page.getByRole('link', { name: 'Coach Meetings & Recordings', exact: true })); await point(page, page.getByRole('combobox', { name: 'Coach', exact: true })); });
  } },
  { id: 'tutor-recordings', path: '/curriculum/recordings', async play(page) {
    await scene(page, () => point(page, page.getByRole('group', { name: 'Recordings view' })));
    await scene(page, async () => { await click(page, page.getByRole('group', { name: 'Calendar views', exact: true }).getByRole('button', { name: 'Week', exact: true })); });
    await scene(page, async () => { const input = page.getByPlaceholder('Search lectures by title, module or programme'); await point(page, input); await input.pressSequentially('Marketing', { delay: check ? 0 : 150 }); });
    await click(page, btn(page, 'Clear search')); await page.keyboard.press('Escape');
    await scene(page, async () => { await choose(page, 'Filter by programme', 'Level 4 Marketing'); await choose(page, 'Filter by recording status', 'All recordings'); await click(page, page.getByRole('button', { name: /More filters/ })); await point(page, page.getByRole('combobox', { name: 'Filter by cohort', exact: true })); });
    await scene(page, async () => { const event = page.getByRole('region', { name: 'Hourly lecture calendar', exact: true }).getByRole('button').first(); await click(page, event); await expect(page.getByRole('complementary', { name: 'Lecture details' })).toBeVisible(); });
    await scene(page, async () => { const details = page.getByRole('complementary', { name: 'Lecture details' }); await point(page, details.getByRole('button', { name: 'Play', exact: true })); await point(page, details.getByRole('button', { name: /Download/, exact: false }).first()); });
    await scene(page, async () => { await click(page, btn(page, 'View attendance & saved files')); await expect(page.getByText('Demo Learner', { exact: true })).toBeVisible(); await point(page, btn(page, 'Download attendance sheet')); });
    await scene(page, async () => { const details = page.getByRole('complementary', { name: 'Lecture details' }); await click(page, details.getByRole('button', { name: 'Transcript', exact: true })); await point(page, details.getByRole('button', { name: 'Open teaching quality check', exact: true })); });
    await click(page, btn(page, 'Close details panel'));
    await scene(page, async () => { await click(page, page.getByRole('button', { name: /All LMS modules/ })); const region = page.getByRole('region', { name: 'All LMS modules', exact: true }); await click(page, region.locator('summary').first()); });
    await scene(page, () => click(page, btn(page, 'Calendar')));
  } },
  { id: 'coach-meetings', path: `/curriculum/coaching-recordings?date=${date}`, async play(page) {
    await scene(page, async () => { await choose(page, 'Coach', 'Demo Coach'); await expect(page.getByRole('region', { name: 'Coach meeting calendar', exact: true })).toBeVisible(); });
    await scene(page, () => choose(page, 'Calendar period', 'Week'));
    await scene(page, () => choose(page, 'Meeting status', 'All meetings'));
    await scene(page, () => choose(page, 'Meeting type', 'MCM'));
    await scene(page, async () => { await choose(page, 'Learner', 'Demo Learner'); await point(page, page.getByRole('combobox', { name: 'LMS match', exact: true })); });
    await scene(page, async () => { await click(page, page.getByRole('button', { name: /^View Monthly Coaching Meeting/ }).first()); await expect(page.getByRole('dialog', { name: 'Meeting details', exact: true })).toBeVisible(); });
    await scene(page, () => click(page, page.getByRole('tab', { name: 'Overview', exact: true })));
    await scene(page, async () => { await click(page, page.getByRole('tab', { name: 'Recording', exact: true })); await point(page, page.getByRole('dialog', { name: 'Meeting details', exact: true }).getByRole('button', { name: /Play/ }).first()); });
    await scene(page, async () => { await click(page, page.getByRole('tab', { name: 'Attendance', exact: true })); await expect(page.getByRole('dialog').getByText('Demo Learner', { exact: true }).last()).toBeVisible(); });
    await scene(page, () => click(page, page.getByRole('tab', { name: 'Transcript', exact: true })));
    await scene(page, async () => { await click(page, page.getByRole('tab', { name: 'Quality check', exact: true })); await point(page, page.getByRole('dialog').getByRole('button', { name: /^Quality Check/ })); });
    await click(page, btn(page, 'Close meeting details'));
  } },
];

const stamp = n => { const ms = Math.round(n * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
for (const tutorial of tutorials) { tutorial.title = english[tutorial.id].title; tutorial.total = english[tutorial.id].chapters.length; }
const report = [];
const guides = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  // Warm the real frontend before recording, so dependency preparation is excluded.
  const warm = await browser.newPage();
  await warm.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await warm.goto(base + '/curriculum/recordings-hub', { waitUntil: 'networkidle' });
  await warm.close();
  for (const tutorial of tutorials.filter(t => !verifyOnly && (!only || only.split(',').includes(t.id)))) {
    currentId = tutorial.id; title = tutorial.title; totalScenes = tutorial.total; sceneNumber = 0; chapters = [];
    const context = await browser.newContext({ timezoneId: 'Europe/London', viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', ...(check ? {} : { recordVideo: { dir: `${dir}/raw`, size: { width: 1600, height: 1000 } } }) });
    await context.addInitScript(() => sessionStorage.setItem('recordings-help-hint-hidden', '1'));
    await context.route('**/*', route => { const u = new URL(route.request().url()); if (u.origin === base || ['data:', 'blob:'].includes(u.protocol)) return route.continue(); if (u.hostname.endsWith('.supabase.co') && route.request().resourceType() === 'image') return route.fulfill({ path: `${frontend}/public/kbc-logo.png`, contentType: 'image/png' }); external.push(u.origin); return route.abort(); });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date('2026-11-12T16:00:00Z'));
    page.on('pageerror', error => errors.push(error.message));
    const videoStarted = Date.now();
    try {
      await page.goto(base + tutorial.path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await pause(800);
      recordingStart = Date.now(); const trimStart = (recordingStart - videoStarted) / 1000;
      await tutorial.play(page);
      if (chapters.length !== english[currentId].chapters.length) throw Error('Chapter count does not match catalog');
      const duration = (Date.now() - recordingStart) / 1000;
      const video = page.video();
      await context.close();
      if (!check) {
        const source = await video.path();
        await run(ffmpeg, ['-y', '-i', source, '-ss', String(trimStart), '-t', String(duration), '-an', '-c:v', 'libvpx', '-b:v', '1800k', '-deadline', 'realtime', '-cpu-used', '5', `${dir}/${tutorial.id}.webm`], { windowsHide: true, maxBuffer: 3 * 1024 * 1024 });
        await writeFile(`${dir}/${tutorial.id}.vtt`, 'WEBVTT\n\n' + chapters.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(chapters[i + 1]?.start ?? duration)}\n${c.title}\n${c.text}`).join('\n\n') + '\n');
        await copyFile(`${dir}/raw/${tutorial.id}-1.jpg`, `${dir}/${tutorial.id}.jpg`);
      }
      report.push({ id: tutorial.id, title, passed: true, duration, chapters });
    } catch (error) {
      await page.screenshot({ path: `${dir}/${tutorial.id}-failed.png` }).catch(() => {});
      await writeFile(`${dir}/${tutorial.id}-failed.txt`, await page.locator('body').innerText().catch(() => ''));
      report.push({ id: tutorial.id, passed: false, error: error.stack });
      console.error(error.stack); await context.close(); break;
    }
  }
  if (!check && !verifyOnly && report.every(t => t.passed)) {
    const verify = await browser.newPage();
    for (const item of report) {
      await verify.goto(`${base}/tutorial-files/verification`, { waitUntil: 'domcontentloaded' });
      item.playback = await verify.evaluate(async source => {
        const video = document.createElement('video'); video.muted = true; video.src = source; document.body.replaceChildren(video);
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(Error('Cannot decode WebM')); });
        const metadata = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
        await video.play(); await new Promise(resolve => setTimeout(resolve, 700)); video.pause();
        if (video.currentTime <= 0) throw Error('Video does not advance');
        const seeked = new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
        video.currentTime = Math.max(0, video.duration - 1);
        await seeked;
        return { ...metadata, decodedStartAndEnd: true };
      }, `${base}/tutorial-files/${item.id}.webm`);
      if (item.playback.width !== 1600 || item.playback.height !== 1000 || item.playback.duration < 20) throw Error('Invalid video dimensions or duration');
      item.bytes = (await stat(`${dir}/${item.id}.webm`)).size;
      console.log(`VERIFIED ${item.id} ${JSON.stringify(item.playback)}`);
    }
    await verify.close();
    if (publish) {
      await mkdir(output, { recursive: true });
      for (const item of report) for (const ext of ['webm', 'jpg', 'vtt']) await copyFile(`${dir}/${item.id}.${ext}`, `${output}/${item.id}.${ext}`);
      const timingsPath = `${frontend}/src/pages/curriculum/recordings/help/tutorialTimings.json`;
      const timings = JSON.parse(await readFile(timingsPath, 'utf8'));
      for (const item of report) timings[item.id] = item.chapters.map(chapter => chapter.start);
      await writeFile(timingsPath, JSON.stringify(timings, null, 2) + '\n');
    }
  }
  if (verifyOnly) {
    const timings = JSON.parse(await readFile(`${frontend}/src/pages/curriculum/recordings/help/tutorialTimings.json`, 'utf8'));
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
        external.push(url.origin); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      for (const tutorial of catalog) {
        await page.goto(base + tutorial.path, { waitUntil: 'networkidle' });
        const launcher = page.getByRole('button', { name: `Watch ${tutorial.title} page guide`, exact: true });
        await launcher.click();
        const dialog = page.getByRole('dialog', { name: tutorial.title, exact: true });
        await expect(dialog).toBeVisible();
        const video = dialog.locator('video');
        await expect.poll(() => video.evaluate(el => el.readyState)).toBeGreaterThanOrEqual(1);
        const duration = await video.evaluate(el => el.duration);
        await expect(video.locator('source')).toHaveAttribute('src', `/help/recordings/v2/${tutorial.id}.webm`);
        await expect(dialog.getByRole('link', { name: 'Download video', exact: true })).toHaveAttribute('href', `/help/recordings/v2/${tutorial.id}.webm`);
        const cues = await readFile(`${output}/${tutorial.id}.vtt`, 'utf8');
        expect(timings[tutorial.id]).toHaveLength(tutorial.chapters.length);
        for (const [index, chapter] of tutorial.chapters.entries()) {
          const time = timings[tutorial.id][index];
          expect(time).toBeLessThan(duration);
          if (index) expect(time).toBeGreaterThan(timings[tutorial.id][index - 1]);
          expect(cues).toContain(`${stamp(time)} --> `);
          expect(cues).toContain(chapter.text);
          await dialog.getByRole('button').filter({ has: page.getByText(chapter.title, { exact: true }) }).click();
          await expect.poll(() => video.evaluate(el => el.currentTime)).toBeCloseTo(time, 1);
          await expect(video).toHaveJSProperty('seeking', false);
        }
        await video.evaluate(async el => { el.muted = true; el.currentTime = 0; await el.play(); });
        await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(0.2);
        await video.evaluate(el => el.pause());
        await page.screenshot({ path: `${dir}/${tutorial.id}-player-${width}-${theme}.png` });
        const box = await dialog.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        await dialog.getByRole('button', { name: 'Close page guide', exact: true }).click();
        await expect(launcher).toBeFocused();
        guides.push({ id: tutorial.id, width, theme, chapters: tutorial.chapters.length, duration, passed: true });
        console.log(`PASS guide ${tutorial.id}: ${width}px ${theme}, ${tutorial.chapters.length} chapters, playback and focus`);
      }
      await context.close();
    }
  }
} finally {
  await browser?.close(); await server.close();
  await writeFile(`${dir}/${verifyOnly ? 'verification' : check ? 'preflight' : 'report'}.json`, JSON.stringify({ videos: report, guides, errors, writes, externalBlocked: [...new Set(external)], requests: [...new Set(requests)], syntheticDataOnly: true, liveBackend: false }, null, 2));
}
if (report.some(t => !t.passed) || errors.length || writes.length) process.exitCode = 1;
