import { fetchSharedJsonGet } from '@/lib/sharedGetJson';
import { adaptDashboardPopupContract, adaptDashboardSummary, type DashboardPopupContract, type DashboardSummary } from './dashboardSummary';
import { withCoachViewAs } from '@/lib/coachViewAs';
import { adaptDashboardLearnerRow, type DashboardLearnerRow } from './dashboardLearnerRow';
import type { CaseloadApiResponse } from '@/pages/coach/caseload/types';
import { adaptDashboardMeetings, dashboardMeetingsQuery } from './dashboardMeetings';
import { dashboardBusinessDate } from './dashboardWeek';

const DASHBOARD_ENDPOINT = '/coach_api/coach/dashboard';
// Successful bulk datasets live until explicit invalidation or a browser reload.
const learnerPageCache = new Map<string, CaseloadApiResponse>();

const learnerLoadVersions = new Map<string, symbol>();

export function clearDashboardLearnerPageCache() { learnerPageCache.clear(); learnerLoadVersions.clear(); }
const learnerDateKey = (key: string) => `${key}::${dashboardBusinessDate()}`;
export function invalidateDashboardLearners(key: string) { learnerPageCache.delete(learnerDateKey(key)); learnerLoadVersions.delete(learnerDateKey(key)); }
export function getDashboardLearnerPageCache(key: string) { return learnerPageCache.get(learnerDateKey(key)); }

export async function fetchCoachDashboard<Response>(signal: AbortSignal): Promise<Response> {
  const response = await fetchDashboardSection<DashboardPopupContract | DashboardSummary | Response>('summary', signal);
  if (typeof response === 'object' && response !== null && 'learnerPopup' in response) {
    return adaptDashboardPopupContract(response as DashboardPopupContract) as Response;
  }
  // Accept an older server response during a rolling deployment.
  return (typeof response === 'object' && response !== null && 'meetingsThisWeek' in response
    ? adaptDashboardSummary(response as DashboardSummary) : response) as Response;
}

export async function fetchDashboardSection<Response>(section: 'summary' | 'meetings' | 'risk' | 'learners', signal: AbortSignal, query = ''): Promise<Response> {
  if (section === 'meetings' && !query) query = dashboardMeetingsQuery();
  const url = withCoachViewAs(`${DASHBOARD_ENDPOINT}/${section}${query}`);
  const read = async () => {
    const response = await fetchSharedJsonGet<Response>(url, { signal, credentials: 'include' });
    return section === 'meetings' ? adaptDashboardMeetings(response) : response;
  };
  try {
    return await read();
  } catch (error) {
    if (signal.aborted) throw error;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        window.clearTimeout(timeout);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      const timeout = window.setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 250);
      signal.addEventListener('abort', abort, { once: true });
    });
    return read();
  }
}

export async function fetchDashboardLearners(signal: AbortSignal, cacheKey: string): Promise<CaseloadApiResponse> {
  cacheKey = learnerDateKey(cacheKey);
  const cached = cacheKey ? learnerPageCache.get(cacheKey) : undefined;
  if (cached) return cached;
  const version = Symbol(cacheKey);
  learnerLoadVersions.set(cacheKey, version);
  // One bulk request; failures stay visible until an explicit retry.
  const wire = await fetchSharedJsonGet<Omit<CaseloadApiResponse, 'results'> & { results?: DashboardLearnerRow[] }>(withCoachViewAs(`${DASHBOARD_ENDPOINT}/learners`), { signal, credentials: 'include' });
  const response: CaseloadApiResponse = { ...wire, results: wire.results?.map(row =>
    // Already-open pages may still hold the previous response during rollout.
    ({ ...('otjh' in row ? adaptDashboardLearnerRow(row) : row as unknown as NonNullable<CaseloadApiResponse['results']>[number]), ...wire.learnerFilterData?.[row.id] })),
  };
  if (!signal.aborted && learnerLoadVersions.get(cacheKey) === version) learnerPageCache.set(cacheKey, response);
  return response;
}
