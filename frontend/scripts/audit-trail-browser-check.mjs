// UI-only browser regression. All APIs and external hosts are intercepted;
// this does not authenticate to, read, or mutate an LMS database.
// Start Vite on 127.0.0.1:3017, then: node scripts/audit-trail-browser-check.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3017';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const workspaces = ['curriculum', 'coach', 'enrolment', 'learner', 'tutor'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
const stamp = new Date().toISOString();
const actor = { email: 'audit-test@example.invalid', name: 'Audit Test Actor', role: 'super-admin',
  firstSeen: stamp, lastSeen: stamp, visits: 0, pageViews: 0, readActions: 0, changes: 1,
  signIns: 1, pagesOpened: 0, workspaces: [], lastPagePath: '', lastPageLabel: '' };
const event = { id: 'rev:1', at: stamp, action: 'updated', actionLabel: 'Edited', entity: 'module',
  entityLabel: 'Module', entityId: 'AUDIT-TEST', revisionNo: 2, title: 'Synthetic audit module',
  context: '', parents: {}, moduleCatalogueId: 'AUDIT-TEST', parentId: '', versionLabel: '',
  contentStatus: '', actorName: actor.name, actorEmail: actor.email, actorType: 'user', actorTypeLabel: 'Person',
  triggeredByEmail: '', triggeredByName: '', source: 'manual', sourceLabel: 'Manual save', reason: '',
  metadata: { page_path: '/tutor/modules/AUDIT-TEST', page_workspace: 'tutor', page_source: 'browser' },
  changes: [{ field: 'title', label: 'Title', before: 'Old module title', after: 'New module title', truncated: false }],
  snapshot: null, href: '/curriculum/modules/AUDIT-TEST' };
const base = { generatedAt: stamp, since: stamp, windowDays: 30, visitsRecorded: true,
  changesRecorded: true, signInsRecorded: true, workspaces, changeWorkspaces: workspaces.map(w => w.value),
  workspaceRecorded: true, page: 1, pages: 1, pageSize: 50, total: 1, truncated: false };
let selectedWorkspace = '';
let blockedExternal = 0;
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) { blockedExternal++; await route.abort(); return; }
  if (!/^\/(?:\w+_api|api)\//.test(url.pathname)) { await route.continue(); return; }
  let result = {};
  if (url.pathname === '/login_api/me/') result = { user: { id: 1, email: actor.email,
    displayName: actor.name, role: 'admin', subjectType: 'staff', subjectId: 1, hasPassword: true,
    lastLoginAt: stamp, permissions: ['*'], access: 'super-admin', accesses: ['super-admin'],
    accessHome: '/workspace/admin', accessNavRole: 'super-admin', accessWorkspaces: [{ access: 'super-admin', home: '/workspace/admin' }] } };
  else if (url.pathname.endsWith('/activity/people/')) result = { ...base, workspace: '',
    people: [actor], roles: ['super-admin'], rolesIncludeBlank: false,
    totals: { people: 1, visits: 0, pageViews: 0, readActions: 0, changes: 1, signIns: 1 }, shown: 1, limit: 50 };
  else if (url.pathname.includes('/activity/people/')) result = { ...base, person: actor, visits: [],
    changes: [event], signIns: [], counts: { visits: 0, pageViews: 0, readActions: 0, changes: 1, changesOnAPage: 0, signIns: 1 },
    accountEventsRecorded: true, accountEvents: [{ id: 1, at: stamp, event: 'logout', succeeded: true },
      { id: 2, at: stamp, event: 'login', succeeded: true }] };
  else if (url.pathname.endsWith('/quality/audit-trail/')) {
    selectedWorkspace = url.searchParams.get('workspace') || '';
    result = { ...base, limit: 50, authorRecorded: true, source: 'revisions', structuredMetadata: true,
      actionCounts: { updated: 1 }, entityCounts: { module: 1 }, unreadable: [], actors: [], sources: [], actorTypes: [],
      entityTypes: [{ value: 'module', label: 'Module' }], events: [event] };
  } else if (url.pathname.includes('/activity/record/')) result = { recorded: 0, available: true };
  else if (url.pathname.includes('notifications')) result = { items: [], notifications: [], unreadCount: 0 };
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
});

try {
  await page.goto(`${origin}/admin/audit-trail`);
  await page.getByText(actor.name, { exact: true }).first().waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: /Changes/ }).click();
  await page.getByText('Synthetic audit module', { exact: true }).waitFor();
  assert.match(await page.locator('body').innerText(), /Page: \/tutor\/modules\/AUDIT-TEST/);
  await page.getByRole('combobox', { name: /Workspace/i }).click();
  await page.getByRole('option', { name: 'Tutor', exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Reading audit records...'));
  assert.equal(selectedWorkspace, 'tutor');
  const detailButton = page.getByRole('button', { name: '1 changed field', exact: true });
  await detailButton.click();
  await page.getByText('Old module title', { exact: true }).first().waitFor();
  await page.getByText('New module title', { exact: true }).first().waitFor();
  await page.screenshot({ path: 'audit-trail-browser.png', fullPage: true });
  await page.goto(`${origin}/admin/audit-trail/people/${encodeURIComponent(actor.email)}`);
  await page.getByRole('heading', { name: 'Account access', exact: true }).waitFor();
  await page.getByText('Signed out', { exact: true }).waitFor();
  await page.getByText('Signed in', { exact: true }).waitFor();
  await page.getByRole('button', { name: /1 field changed/ }).click();
  await page.getByText('Old module title', { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', checks: ['workspace filter', 'source page', 'before/after', 'person history', 'login/logout'], blockedExternal, backend: 'mocked; no database access' }));
} finally {
  await browser.close();
}
