import { fetchSharedJsonGet } from '@/lib/sharedGetJson';
import { withCoachViewAs } from '@/lib/coachViewAs';

const DASHBOARD_ENDPOINT = '/coach_api/coach/dashboard';

export async function fetchCoachDashboard<Response>(signal: AbortSignal): Promise<Response> {
  const url = withCoachViewAs(DASHBOARD_ENDPOINT);
  try {
    return await fetchSharedJsonGet<Response>(url, { signal, credentials: 'include' });
  } catch (error) {
    if (signal.aborted) throw error;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(resolve, 250);
      signal.addEventListener('abort', () => {
        window.clearTimeout(timeout);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    });
    return fetchSharedJsonGet<Response>(url, { signal, credentials: 'include' });
  }
}
