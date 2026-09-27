import { AppIcon } from '@/components/feature/AppIcon';
import type { BookableSessionType } from '@/api/learnerCalendar';

export const COACH_SESSION_TYPES = [
  { value: 'catch-up', label: 'Catch-up', icon: 'ri-chat-3-line', desc: 'Quick check-in on your progress' },
  { value: 'student-support', label: 'Student Support', icon: 'ri-heart-2-line', desc: 'Help with challenges or wellbeing' },
  { value: 'progress-review', label: 'PR', icon: 'ri-line-chart-line', desc: 'Progress Review' },
  { value: 'mcr', label: 'MCM', icon: 'ri-calendar-check-line', desc: 'Monthly Coaching Meeting' },
  { value: 'gateway', label: 'Gateway', icon: 'ri-flag-line', desc: 'Gateway review or assessment' },
  { value: 'other', label: 'Other', icon: 'ri-more-line', desc: 'Request another session type' },
] as const;

export type CoachSessionRequestType = typeof COACH_SESSION_TYPES[number]['value'];

export const COACH_APPROVAL_SESSION_TYPES: ReadonlySet<BookableSessionType> = new Set([
  'student-support', 'gateway', 'other',
]);

export default function CoachSessionTypePicker({ value, onChange }: {
  value: BookableSessionType;
  onChange: (value: CoachSessionRequestType) => void;
}) {
  return <div role="group" aria-label="Session Type" className="grid grid-cols-2 gap-3">
    {COACH_SESSION_TYPES.map((type, index, list) => <button
      key={type.value}
      type="button"
      aria-pressed={value === type.value}
      onClick={() => onChange(type.value)}
      /* A lone trailing tile leaves a visible gap, so let it span the row. */
      className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${index === list.length - 1 && list.length % 2 === 1 ? 'col-span-2' : ''} ${value === type.value ? 'border-primary-400 bg-primary-50/40' : 'border-background-300 hover:border-background-400'}`}
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${value === type.value ? 'bg-primary-100 text-primary-600' : 'bg-background-100 text-foreground-500'}`}><AppIcon className={type.icon} /></span>
      <p className="text-sm font-semibold text-foreground-900">{type.label}</p>
      <p className="text-xs text-foreground-400 mt-0.5">{type.desc}</p>
    </button>)}
  </div>;
}
