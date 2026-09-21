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
  tutor: 'Alex Morgan', coach: 'Sam Taylor',
  ksbs: ['K1', 'S1', 'B1', 'K18', 'S14', 'K25', 'K99'], status: 'completed', catchupStatus: null, updatedAt: null,
  canReportAbsence: false, absenceReport: null,
  monthlyLog: { month: '2026-08', sourceRef: 'att:legacy-1' },
  activities: [{ id: 'activity-1', title: 'Lecture recording', type: 'video', completed: true, href: '/learner/component/apprenticeship/12/comp-1' }],
};
const payload = {
  timeZone: 'Europe/London', csrfToken: 'fixture-csrf',
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
  recentActivity: [
    { id: 'recent-1', title: 'Opened module activities: Business Strategy and Innovation', at: '2026-09-12T10:00:00Z', type: 'activity' },
    { id: 'recent-2', title: 'Reported absence: Innovation and Change Management', at: '2026-09-11T09:15:00Z', type: 'absence' },
    { id: 'recent-3', title: 'Support session booked', at: '2026-09-10T11:30:00Z', type: 'support' },
    { id: 'recent-4', title: 'Attendance mode changed', at: '2026-09-09T08:00:00Z', type: 'mode' },
    { id: 'recent-5', title: 'Lecture recording completed', at: '2026-09-08T13:45:00Z', type: 'activity' },
    { id: 'recent-6', title: 'Historical attendance recorded', at: '2026-09-07T10:00:00Z', type: 'attendance' },
  ],
};

const log = { source: 'legacy', month: '2026-08', status: 'complete', row_count: 1,
  actual_hours: 1, planned_hours: 1, not_accepted_hours: 0, pending_revisions: 0, can_complete: false,
  student_signature: null, coach_signature: null, source_finalization: null, snapshot_digest: 'fixture',
  rows: [{ id: 44, title: row.title, category: 'Attendance', source_ref: 'att:legacy-1', activity_date: '2026-08-31',
    activity_time: '10:00', timestamp_label: '10:00', actual_hours: 1, planned_hours: 1,
    accepted: true, completion_note: null, documents: [], results: [] }] };

const bookingDay = new Date();
bookingDay.setDate(bookingDay.getDate() + 45);
while ([0, 6].includes(bookingDay.getDay())) bookingDay.setDate(bookingDay.getDate() + 1);
const bookingDate = `${bookingDay.getFullYear()}-${String(bookingDay.getMonth() + 1).padStart(2, '0')}-${String(bookingDay.getDate()).padStart(2, '0')}`;
let bookedCatchup = null;
const absencePosts = [];
const attendancePosts = [];

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
  if (!url.pathname.includes('_api/') && !url.pathname.startsWith('/api/')) return route.continue();
  let body = { results: [], count: 0 };
  if (url.pathname === '/login_api/me/') body = { user: { id: 1, email: 'learner@example.test', displayName: 'Alex Smith', role: 'learner', subjectType: 'learner', subjectId: 12, learnerType: 'apprenticeship', hasPassword: true, lastLoginAt: null, permissions: [], hasLegacyRecord: false } };
  else if (url.pathname === '/login_api/learner-entry/') body = { classification: 'new', required: false, canAccess: true };
  else if (url.pathname.endsWith('/lectures/')) body = payload;
  else if (url.pathname.endsWith('/attend/')) {
    const input = route.request().postDataJSON();
    assert.equal(route.request().headers()['x-csrftoken'], 'fixture-csrf');
    attendancePosts.push(input);
    const lecture = payload.lectures.find(item => item.id === input.lectureId);
    lecture.status = 'completed'; lecture.attendanceConfirmed = true;
    lecture.creditedMinutes = lecture.durationMinutes; lecture.canReportAbsence = false;
    body = { lectureId: lecture.id, status: 'completed', creditedMinutes: lecture.durationMinutes,
      creditedHours: lecture.durationMinutes / 60, alreadyRecorded: false };
  }
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
  else if (url.pathname === '/learner_api/calendar/apprenticeship/12/') body = { learner: { kind: 'apprenticeship', id: 12 }, events: bookedCatchup ? [bookedCatchup] : [] };
  else if (url.pathname === '/learner_api/calendar/apprenticeship/12/book/') {
    const input = route.request().postDataJSON();
    assert.equal(input.sessionType, 'catch-up');
    bookedCatchup = { id: 'catch-up:12:1', eventKey: 'catch-up:12:1', source: 'catch-up', title: 'Catch-up Session',
      status: 'not-scheduled', scheduledDate: input.scheduledDate, scheduledTime: input.scheduledTime,
      durationMinutes: input.durationMinutes, coachName: 'Coach', notes: input.notes };
    body = { event: bookedCatchup, approvalRequired: true };
  }
  else if (url.pathname.includes('/absence-reports/')) {
    if (route.request().method() === 'POST') {
      absencePosts.push(route.request().postData());
      assert.ok(bookedCatchup, 'An actual saved booking must precede the absence submission.');
      body = { id: 1, reference: 'AR-0001', sessionTitle: 'Leadership in a Digital Era', sessionDate: '2026-10-01', status: 'pending', recoveryMethod: 'catch-up', catchupEventKey: bookedCatchup.eventKey };
    } else body = { results: [], missedSessions: payload.lectures.filter(item => item.canReportAbsence).map(item => ({ ...item, dateIso: item.date, sessionType: 'live_session', coach: '' })) };
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

try {
  await page.goto(process.env.ATTENDANCE_SMOKE_URL || 'http://127.0.0.1:5184/learner/attendance');
  await page.getByRole('article').first().waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('article').count(), 62);
  const nextCard = page.getByRole('region', { name: 'Leadership in a Digital Era', exact: true });
  assert.equal(await nextCard.getByRole('button', { name: 'Attend', exact: true }).isDisabled(), true);
  await nextCard.getByRole('button', { name: 'Report Absence', exact: true }).click();
  await page.getByLabel('Lecture *').waitFor();
  assert.equal(await page.getByLabel('Lecture *').inputValue(), 'lecture-3');
  await page.getByRole('button', { name: 'Close absence report' }).click();
  await page.getByRole('article', { name: 'Innovation and Change Management', exact: true }).getByRole('button', { name: 'Book Catchup Session' }).click();
  await page.getByRole('dialog', { name: 'Book Catchup Session' }).waitFor();
  await page.getByLabel('Catch-up date').waitFor();
  await page.getByRole('button', { name: 'Close catch-up booking' }).click();
  assert.equal(await page.getByText('Historical attendance recorded', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'View all', exact: false }).click();
  await page.getByText('Historical attendance recorded', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Show less/ }).click();
  await page.getByRole('button', { name: 'Group by month', exact: true }).click();
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
  await page.getByRole('button', { name: 'Group by month', exact: true }).click();
  await page.getByRole('heading', { name: 'Attendance', exact: true }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-desktop.png'), fullPage: true, animations: 'disabled' });
  const upcoming = page.getByRole('article', { name: 'Leadership in a Digital Era', exact: true });
  Object.assign(payload.lectures.find(item => item.id === 'lecture-3'), {
    startsAt: new Date(Date.now() + 2_000).toISOString(), endsAt: new Date(Date.now() + 5_000).toISOString(),
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/attendance-fixture',
  });
  const refresh = page.waitForResponse(response => response.url().endsWith('/lectures/'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refresh;
  await upcoming.getByRole('link', { name: 'Join session', exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await upcoming.getByRole('link', { name: 'Join session' }).getAttribute('href'), 'https://teams.microsoft.com/l/meetup-join/attendance-fixture');
  await upcoming.getByRole('button', { name: 'Open Activities', exact: true }).waitFor({ timeout: 10000 });
  await upcoming.getByRole('button', { name: 'Report Absence' }).click();
  await page.getByLabel('Lecture *').waitFor();
  assert.equal(await page.getByLabel('Lecture *').inputValue(), 'lecture-3');
  const dialog = page.getByRole('dialog', { name: 'Report Absence', exact: true });
  assert.equal(await dialog.isVisible(), true);
  await page.getByLabel('Main reason', { exact: true }).selectOption('illness');
  await page.getByRole('radio', { name: 'Watch the recording', exact: true }).check();
  await page.getByRole('checkbox').check();
  assert.equal(await page.getByRole('button', { name: 'Submit absence report' }).isEnabled(), true);
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-absence.png'), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(await upcoming.getByRole('button', { name: 'Report Absence' }).evaluate(element => element === document.activeElement), true);
  await upcoming.getByRole('button', { name: 'Report Absence' }).click();
  await page.getByLabel('Main reason', { exact: true }).selectOption('illness');
  await page.getByRole('radio', { name: 'Book a Catch-up session', exact: true }).check();
  await page.getByRole('checkbox').check();
  assert.equal(await page.getByRole('button', { name: 'Submit absence report' }).isDisabled(), true);
  await page.getByLabel('Catch-up date', { exact: true }).fill(bookingDate);
  await page.getByLabel('Catch-up time', { exact: true }).fill('11:00');
  await page.getByRole('button', { name: 'Book Catch-up Session', exact: true }).click();
  await page.getByText(/Catch-up request saved/).waitFor();
  assert.equal(absencePosts.length, 0);
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-catchup.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Submit absence report' }).click();
  await page.getByText(/has been saved for your coach to review/).waitFor();
  assert.equal(absencePosts.length, 1);
  assert.ok(absencePosts[0].includes('catchupEventKey') && absencePosts[0].includes('catch-up:12:1'));
  await page.getByRole('button', { name: 'Close absence report', exact: true }).click();
  await page.getByLabel('Module', { exact: true }).selectOption('native:ethics');
  assert.equal(await page.getByRole('article').count(), 1);
  await page.getByLabel('Module', { exact: true }).selectOption('all');
  await firstLecture.getByRole('button', { name: 'Open Activities', exact: true }).click();
  await page.waitForURL('**/learner/monthly-logs/apprenticeship/12/2026-08?source=att%3Alegacy-1');
  await page.getByRole('region', { name: `Content for ${row.title}`, exact: true }).waitFor();
  await page.locator('iframe[title="Attendance source"]').waitFor();
  assert.equal(await page.getByRole('button', { name: row.title, exact: true }).getAttribute('aria-expanded'), 'true');
  await page.goBack();
  await page.getByRole('button', { name: 'Group by month', exact: true }).click();
  await page.getByRole('button', { name: 'Expand all months', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Expand all months', exact: true }).click();
  assert.equal(await page.getByRole('article').count(), 62);
  await page.getByRole('button', { name: 'Collapse all months', exact: true }).click();
  assert.equal(await page.getByRole('article').count(), 0);
  await page.getByText('Search & filters', { exact: true }).click();
  await page.getByLabel('Search lectures', { exact: true }).fill('K99');
  assert.equal(await page.getByRole('article').count(), 62);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByLabel('Month', { exact: true }).selectOption('2026-09');
  assert.equal(await page.getByRole('article').count(), 3);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('button', { name: 'Group by month', exact: true }).click();
  await page.getByText('Search & filters', { exact: true }).click();
  await page.getByRole('heading', { name: 'Attendance', exact: true }).last().scrollIntoViewIfNeeded();
  for (const width of [1920, 1440, 1280, 1024, 768, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `Page should not overflow at ${width}px.`);
    const rowOverflow = await page.getByRole('article').evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth));
    assert.equal(rowOverflow, false, `Lecture content should fit at ${width}px.`);
    if (width >= 1280) {
      const main = await page.locator('[class*="_mainColumn_"]').boundingBox();
      const sidebar = await page.locator('aside[class*="_sidebar_"]').boundingBox();
      assert.ok(Math.abs(main.width / (main.width + sidebar.width) - .74) < .01, `Workspace should keep the 74:26 ratio at ${width}px.`);
      assert.ok(Math.abs(main.y - sidebar.y) < 1, 'Overview and sidebar should start on the same line.');
    }
    if (width === 390 || width === 1440) await page.screenshot({ path: join(tmpdir(), `lms-attendance-${width === 390 ? 'mobile' : 'laptop'}.png`), fullPage: width !== 390, animations: 'disabled' });
    if (width === 390) {
      await page.getByRole('article').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(tmpdir(), 'lms-attendance-mobile-list.png'), animations: 'disabled' });
    }
  }
  await page.getByRole('button', { name: 'Group by month', exact: true }).click();
  const monthToggle = page.getByRole('button', { name: 'September 2026', exact: true });
  await monthToggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await monthToggle.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Space');
  assert.equal(await monthToggle.getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  Object.assign(payload.lectures.find(item => item.id === 'lecture-3'), {
    date: today, startTime: '10:00', endTime: '12:00', startsAt: null, endsAt: null, durationMinutes: 120,
    joinUrl: '', status: 'upcoming', canReportAbsence: true,
  });
  await page.reload();
  const todayCard = page.getByRole('region', { name: 'Leadership in a Digital Era', exact: true });
  await todayCard.getByRole('button', { name: 'Attend', exact: true }).waitFor();
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-today.png'), fullPage: true });
  await todayCard.getByRole('button', { name: 'Attend', exact: true }).click();
  await todayCard.getByText(/2 hours credited/).first().waitFor();
  assert.equal(await todayCard.getByRole('button', { name: 'Attended', exact: true }).isDisabled(), true);
  assert.equal(attendancePosts.length, 1);
  await page.reload();
  await todayCard.getByRole('button', { name: 'Attended', exact: true }).waitFor();
  assert.equal(attendancePosts.length, 1);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.getByRole('heading', { name: 'Attendance', exact: true }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-dark.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots: ['desktop', 'laptop', 'absence', 'mobile', 'mobile-list', 'dark'].map(name => join(tmpdir(), `lms-attendance-${name}.png`)) }));
} catch (error) {
  console.error(JSON.stringify({ url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 2500) }));
  await page.screenshot({ path: join(tmpdir(), 'lms-attendance-failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
