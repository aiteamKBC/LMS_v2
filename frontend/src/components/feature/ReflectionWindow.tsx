import { useMemo, useState } from 'react';
import type { LearnerKsbItem } from '@/api/learnerDetail';

/* ═══════════════════════════════════════════════════════
   REFLECTION WINDOW — shared by quiz-take and video-watch.
   2 tabs: KSBs + feedback, and time-taken. Returns
   { ksbs, feedback, reportedTime } via onSubmit.
   ═══════════════════════════════════════════════════════ */

const KSB_TYPE_LABELS: Record<string, string> = { K: 'Knowledge', S: 'Skills', B: 'Behaviours' };
const KSB_TYPE_ORDER = ['K', 'S', 'B'];

/** Group a flat KSB list into type buckets, ordered K → S → B, then by number. */
function groupKsbsByType(ksbs: LearnerKsbItem[]) {
  const byType: Record<string, LearnerKsbItem[]> = {};
  for (const k of ksbs) {
    const t = (k.type || k.code.charAt(0) || '?').toUpperCase();
    (byType[t] ||= []).push(k);
  }
  const types = Object.keys(byType).sort((a, b) => {
    const ia = KSB_TYPE_ORDER.indexOf(a); const ib = KSB_TYPE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return types.map((t) => ({
    type: t,
    label: KSB_TYPE_LABELS[t] || t,
    items: byType[t].slice().sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)),
  }));
}

/** MM:SS from total seconds (e.g. 26 -> "0:26"). */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ReflectionWindow({
  learnerKsbs, elapsedSeconds, plannedTimeLabel, noun = 'quiz',
  submitting, submitError, onSubmit,
}: {
  learnerKsbs: LearnerKsbItem[];
  elapsedSeconds: number;
  plannedTimeLabel: string;            // e.g. "20 min" — the planned-time preset (empty if none)
  noun?: string;                       // "quiz" | "video" — used in the copy
  submitting: boolean;
  submitError: string | null;
  onSubmit: (r: { ksbs: string[]; feedback: string; reportedTime: string }) => void;
}) {
  const [tab, setTab] = useState<'ksbs' | 'time'>('ksbs');
  const [selectedKsbs, setSelectedKsbs] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [timeMode, setTimeMode] = useState<'planned' | 'custom' | null>(null);
  const [customTime, setCustomTime] = useState('');
  const [triedSave, setTriedSave] = useState(false);

  const groups = useMemo(() => groupKsbsByType(learnerKsbs), [learnerKsbs]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (t: string) => expanded[t] ?? true; // default: open

  const toggleKsb = (code: string) =>
    setSelectedKsbs((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const toggleGroup = (codes: string[], allSelected: boolean) =>
    setSelectedKsbs((prev) => (allSelected
      ? prev.filter((c) => !codes.includes(c))
      : Array.from(new Set([...prev, ...codes]))));

  // Time is obligatory: a mode must be chosen, and if custom it must be non-empty.
  const reportedTime = timeMode === 'planned' ? plannedTimeLabel : timeMode === 'custom' ? customTime.trim() : '';
  const timeValid = reportedTime.length > 0;

  const handleSave = () => {
    if (!timeValid) {
      setTriedSave(true);
      setTab('time');
      return;
    }
    onSubmit({ ksbs: selectedKsbs, feedback: feedback.trim(), reportedTime });
  };

  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 card-premium overflow-hidden">
      {/* Header */}
      <div className="px-5 md:px-6 pt-5 pb-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
            <i className="ri-checkbox-circle-line text-primary-600 text-base" />
          </div>
          <div>
            <h1 className="text-base font-heading font-bold text-foreground-900">Before we finish…</h1>
            <p className="text-xs text-foreground-400">Tell us what this {noun} covered and how it went.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-background-300 mt-4">
          <TabButton active={tab === 'ksbs'} onClick={() => setTab('ksbs')} icon="ri-links-line" label="KSBs & Feedback" />
          <TabButton active={tab === 'time'} onClick={() => setTab('time')} icon="ri-timer-line" label="Time Taken" required={!timeValid} />
        </div>
      </div>

      {/* Tab content */}
      <div className="p-5 md:p-6">
        {tab === 'ksbs' ? (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-foreground-800 mb-1">Which KSBs did this {noun} fulfil?</p>
              <p className="text-xs text-foreground-400 mb-3">Expand a category and tick all that apply.</p>
              {learnerKsbs.length === 0 ? (
                <p className="text-xs text-foreground-400 italic">No KSBs available for this learner.</p>
              ) : (
                <div className="border border-background-300 rounded-xl divide-y divide-background-300 max-h-72 overflow-y-auto">
                  {groups.map((g) => {
                    const codes = g.items.map((k) => k.code);
                    const selectedInGroup = codes.filter((c) => selectedKsbs.includes(c)).length;
                    const allSelected = selectedInGroup === codes.length && codes.length > 0;
                    const someSelected = selectedInGroup > 0 && !allSelected;
                    const open = isExpanded(g.type);
                    return (
                      <div key={g.type}>
                        {/* Parent node */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-background-100/40">
                          <button
                            onClick={() => setExpanded((e) => ({ ...e, [g.type]: !open }))}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-background-200 cursor-pointer shrink-0"
                            aria-label={open ? 'Collapse' : 'Expand'}
                          >
                            <i className={`ri-arrow-right-s-line text-foreground-500 transition-transform ${open ? 'rotate-90' : ''}`} />
                          </button>
                          <button
                            onClick={() => toggleGroup(codes, allSelected)}
                            className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer text-left"
                          >
                            <span className={`shrink-0 w-4 h-4 rounded flex items-center justify-center border-2 ${
                              allSelected ? 'bg-primary-600 border-primary-600' : someSelected ? 'bg-primary-200 border-primary-400' : 'border-foreground-300'
                            }`}>
                              {allSelected ? <i className="ri-check-line text-white text-[10px]" /> : someSelected ? <i className="ri-subtract-line text-primary-700 text-[10px]" /> : null}
                            </span>
                            <span className="text-sm font-semibold text-foreground-800">{g.label} <span className="text-foreground-400 font-normal">({g.type})</span></span>
                            <span className="text-[11px] text-foreground-400">{selectedInGroup}/{codes.length}</span>
                          </button>
                        </div>
                        {/* Children */}
                        {open && (
                          <div className="pl-8 pr-2 py-1.5 space-y-1">
                            {g.items.map((k) => {
                              const selected = selectedKsbs.includes(k.code);
                              return (
                                <button
                                  key={k.code}
                                  onClick={() => toggleKsb(k.code)}
                                  className={`w-full flex items-start gap-2 p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                                    selected ? 'border-primary-400 bg-primary-50' : 'border-transparent hover:bg-background-100'
                                  }`}
                                >
                                  <span className={`shrink-0 w-4 h-4 rounded flex items-center justify-center mt-0.5 border-2 ${
                                    selected ? 'bg-primary-600 border-primary-600' : 'border-foreground-300'
                                  }`}>
                                    {selected && <i className="ri-check-line text-white text-[10px]" />}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="text-xs font-semibold text-primary-600">{k.code}</span>
                                    <span className="block text-[11px] text-foreground-600 line-clamp-2">{k.description}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedKsbs.length > 0 && (
                <p className="text-[11px] text-foreground-500 mt-2">{selectedKsbs.length} KSB{selectedKsbs.length === 1 ? '' : 's'} selected</p>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground-800 mb-2">Feedback about this {noun}</p>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
                placeholder={`How did you find the ${noun}? Anything you'd like to note…`}
                className="w-full px-3 py-2.5 text-sm bg-background-50 border border-foreground-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 text-foreground-800 resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-foreground-800">How long did it take you to complete this {noun}? <span className="text-red-500">*</span></p>
            <p className="text-xs text-foreground-400 -mt-2">We tracked {formatClock(elapsedSeconds)} while you worked. Please confirm or record your own — this is required.</p>

            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              timeMode === 'planned' ? 'border-primary-400 bg-primary-50' : 'border-foreground-200 hover:bg-background-100'
            } ${!plannedTimeLabel ? 'opacity-50 pointer-events-none' : ''}`}>
              <input type="radio" name="timeMode" checked={timeMode === 'planned'} onChange={() => setTimeMode('planned')} disabled={!plannedTimeLabel} className="accent-primary-600" />
              <span className="text-sm text-foreground-800">
                Use the planned time
                {plannedTimeLabel ? <span className="font-semibold"> ({plannedTimeLabel})</span> : <span className="text-foreground-400"> (none set)</span>}
              </span>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              timeMode === 'custom' ? 'border-primary-400 bg-primary-50' : 'border-foreground-200 hover:bg-background-100'
            }`}>
              <input type="radio" name="timeMode" checked={timeMode === 'custom'} onChange={() => setTimeMode('custom')} className="accent-primary-600 mt-1" />
              <span className="flex-1">
                <span className="text-sm text-foreground-800 block mb-2">Enter it myself</span>
                <input
                  type="text"
                  value={customTime}
                  onChange={(e) => { setCustomTime(e.target.value); setTimeMode('custom'); }}
                  placeholder="e.g. 25 minutes"
                  className="w-full h-10 px-3 text-sm bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 text-foreground-800"
                />
              </span>
            </label>

            {triedSave && !timeValid && (
              <p className="text-xs text-red-600 inline-flex items-center gap-1">
                <i className="ri-error-warning-line" /> Please record how long the {noun} took before finishing.
              </p>
            )}
          </div>
        )}

        {submitError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{submitError}</div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-background-300">
          {tab === 'ksbs' ? (
            <button onClick={() => setTab('time')} className="text-sm font-medium text-primary-600 hover:text-primary-700 cursor-pointer inline-flex items-center gap-1">
              Next: Time Taken <i className="ri-arrow-right-line" />
            </button>
          ) : (
            <button onClick={() => setTab('ksbs')} className="text-sm font-medium text-foreground-500 hover:text-foreground-700 cursor-pointer inline-flex items-center gap-1">
              <i className="ri-arrow-left-line" /> Back to KSBs
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={submitting || !timeValid}
            title={!timeValid ? `Record how long the ${noun} took first` : undefined}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {submitting ? <><i className="ri-loader-4-line animate-spin" /> Saving…</> : <><i className="ri-check-line" /> Finish & Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, required }: { active: boolean; onClick: () => void; icon: string; label: string; required?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 -mb-px transition-colors cursor-pointer ${
        active ? 'border-primary-600 text-primary-700' : 'border-transparent text-foreground-400 hover:text-foreground-600'
      }`}
    >
      <i className={icon} /> {label}
      {required && <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Required" />}
    </button>
  );
}
