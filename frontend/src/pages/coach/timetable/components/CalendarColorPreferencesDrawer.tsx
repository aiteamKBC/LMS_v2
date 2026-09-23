import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CALENDAR_STATUS_DEFINITIONS,
  DEFAULT_CALENDAR_COLORS,
  HIGH_CONTRAST_CALENDAR_COLORS,
  MEETING_TYPE_DEFINITIONS,
  PASTEL_CALENDAR_COLORS,
  cloneCalendarColors,
  readableTextColor,
  type CalendarColorPair,
  type CalendarColorPreferences,
  type CalendarStatusKey,
  type MeetingTypeKey,
} from '../calendarColors';

type ColorTab = 'meeting-types' | 'statuses';

interface CalendarColorPreferencesDrawerProps {
  open: boolean;
  value: CalendarColorPreferences;
  onClose: () => void;
  onSave: (value: CalendarColorPreferences) => void;
  activeMeetingTypeKeys?: MeetingTypeKey[];
}

const PRESETS = [
  { key: 'default', label: 'Default', value: DEFAULT_CALENDAR_COLORS },
  { key: 'pastel', label: 'Pastel', value: PASTEL_CALENDAR_COLORS },
  { key: 'high-contrast', label: 'High Contrast', value: HIGH_CONTRAST_CALENDAR_COLORS },
] as const;

function isHex(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

const COLOR_NAMES: Record<string, string> = {
  '#7C3AED': 'Purple',
  '#2563EB': 'Blue',
  '#0D9488': 'Teal',
  '#4F46E5': 'Indigo',
  '#DB2777': 'Pink',
  '#64748B': 'Slate',
  '#EA580C': 'Orange',
  '#0891B2': 'Cyan',
  '#6B7280': 'Gray',
  '#DC2626': 'Red',
  '#D97706': 'Amber',
  '#059669': 'Green',
};

function colorName(value: string) {
  return COLOR_NAMES[value.toUpperCase()] || 'Custom';
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-xl bg-white px-2.5 py-2 transition hover:bg-[#F7F3FB] focus-within:ring-2 focus-within:ring-[#4F2D7F]/20">
      <input
        type="color"
        aria-label={label}
        value={isHex(value) ? value : '#ffffff'}
        onChange={event => onChange(event.target.value.toUpperCase())}
        className="sr-only"
      />
      <span className="h-6 w-6 shrink-0 rounded-full shadow-sm ring-2 ring-white" style={{ backgroundColor: isHex(value) ? value : '#CBD5E1' }} />
      <span className="min-w-0 truncate whitespace-nowrap break-normal text-[11px] font-bold text-slate-700">{label}: {colorName(value)}</span>
      <AppIcon className="ri-pencil-line ml-auto shrink-0 text-sm text-slate-400 transition group-hover:text-[#4F2D7F]" />
    </label>
  );
}

function PairEditor({
  pair,
  onChange,
}: {
  pair: CalendarColorPair;
  onChange: (pair: CalendarColorPair) => void;
}) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:min-w-[210px] sm:w-auto">
      <ColorField label="Accent" value={pair.accent} onChange={accent => onChange({ ...pair, accent })} />
      <ColorField label="Fill" value={pair.background} onChange={background => onChange({ ...pair, background })} />
    </div>
  );
}

export function CalendarColorPreferencesDrawer({
  open,
  value,
  onClose,
  onSave,
  activeMeetingTypeKeys,
}: CalendarColorPreferencesDrawerProps) {
  const [tab, setTab] = useState<ColorTab>('meeting-types');
  const [draft, setDraft] = useState<CalendarColorPreferences>(() => cloneCalendarColors(value));
  const [preset, setPreset] = useState('default');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(cloneCalendarColors(value));
    setPreset('default');
    setTab('meeting-types');
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open, value]);

  const activeDefinitions = useMemo(() => {
    const active = new Set(activeMeetingTypeKeys || []);
    return MEETING_TYPE_DEFINITIONS.filter(item => active.size === 0 || active.has(item.key));
  }, [activeMeetingTypeKeys]);

  if (!open) return null;

  const updateMeetingType = (key: MeetingTypeKey, pair: CalendarColorPair) => {
    setDraft(current => ({ ...current, meetingTypes: { ...current.meetingTypes, [key]: pair } }));
    setPreset('custom');
  };
  const updateStatus = (key: CalendarStatusKey, pair: CalendarColorPair) => {
    setDraft(current => ({ ...current, statuses: { ...current.statuses, [key]: pair } }));
    setPreset('custom');
  };
  const applyPreset = (nextPreset: typeof PRESETS[number]) => {
    setDraft(cloneCalendarColors(nextPreset.value));
    setPreset(nextPreset.key);
  };
  const hasInvalidColor = [...Object.values(draft.meetingTypes), ...Object.values(draft.statuses)]
    .some(pair => !isHex(pair.accent) || !isHex(pair.background));

  const previewEvents = [
    { key: 'monthly-coaching' as MeetingTypeKey, status: 'missed-overdue' as CalendarStatusKey, title: 'Monthly Coaching Meeting' },
    { key: 'progress-review' as MeetingTypeKey, status: 'completed' as CalendarStatusKey, title: 'Progress Review' },
    { key: 'catch-up' as MeetingTypeKey, status: 'pending-due-soon' as CalendarStatusKey, title: 'Catch-up Session' },
  ];

  return (
    <div className="fixed inset-0 z-[130] flex justify-end" role="presentation">
      <button type="button" aria-label="Close calendar color preferences" onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/25 backdrop-blur-[1px]" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-color-preferences-title"
        className="relative flex h-full w-full max-w-[520px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1ECF8] text-[#4F2D7F]"><AppIcon className="ri-palette-line text-lg" /></span>
            <div>
              <h2 id="calendar-color-preferences-title" className="text-lg font-heading font-bold tracking-tight text-slate-950">Calendar Color Preferences</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Customize the colors used for meeting types and statuses in your calendar.</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close color preferences" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#4F2D7F]/30"><AppIcon className="ri-close-line text-lg" /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="grid grid-cols-2 border-b border-slate-200 px-5 pt-4">
            {([
              ['meeting-types', 'Meeting Type Colors'],
              ['statuses', 'Status Colors (RAG)'],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`border-b-2 px-2 pb-3 text-left text-xs font-bold transition ${tab === key ? 'border-[#4F2D7F] text-[#4F2D7F]' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>{label}</button>
            ))}
          </div>

          <div className="space-y-5 px-5 py-5">
            {tab === 'meeting-types' ? (
              <section aria-labelledby="meeting-type-colors-heading">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <h3 id="meeting-type-colors-heading" className="text-sm font-heading font-bold text-slate-950">Meeting type mapping</h3>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">These colors identify what each session is.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Accent + fill</span>
                </div>
                <div className="space-y-2">
                  {activeDefinitions.map(definition => {
                    const pair = draft.meetingTypes[definition.key];
                    return (
                      <div key={definition.key} className="flex flex-col items-stretch gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 sm:flex-row sm:items-center">
                        <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: pair.accent }} />
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: pair.background, color: pair.accent }}><AppIcon className={definition.icon} /></span>
                        <div className="w-full min-w-[160px] flex-1 basis-0 sm:w-auto"><p className="truncate text-xs font-bold text-slate-800">{definition.label}</p><p className="mt-0.5 whitespace-normal break-normal leading-4 text-[10px] text-slate-400">Choose the accent and fill colors</p></div>
                        <PairEditor pair={pair} onChange={next => updateMeetingType(definition.key, next)} />
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <section aria-labelledby="status-colors-heading">
                <div className="mb-3"><h3 id="status-colors-heading" className="text-sm font-heading font-bold text-slate-950">Status color mapping</h3><p className="mt-1 text-[11px] leading-4 text-slate-500">RAG colors identify the current condition of a meeting or case.</p></div>
                <div className="space-y-2">
                  {CALENDAR_STATUS_DEFINITIONS.map(definition => {
                    const pair = draft.statuses[definition.key];
                    return (
                      <div key={definition.key} className="flex flex-col items-stretch gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: pair.accent }} />
                        <div className="w-full min-w-[160px] flex-1 basis-0 sm:w-auto"><p className="truncate text-xs font-bold text-slate-800">{definition.label}</p><p className="mt-0.5 whitespace-normal break-normal leading-4 text-[10px] text-slate-400">{definition.description}</p></div>
                        <PairEditor pair={pair} onChange={next => updateStatus(definition.key, next)} />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="border-t border-slate-200 pt-5" aria-labelledby="calendar-palette-heading">
              <h3 id="calendar-palette-heading" className="text-sm font-heading font-bold text-slate-950">Preset palettes</h3>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">Quickly apply a predefined scheme, then adjust individual colors.</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {PRESETS.map(item => (
                  <button key={item.key} type="button" onClick={() => applyPreset(item)} className={`rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition ${preset === item.key ? 'border-[#4F2D7F] bg-[#F7F3FB] text-[#4F2D7F] ring-2 ring-[#4F2D7F]/10' : 'border-slate-200 text-slate-600 hover:border-[#C9B9DD] hover:bg-slate-50'}`}>
                    <span className="mb-2 flex gap-1">{Object.values(item.value.meetingTypes).slice(0, 4).map(pair => <span key={pair.accent} className="h-2.5 flex-1 rounded-full" style={{ backgroundColor: pair.accent }} />)}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="border-t border-slate-200 pt-5" aria-labelledby="calendar-preview-heading">
              <h3 id="calendar-preview-heading" className="text-sm font-heading font-bold text-slate-950">Live preview</h3>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">See how meeting and status colors work together.</p>
              <div className="mt-3 grid gap-2">
                {previewEvents.map(preview => {
                  const meeting = draft.meetingTypes[preview.key];
                  const status = draft.statuses[preview.status];
                  const statusLabel = CALENDAR_STATUS_DEFINITIONS.find(item => item.key === preview.status)?.label || '';
                  return (
                    <div key={preview.key} className="rounded-xl border px-3 py-2.5" style={{ borderColor: `${meeting.accent}55`, borderLeftWidth: 3, backgroundColor: meeting.background }}>
                      <div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-bold" style={{ color: meeting.accent }}>{preview.title}</p><span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold" style={{ backgroundColor: status.background, color: status.accent }}>{statusLabel}</span></div>
                      <p className="mt-1 text-[10px]" style={{ color: readableTextColor(meeting.background) }}>09:00 · Ava / Any Test</p>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-4">
          <button type="button" onClick={() => { setDraft(cloneCalendarColors(DEFAULT_CALENDAR_COLORS)); setPreset('default'); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"><AppIcon className="ri-refresh-line" /> Reset to Default</button>
          <div className="flex items-center gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">Cancel</button><button type="button" disabled={hasInvalidColor} onClick={() => onSave(cloneCalendarColors(draft))} className="rounded-lg bg-[#4F2D7F] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#422366] disabled:cursor-not-allowed disabled:opacity-50">Save Changes</button></div>
        </footer>
      </aside>
    </div>
  );
}
