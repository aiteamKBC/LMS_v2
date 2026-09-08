import { useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { ComponentKsbMapping, LearnerKind, LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerDetail } from '@/api/learnerDetail';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { exportMonthlyPresentation, type MonthlyAssignment, type AssignmentQualityCheck } from '@/api/monthlyAssignment';
import { proofreadLearningReflection, transcribeVoiceReflection } from '@/api/reflectionVoice';
import type { LearningReflectionSubmissionInput } from '@/api/reflectionSubmission';
import type { AssignmentAnswers } from './AssignmentSubmissionWizard';

const inputClass = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50';
const buttonClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-blue-50 disabled:opacity-40';

/** AI never silently replaces a learner's answer: suggestions require acceptance. */
export function MonthlyAnswerField({ label, value, onChange, disabled, title, rows = 5 }: {
  label: string; value: string; onChange: (value: string) => void; disabled: boolean; title: string; rows?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const active = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      recorder.current?.stream.getTracks().forEach(track => track.stop());
    };
  }, []);
  const context = { activityTitle: `${title}: ${label}`, moduleLabel: '', weekLabel: '' };
  const proofread = async () => {
    setBusy(true); setError('');
    try { const result = await proofreadLearningReflection(value, context); if (active.current) setSuggestion(result.text); }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Proofreading unavailable.'); }
    finally { if (active.current) setBusy(false); }
  };
  const record = async () => {
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return; }
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Voice recording is not available in this browser. You can type your answer.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
      const media = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.current = media;
      const chunks: Blob[] = [];
      // Keep each recording bounded; answers can contain multiple recordings.
      const limit = window.setTimeout(() => { if (media.state === 'recording') media.stop(); }, 120000);
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = async () => {
        window.clearTimeout(limit); stream.getTracks().forEach(track => track.stop());
        if (!active.current) return;
        setRecording(false); setBusy(true);
        try {
          const result = await transcribeVoiceReflection(new Blob(chunks, { type: media.mimeType }), context);
          if (active.current) onChange([valueRef.current, result.text].filter(Boolean).join('\n'));
        } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Could not transcribe recording.'); }
        finally { if (active.current) setBusy(false); }
      };
      media.start(); setRecording(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Microphone access failed.'); }
  };
  return <div>
    <label className="block text-sm font-medium text-slate-900">{label}
      <textarea className={inputClass} rows={rows} value={value} disabled={disabled || busy || recording} onChange={e => onChange(e.target.value)} />
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => void record()}>{recording ? 'Stop recording' : 'Record by voice'}</button>
      <button type="button" className={buttonClass} disabled={disabled || busy || recording || !value.trim()} onClick={() => void proofread()}>{busy ? 'Processing…' : 'AI proofread & improve'}</button>
      <span className="ml-auto text-xs text-slate-500">{value.trim().split(/\s+/).filter(Boolean).length} words</span>
    </div>
    {suggestion && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm"><p className="whitespace-pre-wrap">{suggestion}</p><div className="mt-2 flex gap-2"><button type="button" disabled={disabled} className={buttonClass} onClick={() => { onChange(suggestion); setSuggestion(''); }}>Use suggestion</button><button type="button" className={buttonClass} onClick={() => setSuggestion('')}>Keep my answer</button></div></div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </div>;
}

export function MonthlyAssignmentSteps({ step, data, onChange, answers, onAnswer, kind, learnerId, title, plannedOtjh, mappings, evidenceFiles, evidenceUploader, timeControl, disabled, payload, checks, checking, onCheck, onSave, historical = false }: {
  step: number; data: MonthlyAssignment; onChange: Dispatch<SetStateAction<MonthlyAssignment>>;
  answers: AssignmentAnswers; onAnswer: (key: keyof AssignmentAnswers, value: string) => void;
  kind: LearnerKind; learnerId: string; title: string; plannedOtjh: number | null;
  mappings: ComponentKsbMapping[]; evidenceFiles: EvidenceRecord[]; evidenceUploader: ReactNode; timeControl: ReactNode;
  disabled: boolean; payload: () => LearningReflectionSubmissionInput;
  checks: AssignmentQualityCheck[]; checking: boolean; onCheck: () => Promise<boolean>; onSave: () => Promise<boolean>;
  historical?: boolean;
}) {
  const [library, setLibrary] = useState<EvidenceRecord[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [detail, setDetail] = useState<LearnerDetail | null>(null);
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('09:00');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [extraCode, setExtraCode] = useState('');
  const patch = (value: Partial<MonthlyAssignment>) => onChange(current => ({ ...current, ...value }));
  const field = (key: keyof MonthlyAssignment, label: string) => <MonthlyAnswerField label={label} title={title} value={String(data[key] || '')} onChange={value => patch({ [key]: value })} disabled={disabled || busy} />;
  const check = (key: keyof MonthlyAssignment, label: string) => <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm"><input type="checkbox" checked={data[key] === true} disabled={disabled || busy} onChange={e => patch({ [key]: e.target.checked })} className="mt-1" />{label}</label>;
  const monthEnd = /^\d{4}-\d{2}$/.test(data.month) ? new Date(Number(data.month.slice(0, 4)), Number(data.month.slice(5)), 0).getDate() : 0;
  const minBooking = `${data.month}-${String(monthEnd - 9).padStart(2, '0')}`;
  const maxBooking = `${data.month}-${monthEnd}`;
  const qualifyingEvents = events.filter(event => event.source === 'mcr' && ['scheduled', 'in-progress', 'completed', 'awaiting-signature'].includes(event.status) && (event.scheduledDate || '') >= minBooking && (event.scheduledDate || '') <= maxBooking);
  useEffect(() => {
    let active = true;
    if (historical) return;
    if ([2, 3].includes(step)) fetchLearnerDetail(kind, learnerId).then(result => { if (active) setDetail(result); }).catch(e => { if (active) setError(e.message); });
    if (step === 7) fetchLearnerCalendarEvents(kind, learnerId, { force: true }).then(result => { if (active) setEvents(result.events); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [step, kind, learnerId, historical]);
  const addFile = (file: EvidenceRecord) => {
    if (!data.evidence.some(e => e.id === file.id)) patch({ evidence: [...data.evidence, { id: file.id, name: file.filename, points: '' }] });
  };
  const openLibrary = async () => {
    setBusy(true); setError('');
    try { setLibrary(await fetchEvidence(kind, learnerId, { status: 'approved' })); setShowLibrary(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the evidence library.'); }
    finally { setBusy(false); }
  };
  const book = async () => {
    if (bookingDate < minBooking || bookingDate > maxBooking) { setError('Choose a date in the last ten days of this submission month.'); return; }
    setBusy(true); setError('');
    try {
      if (!await onSave()) return;
      const result = await bookLearnerCalendarSession(kind, learnerId, { sessionType: 'mcr', scheduledDate: bookingDate, scheduledTime: bookingTime, durationMinutes: 60, timezoneOffsetMinutes: new Date(`${bookingDate}T${bookingTime}`).getTimezoneOffset(), notes: `Monthly assignment: ${title}` });
      setEvents(current => [...current.filter(event => event.eventKey !== result.event.eventKey), result.event]);
      patch({ meetingKey: result.event.eventKey });
      setNotice(result.warning ? `Booking saved. ${result.warning}` : 'Your coaching meeting has been booked.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not book. Your draft is still saved.'); }
    finally { setBusy(false); }
  };
  const generate = () => {
    patch({ slides: [
      { title: `${title} — ${data.month}`, body: answers.assignmentAnswer },
      { title: 'Learning and understanding', body: `${answers.whatYouLearned}\n\n${data.understood}\n\n${data.gainedSkills}` },
      { title: 'Evidence and KSBs', body: `${data.evidence.map(e => `${e.name} — answer points ${e.points}`).join('\n')}\n\n${data.claims.map(c => `${c.code}: ${c.explanation}`).join('\n')}` },
      { title: 'Full-month reflection', body: `${data.lmsReflection}\n\n${data.extraActivities}\n\n${data.integratedReflection}` },
      { title: 'Impact and employer benefit', body: `${data.careerImpact}\n\n${data.jobImpact}\n\n${data.employerImpact}\n\n${answers.businessImpact}` },
      { title: 'Action plan and EPA', body: `${data.actionPlan}\n\n${data.epaPreparedness}` },
    ], presentationReviewed: false, presentationToken: '' });
  };
  const exportDeck = async () => {
    setBusy(true); setError('');
    try {
      if (!disabled && !await onSave()) return;
      const { blob, token } = await exportMonthlyPresentation(payload());
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `monthly-assignment-${data.month}.pptx`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (!disabled) patch({ presentationToken: token });
      setNotice('PowerPoint exported. Slide content is also saved in your draft.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not export the presentation.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5">
    {step === 0 && <div className="grid gap-4 md:grid-cols-3">
      <MonthlyAnswerField title={title} label="I learned… (at least 20 words)" value={answers.whatYouLearned} disabled={disabled} onChange={value => onAnswer('whatYouLearned', value)} />
      {field('understood', 'I understood… (at least 20 words)')}
      {field('gainedSkills', 'I gained skills in… (at least 20 words)')}
    </div>}
    {step === 1 && <>
      <h3 className="text-lg font-semibold">Evidence & cross-referencing</h3>
      <p className="text-sm text-slate-600">Put each answer point on a separate line. Attach evidence, then enter the supported point numbers, separated by commas. Files remain securely stored in Azure.</p>
      <ol className="list-inside list-decimal rounded-xl bg-blue-50 p-4 text-sm">{answers.assignmentAnswer.split('\n').filter(line => line.trim()).map((line, i) => <li className="mb-2" key={i}>{line}</li>)}</ol>
      {evidenceUploader}
      <div className="flex flex-wrap gap-2">{evidenceFiles.filter(f => f.status === 'approved' && !data.evidence.some(e => e.id === f.id)).map(file => <button key={file.id} type="button" disabled={disabled} className={buttonClass} onClick={() => addFile(file)}>Attach {file.filename}</button>)}<button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => void openLibrary()}>Pull from evidence library</button></div>
      {showLibrary && <div className="rounded-xl border p-3"><button type="button" className={buttonClass} onClick={() => setShowLibrary(false)}>Close library</button>{library.length === 0 && <p className="mt-2 text-sm">No uploaded evidence available yet.</p>}{library.map(file => <div key={file.id} className="mt-2 flex justify-between gap-2 text-sm"><span>{file.filename}</span><button type="button" className={buttonClass} disabled={disabled || data.evidence.some(e => e.id === file.id)} onClick={() => addFile(file)}>Attach</button></div>)}</div>}
      <fieldset disabled={disabled || busy} className="flex flex-wrap gap-2"><input aria-label="Evidence link name" placeholder="Link title" value={linkName} onChange={e => setLinkName(e.target.value)} className={inputClass + ' sm:w-auto'} /><input type="url" aria-label="Evidence URL" placeholder="https://…" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} className={inputClass + ' sm:w-auto'} /><button type="button" className={buttonClass} onClick={() => {
        try { const url = new URL(linkUrl); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); patch({ evidence: [...data.evidence, { id: `link:${crypto.randomUUID()}`, name: linkName.trim() || url.hostname, url: url.href, points: '' }] }); setLinkUrl(''); setLinkName(''); setError(''); }
        catch { setError('Enter a valid HTTP or HTTPS evidence link.'); }
      }}>Add link</button></fieldset>
      {data.evidence.map(entry => <div key={entry.id} className="rounded-xl border border-slate-200 p-4"><p className="font-semibold">{entry.name}</p><label className="block text-sm">Answer point numbers<input className={inputClass} placeholder="1, 2" value={entry.points} disabled={disabled} onChange={e => patch({ evidence: data.evidence.map(item => item.id === entry.id ? { ...item, points: e.target.value } : item) })} /></label><button type="button" disabled={disabled} className={buttonClass + ' mt-2'} onClick={() => patch({ evidence: data.evidence.filter(item => item.id !== entry.id), claims: data.claims.map(c => ({ ...c, evidenceIds: c.evidenceIds.filter(id => id !== entry.id) })) })}>Remove from submission</button></div>)}
    </>}
    {step === 2 && <>
      <h3 className="text-lg font-semibold">KSBs & hours claimed</h3>
      <p className="text-sm text-slate-600">Planned hours: {plannedOtjh ?? 'Not set'}. Keep your actual time; there is no six-hour cap. Planned values are not changed by this claim.</p>
      <fieldset disabled={disabled}>{timeControl}</fieldset>
      {check('paidHours', 'This learning was completed during paid working hours.')}
      {data.claims.map((claim, index) => <div key={claim.code} className="space-y-3 rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-2"><strong>{claim.code} <span className="text-xs font-normal">{mappings.find(m => m.code === claim.code)?.classification || ''}</span></strong><button type="button" disabled={disabled} className={buttonClass} onClick={() => patch({ claims: data.claims.filter((_, i) => i !== index), plannedReviewed: false })}>Remove claim</button></div><p className="text-xs text-slate-600">{mappings.find(m => m.code === claim.code)?.description || detail?.ksbs.find(k => k.code === claim.code)?.description}</p><label className="block text-sm">How did you apply this KSB? (at least 20 words)<textarea rows={4} className={inputClass} value={claim.explanation} disabled={disabled} onChange={e => patch({ claims: data.claims.map((c, i) => i === index ? { ...c, explanation: e.target.value } : c) })} /></label><p className="text-xs font-semibold">Supporting evidence</p>{data.evidence.map(e => <label className="mr-4 inline-flex items-center gap-2 text-sm" key={e.id}><input type="checkbox" disabled={disabled} checked={claim.evidenceIds.includes(e.id)} onChange={event => patch({ claims: data.claims.map((c, i) => i === index ? { ...c, evidenceIds: event.target.checked ? [...c.evidenceIds, e.id] : c.evidenceIds.filter(id => id !== e.id) } : c) })} />{e.name}</label>)}</div>)}
      <div className="flex flex-wrap gap-2"><select aria-label="Another KSB" disabled={disabled} className={inputClass + ' sm:w-auto'} value={extraCode} onChange={e => setExtraCode(e.target.value)}><option value="">Choose another programme KSB</option>{(detail?.ksbs || []).filter(k => !data.claims.some(c => c.code === k.code)).map(k => <option key={k.code} value={k.code}>{k.code} — {k.description}</option>)}</select><button type="button" disabled={disabled || !extraCode} className={buttonClass} onClick={() => { patch({ claims: [...data.claims, { code: extraCode, explanation: '', evidenceIds: [] }], plannedReviewed: false }); setExtraCode(''); }}>Add KSB</button><button type="button" disabled={disabled} className={buttonClass} onClick={() => patch({ claims: mappings.map(m => data.claims.find(c => c.code === m.code) || { code: m.code, explanation: '', evidenceIds: [] }), plannedReviewed: false })}>Reset claims to planned KSBs</button></div>
      {check('plannedReviewed', 'I have reviewed the planned hours and KSBs against my actual learning.')}
      {check('newKnowledge', 'This activity developed new knowledge.')}
      {check('newSkills', 'This activity developed new skills or behaviours.')}
      {check('sharingConsent', 'My employer accepts sharing this evidence, and it contains no confidential information.')}
    </>}
    {step === 3 && <>
      <h3 className="text-lg font-semibold">Full-month reflection — {data.month}</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-blue-50"><tr><th className="p-3">Activity</th><th className="p-3">Date</th><th className="p-3">Result</th><th className="p-3">KSBs</th><th className="p-3">Time / source</th><th className="p-3">Learning and impact</th></tr></thead>
          <tbody>{(detail?.activityFeed || []).filter(a => a.at.slice(0, 7) === data.month).map((a, i) => {
            const records = a.kind === 'quiz' ? detail?.quizAttempts || [] : a.kind === 'video' ? detail?.videoProgress || [] : detail?.componentProgress || [];
            const progress = records.find(p => p.submittedAt === a.at && (a.componentId ? p.componentId === a.componentId : a.kind === 'quiz' && 'quizId' in p && p.quizId === a.quizId));
            return <tr key={i} className="border-t">
              <td className="p-3">{a.title}</td><td className="p-3">{a.at.slice(0, 10)}</td><td className="p-3">{a.detail || a.action}</td>
              <td className="p-3">{progress?.ksbs?.join(', ') || 'Not recorded'}</td>
              <td className="p-3">{progress?.reportedTime || progress?.timeTaken || 'Not recorded'}<span className="block text-slate-500">{progress?.timeTrackingSource || ''}</span></td>
              <td className="max-w-xs whitespace-pre-wrap p-3">{progress?.feedback || 'Not recorded'}</td>
            </tr>;
          })}</tbody>
        </table>
        {detail && !(detail.activityFeed || []).some(a => a.at.slice(0, 7) === data.month) && <p className="p-3 text-sm">No recorded activities for this month.</p>}
        {!detail && <p className="p-3 text-sm">Loading your recorded activities…</p>}
      </div>
      {field('lmsReflection', 'Reflect on your LMS activities and assignment (at least 20 words)')}
      {field('extraActivities', 'Additional activities outside the LMS (optional)')}
      {field('integratedReflection', 'How does the learning fit together? (at least 20 words)')}
    </>}
    {step === 4 && <>{field('careerImpact', 'Impact on your career (at least 20 words)')}{field('jobImpact', 'Impact on your job performance (at least 20 words)')}{field('employerImpact', 'Impact on employer performance (at least 20 words)')}{check('employerBenefit', 'I can explain how my employer has benefited from this learning.')}<MonthlyAnswerField title={title} label="Measurable business outcomes (at least 20 words)" value={answers.businessImpact} onChange={value => onAnswer('businessImpact', value)} disabled={disabled} /></>}
    {step === 5 && <>{field('actionPlan', 'Your action plan for next month (at least 20 words)')}{field('epaPreparedness', 'How has this prepared you for EPA? (at least 20 words)')}</>}
    {step === 6 && <><h3 className="text-lg font-semibold">Submission quality checks</h3><p className="text-sm text-slate-600">These are server-verified completeness checks, not an AI grade or tutor approval. Incomplete items do not prevent saving a draft.</p><button type="button" className={buttonClass} disabled={checking || disabled} onClick={() => void onCheck()}>{checking ? 'Checking…' : 'Run quality checks'}</button>{checks.map(c => <div key={c.key} className={`rounded-xl border p-3 text-sm ${c.passed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{c.passed ? '✓' : '○'} {c.label}</div>)}</>}
    {step === 7 && <>
      <h3 className="text-lg font-semibold">Coaching & presentation</h3>
      <p className="text-sm text-slate-600">Book coaching between {minBooking} and {maxBooking}. You can finish both tasks here and keep the whole submission as a draft until ready.</p>
      <label className="block text-sm">Use an existing coaching booking<select className={inputClass} value={data.meetingKey} disabled={disabled || busy} onChange={e => patch({ meetingKey: e.target.value })}><option value="">Select a booked meeting</option>{qualifyingEvents.map(event => <option key={event.eventKey} value={event.eventKey}>{event.scheduledDate} {event.scheduledTime} — {event.coachName}</option>)}</select></label>
      <fieldset disabled={disabled || busy} className="rounded-xl border border-slate-200 p-4"><legend className="px-2 text-sm font-semibold">Book with your assigned coach</legend><p className="text-xs text-slate-500">Times are in your browser's local timezone. The booking service checks calendar conflicts before reserving the meeting.</p><div className="flex flex-wrap items-end gap-3"><label className="text-xs">Date<input type="date" className={inputClass} min={minBooking} max={maxBooking} value={bookingDate} onChange={e => setBookingDate(e.target.value)} /></label><label className="text-xs">Time<input type="time" className={inputClass} value={bookingTime} onChange={e => setBookingTime(e.target.value)} /></label><button type="button" className={buttonClass} disabled={!bookingDate || !bookingTime} onClick={() => void book()}>{busy ? 'Please wait…' : 'Book 60-minute coaching meeting'}</button></div></fieldset>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => { if (!data.slides.length || window.confirm('Replace your edited slides with a fresh draft from your answers?')) generate(); }}>Generate presentation from my answers</button><button type="button" className={buttonClass} disabled={disabled || busy || data.slides.length >= 30} onClick={() => patch({ slides: [...data.slides, { title: '', body: '' }], presentationReviewed: false, presentationToken: '' })}>Add slide</button></div>
      {data.slides.map((slide, i) => <fieldset disabled={disabled || busy} key={i} className="rounded-xl border border-slate-200 p-4"><legend className="px-2 text-sm">Slide {i + 1}</legend><label className="block text-xs">Title<input className={inputClass} value={slide.title} onChange={e => patch({ slides: data.slides.map((s, index) => index === i ? { ...s, title: e.target.value } : s), presentationReviewed: false, presentationToken: '' })} /></label><label className="block text-xs">Content<textarea className={inputClass} rows={5} value={slide.body} onChange={e => patch({ slides: data.slides.map((s, index) => index === i ? { ...s, body: e.target.value } : s), presentationReviewed: false, presentationToken: '' })} /></label><button type="button" className={buttonClass} onClick={() => patch({ slides: data.slides.filter((_, index) => index !== i), presentationReviewed: false, presentationToken: '' })}>Remove slide</button></fieldset>)}
      {check('presentationReviewed', 'I have reviewed the slides and they accurately represent my own work.')}
      <button type="button" className={buttonClass} disabled={busy || !data.slides.length} onClick={() => void exportDeck()}>{busy ? 'Please wait…' : 'Export PowerPoint (.pptx)'}</button>
      {data.presentationToken && <p className="text-sm text-emerald-700">PowerPoint export complete. Editing your submission content or slides requires another reviewed export.</p>}
      <button type="button" className={buttonClass + ' ml-2'} disabled={checking || disabled} onClick={() => void onCheck()}>Recheck submission requirements</button>
    </>}
    {notice && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  </div>;
}
