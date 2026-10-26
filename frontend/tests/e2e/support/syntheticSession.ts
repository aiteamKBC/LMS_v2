import type { Page, Route } from '@playwright/test';

type AccountRole = 'admin' | 'staff' | 'employer' | 'learner';
type SubjectType = 'learner' | 'employer' | 'staff';

export interface SyntheticAccount {
  id: number;
  email: string;
  displayName: string;
  role: AccountRole;
  subjectType: SubjectType;
  subjectId: number;
  hasPassword: boolean;
  lastLoginAt: string;
  permissions: string[];
  access: string;
  accessHome: string;
  accessWorkspaces: Array<{ access: string; home: string; navRole?: string }>;
  learnerType?: string;
  organisationIds?: number[];
}

const API_PREFIXES = [
  '/api/',
  '/audit_api/',
  '/coach_api/',
  '/curriculum_api/',
  '/engagement_api/',
  '/enrolment_api/',
  '/hours_test_api/',
  '/learner_api/',
  '/login_api/',
  '/manual_audit_api/',
  '/progress_reviews_api/',
  '/quiz_api/',
];

const JSON_HEADERS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function guardRequest(route: Route, account: SyntheticAccount | null): Promise<void> {
  const requestUrl = new URL(route.request().url());

  if (requestUrl.origin !== 'http://127.0.0.1:4173') {
    await route.abort('blockedbyclient');
    return;
  }

  if (requestUrl.pathname === '/login_api/me/') {
    await route.fulfill({
      status: account ? 200 : 401,
      headers: JSON_HEADERS,
      body: JSON.stringify(account ? { user: account } : { error: 'Not signed in' }),
    });
    return;
  }

  if (isApiPath(requestUrl.pathname)) {
    await route.fulfill({
      status: 501,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: `Unmocked E2E API request: ${requestUrl.pathname}` }),
    });
    return;
  }

  await route.continue();
}

export async function useSyntheticSession(page: Page, account: SyntheticAccount | null): Promise<void> {
  await page.route('**/*', (route) => guardRequest(route, account));
}

export function accountForProject(projectName: string): SyntheticAccount {
  const common = {
    hasPassword: true,
    lastLoginAt: '2026-01-15T09:00:00.000Z',
    permissions: [],
  };

  switch (projectName) {
    case 'learner':
      return {
        ...common,
        id: 1001,
        email: 'learner.e2e@example.test',
        displayName: 'Synthetic Learner',
        role: 'learner',
        subjectType: 'learner',
        subjectId: 2001,
        access: 'learner',
        accessHome: '/learner/home',
        accessWorkspaces: [{ access: 'learner', home: '/learner/home', navRole: 'learner' }],
        learnerType: 'commercial',
      };
    case 'apprentice':
      return {
        ...common,
        id: 1002,
        email: 'apprentice.e2e@example.test',
        displayName: 'Synthetic Apprentice',
        role: 'learner',
        subjectType: 'learner',
        subjectId: 2002,
        access: 'learner',
        accessHome: '/learner/home',
        accessWorkspaces: [{ access: 'learner', home: '/learner/home', navRole: 'learner' }],
        learnerType: 'apprenticeship',
      };
    case 'employer':
      return {
        ...common,
        id: 1003,
        email: 'employer.e2e@example.test',
        displayName: 'Synthetic Employer',
        role: 'employer',
        subjectType: 'employer',
        subjectId: 3001,
        access: 'employer',
        accessHome: '/workspace/employer',
        accessWorkspaces: [{ access: 'employer', home: '/workspace/employer', navRole: 'employer' }],
        organisationIds: [4001],
      };
    case 'verify':
      return {
        ...common,
        id: 1004,
        email: 'admin.e2e@example.test',
        displayName: 'Synthetic Verifier',
        role: 'admin',
        subjectType: 'staff',
        subjectId: 5001,
        access: 'admin',
        accessHome: '/workspace/admin',
        accessWorkspaces: [{ access: 'admin', home: '/workspace/admin', navRole: 'admin' }],
      };
    case 'staff':
    default:
      return {
        ...common,
        id: 1005,
        email: 'staff.e2e@example.test',
        displayName: 'Synthetic Staff Member',
        role: 'staff',
        subjectType: 'staff',
        subjectId: 5002,
        access: 'coach',
        accessHome: '/workspace/coach',
        accessWorkspaces: [{ access: 'coach', home: '/workspace/coach', navRole: 'coach' }],
      };
  }
}
