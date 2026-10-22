import { test, expect } from './network';
import { catalogue, editablePlan, firstLogin, learner, session, staff } from './fixtures';

test.beforeEach(async ({ page, api }, info) => {
  void api; // Install the deny-by-default network fixture before navigation.
  await page.addInitScript(({ dark, arabic }) => {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    // Layout exercise only: does not pretend a product language toggle exists.
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.lang = arabic ? 'ar' : 'en';
      document.documentElement.dir = arabic ? 'rtl' : 'ltr';
    });
  }, { dark: info.project.name.includes('dark'), arabic: info.project.name.includes('arabic') });
});

test('credential login uses exact button and server-directed role navigation', async ({ page, api }) => {
  let loggedIn = false;
  api.on('GET', '/login_api/me/', () => loggedIn ? { body: { user: staff } } : { status: 401, body: { error: 'Expired' } });
  api.on('POST', '/login_api/login/', route => {
    expect(route.request().postDataJSON()).toMatchObject({ email: staff.email, password: 'Synthetic-Harbour-92!' });
    loggedIn = true;
    return { body: { user: staff } };
  });
  await page.goto('/login');
  await page.getByLabel(/email address/i).fill(staff.email);
  await page.getByLabel(/^password$/i).fill('Synthetic-Harbour-92!');
  await page.getByRole('button', { name: 'Sign in to Workspace', exact: true }).click();
  await expect(page).toHaveURL(/choose-workspace/);
  await expect(page.getByRole('button', { name: /Enrolment/ })).toBeVisible();
  expect(api.requests.filter(r => r.method === 'POST')).toHaveLength(1);
});

test('401 shows sign-in; temporary sign-in failure allows retry', async ({ page, api }) => {
  api.on('GET', '/login_api/me/', () => ({ status: 401, body: { error: 'Expired' } }));
  api.on('POST', '/login_api/login/', () => ({ status: 503, body: { error: 'Synthetic temporary outage' } }));
  await page.goto('/login');
  await page.getByLabel(/email address/i).fill(learner.email);
  await page.getByLabel(/^password$/i).fill('Synthetic-Harbour-92!');
  await page.getByRole('button', { name: 'Sign in to Workspace', exact: true }).click();
  await expect(page.getByText('Synthetic temporary outage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to Workspace', exact: true })).toBeEnabled();
  expect(api.requests.filter(r => r.method === 'POST')).toHaveLength(1);
});

test('First Login keeps personal values when moving to signature and back', async ({ page, api }) => {
  // First Login details apply to apprentices; commercial learners skip this form.
  session(api, { ...learner, learnerType: 'apprenticeship' });
  api.on('GET', '/login_api/learner-entry/', () => ({ body: {
    classification: 'new', required: false, canAccess: true,
  } }));
  api.on('GET', '/learner_api/calendar/apprenticeship/701/first-session/', () => ({ body: {
    caseOwner: null, booked: false, event: null, startsOn: null, access: 'enrolling', canBook: false,
  } }));
  api.on('GET', '/learner_api/learner-summary/apprenticeship/701/', () => ({ body: {
    id: '701', name: learner.displayName, email: learner.email, phone: firstLogin.details.phone,
    programme: learner.programme, programmeStatus: firstLogin.programmeStatus,
    onboardingStatus: 'Draft', firstSessionUnlocked: false, studentActivityAvailable: false,
    cohort: '', group: '', employer: '', employerId: null, organization: '',
    learnerType: 'apprenticeship', isActive: true,
  } }));
  api.on('POST', '/curriculum_api/activity/record/', route => {
    const body = route.request().postDataJSON();
    expect(body.visitId).toEqual(expect.any(String));
    expect(body.events.length).toBeGreaterThan(0);
    for (const event of body.events) {
      expect(event.path).toBe('/learner/welcome');
      expect(event.kind).toBe('page_view');
    }
    return { body: { available: true, recorded: body.events.length } };
  });
  api.on('GET', '/learner_api/first-login-details/701/', () => ({ body: firstLogin }));
  await page.goto('/learner/welcome');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByRole('tablist', { name: 'How to sign' })).toBeVisible();
  await page.getByRole('button', { name: /^Back/ }).click();
  await expect(page.getByLabel(/^Address line 1/i)).toHaveValue('1 Synthetic Street');
  // Let the real batching timer fire so the exact telemetry fixture is exercised.
  await expect.poll(() => api.requests.filter(r => r.path === '/curriculum_api/activity/record/').length).toBeGreaterThan(0);
  // Navigation telemetry is permitted; saving personal details/signatures is not.
  expect(api.requests.filter(r => r.method === 'POST' && r.path !== '/curriculum_api/activity/record/')).toHaveLength(0);
});

test('learner catalogue retains canonical module progress and retries 503', async ({ page, api }) => {
  session(api);
  let calls = 0;
  api.on('GET', '/learner_api/my-learning/commercial/701/', () => ++calls === 1
    ? { status: 503, body: { error: 'Synthetic catalogue outage' } } : { body: catalogue });
  await page.goto('/learner/my-learning/commercial/701');
  await page.getByRole('button', { name: /retry|try again/i }).click();
  await expect(page.getByText('Synthetic module', { exact: true })).toBeVisible();
  await expect(page.getByText('50%', { exact: true }).first()).toBeVisible();
  expect(calls).toBe(2);
  expect(api.requests.filter(r => r.path.endsWith('/logout/'))).toHaveLength(0);
});

test('staff plan failure stays editable and never announces successful save', async ({ page, api }) => {
  session(api, staff);
  api.on('GET', '/learner_api/enrolment-users/', () => ({ body: { count: 1, results: [{
    id: '701', uuid: '10000000-0000-4000-8000-000000000701', name: 'Synthetic learner',
    type: 'User', email: learner.email, source: 'commercial', group: 'Synthetic group',
    subscriptionStatus: 'FullUser', subscriptionVerified: true, learningPlan: true,
    hasLearningPlan: true, programmeStatus: 'Delivery', programme: 'Synthetic programme',
  }] } }));
  api.on('GET', '/learner_api/staff-users/', () => ({ body: { count: 0, results: [] } }));
  api.on('GET', '/learner_api/employers/', () => ({ body: { count: 0, results: [] } }));
  api.on('GET', '/learner_api/attendance-mode/', () => ({ body: { available: true, modes: {} } }));
  api.on('GET', '/learner_api/curriculum/programmes/', () => ({ body: { results: ['Synthetic programme'] } }));
  api.on('GET', '/curriculum_api/curriculum/free-programmes/FREE-COURSES/modules/', () => ({ body: { results: [] } }));
  api.on('GET', '/learner_api/learning-plan/701/', () => ({ body: editablePlan }));
  api.on('PATCH', '/learner_api/learning-plan/701/', route => {
    expect(route.request().postDataJSON()).toMatchObject({ modules: [] });
    return { status: 200, body: { error: 'Synthetic mirror failure' } };
  });
  await page.goto('/users');
  await page.getByRole('button', { name: 'Edit learning plan', exact: true }).click();
  await page.getByRole('button', { name: 'Save learning plan', exact: true }).click();
  await expect(page.getByText('Synthetic mirror failure')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save learning plan', exact: true })).toBeEnabled();
  await expect(page.getByText(/saved successfully/i)).toHaveCount(0);
});

test('Curriculum partial assignment names failures without claiming complete success', async ({ page, api }) => {
  session(api, { ...staff, access: 'curriculum' });
  const programme = { id: 'SYNTHETIC-P', sourceId: 'SYNTHETIC-P', name: 'Synthetic programme', status: 'active', isArchived: false };
  const module = { id: 'SYNTHETIC-M', catalogueId: 'SYNTHETIC-M', moduleCatalogueId: 'SYNTHETIC-M',
    name: 'Synthetic module', title: 'Synthetic module', programmeId: programme.id,
    programme: programme.name, programmeName: programme.name, status: 'draft',
    weeks: 1, sessions: 0, totalHours: 1, assignedLearnerCount: 0, weekStructure: [] };
  api.on('GET', '/curriculum_api/curriculum/modules/', () => ({ body: { results: [module] } }));
  api.on('GET', '/curriculum_api/curriculum/programmes/', () => ({ body: { results: [programme] } }));
  api.on('GET', '/curriculum_api/curriculum/overview/', () => ({ body: {
    programmes: [programme], modules: [module], cohorts: [], groups: [],
  } }));
  api.on('GET', '/curriculum_api/curriculum/delivery-scope/', () => ({ body: { cohorts: [], groups: [] } }));
  const path = '/curriculum_api/curriculum/modules/SYNTHETIC-M/learner-assignments/';
  api.on('GET', path, () => ({ body: { target: { scope: 'module', id: 'SYNTHETIC-M', name: 'Synthetic module',
    programmeName: 'Synthetic programme', moduleCount: 1 }, learners: [701, 702].map(id => ({
      id: String(id), name: `Synthetic learner ${id}`, email: `${id}@example.invalid`, programme: 'Synthetic programme',
      company: '', cohort: '', group: '', programmeStatus: 'Active', learnerType: 'commercial', assigned: false, moduleCount: 0,
    })), totals: { learnerCount: 2, assignedCount: 0 } } }));
  api.on('POST', path, route => {
    expect(route.request().postDataJSON()).toEqual({ learnerIds: ['701', '702'] });
    return { body: { assignedCount: 1, changedCount: 1, moduleCount: 1, failedIds: ['702'], failureMessage: 'Synthetic failure' } };
  });
  // Existing deep link reopens the module's assignment drawer after catalogue load.
  await page.goto('/curriculum/module-builder?learners=SYNTHETIC-M');
  await page.getByLabel(/Select all filtered learners/).check();
  await page.getByRole('button', { name: 'Add 2', exact: true }).click();
  await expect(page.getByText('Synthetic failure')).toBeVisible();
});

test('unrelated employer cannot open learner document or offer a signature', async ({ page, api }) => {
  session(api, { id: 901, subjectId: 901, subjectType: 'employer', role: 'employer',
    hasPassword: true, lastLoginAt: null, permissions: [],
    displayName: 'Synthetic employer', email: 'employer@example.invalid', organisationIds: [] });
  api.on('GET', '/learner_api/employer-portal/901/learner/commercial/701/', () => ({ status: 404, body: { error: 'Not found.' } }));
  await page.goto('/employers/901/learner/commercial/701');
  await expect(page.getByText('Not found.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /sign.*plan/i })).toHaveCount(0);
  expect(api.requests.filter(r => r.method === 'POST')).toHaveLength(0);
});

test('login keyboard and layout work in each locale/theme/viewport', async ({ page, api }, info) => {
  api.on('GET', '/login_api/me/', () => ({ status: 401, body: { error: 'Expired' } }));
  await page.goto('/login');
  const email = page.getByLabel(/email address/i);
  await email.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Forgot password?', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(/^password$/i)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel(/^password$/i)).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('dir', info.project.name.includes('arabic') ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-theme', info.project.name.includes('dark') ? 'dark' : 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
