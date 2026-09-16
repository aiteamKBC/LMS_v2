import { coachFetch } from '@/lib/coachFetch';

export interface EntraPerson { id: string; name: string; email: string }

export async function searchEntraPeople(query: string, signal?: AbortSignal): Promise<{ people: EntraPerson[]; hasMore: boolean }> {
  const base = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
  const response = await coachFetch(`${base}/curriculum/teams-directory/?q=${encodeURIComponent(query.trim())}`, { signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Entra search is unavailable.');
  if (!result || !Array.isArray(result.people) || !result.people.every((person: EntraPerson) => person &&
    typeof person.id === 'string' && typeof person.name === 'string' && typeof person.email === 'string')) {
    throw new Error('Entra search results could not be read.');
  }
  return result;
}
