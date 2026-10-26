import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Eye, Plus, Save, Send, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { qualityDefinition, saveQualityDefinition, invalidateQualityReviews, type QualityField, type QualityFieldType, type QualityTemplate, type QualityTemplateState, type QualityReviewType } from '@/api/coachingQualityReviews';
import QualityModal from './QualityModal';
import QualityQuestions, { qualityControl } from './QualityQuestions';
import { blankQualityForm } from './qualityFormModel';
import QualityTypePicker from './QualityTypePicker';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm font-semibold text-primary-700 disabled:opacity-50';
const fieldLabels: Record<QualityFieldType, string> = { rating: 'Quality rating + evidence', text: 'Short text', textarea: 'Long text', boolean: 'Yes / No', single_choice: 'Single choice', checklist: 'Checklist', date: 'Date', number: 'Number', image: 'Upload image' };
const identity = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function FormPreview({ definition, onClose }: { definition: QualityTemplate; onClose: () => void }) {
  const [section, setSection] = useState(definition.sections[0].id);
  const [form, setForm] = useState(() => blankQualityForm(definition, ''));
  return <QualityModal title="Quality form preview" onClose={onClose}>
    <div className="mb-5 flex items-center gap-4"><img src="/assets/kbc-logo.png" alt="Kent Business College" className="h-16 w-32 object-contain" /><div><h3 className="font-bold">{definition.title}</h3><p className="mt-1 text-xs text-foreground-500">Preview only · answers are not saved</p></div></div>
    <label className="mb-5 grid gap-1 text-xs font-semibold">Section<select className={qualityControl} value={section} onChange={event => setSection(event.target.value)}>{definition.sections.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <QualityQuestions template={definition} sectionId={section} form={form} onChange={setForm} />
  </QualityModal>;
}

export default function QualityFormsPage() {
  const [params, setParams] = useSearchParams();
  const kind: QualityReviewType = params.get('type') === 'PR' ? 'PR' : 'MCM';
  const [saved, setSaved] = useState<QualityTemplateState | null>(null), [definition, setDefinition] = useState<QualityTemplate | null>(null);
  const [baseline, setBaseline] = useState(''), [section, setSection] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false), [reload, setReload] = useState(0);
  const retry = useRef({ body: '', id: '' }), alive = useRef(true);
  const dirty = Boolean(definition && JSON.stringify(definition) !== baseline);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setMessage(''); setDefinition(null); setSaved(null);
    void qualityDefinition(controller.signal, kind).then(value => {
      if (controller.signal.aborted) return;
      setSaved(value.template); setDefinition(value.template.draft); setBaseline(JSON.stringify(value.template.draft)); setSection(value.template.draft.sections[0].id);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The form could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload, kind]);
  useEffect(() => {
    const acceptedIndex = window.history.state?.idx;
    let restoring = false;
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    const back = (event: PopStateEvent) => {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      if (!dirty && !busy) return;
      const nextIndex = event.state?.idx;
      if (typeof acceptedIndex !== 'number' || typeof nextIndex !== 'number' || acceptedIndex === nextIndex) return;
      if (!busy && window.confirm('Discard the unsaved form definition changes?')) return;
      event.stopImmediatePropagation(); restoring = true; window.history.go(acceptedIndex - nextIndex);
    };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (link && (dirty || busy) && (busy || !window.confirm('Discard the unsaved form definition changes?'))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', warn); window.addEventListener('popstate', back, true); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('popstate', back, true); document.removeEventListener('click', navigate, true); };
  }, [dirty, busy]);
  const update = (value: QualityTemplate) => { setDefinition(value); setError(''); setMessage(''); };
  const group = definition?.sections.find(item => item.id === section);
  const changeSection = (changes: Partial<NonNullable<typeof group>>) => { if (definition) update({ ...definition, sections: definition.sections.map(item => item.id === section ? { ...item, ...changes } : item) }); };
  const changeField = (id: string, changes: Partial<QualityField>) => { if (group) changeSection({ criteria: group.criteria.map(item => item.id === id ? { ...item, ...changes } : item) }); };
  const move = <T,>(rows: T[], index: number, offset: number): T[] => { const next = [...rows]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; };
  const save = async (publish: boolean) => {
    if (!definition || !saved || busy) return;
    const body = { definition: { ...definition, reviewType: kind }, expectedRevision: saved.revision, publish }, text = JSON.stringify(body);
    if (retry.current.body !== text) retry.current = { body: text, id: crypto.randomUUID() };
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveQualityDefinition({ ...body, requestId: retry.current.id });
      if (!alive.current) return;
      setSaved(result); setDefinition(result.draft); setBaseline(JSON.stringify(result.draft));
      setMessage(publish ? `Published · Form version ${result.published.version} is available for new reviews.` : 'Draft saved. Meetings continue to use the published form.');
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'The definition could not be saved. Your changes are still here.'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" workspaceLabel="Curriculum Studio" pageTitle="Quality forms" pageSubtitle="Create and publish the questions used to review coach meetings" navItems={curriculumNavItems}>
    <main className="mx-auto w-full max-w-[1500px] space-y-5 p-3 sm:p-6">
      <Link to="/curriculum/quality" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700"><ArrowLeft size={16} />Curriculum quality</Link>
      <section aria-label="Form library" className="space-y-3 rounded-xl border border-background-200 bg-white p-4">
        <QualityTypePicker value={kind} disabled={busy || loading} onChange={next => {
          if (next !== kind && (!dirty || window.confirm('Discard the unsaved form definition changes?'))) setParams({ type: next });
        }} />
        <p className="text-xs text-foreground-500">Edit and publish each type separately. New {kind} reviews use its published questions; saved reviews keep their own form version.</p>
      </section>
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Quality forms</h1><p className="mt-2 max-w-2xl text-sm text-foreground-600">Save changes as a draft, preview them, then publish for new meeting reviews. Existing reviews keep their original questions.</p></div><div className="flex flex-wrap gap-2"><button className={button} disabled={!definition || loading || busy} onClick={() => setPreview(true)}><Eye size={16} />Preview form</button><button className={button} disabled={!definition || loading || busy} onClick={() => void save(false)}><Save size={16} />Save draft</button><button className={`${button} bg-primary-600 text-white`} disabled={!definition || loading || busy} onClick={() => void save(true)}><Send size={16} />Publish form</button></div></header>
      <p role="status" className="text-xs text-foreground-500">{loading ? 'Loading form definition…' : busy ? 'Saving form…' : message || (dirty ? 'Unsaved definition changes' : `Published form version ${saved?.published.version ?? 1} · saved revision ${saved?.revision ?? 0}`)}</p>
      {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{error}<button className={`${button} ml-3`} disabled={busy} onClick={() => { if (!dirty || window.confirm('Replace your changes with the saved definition?')) { invalidateQualityReviews(); setReload(value => value + 1); } }}>Reload saved form</button></div>}
      {definition && !loading && <fieldset disabled={busy} className="min-w-0 space-y-5">
        <section className="grid gap-4 rounded-xl border border-background-200 bg-white p-4 sm:grid-cols-2"><label className="grid gap-1 text-xs font-semibold">Form title<input className={qualityControl} maxLength={160} value={definition.title} onChange={event => update({ ...definition, title: event.target.value })} /></label><label className="grid gap-1 text-xs font-semibold">Action plan heading<input className={qualityControl} maxLength={160} value={definition.actionsTitle || 'SMART action plan'} onChange={event => update({ ...definition, actionsTitle: event.target.value })} /></label></section>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="space-y-3"><p className="text-xs font-bold uppercase text-foreground-500">Sections</p>{definition.sections.map((item, index) => <div key={item.id} className="flex min-w-0 items-center gap-1"><button className={`${button} min-w-0 flex-1 justify-start break-words text-left ${item.id === section ? 'bg-primary-100' : ''}`} onClick={() => setSection(item.id)}>{item.title}</button><button className={`${button} px-2`} aria-label={`Move section ${item.title} up`} disabled={index === 0} onClick={() => update({ ...definition, sections: move(definition.sections, index, -1) })}><ArrowUp size={13} /></button><button className={`${button} px-2`} aria-label={`Move section ${item.title} down`} disabled={index === definition.sections.length - 1} onClick={() => update({ ...definition, sections: move(definition.sections, index, 1) })}><ArrowDown size={13} /></button></div>)}<button className={button} disabled={definition.sections.length >= 30} onClick={() => { const id = identity('section'); update({ ...definition, sections: [...definition.sections, { id, title: 'New section', screenshots: false, criteria: [{ id: identity('question'), text: 'New question', type: 'text', required: true }] }] }); setSection(id); }}><Plus size={15} />Add section</button></aside>
          {group && <section className="min-w-0 space-y-4"><div className="space-y-3 rounded-xl border border-background-200 bg-white p-4"><label className="grid gap-1 text-xs font-semibold">Section title<input className={qualityControl} maxLength={160} value={group.title} onChange={event => changeSection({ title: event.target.value })} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={group.screenshots} onChange={event => changeSection({ screenshots: event.target.checked })} />Allow supporting screenshots in this section</label><button className={`${button} text-rose-700`} disabled={definition.sections.length === 1} onClick={() => { if (window.confirm('Remove this section from the draft? Saved reviews keep their original version.')) { const next = definition.sections.filter(item => item.id !== section); update({ ...definition, sections: next }); setSection(next[0].id); } }}><Trash2 size={14} />Remove section</button></div>
            {group.criteria.map((item, index) => <article key={item.id} className="min-w-0 space-y-3 rounded-xl border border-background-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-foreground-500">Question {index + 1}</p><div className="flex gap-1"><button className={button} aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => changeSection({ criteria: move(group.criteria, index, -1) })}><ArrowUp size={13} /></button><button className={button} aria-label={`Move question ${index + 1} down`} disabled={index === group.criteria.length - 1} onClick={() => changeSection({ criteria: move(group.criteria, index, 1) })}><ArrowDown size={13} /></button><button className={`${button} text-rose-700`} aria-label={`Remove question ${index + 1}`} disabled={group.criteria.length === 1} onClick={() => changeSection({ criteria: group.criteria.filter(row => row.id !== item.id) })}><Trash2 size={13} /></button></div></div>
              <label className="grid gap-1 text-xs font-semibold">Question text<textarea className={qualityControl} rows={2} maxLength={1200} value={item.text} onChange={event => changeField(item.id, { text: event.target.value })} /></label>
              <div className="grid items-center gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-semibold">Question type<select className={qualityControl} value={item.type || 'rating'} onChange={event => { const type = event.target.value as QualityFieldType; changeField(item.id, { type, options: type === 'single_choice' || type === 'checklist' ? item.options?.length ? item.options : ['First option', 'Second option'] : [] }); }}>{Object.entries(fieldLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.required !== false} onChange={event => changeField(item.id, { required: event.target.checked })} />Required question</label></div>
              {(item.type === 'single_choice' || item.type === 'checklist') && <label className="grid gap-1 text-xs font-semibold">Options · one per line<textarea className={qualityControl} rows={3} value={(item.options || []).join('\n')} onChange={event => changeField(item.id, { options: event.target.value.split('\n') })} /></label>}
              <label className="grid gap-1 text-xs font-semibold">Help text<input className={qualityControl} maxLength={1000} value={item.help || ''} onChange={event => changeField(item.id, { help: event.target.value })} /></label>
            </article>)}<button className={button} disabled={definition.sections.reduce((sum, row) => sum + row.criteria.length, 0) >= 100} onClick={() => changeSection({ criteria: [...group.criteria, { id: identity('question'), text: 'New question', type: 'text', required: true }] })}><Plus size={15} />Add question</button>
          </section>}
        </div>
        <details className="rounded-xl border border-background-200 bg-white p-4"><summary className="cursor-pointer text-sm font-bold">Quality rating descriptors</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(definition.ratings).map(([key, value]) => <label key={key} className="grid gap-1 text-xs font-semibold">{key === 'na' ? 'N/A' : key[0].toUpperCase() + key.slice(1)}<textarea className={qualityControl} rows={3} maxLength={1000} value={value} onChange={event => update({ ...definition, ratings: { ...definition.ratings, [key]: event.target.value } })} /></label>)}</div></details>
      </fieldset>}
      {preview && definition && <FormPreview definition={definition} onClose={() => setPreview(false)} />}
    </main>
  </WorkspaceShell>;
}
