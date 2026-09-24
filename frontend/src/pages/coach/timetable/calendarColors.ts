export type MeetingTypeKey =
  | 'live-session'
  | 'monthly-coaching'
  | 'progress-review'
  | 'gateway-review'
  | 'personal-support-plan'
  | 'review'
  | 'catch-up'
  | 'support'
  | 'other';

export type CalendarStatusKey =
  | 'all'
  | 'missed-overdue'
  | 'pending-due-soon'
  | 'awaiting-signature'
  | 'in-progress'
  | 'scheduled'
  | 'completed'
  | 'not-scheduled';

export interface CalendarColorPair {
  accent: string;
  background: string;
}

export type CalendarColorPreferences = {
  meetingTypes: Record<MeetingTypeKey, CalendarColorPair>;
  statuses: Record<CalendarStatusKey, CalendarColorPair>;
};

export interface MeetingTypeDefinition {
  key: MeetingTypeKey;
  label: string;
  icon: string;
}

export interface CalendarStatusDefinition {
  key: CalendarStatusKey;
  label: string;
  description: string;
}

export const MEETING_TYPE_DEFINITIONS: MeetingTypeDefinition[] = [
  { key: 'live-session', label: 'Live Sessions', icon: 'ri-live-line' },
  { key: 'monthly-coaching', label: 'Monthly Coaching Meeting', icon: 'ri-chat-smile-2-line' },
  { key: 'progress-review', label: 'Progress Review', icon: 'ri-file-chart-line' },
  { key: 'gateway-review', label: 'Gateway Review', icon: 'ri-flag-line' },
  { key: 'personal-support-plan', label: 'Personal Support Plan', icon: 'ri-hand-heart-line' },
  { key: 'review', label: 'Review', icon: 'ri-survey-line' },
  { key: 'catch-up', label: 'Catch-up Session', icon: 'ri-timer-line' },
  { key: 'support', label: 'Support', icon: 'ri-heart-2-line' },
  { key: 'other', label: 'Other', icon: 'ri-more-line' },
];

export const CALENDAR_STATUS_DEFINITIONS: CalendarStatusDefinition[] = [
  { key: 'missed-overdue', label: 'Missed / Overdue', description: 'Past due or missed' },
  { key: 'pending-due-soon', label: 'Pending / Due Soon', description: 'Due soon or awaiting action' },
  { key: 'awaiting-signature', label: 'Awaiting Signature', description: 'Waiting for signature' },
  { key: 'in-progress', label: 'In Progress', description: 'Active and in progress' },
  { key: 'scheduled', label: 'Scheduled / On Track', description: 'On schedule' },
  { key: 'completed', label: 'Completed', description: 'Case completed' },
  { key: 'not-scheduled', label: 'Not Scheduled', description: 'Not yet scheduled' },
];

export const DEFAULT_CALENDAR_COLORS: CalendarColorPreferences = {
  meetingTypes: {
    'live-session': { accent: '#7C3AED', background: '#F5F3FF' },
    'monthly-coaching': { accent: '#2563EB', background: '#EFF6FF' },
    'progress-review': { accent: '#0D9488', background: '#F0FDFA' },
    'gateway-review': { accent: '#4F46E5', background: '#EEF2FF' },
    'personal-support-plan': { accent: '#DB2777', background: '#FDF2F8' },
    review: { accent: '#64748B', background: '#F1F5F9' },
    'catch-up': { accent: '#EA580C', background: '#FFF7ED' },
    support: { accent: '#0891B2', background: '#ECFEFF' },
    other: { accent: '#6B7280', background: '#F9FAFB' },
  },
  statuses: {
    all: { accent: '#4F2D7F', background: '#F1ECF8' },
    'missed-overdue': { accent: '#DC2626', background: '#FEF2F2' },
    'pending-due-soon': { accent: '#D97706', background: '#FFFBEB' },
    'awaiting-signature': { accent: '#C2410C', background: '#FFF7ED' },
    'in-progress': { accent: '#B45309', background: '#FEF3C7' },
    scheduled: { accent: '#059669', background: '#ECFDF5' },
    completed: { accent: '#047857', background: '#D1FAE5' },
    'not-scheduled': { accent: '#DC2626', background: '#FEF2F2' },
  },
};

const STORAGE_PREFIX = 'kbc.coach-calendar-colors.v1';

const normalizeText = (value?: string | null) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export function getMeetingTypeKey(event: {
  source?: string | null;
  type?: string | null;
  reviewTypeCode?: string | null;
  reviewTypeName?: string | null;
}): MeetingTypeKey {
  if (event.source === 'live-session' || event.type === 'live-session') return 'live-session';
  const reviewIdentity = normalizeText(`${event.reviewTypeCode || ''} ${event.reviewTypeName || ''}`);
  if (reviewIdentity.includes('gateway')) return 'gateway-review';
  if (reviewIdentity.includes('personal support') || reviewIdentity.includes('support plan')) return 'personal-support-plan';
  if (event.source === 'mcr') return 'monthly-coaching';
  if (event.source === 'progress-review') return 'progress-review';
  if (event.source === 'catch-up') return 'catch-up';
  if (event.source === 'student-support' || event.type === 'welfare') return 'support';
  if (event.source === 'review' || event.reviewTypeCode || event.reviewTypeName) return 'review';
  if (event.type === 'coaching') return 'monthly-coaching';
  return 'other';
}

export function meetingTypeLabelForEvent(event: {
  source?: string | null;
  type?: string | null;
  reviewTypeCode?: string | null;
  reviewTypeName?: string | null;
}) {
  const definition = MEETING_TYPE_DEFINITIONS.find(item => item.key === getMeetingTypeKey(event));
  const reviewName = event.reviewTypeName?.trim();
  if (getMeetingTypeKey(event) === 'review' && reviewName) return reviewName;
  return definition?.label || 'Other';
}

export function getCalendarStatusKey(
  status: string | null | undefined,
  isOverdue = false,
  isDueSoon = false,
): CalendarStatusKey {
  if ((status === 'pending' || status === 'not-scheduled') && isOverdue) return 'missed-overdue';
  if ((status === 'pending' || status === 'not-scheduled') && isDueSoon) return 'pending-due-soon';
  if (status === 'completed' || status === 'confirmed') return 'completed';
  if (status === 'awaiting-signature') return 'awaiting-signature';
  if (status === 'in-progress') return 'in-progress';
  if (status === 'scheduled') return 'scheduled';
  if (status === 'pending') return 'pending-due-soon';
  return 'not-scheduled';
}

export function cloneCalendarColors(value: CalendarColorPreferences): CalendarColorPreferences {
  return {
    meetingTypes: Object.fromEntries(
      Object.entries(value.meetingTypes).map(([key, pair]) => [key, { ...pair }]),
    ) as CalendarColorPreferences['meetingTypes'],
    statuses: Object.fromEntries(
      Object.entries(value.statuses).map(([key, pair]) => [key, { ...pair }]),
    ) as CalendarColorPreferences['statuses'],
  };
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function mergeCalendarColors(value: unknown): CalendarColorPreferences {
  const result = cloneCalendarColors(DEFAULT_CALENDAR_COLORS);
  if (!value || typeof value !== 'object') return result;
  const candidate = value as Partial<CalendarColorPreferences>;

  (Object.keys(result.meetingTypes) as MeetingTypeKey[]).forEach(key => {
    const pair = candidate.meetingTypes?.[key];
    if (pair && isHex(pair.accent) && isHex(pair.background)) result.meetingTypes[key] = { accent: pair.accent, background: pair.background };
  });
  (Object.keys(result.statuses) as CalendarStatusKey[]).forEach(key => {
    const pair = candidate.statuses?.[key];
    if (pair && isHex(pair.accent) && isHex(pair.background)) result.statuses[key] = { accent: pair.accent, background: pair.background };
  });
  return result;
}

export function getCalendarColorsStorageKey(owner: string) {
  const safeOwner = owner.trim().toLowerCase() || 'default';
  let hash = 2166136261;
  for (let index = 0; index < safeOwner.length; index += 1) {
    hash ^= safeOwner.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${STORAGE_PREFIX}:${(hash >>> 0).toString(36)}`;
}

export function loadCalendarColors(owner: string): CalendarColorPreferences {
  if (typeof window === 'undefined') return cloneCalendarColors(DEFAULT_CALENDAR_COLORS);
  try {
    const raw = window.localStorage.getItem(getCalendarColorsStorageKey(owner));
    return raw ? mergeCalendarColors(JSON.parse(raw)) : cloneCalendarColors(DEFAULT_CALENDAR_COLORS);
  } catch {
    return cloneCalendarColors(DEFAULT_CALENDAR_COLORS);
  }
}

export function saveCalendarColors(owner: string, value: CalendarColorPreferences) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getCalendarColorsStorageKey(owner), JSON.stringify(mergeCalendarColors(value)));
  } catch {
    // Local preference persistence is best-effort when storage is unavailable.
  }
}

export function readableTextColor(background: string) {
  if (!isHex(background)) return '#172033';
  const channels = [1, 3, 5].map(index => parseInt(background.slice(index, index + 2), 16) / 255);
  const luminance = channels.map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.45 ? '#172033' : '#FFFFFF';
}

export const PASTEL_CALENDAR_COLORS: CalendarColorPreferences = {
  meetingTypes: {
    'live-session': { accent: '#8B5CF6', background: '#FAF7FF' },
    'monthly-coaching': { accent: '#60A5FA', background: '#F4F8FF' },
    'progress-review': { accent: '#2DD4BF', background: '#F1FFFC' },
    'gateway-review': { accent: '#818CF8', background: '#F4F4FF' },
    'personal-support-plan': { accent: '#F472B6', background: '#FFF5FA' },
    review: { accent: '#94A3B8', background: '#F8FAFC' },
    'catch-up': { accent: '#FB923C', background: '#FFF9F2' },
    support: { accent: '#22D3EE', background: '#F1FDFF' },
    other: { accent: '#9CA3AF', background: '#FAFAFA' },
  },
  statuses: {
    all: { accent: '#FFFFFF', background: '#8B5CF6' },
    'missed-overdue': { accent: '#F87171', background: '#FFF5F5' },
    'pending-due-soon': { accent: '#FBBF24', background: '#FFFDF4' },
    'awaiting-signature': { accent: '#FBBF24', background: '#FFFDF4' },
    'in-progress': { accent: '#FBBF24', background: '#FFFDF4' },
    scheduled: { accent: '#34D399', background: '#F1FFF8' },
    completed: { accent: '#34D399', background: '#F1FFF8' },
    'not-scheduled': { accent: '#9CA3AF', background: '#F7F8FA' },
  },
};

export const HIGH_CONTRAST_CALENDAR_COLORS: CalendarColorPreferences = {
  meetingTypes: {
    'live-session': { accent: '#5B21B6', background: '#EDE9FE' },
    'monthly-coaching': { accent: '#1D4ED8', background: '#DBEAFE' },
    'progress-review': { accent: '#0F766E', background: '#CCFBF1' },
    'gateway-review': { accent: '#3730A3', background: '#E0E7FF' },
    'personal-support-plan': { accent: '#9D174D', background: '#FCE7F3' },
    review: { accent: '#334155', background: '#E2E8F0' },
    'catch-up': { accent: '#C2410C', background: '#FFEDD5' },
    support: { accent: '#0E7490', background: '#CFFAFE' },
    other: { accent: '#374151', background: '#E5E7EB' },
  },
  statuses: {
    all: { accent: '#FFFFFF', background: '#5B21B6' },
    'missed-overdue': { accent: '#B91C1C', background: '#FEE2E2' },
    'pending-due-soon': { accent: '#B45309', background: '#FEF3C7' },
    'awaiting-signature': { accent: '#B45309', background: '#FEF3C7' },
    'in-progress': { accent: '#B45309', background: '#FEF3C7' },
    scheduled: { accent: '#047857', background: '#D1FAE5' },
    completed: { accent: '#047857', background: '#D1FAE5' },
    'not-scheduled': { accent: '#4B5563', background: '#E5E7EB' },
  },
};
