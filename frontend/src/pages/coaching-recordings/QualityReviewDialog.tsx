import { useEffect, useRef, useState } from 'react';
import { Check, FileDown, Plus, Save, Trash2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { qualityContext, qualityReview, qualityPdf, qualityImageUrl, uploadQualityImage, uploadQualityEvidence, saveQualityReview, invalidateQualityReviews,
  QualityReviewError, type QualityContext, type QualityForm, type QualityReview, type QualityTemplate, type QualityReviewType, type QualityEvidenceFile } from '@/api/coachingQualityReviews';
import { AssignmentPdfPreview } from '@/pages/learner/monthly-submission/AssignmentPdfPreview';
import { meetingDate } from './model';
import QualityModal from './QualityModal';
import QualityQuestions from './QualityQuestions';
import { blankQualityForm, qualityCompletionIssue } from './qualityFormModel';
import QualityFormCards from './QualityFormCards';
import QualityEvidenceFiles from './QualityEvidenceFiles';
import { suggestQualityType } from './qualityReviewType';

const input = 'w-full min-w-0 rounded-lg border border-background-200 bg-white px-3 py-2 text-sm text-foreground-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 disabled:opacity-50';
export default function QualityReviewDialog({ eventKey = '', reference, initialLearnerId = '', initialReviewType, reviewId, timeZone = 'Europe/London', onClose, onSaved, onDirtyChange, onBusyChange }: {
  eventKey?: string; reference?: string; initialLearnerId?: string; initialReviewType?: QualityReviewType | ''; reviewId?: string; timeZone?: string; onClose: () => void; onSaved?: (review: QualityReview) => void; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [context, setContext] = useState<QualityContext | null>(null), [template, setTemplate] = useState<QualityTemplate | null>(null);
  const [review, setReview] = useState<QualityReview | null>(null), [form, setForm] = useState<QualityForm | null>(null);
  const [learner, setLearner] = useState(initialLearnerId), [section, setSection] = useState(''), [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0), [pdfOpen, setPdfOpen] = useState(false), [pdfUrl, setPdfUrl] = useState(''), [pdfError, setPdfError] = useState('');
  const [requestedType, setRequestedType] = useState<QualityReviewType>(), [formType, setFormType] = useState<QualityReviewType | ''>('');
  const [evidenceFiles, setEvidenceFiles] = useState<QualityEvidenceFile[]>([]);
  const [choosingForm, setChoosingForm] = useState(true);
  const currentReview = useRef(review); currentReview.current = review;
  const pdfObject = useRef(''), requestKey = useRef({ body: '', id: '' });
  const alive = useRef(true);
  const dirty = Boolean(form && (JSON.stringify(form) !== baseline || (review && formType !== (review.reviewType || suggestQualityType(review.meeting.title)))));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setForm(null); setReview(null); setError(''); setConflict(false);
    const accept = (saved: QualityReview | null, structure: QualityTemplate, data?: QualityContext, chosen?: QualityReviewType | '') => {
      if (controller.signal.aborted) return;
      const kind = chosen || requestedType || saved?.reviewType || (saved ? suggestQualityType(saved.meeting.title) : '') || '';
      const changedType = saved && kind !== (saved.reviewType || suggestQualityType(saved.meeting.title));
      const next = saved && !changedType ? saved.form : blankQualityForm(structure, meetingDate(saved?.meeting.startsAt || data?.snapshot.meeting.startsAt || new Date().toISOString(), timeZone));
      setFormType(kind);
      setChoosingForm(!kind);
      setEvidenceFiles(saved?.evidenceFiles ?? []);
      setTemplate(structure); setReview(saved); setForm(next); setBaseline(JSON.stringify(next)); setSection(structure.sections[0]?.id ?? '');
      if (data) setContext(data);
    };
    void (reviewId ? qualityReview(reviewId, controller.signal, requestedType).then(value => accept(value.review, value.template, undefined, value.reviewType))
      : qualityContext(eventKey, reference, learner, controller.signal, requestedType).then(value => accept(requestedType ? value.review : null, value.template, value)))
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The form could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventKey, reference, learner, reviewId, reload, timeZone, requestedType, initialReviewType]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (pdfObject.current) URL.revokeObjectURL(pdfObject.current); }; }, []);
  const close = () => { if (!busy && (!dirty || window.confirm('Discard the unsaved changes to this review?'))) onClose(); };
  const update = (next: QualityForm) => { setForm(next); setError(''); };
  const save = async (status: 'draft' | 'completed') => {
    if (!form || !template || !formType || busy || !(review?.learner.id || learner)) return;
    const issue = status === 'completed' ? qualityCompletionIssue(template, form) : '';
    if (issue) { setError(issue); return; }
    const payload = { templateVersion: template.version ?? 1, reviewType: formType, learnerId: review?.learner.id || learner, expectedVersion: review?.version ?? 0, status, form };
    const body = JSON.stringify(payload);
    if (requestKey.current.body !== body) requestKey.current = { body, id: crypto.randomUUID() };
    setBusy(true); setError(''); setConflict(false);
    try {
      const saved = await saveQualityReview({ ...payload, requestId: requestKey.current.id }, review?.id, eventKey, reference);
      setReview(saved); setFormType(saved.reviewType || formType); setForm(saved.form); setBaseline(JSON.stringify(saved.form)); onSaved?.(saved);
      currentReview.current = saved;
      setEvidenceFiles(saved.evidenceFiles ?? []);
      if (saved.document?.state === 'failed') setError(saved.document.message || 'Review saved. The PDF could not be prepared; use Preview PDF to retry.');
      if (pdfObject.current) URL.revokeObjectURL(pdfObject.current);
      pdfObject.current = ''; setPdfUrl('');
      return saved;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The review could not be saved.'); setConflict(reason instanceof QualityReviewError && reason.status === 409); }
    finally { setBusy(false); }
  };
  const attachEvidence = async (file: File, key: string) => {
    if (!form || !formType || !(review?.learner.id || learner)) { setError('Choose a learner and form before attaching evidence.'); return false; }
    if (!file.size || file.size > 25 * 1024 * 1024) { setError('Choose a non-empty evidence file up to 25 MB.'); return false; }
    let saved = currentReview.current;
    if (!saved) saved = await save('draft') ?? null;
    if (!saved) return false;
    setBusy(true); setError('');
    try {
      const value = await uploadQualityEvidence(saved.id, key, file);
      if (!alive.current) return false;
      setEvidenceFiles(rows => [...rows.filter(row => row.id !== value.id), value]);
      setForm(current => current ? { ...current, attachments: { ...current.attachments, [key]: [...new Set([...(current.attachments?.[key] ?? []), value.id])] } } : current);
      return true;
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'The evidence file could not be attached.'); return false; }
    finally { if (alive.current) setBusy(false); }
  };
  const pdf = async (download = false) => {
    if (!review || dirty || review.status !== 'completed') return;
    if (!download) setPdfOpen(true);
    setPdfError('');
    try {
      let value = pdfObject.current;
      if (!value) { const blob = await qualityPdf(review); if (!alive.current) return; value = URL.createObjectURL(blob); pdfObject.current = value; setPdfUrl(value); }
      if (download) { const link = document.createElement('a'); link.href = value; link.download = 'quality-check.pdf'; document.body.append(link); link.click(); link.remove(); }
    } catch (reason) { setPdfError(reason instanceof Error ? reason.message : 'The PDF could not be loaded.'); }
  };
  const upload = async (file: File | undefined, imageKey: string) => {
    if (!file || !review || !form || busy) return;
    setBusy(true); setError('');
    try {
      const value = await uploadQualityImage(review.id, imageKey, file);
      update({ ...form, images: { ...form.images, [imageKey]: [...new Set([...(form.images[imageKey] ?? []), value.id])] } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The screenshot could not be attached.'); }
    finally { setBusy(false); }
  };
  const completed = template?.sections.flatMap(item => item.criteria).filter(item => (item.type || 'rating') === 'rating' ? Boolean(form?.criteria[item.id]?.rating) : item.type === 'image' ? Boolean(form?.images[item.id]?.length) : item.type === 'file' ? Boolean(form?.attachments?.[item.id]?.length) : form?.answers?.[item.id] != null && form.answers[item.id] !== '' && (!Array.isArray(form.answers[item.id]) || (form.answers[item.id] as string[]).length > 0)).length ?? 0;
  const selected = review?.learner ?? context?.learners.find(item => item.id === learner);
  const meeting = review?.meeting ?? context?.snapshot.meeting, coach = review?.coach ?? context?.snapshot.coach;
  const selectType = (kind: QualityReviewType) => {
    if (kind === formType || busy || (dirty && !window.confirm('Discard these unsaved answers and open the other quality form? Saved reviews and PDFs will remain available.'))) return;
    if (pdfObject.current) URL.revokeObjectURL(pdfObject.current);
    pdfObject.current = ''; setPdfUrl(''); setRequestedType(kind);
  };
  return <>
    <QualityModal title="Quality Check" onClose={close} suspended={pdfOpen} footer={<>
      <p role="status" className="text-xs text-foreground-500">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : review ? `${review.status === 'completed' ? 'Completed' : 'Draft'} · Version ${review.version} saved` : 'New review · Not saved'}</p>
      <div className="flex flex-wrap gap-2">
        {review?.status === 'completed' && <><button className={button} disabled={dirty || busy} onClick={() => void pdf()}><FileDown size={14} />Preview PDF</button><button className={button} disabled={dirty || busy} onClick={() => void pdf(true)}><FileDown size={14} />Download PDF</button></>}
        <button className={button} disabled={busy || loading || !formType || !selected || !form} onClick={() => void save('draft')}><Save size={14} />Save draft</button>
        <button className={`${button} bg-primary-600 text-white`} disabled={busy || loading || !formType || !selected || !form} onClick={() => void save('completed')}><Check size={14} />Complete review</button>
      </div></>}>
      {loading ? <p role="status" className="py-12 text-center text-sm">Loading the saved form…</p> : <>
        {error && <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{error}
          {conflict && <button className={`${button} ml-2`} onClick={() => { if (!dirty || window.confirm('Replace your edits with the saved version?')) { invalidateQualityReviews(); setReload(value => value + 1); } }}>Reload saved version</button>}
          {!form && <button className={`${button} ml-2`} onClick={() => setReload(value => value + 1)}>Retry form</button>}</div>}
        {template && form && <fieldset disabled={busy} className="min-w-0">
          {!formType && <div className="mb-4 flex items-center gap-4"><img src="/assets/kbc-logo.png" alt="Kent Business College" className="h-16 w-32 object-contain" /><p className="text-sm text-foreground-600">Select the feedback form for this observation.</p></div>}
          <section aria-label="Choose quality form" className="mb-4 space-y-3 rounded-xl border border-background-200 bg-white p-4">
            {reviewId || !choosingForm ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">{template.title}</p>{!reviewId && <button type="button" className={button} onClick={() => setChoosingForm(true)}>Choose another form</button>}</div>
              : <QualityFormCards value={formType} onChange={selectType} disabled={busy} />}
            <p className="text-xs text-foreground-500">Choose the form yourself. Each form is saved independently for this learner and meeting; the calendar meeting type stays unchanged.</p>
            {formType && <Link className="inline-flex text-xs font-semibold text-primary-700 underline" to={`/curriculum/quality/forms?type=${formType}`} target="_blank" rel="noopener noreferrer">Edit form template</Link>}
          </section>
          {formType && <>
          <div className="mb-4 flex items-center gap-3"><img src="/assets/kbc-logo.png" alt="Kent Business College" className="h-16 w-32 object-contain" /><div><h3 className="font-bold">{template.title}</h3><p className="mt-1 text-xs text-foreground-500">Form version {template.version ?? 1}</p></div></div>
          <section aria-label="Review context" className="mb-4 grid gap-3 rounded-xl border border-background-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-xs text-foreground-500">Coach / tutor observed</p><p className="mt-1 font-semibold">{coach?.name}</p></div>
            <div><p className="text-xs text-foreground-500">Observer</p><p className="mt-1 font-semibold">{review?.reviewer.name ?? context?.observer.name}</p></div>
            <label className="grid gap-1 text-xs text-foreground-600">Learner{review ? <span className="mt-1 text-sm font-semibold">{review.learner.name}</span> : <select aria-label="Review learner" className={input} value={learner} onChange={event => {
              if (!dirty || window.confirm('Discard this unsaved form and choose another learner?')) setLearner(event.target.value);
            }}><option value="">Choose one learner</option>{context?.learners.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}</label>
            <div className="min-w-0"><p className="text-xs text-foreground-500">Meeting</p><p className="mt-1 break-words text-xs font-medium">{meeting?.title}</p><p className="mt-1 text-xs text-foreground-500">{meeting && meetingDate(meeting.startsAt, timeZone)}</p></div>
          </section>
          <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
            <label className="grid gap-2 text-xs font-semibold lg:hidden">Review section · {completed} questions answered
              <select className={input} value={section} onChange={event => setSection(event.target.value)}>
                {[{ id: 'details', title: 'Learner and evidence details' }, ...template.sections, { id: 'actions', title: template.actionsTitle || 'SMART action plan' }].map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <nav aria-label="Review sections" className="hidden flex-col gap-1 rounded-xl border border-background-200 bg-white p-2 lg:flex">
              <p className="px-3 py-2 text-xs font-semibold text-foreground-500">{completed} of {template.sections.reduce((sum, item) => sum + item.criteria.length, 0)} criteria rated</p>
              {[{ id: 'details', title: 'Learner and evidence details' }, ...template.sections, { id: 'actions', title: template.actionsTitle || 'SMART action plan' }].map(item => <button type="button" key={item.id}
                aria-current={section === item.id ? 'step' : undefined} onClick={() => setSection(item.id)} className={`rounded-lg px-3 py-2 text-left text-xs leading-5 ${section === item.id ? 'bg-primary-600 font-semibold text-white' : 'text-foreground-700 hover:bg-primary-50'}`}>{item.title}</button>)}
            </nav>
            <div className="min-w-0 space-y-4">
              <p className="rounded-xl border border-primary-100 bg-primary-50 p-3 text-xs leading-5 text-foreground-600">Record what you observed in this session. Use the recording, transcript and other evidence to support each judgement. No ratings are selected automatically.</p>
              {section === 'details' && <section aria-label="Learner and evidence details" className="space-y-4 rounded-xl border border-background-200 bg-white p-4">
                <h3 className="font-bold">Learner and evidence details</h3>
                <div className="grid gap-4 sm:grid-cols-2">{([['employer', 'Employer', 'text'], ['programme', 'Programme / standard', 'text'], ['activityDate', 'Activity date', 'date'], ['startDate', 'Start date', 'date'], ['endDate', 'Planned end date', 'date']] as const).map(([key, label, type]) =>
                  <label key={key} className="grid gap-1 text-xs font-semibold">{label}<input className={input} type={type} maxLength={300} value={form.header[key]} onChange={event => update({ ...form, header: { ...form.header, [key]: event.target.value } })} /></label>)}</div>
                <fieldset><legend className="mb-2 text-sm font-semibold">Evidence you relied on</legend><p className="mb-3 text-xs text-foreground-500">Select the sources you reviewed. Add page numbers or video times in each criterion’s evidence.</p>
                  <div className="flex flex-wrap gap-3">{[['recording', 'Recording'], ['transcript', 'Transcript'], ['ai', 'AI analysis'], ['portfolio', 'LMS / portfolio'], ['other', 'Other evidence']].map(([key, label]) =>
                    <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.sources.includes(key)} onChange={event => update({ ...form, sources: event.target.checked ? [...form.sources, key] : form.sources.filter(item => item !== key) })} />{label}</label>)}</div>
                </fieldset>
              </section>}
              <QualityEvidenceFiles reviewId={review?.id} files={evidenceFiles} ids={form.attachments?.evidence ?? []} busy={busy} onUpload={attachEvidence} onRemove={(id, key) => update({ ...form, attachments: { ...form.attachments, [key]: (form.attachments?.[key] ?? []).filter(value => value !== id) } })} />
              <QualityQuestions template={template} sectionId={section} form={form} onChange={update}
                renderFiles={key => <QualityEvidenceFiles section={key} reviewId={review?.id} files={evidenceFiles} ids={form.attachments?.[key] ?? []} busy={busy} onUpload={attachEvidence} onRemove={(id, group) => update({ ...form, attachments: { ...form.attachments, [group]: (form.attachments?.[group] ?? []).filter(value => value !== id) } })} />}
                renderImages={(key, label) => <section aria-label={label} className="rounded-xl border border-dashed border-primary-200 bg-white p-4">
                <h4 className="text-sm font-semibold">{label}</h4><p className="mt-1 text-xs text-foreground-500">Save the draft before uploading. Up to two images here, 20 per review.</p>
                <div className="mt-3 flex flex-wrap gap-3">{(form.images[key] ?? []).map(id => <div key={id} className="w-36"><a href={qualityImageUrl(review?.id ?? '', id)} target="_blank" rel="noreferrer"><img loading="lazy" className="h-24 w-36 rounded-lg border object-contain" src={qualityImageUrl(review?.id ?? '', id)} alt="Saved review screenshot" /></a><button type="button" className="mt-1 text-xs text-rose-700 underline" onClick={() => update({ ...form, images: { ...form.images, [key]: form.images[key].filter(value => value !== id) } })}>Remove from this version</button></div>)}</div>
                <label className={`${button} mt-3 ${!review || busy || (form.images[key]?.length ?? 0) >= 2 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}><Upload size={13} />Attach screenshot<input aria-label={`Attach image: ${label}`} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={!review || busy || (form.images[key]?.length ?? 0) >= 2} onChange={event => { void upload(event.target.files?.[0], key); event.target.value = ''; }} /></label>
              </section>} />
              {section === 'actions' && <section aria-label="SMART action plan" className="space-y-4 rounded-xl border border-background-200 bg-white p-4"><h3 className="text-lg font-bold">{template.actionsTitle || 'SMART action plan'}</h3>
                {form.actions.map((action, index) => <div key={index} className="grid gap-3 rounded-xl border border-background-200 p-3 sm:grid-cols-2">
                  {([['action', 'Target / action (SMART)', 'text'], ['outcome', 'Planned outcome and learner impact', 'text'], ['supportedBy', 'Supported by', 'text'], ['dueDate', 'By when', 'date']] as const).map(([key, label, type]) => <label key={key} className="grid gap-1 text-xs font-semibold">{label}<input className={input} type={type} maxLength={key === 'action' || key === 'outcome' ? 3000 : 300} value={action[key]} onChange={event => update({ ...form, actions: form.actions.map((row, position) => position === index ? { ...row, [key]: event.target.value } : row) })} /></label>)}
                  <button className={`${button} justify-self-start text-rose-700`} onClick={() => update({ ...form, actions: form.actions.filter((_, position) => position !== index) })}><Trash2 size={13} />Remove action</button>
                </div>)}
                <button className={button} disabled={form.actions.length >= 30} onClick={() => update({ ...form, actions: [...form.actions, { action: '', outcome: '', supportedBy: '', dueDate: '' }] })}><Plus size={14} />Add action</button>
              </section>}
            </div>
          </div>
          </>}
        </fieldset>}
      </>}
    </QualityModal>
    {pdfOpen && <QualityModal title="Quality Check PDF" onClose={() => setPdfOpen(false)} top footer={<button className={`${button} bg-primary-600 text-white`} disabled={!pdfUrl} onClick={() => void pdf(true)}><FileDown size={14} />Download PDF</button>}>
      {pdfUrl ? <AssignmentPdfPreview url={pdfUrl} scrollableZoom filename="Quality check.pdf" label="Quality Check PDF preview" /> : pdfError ? <p role="alert">{pdfError} <button className={button} onClick={() => void pdf()}>Retry PDF</button></p> : <p role="status" className="py-12 text-center">Preparing the saved review PDF…</p>}
    </QualityModal>}
  </>;
}
