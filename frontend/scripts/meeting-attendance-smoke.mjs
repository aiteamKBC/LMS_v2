// Local browser verification with intercepted APIs; no live bookings or attendance writes.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const today = '2026-09-14';
const syncWarning = 'Your meeting time is saved in the LMS calendar, but Microsoft calendar access needs administrator approval.';
const events = ['mcr', 'progress-review'].flatMap(source => [
  { id: `${source}-today`, eventKey: `${source}-today`, title: source === 'mcr' ? 'Monthly Coaching Meeting' : 'Progress Review',
    source, type: source === 'mcr' ? 'coaching' : 'review', sequence: 1, status: 'scheduled', date: today, targetDate: today,
    scheduledDate: today, scheduledTime: '10:00', durationMinutes: 90, coachName: 'Alex Morgan', coachEmail: 'coach@example.test',
    meetingLink: source === 'mcr' ? 'https://teams.microsoft.com/meet/fixture' : '', meetingProvider: 'Microsoft Teams', notes: '',
    invited: source === 'mcr', syncWarning: source === 'mcr' ? '' : syncWarning },
  { id: `${source}-next`, eventKey: `${source}-next`, title: 'Next meeting', source, type: 'coaching', sequence: 2, status: 'not-scheduled',
    date: '2026-10-14', targetDate: '2026-10-14', scheduledDate: null, scheduledTime: null, durationMinutes: 60, coachName: 'Alex Morgan', coachEmail: '', meetingLink: '', meetingProvider: '', notes: '' },
]);
const states = events.map(event => ({ id: event.id, title: event.title, date: event.scheduledDate, startTime: event.scheduledTime,
  durationMinutes: event.durationMinutes, meetingLink: event.meetingLink, meetingProvider: event.meetingProvider,
  invited: event.invited, syncWarning: event.syncWarning, calendarEventKey: event.eventKey,
  canAttend: event.status === 'scheduled', attendanceConfirmed: false, creditedMinutes: null,
  canReportAbsence: event.status === 'scheduled', absenceReported: false, absenceSessionId: `meeting:12:${event.id}-${today}`, missed: false }));
const posts = [];
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
  if (!url.pathname.includes('_api/') && !url.pathname.startsWith('/api/')) return route.continue();
  let body = { results: [], count: 0 };
  if (url.pathname === '/login_api/me/') body = { user: { id: 1, email: 'learner@example.test', displayName: 'Sam Taylor', role: 'learner', subjectType: 'learner', subjectId: 12, learnerType: 'apprenticeship', hasPassword: true, permissions: [], hasLegacyRecord: false } };
  else if (url.pathname === '/login_api/learner-entry/') body = { classification: 'new', required: false, canAccess: true };
  else if (/learner-(detail|summary)/.test(url.pathname)) body = { id: '12', name: 'Sam Taylor', email: 'learner@example.test', programme: 'Business Management', programmeStatus: 'Active', status: 'Active', isActive: true, lineManager: 'Jordan Smith', modules: [], components: [], activityFeed: [] };
  else if (url.pathname.includes('/profile-photo/')) body = { url: null };
  else if (url.pathname.includes('/calendar-connections/')) body = { connections: [], busy: [], errors: [], connectedProviders: [] };
  else if (url.pathname.endsWith('/coach/')) body = { coachName: 'Alex Morgan', coachEmail: 'coach@example.test' };
  else if (url.pathname.endsWith('/artifacts/')) body = { artifacts: [], attendance: null, meetingSummary: null, errors: [] };
  else if (url.pathname.endsWith('/attend/')) {
    const payload = route.request().postDataJSON(); posts.push(payload);
    assert.equal(route.request().headers()['x-csrftoken'], 'fixture');
    const state = states.find(item => item.id === payload.meetingId);
    Object.assign(state, { attendanceConfirmed: true, canAttend: false, canReportAbsence: false, creditedMinutes: 90 });
    body = { creditedMinutes: 90, alreadyRecorded: false };
  }
  else if (url.pathname.includes('/meeting-attendance/')) body = { sessions: states, today, timeZone: 'Europe/London', csrfToken: 'fixture' };
  else if (url.pathname.includes('/calendar/')) body = { events };
  else if (url.pathname.includes('/absence-reports/')) body = { results: [], missedSessions: states.filter(item => item.canReportAbsence).map(item => ({ id: item.absenceSessionId, sessionId: `meeting:12:${item.id}`, title: item.title, dateIso: item.date, startTime: '10:00', endTime: '11:30', coach: 'Alex Morgan', module: '', sessionType: 'mcr' })) };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
try {
  for (const [path, source] of [['monthly-coaching', 'mcr'], ['progress-reviews', 'progress-review']]) {
    await page.goto(`http://127.0.0.1:5184/learner/${path}`);
    await page.getByRole('button', { name: 'Attend', exact: true }).waitFor({ timeout: 60000 });
    const card = page.locator('section').filter({ has: page.getByRole('button', { name: 'Attend', exact: true }) }).last();
    assert.equal(await card.getByText('10:00 – 11:30', { exact: true }).count(), 1);
    await card.getByRole('button', { name: 'Report Absence', exact: true }).click();
    await page.getByLabel('Meeting *', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Meeting *', { exact: true }).inputValue(), `meeting:12:${source}-today-${today}`);
    assert.equal(await page.getByText('Watch the recording', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Close absence report' }).click();
    await card.getByRole('button', { name: 'Reschedule', exact: true }).click();
    const reschedule = page.getByRole('dialog', { name: source === 'mcr' ? 'Reschedule monthly coaching' : 'Reschedule progress review' });
    await reschedule.waitFor();
    assert.ok(new URL(page.url()).pathname === `/learner/${path}`);
    assert.equal(await reschedule.getByLabel('Day', { exact: true }).inputValue(), today);
    assert.equal(await reschedule.getByLabel('Time', { exact: true }).inputValue(), '10:00');
    assert.equal(await reschedule.getByLabel('Session', { exact: true }).inputValue(), `${source}-today`);
    await page.getByRole('button', { name: 'Close booking dialog' }).click();
    assert.ok(await card.getByRole('button', { name: 'Reschedule', exact: true }).evaluate(element => element === document.activeElement));
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    const booking = page.getByRole('dialog', { name: source === 'mcr' ? 'Book monthly coaching' : 'Book progress review' });
    await booking.waitFor();
    await booking.getByRole('button', { name: 'Book session', exact: true }).waitFor();
    assert.equal(await booking.getByLabel('Session', { exact: true }).inputValue(), `${source}-next`);
    for (const width of [1440, 510, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      const bounds = await booking.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${path} dialog overflows at ${width}`);
      await page.screenshot({ path: join(tmpdir(), `lms-${path}-booking-${width}.png`), fullPage: true });
    }
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: join(tmpdir(), `lms-${path}-booking-dark.png`), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    for (const width of [1920, 1440, 1280, 1024, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.width + 1, `${path} overflows at ${width}: ${dimensions.scroll}`);
      assert.ok(await card.getByRole('button', { name: 'Attend', exact: true }).isVisible());
      if ([1440, 390].includes(width)) await page.screenshot({ path: join(tmpdir(), `lms-${path}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: join(tmpdir(), `lms-${path}-dark.png`), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await card.getByRole('button', { name: 'Attend', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '90 minutes credited' }).waitFor();
    await page.reload();
    await page.getByText('Attended · 90 min', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Attend', exact: true }).count(), 0);
    if (source === 'progress-review') {
      await page.getByText('Calendar sync pending', { exact: true }).waitFor();
      assert.equal(await page.getByText(syncWarning, { exact: true }).count(), 1);
    }
    await page.getByRole('link', { name: 'View in calendar', exact: true }).click();
    try { await page.getByRole('dialog').waitFor(); }
    catch (error) {
      await page.screenshot({ path: join(tmpdir(), 'lms-meeting-calendar-failure.png'), fullPage: true });
      console.log('Calendar navigation state:', page.url(), (await page.locator('body').innerText()).slice(-2200), errors);
      throw error;
    }
    assert.ok(page.url().includes(`event=${source}-today&date=${today}`));
    if (source === 'progress-review') assert.equal(await page.getByRole('dialog').getByText(syncWarning, { exact: true }).count(), 1);
  }
  assert.equal(posts.length, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: both meeting pages; attendance, reload, absence, rescheduling, sync warnings, exact calendar links, dark theme, 320–1920px.');
} finally { await browser.close(); }
