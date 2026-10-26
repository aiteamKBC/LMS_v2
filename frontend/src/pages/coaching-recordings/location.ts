import { TIME_ZONE_LABEL, todayIso } from '@/pages/curriculum/recordings/utils';
import type { MatchFilter, MeetingFilter } from './model';
import type { Period } from '@/pages/curriculum/recordings/filters';

export type EvidenceTab = 'recordings' | 'transcript' | 'analysis';
export interface CoachingLocation {
  date: string; period: Period; zone: string; coach: string; learner: string; phase: MeetingFilter;
  family: string; match: MatchFilter; lectures: boolean; meeting: string; occurrenceDate: string; tab: EvidenceTab;
}
const member = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export function readLocation(params: URLSearchParams): CoachingLocation {
  let zone = params.get('zone') || TIME_ZONE_LABEL;
  try { if (zone.length > 100) throw new Error(); new Intl.DateTimeFormat('en', { timeZone: zone }).format(); }
  catch { zone = TIME_ZONE_LABEL; }
  const date = params.get('date') ?? '';
  const validDate = validDay(date);
  const lectures = params.get('lectures') === '1';
  return { date: validDate ? date : todayIso(zone), period: member(params.get('view'), ['day', 'week', 'month'], 'day'), zone,
    coach: (params.get('coach') ?? '').slice(0, 320), learner: /^\d+$/.test(params.get('learner') ?? '') ? params.get('learner')! : '',
    phase: member(params.get('status'), ['ready', 'attention', 'ended', 'upcoming', 'in-progress', 'cancelled', 'all'], 'ready'),
    family: member(params.get('type'), lectures ? ['all', 'MCM', 'PR', 'SUPPORT', 'OTHER', 'LECTURE'] : ['all', 'MCM', 'PR', 'SUPPORT', 'OTHER'], 'all'),
    match: member(params.get('match'), ['all', 'matched', 'review'], 'all'), lectures,
    meeting: (params.get('meeting') ?? '').slice(0, 128), occurrenceDate: validDay(params.get('on') ?? '') ? params.get('on')! : validDate ? date : todayIso(zone),
    tab: member(params.get('tab'), ['recordings', 'transcript', 'analysis'], 'recordings') };
}
export function writeLocation(value: CoachingLocation): URLSearchParams {
  const result = new URLSearchParams({ date: value.date, view: value.period, zone: value.zone, status: value.phase });
  if (value.coach) result.set('coach', value.coach);
  if (value.learner) result.set('learner', value.learner);
  if (value.family !== 'all') result.set('type', value.family);
  if (value.match !== 'all') result.set('match', value.match);
  if (value.lectures) result.set('lectures', '1');
  if (value.meeting) { result.set('meeting', value.meeting); result.set('on', value.occurrenceDate); if (value.tab !== 'recordings') result.set('tab', value.tab); }
  return result;
}
