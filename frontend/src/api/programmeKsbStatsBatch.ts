import { coachFetch } from '@/lib/coachFetch';
import type { ProgrammeKsbStats } from '@/lib/curriculumApi';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

/** The server's cap on one request; longer lists are split. */
export const PROGRAMME_KSB_STATS_BATCH_SIZE = 60;

/**
 * Several programme cards' KSB numbers in one request.
 *
 * Each value is exactly what `/programmes/<id>/ksb-stats/` returns for that
 * programme (the server builds and caches them the same way); `null` means the
 * programme was not found.
 */
export async function fetchProgrammeKsbStatsBatch(
  ids: string[],
  signal: AbortSignal,
  options: { visibility?: 'all' | 'operational' } = {},
): Promise<Record<string, ProgrammeKsbStats | null>> {
  const query = new URLSearchParams({ ids: ids.join(',') });
  if (options.visibility === 'all') query.set('visibility', 'all');
  const response = await coachFetch(`${API_BASE_URL}/curriculum/programmes/ksb-stats/?${query}`, { signal });
  if (!response.ok) throw new Error('Could not load the programmes’ KSB numbers. Please retry.');
  const data = await response.json() as { stats?: Record<string, ProgrammeKsbStats | null> };
  if (!data.stats || typeof data.stats !== 'object') throw new Error('The programmes’ KSB numbers are unavailable. Please retry.');
  return data.stats;
}
