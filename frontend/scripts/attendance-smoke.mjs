// Offline browser smoke: run Vite on port 5184 or set ATTENDANCE_SMOKE_URL. All API calls are mocked.
import { chromium } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const row = {
  id: 'lecture-1', sessionId: 'legacy-1', reportId: '8000000000000000001', title: 'Introduction to Business Strategy',
  date: '2026-09-01', moduleId: 'legacy:business', module: 'Business Strategy and Innovation', source: 'kbc-attendance',
  startTime: '10:00', endTime: '11:00', durationMinutes: 60, contentSummary: 'Key strategic models and the business environment.',
  ksbs: ['K1', 'S1', 'B1', 'K18', 'S14', 'K25', 'K99'], status: 'completed', catchupStatus: null, updatedAt: null,
  canReportAbsence: false, absenceReport: null,
  monthlyLog: { month: '2026-08', sourceRef: 'att:legacy-1' },
  activities: [{ id: 'activity-1', title: 'Lecture recording', type: 'video', completed: true, href: '/learner/component/apprenticeship/12/comp-1' }],
};
const payload = {
  lectures: [row,
    { ...row, id: 'lecture-2', title: 'Innovation and Change Management', status: 'absent', catchupStatus: 'pending', canReportAbsence: true },
    { ...row, id: 'lecture-3', title: 'Leadership in a Digital Era', date: '2026-10-01', status: 'upcoming', canReportAbsence: true },
    { ...row, id: 'lecture-4', title: 'Sustainability and Ethics in Business', moduleId: 'native:ethics', module: 'Sustainability and Ethics', status: 'absent', catchupStatus: 'completed', ksbScope: 'module' },
    ...Array.from({ length: 58 }, (_, index) => ({ ...row, id: `history-${index}`, date: new Date(Date.UTC(2025, 5, 16 + index * 7)).toISOString().slice(0, 10),
      title: `L${index + 1}: ${['Introduction to Procurement Risk and Contract Management', 'Fundamentals of Contracts and Procurement', 'Measuring Contract Performance, Relationship and Contractor Management'][index % 3]}`,
      module: 'Procurement Risk and Contract Management', startTime: '', endTime: '' }))],
  totals: { total: 62, attended: 59, absent: 2, covered: 1, upcoming: 1, attendanceRate: 33 },
  modules: [{ id: 'legacy:business', title: row.module }, { id: 'native:ethics', title: 'Sustainability and Ethics' }],
  summary: { learnerName: 'Alex Smith' },
  mode: { available: true, mode: 'live', requestedMode: null, status: 'active', emailSent: false, managerAvailable: true, remindersEnabled: true, updatedAt: null, plannedLiveHours: 1, plannedRecordedHours: 0 },
  recentActivity: [{ id: 'recent-1', title: 'Lecture recording completed', at: '2026-09-12T10:00:00Z', type: 'activity' }],
};

const log = { source: 'legacy', month: '2026-08', status: 'complete', row_count: 1,
  actual_hours: 1, planned_hours: 1, not_accepted_hours: 0, pending_revisions: 0, can_complete: false,
  student_signature: null, coach_signature: null, source_finalization: null, snapshot_digest: 'fixture',
  rows: [{ id: 44, title: row.title, category: 'Attendance', source_ref: 'att:legacy-1', activity_date: '2026-08-31',
    activity_time: '10:00', timestamp_label: '10:00', actual_hours: 1, planned_hours: 1,
    accepted: true, completion_note: null, documents: [], results: [] }] };

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
  if (!url.pathname.includes('_api/') && !url.pathname.startsWith('/api/')) return route.continue();
  let body = { results: [], count: 0 };
  if (url.pathname === '/login_api/me/') body = { user: { id: 1, email: 'learner@example.test', displayName: 'Alex Smith', role: 'learner', subjectType: 'learner', subjectId: 12, learnerType: 'apprenticeship', hasPassword: true, lastLoginAt: null, permissions: [], hasLegacyRecord: false } };
  else if (url.pathname.endsWith('/lectures/')) body = payload;
  else if (url.pathname === '/learner_api/monthly-logs/12/') body = {
    learner: { id: 12, name: 'Alex Smith', programme: 'Business', coach_name: 'Coach' },
    months: [log], total_months: 1, completed_months: 1, read_only: true, csrf_token: 'fixture',
  };
  else if (url.pathname === '/learner_api/monthly-logs/12/2026-08/') body = log;
  else if (url.pathname === '/learner_api/monthly-logs/12/2026-08/activities/44/') body = {
    id: 44, parts: [{ id: 44, title: 'Attendance source', category: 'Attendance', url: null, quiz: null, html: '<p>Original attendance material</p>' }],
  };
  else if (/learner-(summary|detail)/.test(url.pathname)) body = { id: '12', name: 'Alex Smith', email: 'learner@example.test', learnerType: 'apprenticeship', programmeStatus: 'Active', status: 'Active', programme: 'Business', isActive: true, modules: [], components: [], activityFeed: [], photo: null };
  else if (url.pathname.includes('/profile-photo/')) body = { url: null };
  else if (url.pathname.includes('/absence-reports/')) body = { results: [], missedSessions: payload.lectures.filter(item => item.canReportAbsence).map(item => ({ ...item, dateIso: item.date, sessionType: 'live_session', coach: '' })) };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

try {
  await page.goto(process.env.ATTENDANCE_SMOKE_URL || 'http://127.0.0.1:5184/learner/attendance');
  await page.getByRole('button', { name: 'October 2026', exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('article').count(), 1);
  await page.getByRole('button', { name: 'September 2026', exact: true }).click();
  assert.equal(await page.getByRole('article').count(), 4);
  await page.getByText('62 lectures · 16 months').waitFor();
  await page.getByText('Module KSBs', { exact: true }).waitFor();
  const firstLecture = page.getByRole('article', { name: 'Introduction to Business Strategy', exact: true });
  assert.equal(await firstLecture.getByText('K99', { exact: true }).count(), 0);
  await firstLecture.getByRole('button', { name: /Show all 7 KSBs/ }).click();
  await firstLecture.getByText('K99', { exact: true }).waitFor();
  await firstLecture.getByRole('button', { name: /Show fewer KSBs/ }).click();
  await page.getByRole('button', { name: 'September 2026', exact: true }).click();
  await page.getByRole('heading', { name: 'Attendance', exact: true }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-desktop.png'), fullPage: true, animations: 'disabled' });
  const upcoming = page.getByRole('article', { name: 'Leadership in a Digital Era', exact: true });
  await upcoming.getByRole('button', { name: 'Report absence' }).click();
  await page.getByLabel('Lecture *').waitFor();
  assert.equal(await page.getByLabel('Lecture *').inputValue(), 'lecture-3');
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-absence.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Module', { exact: true }).selectOption('native:ethics');
  assert.equal(await page.getByRole('article').count(), 1);
  await page.getByLabel('Module', { exact: true }).selectOption('all');
  const september = page.getByRole('button', { name: 'September 2026', exact: true });
  if (await september.getAttribute('aria-expanded') === 'false') await september.click();
  await firstLecture.getByRole('button', { name: 'Open Activities', exact: true }).click();
  await page.waitForURL('**/learner/monthly-logs/apprenticeship/12/2026-08?source=att%3Alegacy-1');
  await page.getByRole('region', { name: `Content for ${row.title}`, exact: true }).waitFor();
  await page.locator('iframe[title="Attendance source"]').waitFor();
  assert.equal(await page.getByRole('button', { name: row.title, exact: true }).getAttribute('aria-expanded'), 'true');
  await page.goBack();
  await page.getByRole('button', { name: 'Expand all months', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Expand all months', exact: true }).click();
  assert.equal(await page.getByRole('article').count(), 62);
  await page.getByRole('button', { name: 'Collapse all months', exact: true }).click();
  assert.equal(await page.getByRole('article').count(), 0);
  await page.getByLabel('Search lectures', { exact: true }).fill('K99');
  assert.equal(await page.getByRole('article').count(), 62);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByLabel('Month', { exact: true }).selectOption('2026-09');
  assert.equal(await page.getByRole('article').count(), 3);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('heading', { name: 'Attendance', exact: true }).last().scrollIntoViewIfNeeded();
  for (const width of [1920, 1440, 1280, 1024, 768, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `Page should not overflow at ${width}px.`);
    const rowOverflow = await page.getByRole('article').evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth));
    assert.equal(rowOverflow, false, `Lecture content should fit at ${width}px.`);
    if (width === 390 || width === 1440) await page.screenshot({ path: join(tmpdir(), `lms-attendance-${width === 390 ? 'mobile' : 'laptop'}.png`), fullPage: true, animations: 'disabled' });
    if (width === 390) {
      await page.getByRole('article').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(tmpdir(), 'lms-attendance-mobile-list.png'), animations: 'disabled' });
    }
  }
  const monthToggle = page.getByRole('button', { name: 'September 2026', exact: true });
  await monthToggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await monthToggle.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Space');
  assert.equal(await monthToggle.getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.getByRole('heading', { name: 'Attendance', exact: true }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-dark.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots: ['desktop', 'laptop', 'absence', 'mobile', 'mobile-list', 'dark'].map(name => join(tmpdir(), `lms-attendance-${name}.png`)) }));
} finally { await browser.close(); }
