import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Download, Layers, Link, LoaderCircle, Mail, QrCode, Search } from 'lucide-react';
import { SelectMenu } from '@/components/feature/SelectField';
import { qrAttendanceApi, type QRConfiguration, type QRConfirmation, type QRLecture, type QRModule } from '@/api/qrAttendance';
import { lectureDate } from './dates';
import { LectureCards } from './LectureCards';
import './attendance.css';

const field = 'min-h-12 w-full min-w-0 rounded-xl border border-primary-200/70 bg-white px-4 py-3 text-[16px] font-normal text-foreground-900 shadow-sm placeholder:text-foreground-500 transition-colors hover:border-primary-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-background-100 disabled:text-foreground-500';
const button = 'qr-primary-button qr-confirm-button inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-[16px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed';
const failure = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';

function StepLabel({ number, children }: { number: number; children: React.ReactNode }) {
  return <span className="qr-step-label">
    <span aria-hidden="true" className="qr-step-number">{number}</span>
    <span>{children}</span>
  </span>;
}

export default function QRAttendancePage() {
  const [config, setConfig] = useState<QRConfiguration | null>(null);
  const [email, setEmail] = useState('');
  const [identified, setIdentified] = useState(false);
  const [modules, setModules] = useState<QRModule[]>([]);
  const [moduleCandidates, setModuleCandidates] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<QRLecture[]>([]);
  const [lectures, setLectures] = useState<QRLecture[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [occurrenceId, setOccurrenceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingLectures, setLoadingLectures] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lectureError, setLectureError] = useState('');
  const [result, setResult] = useState<QRConfirmation | null>(null);
  const [copied, setCopied] = useState(false);
  const revision = useRef(0);
  const pendingSave = useRef(false);
  const alive = useRef(true);
  const selected = lectures.find(item => item.id === occurrenceId);
  const suggestedModules = modules.filter(item => moduleCandidates.includes(item.id));

  useEffect(() => {
    alive.current = true;
    let current = true;
    qrAttendanceApi.configuration().then(value => { if (current) setConfig(value); })
      .catch(reason => { if (current) setError(failure(reason)); });
    return () => { current = false; alive.current = false; revision.current += 1; };
  }, []);

  function resetEmail(value: string) {
    revision.current += 1;
    setEmail(value); setIdentified(false); setModules([]); setModuleCandidates([]); setSuggestions([]); setLectures([]);
    setModuleId(''); setOccurrenceId(''); setResult(null); setLectureError('');
    if (config) setError('');
    setLoading(false); setLoadingLectures(false);
  }

  async function chooseModule(id: string, preferredOccurrence = '', lookupEmail = email.trim(), knownConfig = config) {
    const ticket = ++revision.current;
    setModuleId(id); setOccurrenceId(''); setLectures([]); setResult(null); setLectureError(''); setError('');
    setLoadingLectures(Boolean(id));
    if (!id || !knownConfig) return;
    try {
      const response = await qrAttendanceApi.lectures(knownConfig.csrfToken, lookupEmail, id);
      if (ticket !== revision.current || !alive.current) return;
      setLectures(response.lectures);
      if (response.lectures.some(item => item.id === preferredOccurrence)) setOccurrenceId(preferredOccurrence);
      else {
        // New servers rank using the business timezone and verified placement.
        // Legacy servers can only suggest one running lecture, never a sole past/future row.
        const current = response.lectures.filter(item => item.current);
        const suggested = response.suggestedOccurrenceId === undefined
          ? (current.length === 1 ? current[0].id : null) : response.suggestedOccurrenceId;
        if (suggested && response.lectures.some(item => item.id === suggested)) setOccurrenceId(suggested);
      }
    } catch (reason) {
      if (ticket === revision.current && alive.current) setLectureError(failure(reason));
    } finally {
      if (ticket === revision.current && alive.current) setLoadingLectures(false);
    }
  }

  async function findLectures(event: React.FormEvent) {
    event.preventDefault();
    if (!config || loading) return;
    const ticket = ++revision.current;
    const normalized = email.trim();
    setLoading(true); setIdentified(false); setError(''); setResult(null);
    setModules([]); setModuleCandidates([]); setSuggestions([]); setModuleId(''); setOccurrenceId(''); setLectures([]);
    setLoadingLectures(false); setLectureError('');
    try {
      const response = await qrAttendanceApi.lookup(config.csrfToken, normalized);
      if (ticket !== revision.current || !alive.current) return;
      const candidates = new Set(response.moduleCandidates || []);
      setModuleCandidates([...candidates]);
      setIdentified(true); setModules([...response.modules.filter(item => candidates.has(item.id)),
        ...response.modules.filter(item => !candidates.has(item.id))]);
      setSuggestions(response.suggestions); setLoading(false);
      const legacy = response.suggestions.length === 1 ? response.suggestions[0] : null;
      const selection = response.selection ?? (legacy ? { moduleId: legacy.moduleId, occurrenceId: legacy.id } : null);
      if (selection?.moduleId && response.modules.some(item => item.id === selection.moduleId)) {
        await chooseModule(selection.moduleId, selection.occurrenceId || '', normalized, config);
      }
    } catch (reason) {
      if (ticket === revision.current && alive.current) setError(failure(reason));
    } finally {
      if (ticket === revision.current && alive.current) setLoading(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!config || !selected || pendingSave.current) return;
    pendingSave.current = true; setSaving(true); setError(''); setResult(null);
    try {
      const response = await qrAttendanceApi.confirm(config.csrfToken, email.trim(), moduleId, selected.id);
      if (alive.current) setResult(response);
    } catch (reason) {
      if (alive.current) setError(failure(reason));
    } finally {
      pendingSave.current = false;
      if (alive.current) setSaving(false);
    }
  }

  async function downloadQR() {
    const svg = document.getElementById('college-attendance-qr');
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'kbc-qr-attendance.svg'; link.click(); URL.revokeObjectURL(url);
  }

  return <main className="qr-attendance-page relative isolate min-h-screen text-foreground-900">
    <aside className="qr-building-panel" aria-label="Conceptual Kent Business College building illustration">
      <div className="qr-building-image" />
    </aside>
    <div className="qr-attendance-content">
      <section aria-labelledby="qr-attendance-heading" className="qr-attendance-card">
        <header className="qr-attendance-heading">
          <span className="qr-header-symbol" aria-hidden="true"><QrCode /></span>
          <h1 id="qr-attendance-heading">QR Attendance</h1>
          <p>Confirm your attendance for a programme lecture</p>
        </header>
        {!config && !error && <p role="status" className="mb-5 text-sm text-foreground-600">Loading attendance…</p>}
        <form onSubmit={findLectures} className="qr-step qr-email-step">
          <StepLabel number={1}><label htmlFor="qr-email">Your Registered Email</label></StepLabel>
          <div className="qr-email-fields">
            <div className="relative min-w-0 flex-1">
              <Mail aria-hidden="true" size={19} className="qr-email-icon" />
              <input id="qr-email" className={`${field} qr-email-input ${identified ? 'pr-12' : ''}`} type="email" required maxLength={320} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} disabled={saving} onChange={event => resetEmail(event.target.value)} placeholder="Enter your registered email" aria-describedby="qr-email-help" />
              {identified && <CheckCircle2 aria-hidden="true" size={20} className="absolute right-4 top-3.5 text-emerald-700" />}
            </div>
            <button className="qr-primary-button qr-find-button inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={!config || loading || saving}>
              {loading ? <LoaderCircle aria-hidden="true" size={18} className="motion-safe:animate-spin" /> : <Search aria-hidden="true" size={19} className="qr-find-search" />}
              {loading ? 'Finding lectures…' : 'Find My Lectures'}
            </button>
          </div>
          <div className="qr-email-status flex flex-wrap items-center justify-between gap-2 text-xs leading-5 sm:text-sm">
            <p id="qr-email-help" className="text-foreground-600">Use the email registered on the KBC LMS.</p>
            {identified && <p role="status" className="inline-flex items-center gap-1.5 font-medium text-emerald-700"><CheckCircle2 aria-hidden="true" size={16} />Email recognised</p>}
          </div>
        </form>
        <form onSubmit={confirm} className="qr-confirm-form">
          <div className="qr-step qr-module-step">
            <StepLabel number={2}><label htmlFor="qr-module">Choose Module</label></StepLabel>
            <div className="qr-module-control">
              <Layers aria-hidden="true" size={18} className="qr-module-icon" />
              <SelectMenu id="qr-module" ariaLabel="Choose Module" value={moduleId}
                options={modules.map(item => ({ value: item.id, label: item.title,
                  description: [item.group, item.cohort].filter(Boolean).join(' · ') }))}
                placeholder={identified ? 'Select a module' : 'Enter your email to find your modules'}
                disabled={!identified || saving || loading} onChange={id => void chooseModule(id)}
                searchable searchPlaceholder="Search modules, groups or cohorts…" emptyMessage="No matching modules."
                triggerClassName="qr-module-trigger" menuClassName="qr-module-menu" />
            </div>
            {identified && !suggestions.length && suggestedModules.length > 1 && <div className="qr-module-suggestions">
              <p id="qr-module-suggestions-label" className="text-sm font-semibold">Suggested modules</p>
              <div role="group" aria-labelledby="qr-module-suggestions-label" className="qr-module-suggestion-list">
                {suggestedModules.map(item => <button key={item.id} type="button" aria-pressed={moduleId === item.id}
                  disabled={saving || loading} onClick={() => void chooseModule(item.id)} className="qr-module-suggestion">
                  <Layers aria-hidden="true" size={18} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{item.title}</span>
                    <span className="qr-module-suggestion-detail">{[item.group, item.cohort].filter(Boolean).join(' · ')}</span>
                  </span>
                  {moduleId === item.id && <CheckCircle2 aria-hidden="true" size={18} className="shrink-0" />}
                </button>)}
              </div>
            </div>}
            {identified && !modules.length && <p role="status" className="text-sm leading-6 text-foreground-600">No curriculum modules are available for your programme. Please contact the college.</p>}
            {suggestions.length > 1 && config && <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-3">
              <p className="text-sm font-semibold text-primary-800">Suggested lectures</p>
              <p className="mt-1 text-xs text-foreground-600">Choose a suggestion, or select any module above.</p>
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                {suggestions.map(item => <button key={`${item.moduleId}:${item.id}`} type="button" disabled={saving} onClick={() => void chooseModule(item.moduleId, item.id)} className="block min-h-11 w-full rounded-lg border border-primary-100 bg-white p-3 text-left text-sm text-primary-800 hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <span className="block font-semibold">{item.title}</span><span className="mt-1 block text-xs">{lectureDate(item, config.timeZone)}</span>
                  <span className="mt-1 block text-xs">{[item.group, item.cohort].filter(Boolean).join(' · ')}</span>
                </button>)}
              </div>
            </div>}
          </div>
          <fieldset className="qr-step qr-lecture-step min-w-0" disabled={saving} aria-busy={loadingLectures}>
            <legend><StepLabel number={3}>Choose Lecture</StepLabel></legend>
            {!moduleId && <p className="qr-lecture-placeholder rounded-xl border border-dashed border-primary-200 bg-background-50 px-4 py-6 text-center text-sm leading-6 text-foreground-600">{identified ? 'Choose a module to see its lectures.' : 'Your available lectures will appear here.'}</p>}
            {loadingLectures && <p role="status" className="flex items-center gap-2 rounded-xl bg-primary-50 px-4 py-6 text-sm text-primary-700"><LoaderCircle aria-hidden="true" size={18} className="motion-safe:animate-spin" />Loading lectures…</p>}
            {moduleId && !loadingLectures && !lectureError && !lectures.length && <p role="status" className="rounded-xl border border-dashed border-primary-200 bg-background-50 px-4 py-6 text-sm leading-6 text-foreground-600">No lectures are scheduled for this module. Please choose another module.</p>}
            {lectureError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{lectureError}<button type="button" className="ml-2 inline-flex min-h-11 items-center px-2 font-semibold underline focus-visible:ring-2 focus-visible:ring-red-500" onClick={() => void chooseModule(moduleId)}>Retry</button></div>}
            {config && lectures.length > 0 && <LectureCards lectures={lectures} selectedId={occurrenceId} timeZone={config.timeZone} disabled={saving} onSelect={id => { setOccurrenceId(id); setResult(null); setError(''); }} />}
          </fieldset>
          <button className={button} disabled={!identified || !config || !selected || loadingLectures || saving}>
            {saving ? <LoaderCircle aria-hidden="true" size={20} className="motion-safe:animate-spin" /> : <CheckCircle2 aria-hidden="true" size={20} />}
            {saving ? 'Confirming…' : 'Confirm Attendance'}
          </button>
        </form>
        {result && <div role="status" className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800"><CheckCircle2 aria-hidden="true" size={20} className="mt-0.5 shrink-0" />{result.message}</div>}
        {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{error}{!config && <button type="button" className="ml-2 inline-flex min-h-11 items-center px-2 font-semibold underline focus-visible:ring-2 focus-visible:ring-red-500" onClick={() => window.location.reload()}>Reload</button>}</div>}
      </section>
      {config && <details className="qr-attendance-sharing mx-auto mt-5 border-t border-primary-200/50 px-3 text-sm text-foreground-700">
        <summary className="min-h-11 cursor-pointer py-3 text-[13px] font-medium text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">College attendance QR</summary>
        <div className="mt-4 flex flex-col items-center gap-3">
          <QRCodeSVG id="college-attendance-qr" value={config.url} size={200} marginSize={4} title="Kent Business College attendance" />
          <p className="max-w-full break-all text-center text-xs">{config.url}</p>
          <p className="text-center text-xs">The same code works for every lecture.</p>
          <div className="flex flex-wrap justify-center gap-4 pb-4"><button type="button" className="inline-flex min-h-11 items-center gap-2 px-2 font-semibold text-primary-700 underline focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => void downloadQR()}><Download aria-hidden="true" size={16} />Download QR</button>
            <button type="button" className="inline-flex min-h-11 items-center gap-2 px-2 font-semibold text-primary-700 underline focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => void navigator.clipboard.writeText(config.url).then(() => setCopied(true)).catch(() => setError('Could not copy the link. Please copy the displayed address.'))}><Link aria-hidden="true" size={16} />{copied ? 'Link copied' : 'Copy link'}</button></div>
        </div>
      </details>}
    </div>
  </main>;
}
