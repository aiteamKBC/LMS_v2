import { coachFetch } from '@/lib/coachFetch';
import { getLogLearners } from '@/features/monthly-logs/api';
import type { MonthlyActivityResponse } from '@/pages/coach/monthly-cycle/types';

export const getCoachMonthlyLogLearners = getLogLearners;

export function monthlyCycleEndpoint(month: string) {
  return `/coach_api/coach/monthly-activity?${new URLSearchParams({ month })}`;
}

export async function getCoachMonthlyCycle(month: string, signal?: AbortSignal): Promise<MonthlyActivityResponse> {
  const response = await coachFetch(monthlyCycleEndpoint(month), { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(detail);
  }
  return data as MonthlyActivityResponse;
}
