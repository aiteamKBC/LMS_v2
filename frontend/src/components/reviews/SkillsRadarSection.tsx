import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, LockKeyhole, Target, X } from 'lucide-react';
import type { ReviewFieldDefinition, ReviewSectionDefinition } from '@/api/reviewInstances';

type Level = { value: string; label: string };
type Entry = { role: string; value: string | null; at: string };
type Metadata = { questionId: string; standardId: string; standard: string; question: string;
  kind: 'learner' | 'coach' | 'goal'; role: 'participant' | 'advisor'; levels: Level[];
  capturedAt?: string | null; baseline?: Entry[]; history?: Entry[]; carriedAnswer?: string;
  continuation?: { status: string; message: string; plannedDate?: string; copiedAt?: string } };
type Question = { id: string; metadata: Metadata; fields: Partial<Record<Metadata['kind'], ReviewFieldDefinition>> };

const meta = (field: ReviewFieldDefinition) => field.configuration.skillsRadar as Metadata | undefined;
function levelCopy(label: string) {
  const parts = label.split(/\s+[—–-]\s+/, 2);
  return { heading: parts[0], description: parts.length > 1 ? label.slice(label.indexOf(parts[1])) : '' };
}
function radarStatus(coach: string, goal: string) {
  return coach === '' || goal === '' ? 'Not assessed' : Number(coach) >= Number(goal) ? 'Achieved' : 'Working Toward';
}
const recordedDate = (value?: string | null) => {
  if (!value) return 'Date unavailable';
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London',
  }).format(at) : 'Date unavailable';
};

interface Props {
  section: ReviewSectionDefinition;
  answers: Record<string, unknown>;
  onAnswerChange: (id: string, value: unknown) => void;
  readOnly?: boolean;
  fieldReadOnly?: (field: ReviewFieldDefinition) => boolean;
  respondentRole?: 'participant' | 'employer';
}

export function SkillsRadarSection({ section, answers, onAnswerChange, readOnly = false, fieldReadOnly, respondentRole }: Props) {
  const questions = new Map<string, Question>();
  for (const field of section.fields) {
    const metadata = meta(field);
    if (!metadata) continue;
    const question = questions.get(metadata.questionId) || { id: metadata.questionId, metadata, fields: {} };
    question.fields[metadata.kind] = field;
    if (metadata.kind === 'coach') question.metadata = metadata;
    questions.set(metadata.questionId, question);
  }
  const items = [...questions.values()];
  const standards = [...new Map(items.map(item => [item.metadata.standardId, item.metadata.standard])).entries()];
  const [selected, setSelected] = useState(standards[0]?.[0] || '');
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const currentStandard = standards.some(([id]) => id === selected) ? selected : standards[0]?.[0];
  const shown = items.filter(item => item.metadata.standardId === currentStandard);
  const current = shown.find(item => item.id === open);
  const continuation = items[0]?.metadata.continuation;
  const value = (field?: ReviewFieldDefinition) => {
    const answer = field ? answers[field.id] : null;
    return typeof answer === 'string' ? answer : '';
  };
  const canEdit = (field?: ReviewFieldDefinition) => Boolean(field && meta(field)?.role === (respondentRole || 'advisor')
    && !(fieldReadOnly ? fieldReadOnly(field) : readOnly));
  const title = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [open]);

  return <div className="space-y-4" aria-label="Skills Radar assessments">
    {continuation && <p role="status" className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm">
      {continuation.message}{continuation.status === 'copied' && continuation.plannedDate
        ? ` Previous review: ${recordedDate(continuation.plannedDate)}. Existing achievements and working-toward ratings are included.` : ''}
    </p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="min-w-0 text-sm font-semibold">Standard
        <select aria-label="Skills Radar standard" value={currentStandard} onChange={event => { setSelected(event.target.value); setOpen(null); }}
          className="ml-3 max-w-full rounded-lg border border-primary-200 bg-white p-2 font-normal">
          {standards.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} />Show history</label>
    </div>
    <p className="text-xs text-foreground-500">Learner assessment · Coach assessment · Dashed line: Goal. Use the review form’s save button to keep your changes.</p>
    <div className="overflow-hidden rounded-xl border border-primary-200">
      {shown.map((question, index) => {
        const coach = value(question.fields.coach), learner = value(question.fields.learner), goal = value(question.fields.goal);
        const status = radarStatus(coach, goal);
        const maximum = Math.max(1, ...question.metadata.levels.map(level => Number(level.value)));
        return <div key={question.id} className="border-b border-primary-100 last:border-b-0">
          <button type="button" onClick={() => setOpen(question.id)}
            className="grid w-full items-center gap-4 p-4 text-left hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 md:grid-cols-[minmax(0,1fr)_9rem_minmax(12rem,1fr)]"
            aria-label={`Assess ${question.metadata.question}`}>
            <span className="text-sm"><span className="mr-2 font-bold">{index + 1}.</span>{question.metadata.question}</span>
            <span className={`w-fit rounded px-2 py-1 text-xs font-semibold ${status === 'Achieved' ? 'bg-emerald-50 text-emerald-700' : status === 'Working Toward' ? 'bg-pink-50 text-pink-700' : 'bg-background-100 text-foreground-500'}`}>{status}</span>
            <span className="space-y-1">
              <span className="relative block space-y-1 border-x border-background-300 py-1">
                <span role="img" aria-label={`Learner assessment: ${learner || 'Not assessed'}`} className="block h-2 rounded bg-blue-500" style={{ width: `${learner === '' ? 0 : Number(learner) / maximum * 100}%` }} />
                <span role="img" aria-label={`Coach assessment: ${coach || 'Not assessed'}`} className="block h-2 rounded bg-blue-900" style={{ width: `${coach === '' ? 0 : Number(coach) / maximum * 100}%` }} />
                {goal !== '' && <span aria-hidden className="absolute -bottom-1 -top-1 border-l border-dashed border-foreground-700" style={{ left: `${Number(goal) / maximum * 100}%` }} />}
              </span>
              <span className="flex justify-between text-[11px] text-foreground-500"><span>0</span><span>Goal: {goal || 'Not set'}</span><span>{maximum}</span></span>
            </span>
          </button>
          {history && <div className="space-y-1 bg-background-50 px-4 pb-4 text-xs text-foreground-600">
            {Object.values(question.fields).filter(field => meta(field)?.carriedAnswer !== undefined).map(field => <p key={`carried:${field.id}`}>
              Previous review {meta(field)?.kind === 'goal' ? 'goal' : meta(field)?.kind === 'learner' ? 'learner assessment' : 'coach assessment'}: {meta(field)?.carriedAnswer}
              {' · '}{recordedDate(meta(field)?.continuation?.plannedDate)} (starting value)
            </p>)}
            {Object.values(question.fields).flatMap(field => (meta(field)?.history || []).map((entry, i) => <p key={`${field.id}:${i}`}>{meta(field)?.kind === 'goal' ? 'Goal' : entry.role === 'participant' ? 'Learner assessment' : 'Coach assessment'}: {entry.value || 'Cleared'} · {recordedDate(entry.at)}</p>))}
            {question.metadata.baseline?.length ? <details><summary className="cursor-pointer font-semibold">Imported Aptem reference · Captured {recordedDate(question.metadata.capturedAt)}</summary>
              <p className="py-1">Learner competency report captured during import; these are not assessments recorded in this review.</p>
              {question.metadata.baseline.map((entry, i) => <p key={i}>{entry.role === 'participant' ? 'Imported learner assessment' : 'Imported staff assessment'}: {entry.value} · {recordedDate(entry.at)}</p>)}
            </details> : <p>No imported assessment history recorded.</p>}
          </div>}
        </div>;
      })}
    </div>
    {current && createPortal(<div className="fixed inset-0 z-[110] flex justify-end bg-slate-950/40 backdrop-blur-[2px]">
      <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={title} className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(null); }
          if (event.key === 'Tab') {
            const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary');
            const first = controls?.[0], last = controls?.[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <div className="shrink-0 border-b border-primary-100 px-5 pb-4 pt-5 sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><Target size={18} aria-hidden="true" /></span>
              <div><p className="text-sm font-semibold text-foreground-900">Skills Radar</p><p className="mt-0.5 text-xs text-foreground-500">Question {shown.indexOf(current) + 1} of {shown.length}</p></div>
            </div>
            <button type="button" aria-label="Close" onClick={() => setOpen(null)} className="rounded-full p-2 text-foreground-500 transition hover:bg-background-100 hover:text-foreground-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"><X size={20} aria-hidden="true" /></button>
          </div>
          <div aria-hidden="true" className="mt-4 h-1 overflow-hidden rounded-full bg-primary-50"><div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${(shown.indexOf(current) + 1) / shown.length * 100}%` }} /></div>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-slate-50/60 px-5 py-6 sm:px-7">
        <div className="space-y-3">
          <h3 id={title} className="text-lg font-semibold leading-relaxed text-foreground-900">{current.metadata.question}</h3>
          {readOnly && !respondentRole && <p className="flex items-start gap-2 text-xs leading-5 text-foreground-500">
            <LockKeyhole size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong className="font-semibold">Read-only preview.</strong> Assessment and goal options are shown for reference.</span>
          </p>}
        </div>
        {(['learner', 'coach'] as const).map(kind => {
          const field = current.fields[kind];
          const showOptions = canEdit(field) || (readOnly && !respondentRole && kind === 'coach');
          return <fieldset key={kind} disabled={!canEdit(field)} className="min-w-0">
            <legend className="mb-3 w-full text-sm font-semibold text-foreground-900">{kind === 'learner' ? 'Learner assessment' : 'Coach assessment'}</legend>
            {!canEdit(field) && !showOptions ? <p className="rounded-xl border border-background-200 bg-white px-4 py-3 text-sm text-foreground-600">
              {value(field) === '' ? 'Not assessed' : `${value(field)} — ${current.metadata.levels.find(level => level.value === value(field))?.label || ''}`}
            </p> : null}
            {showOptions && <div className="overflow-hidden rounded-xl border border-background-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-background-200 bg-slate-50 px-4 py-2.5 text-xs text-foreground-500">
                <span>{canEdit(field) ? 'Choose the best match' : 'Assessment scale'}</span>
                <span className="font-medium">{value(field) === '' ? 'Not assessed' : `Current score: ${value(field)}`}</span>
              </div>
              {[...current.metadata.levels].reverse().map(level => {
                const selected = value(field) === level.value;
                const copy = levelCopy(level.label);
                return <label key={level.value} className={`relative flex items-start gap-3 border-b border-background-100 px-4 py-3.5 text-sm transition last:border-b-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary-400 ${selected ? 'bg-primary-50' : canEdit(field) ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
                  <input type="radio" className="sr-only" aria-label={level.label} disabled={!canEdit(field)} name={`${title}:${kind}`} value={level.value} checked={selected} onChange={() => field && canEdit(field) && onAnswerChange(field.id, level.value)} />
                  <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${selected ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>{level.value}</span>
                  <span className="min-w-0 flex-1"><span className="block font-semibold leading-5 text-foreground-900">{copy.heading}</span>{copy.description && <span className="mt-1 block text-[13px] leading-5 text-foreground-500">{copy.description}</span>}</span>
                  <span aria-hidden="true" className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-primary-600 text-white' : 'border border-background-300'}`}>{selected && <Check size={12} />}</span>
                </label>;
              })}
            </div>}
            {!current.metadata.levels.length && <p>No verified assessment scale is available.</p>}
          </fieldset>;
        })}
        <div className="space-y-3 rounded-xl border border-primary-100 bg-white p-4">
        <label className="block space-y-2 text-sm font-semibold text-foreground-900">Goal
          <select aria-describedby={value(current.fields.goal) ? `${title}-goal-description` : undefined} value={value(current.fields.goal)} disabled={!canEdit(current.fields.goal)} onChange={event => current.fields.goal && canEdit(current.fields.goal) && onAnswerChange(current.fields.goal.id, event.target.value)} className="block w-full rounded-lg border border-background-300 bg-white px-3 py-2.5 text-sm font-normal text-foreground-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50 disabled:text-foreground-500">
            <option value="">Choose a goal</option>{current.metadata.levels.map(level => <option key={level.value} value={level.value}>{level.value} — {level.label}</option>)}
          </select>
        </label>
        {value(current.fields.goal) && <p id={`${title}-goal-description`} className="break-words text-sm leading-6 text-foreground-700">
          {current.metadata.levels.find(level => level.value === value(current.fields.goal))?.label}
        </p>}
        <p className="text-xs leading-5 text-foreground-500">The target uses the same assessment scale above.</p>
        {readOnly && !respondentRole && <details className="group border-t border-background-100 pt-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-primary-700 [&::-webkit-details-marker]:hidden">View goal options<ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <ul aria-label="Goal options" className="mt-3 divide-y divide-background-100">
            {current.metadata.levels.map(level => <li key={level.value} className="flex items-start gap-3 py-3 text-sm leading-6 text-foreground-600"><strong className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">{level.value}</strong><span className="min-w-0 break-words">{level.label}</span></li>)}
          </ul>
        </details>}
        </div>
        <div className="flex items-center justify-between gap-3 text-xs"><span className="text-foreground-500">Assessment outcome</span><span className={`rounded-full px-3 py-1.5 font-semibold ${radarStatus(value(current.fields.coach), value(current.fields.goal)) === 'Achieved' ? 'bg-emerald-50 text-emerald-700' : radarStatus(value(current.fields.coach), value(current.fields.goal)) === 'Working Toward' ? 'bg-amber-50 text-amber-800' : 'bg-background-100 text-foreground-600'}`}>{radarStatus(value(current.fields.coach), value(current.fields.goal))}</span></div>
        </div>
        <div className="flex shrink-0 justify-between gap-3 border-t border-primary-100 bg-white px-5 py-4 sm:px-7"><button type="button" disabled={shown.indexOf(current) === 0} onClick={() => setOpen(shown[shown.indexOf(current) - 1].id)} className="inline-flex items-center gap-2 rounded-lg border border-background-200 px-4 py-2.5 text-sm font-medium text-foreground-700 hover:bg-background-50 disabled:opacity-40"><ChevronLeft size={16} aria-hidden="true" />Previous</button>
          <button type="button" onClick={() => setOpen(shown[shown.indexOf(current) + 1]?.id || null)} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700">{shown.indexOf(current) === shown.length - 1 ? 'Done' : 'Next question'}<ChevronRight size={16} aria-hidden="true" /></button></div>
      </section>
    </div>, document.body)}
  </div>;
}
