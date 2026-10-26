import { addDays, TIME_ZONE_LABEL, todayIso } from '@/pages/curriculum/recordings/utils';

export interface QualityFilters {
  start: string; end: string; timeZone: string; coachEmail: string; status: string; search: string; reviewType?: string; pdf?: string;
}
export interface QualityLocation { filters: QualityFilters; review: string; invalidReview: boolean }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export function readQualityLocation(params: URLSearchParams): QualityLocation {
  let timeZone = params.get('zone') || TIME_ZONE_LABEL;
  try { if (timeZone.length > 100) throw new Error(); new Intl.DateTimeFormat('en', { timeZone }).format(); }
  catch { timeZone = TIME_ZONE_LABEL; }
  const end = day(params.get('to') || '') ? params.get('to')! : todayIso(timeZone);
  const start = day(params.get('from') || '') ? params.get('from')! : addDays(end, -30);
  const raw = params.get('review') || '';
  return { filters: { start, end, timeZone, coachEmail: (params.get('coach') || '').trim().toLowerCase().slice(0, 320),
    status: params.get('status') === 'all' ? '' : ['draft', 'completed'].includes(params.get('status') || '') ? params.get('status')! : 'completed',
    search: (params.get('q') || '').slice(0, 200),
    reviewType: ['MCM','PR'].includes(params.get('type') || '') ? params.get('type')! : '',
    pdf: ['available','missing'].includes(params.get('pdf') || '') ? params.get('pdf')! : '' },
    review: uuid.test(raw) ? raw.toLowerCase() : '', invalidReview: Boolean(raw && !uuid.test(raw)) };
}

export function writeQualityLocation(filters: QualityFilters, review = ''): URLSearchParams {
  const params = new URLSearchParams({ from: filters.start, to: filters.end, zone: filters.timeZone, status: filters.status || 'all' });
  if (filters.coachEmail) params.set('coach', filters.coachEmail);
  if (filters.search) params.set('q', filters.search);
  if (filters.reviewType) params.set('type', filters.reviewType);
  if (filters.pdf) params.set('pdf', filters.pdf);
  if (uuid.test(review)) params.set('review', review.toLowerCase());
  return params;
}
