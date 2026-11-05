import { useEffect, useState } from 'react';
import { CornerDownRight, Layers, MessageSquareText, Plus } from 'lucide-react';
import { Modal } from '@/pages/users/components/Modal';
import { FormField, TextControl, TextAreaControl } from '@/pages/curriculum/shared/entities/ui';
import { ReviewFormRenderer } from '@/components/reviews/ReviewFormRenderer';
import { FAMILY_LABELS, TemplateAnswerConflictError, previewMigratedDefinition, updateMigratedTemplate, type MigratedDefinition, type MigratedField,
  type TemplateDetail, type TemplatePreview } from '@/api/migratedReviewTemplates';
import { definitionCounts, templateKind } from './templateDisplay';

export const buttonClass = 'rounded-lg border border-primary-200 bg-background-50 px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50';
const selectClass = 'h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-sm';
const removeButtonClass = 'rounded-lg border border-red-200 bg-background-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50';
const fieldTypes = [[1, 'Text'], [13, 'Text Multiline'], [2, 'Yes / No'], [4, 'Date'], [5, 'List'], [6, 'Yes / No with conditions'], [11, 'Heading and description']] as const;
const key = () => `field-${crypto.randomUUID()}`;
const newField = (): MigratedField => ({ key: key(), title: '', aptemType: 13, order: 0, mandatory: false, description: '', options: [], ifTrue: [], ifFalse: [] });
// Match Python's character count, including pasted emoji.
const textLength = (value: string) => Array.from(value).length;
const lengthHint = (value: string, limit: number) => `${textLength(value).toLocaleString('en-GB')} / ${limit.toLocaleString('en-GB')} characters`;
function LengthHint({ value, limit }: { value: string; limit: number }) {
  return <p className={`mt-1 text-[11px] ${textLength(value) > limit ? 'font-semibold text-red-600' : 'text-foreground-500'}`}>{lengthHint(value, limit)}</p>;
}
const problemSummary = (problems: Problem[]) => !problems.length ? '' : problems.length === 1 ? problems[0].message
  : `${problems.length} questions or sections need attention before this template can be saved.`;

function ordered<T extends { order: number }>(items: T[]) { return items.map((item, order) => ({ ...item, order })); }
function move<T extends { order: number }>(items: T[], index: number, offset: number) {
  const result = [...items];
  [result[index], result[index + offset]] = [result[index + offset], result[index]];
  return ordered(result);
}

function hasSummary(fields: MigratedField[]): boolean {
  return fields.some(field => field.semanticKey === 'meeting_summary' || hasSummary(field.ifTrue || []) || hasSummary(field.ifFalse || []));
}

type Problem = { anchor: string; message: string };
/** Ties a problem to the control that owns it, so a refused save can scroll to it. */
const anchorId = (anchor: string) => `template-problem-${anchor}`;

/**
 * Mirrors the authoring rules the server enforces in coach_api/migrated_templates.py,
 * for the cases an author can actually produce here: "Add section" and "Add question"
 * both start out empty, and the server then refuses the whole template on the first
 * empty title with a single sentence that names no section or question. Collecting
 * every problem against its own control keeps that answer beside the field instead of
 * at the top of a dialog body the author has already scrolled past.
 */
function definitionProblems(name: string, definition: MigratedDefinition): Problem[] {
  const problems: Problem[] = [];
  if (!name.trim()) problems.push({ anchor: 'name', message: 'Enter a template name.' });
  else if (textLength(name.trim()) > 255) problems.push({ anchor: 'name', message: 'Use at most 255 characters.' });

  const hours = definition.otjh?.expectedHours;
  if (hours !== undefined && (!Number.isFinite(hours) || hours < 0 || hours > 999999.99
    // Compare against the rounded pence value: 0.07 * 100 is 7.000000000000001 in
    // binary floating point, and an exact test would reject a valid two-decimal entry.
    || Math.abs(hours * 100 - Math.round(hours * 100)) > 1e-6)) {
    problems.push({ anchor: 'hours', message: 'Enter 0 to 999999.99, with at most two decimal places.' });
  }

  const visit = (field: MigratedField) => {
    if (!field.title.trim()) problems.push({ anchor: field.key, message: 'Enter a question label.' });
    else if (textLength(field.title) > 4000) problems.push({ anchor: field.key, message: 'Use at most 4,000 characters for this question label.' });
    if (textLength(field.description || '') > 20000) problems.push({ anchor: `description:${field.key}`, message: 'Use at most 20,000 characters for this help text.' });
    if (field.aptemType === 5) {
      const options = field.options || [];
      const trimmed = options.map(option => option.trim());
      // The editor keeps one option per line, so a trailing newline leaves an empty
      // entry the author cannot see. Name it rather than dropping it silently.
      if (!options.length) problems.push({ anchor: `options:${field.key}`, message: 'Add at least one option.' });
      else if (trimmed.some(option => !option)) problems.push({ anchor: `options:${field.key}`, message: 'Remove the blank option lines.' });
      else if (new Set(trimmed).size !== trimmed.length) problems.push({ anchor: `options:${field.key}`, message: 'Options must be unique.' });
      else if (options.some(option => textLength(option) > 4000)) problems.push({ anchor: `options:${field.key}`, message: 'Use at most 4,000 characters per option.' });
    }
    (field.ifTrue || []).forEach(visit);
    (field.ifFalse || []).forEach(visit);
  };

  if (!definition.sections.length) problems.push({ anchor: 'sections', message: 'Add at least one section.' });
  definition.sections.forEach(section => {
    if (!section.title.trim()) problems.push({ anchor: `title:${section.key}`, message: 'Enter a section title.' });
    else if (textLength(section.title) > 4000) problems.push({ anchor: `title:${section.key}`, message: 'Use at most 4,000 characters for this section title.' });
    if (!section.fields.length) problems.push({ anchor: `fields:${section.key}`, message: 'Add at least one question, or remove this section.' });
    section.fields.forEach(visit);
  });
  return problems;
}

function Fields({ fields, onChange, depth = 0, numberPrefix, addLabel, summaryMapped, allowEmployer, problemFor }: { fields: MigratedField[]; onChange: (fields: MigratedField[]) => void; depth?: number; numberPrefix: string; addLabel: string; summaryMapped: boolean; allowEmployer: boolean; problemFor: (anchor: string) => string | undefined }) {
  const update = (index: number, changes: Partial<MigratedField>) => onChange(fields.map((field, i) => i === index ? { ...field, ...changes } : field));
  return <div className="min-w-0 space-y-4">
    {fields.map((field, index) => {
      const number = `${numberPrefix}${index + 1}`;
      const label = `${field.aptemType === 11 ? 'Content' : depth ? 'Follow-up' : 'Question'} ${number}`;
      return <fieldset key={field.key} id={anchorId(field.key)} className="min-w-0 rounded-xl border border-background-300 bg-background-50 shadow-sm">
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap items-center gap-2 border-b border-background-200 px-3 py-3 sm:px-4">
        <span className="inline-flex min-w-0 items-center gap-2 text-sm font-bold text-foreground-900"><MessageSquareText size={16} className="shrink-0 text-primary-600" aria-hidden="true"/><span className="break-all">{label}</span></span>
        <span className="ml-auto rounded-md bg-background-100 px-2 py-1 text-[11px] font-semibold text-foreground-600">{field.aptemType === 11 ? 'Display only' : field.mandatory ? 'Required' : 'Optional'}</span>
      </div>
      <div className={`min-w-0 space-y-3 ${depth ? 'p-2 sm:p-3' : 'p-3 sm:p-4'}`}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div><FormField label="Question label" error={problemFor(field.key)}><TextControl value={field.title} onChange={title => update(index, { title })} /></FormField><LengthHint value={field.title} limit={4000}/></div>
        <FormField label="Field type"><select className={selectClass} value={field.aptemType} onChange={event => {
          const aptemType = Number(event.target.value);
          if (field.semanticKey === 'meeting_summary' && ![1, 13].includes(aptemType)
            && !window.confirm('Changing this field type will turn off Use as AI Meeting Summary. The question will remain in the template. Continue?')) return;
          if (aptemType !== 6 && ((field.ifTrue?.length || 0) + (field.ifFalse?.length || 0)) && !window.confirm('Changing this type removes its conditional questions. Continue?')) return;
          if (field.aptemType === 5 && aptemType !== 5 && field.options?.length
            && !window.confirm('Changing this type removes its list options. Continue?')) return;
          update(index, { aptemType, ...(aptemType !== 5 ? { options: [] } : {}), ...(aptemType === 11 ? { respondentRoles: [] } : {}), ...(![1, 13].includes(aptemType) ? { semanticKey: undefined } : {}), ...(aptemType !== 6 ? { ifTrue: [], ifFalse: [] } : {}) });
        }}>{!fieldTypes.some(([value]) => value === field.aptemType) && <option value={field.aptemType}>Unsupported type {field.aptemType}</option>}
          {fieldTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      </div>
      <div id={anchorId(`description:${field.key}`)}><FormField label="Help text" error={problemFor(`description:${field.key}`)}><TextAreaControl value={field.description || ''} onChange={description => update(index, { description })} rows={2} /></FormField><LengthHint value={field.description || ''} limit={20000}/></div>
      {field.aptemType !== 11 && <fieldset className="rounded-lg border border-dashed border-background-300 bg-white p-3">
        <legend className="px-1 text-xs font-semibold">Who can answer</legend>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-foreground-500">Coach (always)</span>
          {(['participant', 'employer'] as const).filter(role => allowEmployer || role !== 'employer').map(role => <label key={role} className="flex items-center gap-2">
            <input type="checkbox" checked={(field.respondentRoles || []).includes(role)} onChange={event => update(index, {
              respondentRoles: event.target.checked ? [...(field.respondentRoles || []), role] : (field.respondentRoles || []).filter(value => value !== role),
            })} />{role === 'participant' ? 'Learner' : 'Employer'}
          </label>)}
        </div>
        <p className="mt-2 text-xs text-foreground-500">Selected people can edit the same answer before submission. Signature requirements are unchanged.</p>
      </fieldset>}
      {depth === 0 && [1, 13].includes(field.aptemType) && <div className="space-y-1 text-sm">
        <label><input type="checkbox" checked={field.semanticKey === 'meeting_summary'}
          disabled={summaryMapped && field.semanticKey !== 'meeting_summary'}
          onChange={event => update(index, { semanticKey: event.target.checked ? 'meeting_summary' : undefined })} /> Use as AI Meeting Summary</label>
        <p className="text-xs text-foreground-500">Check Session can use the generated meeting summary for this field. The coach can review and edit the answer before submission.</p>
        {summaryMapped && field.semanticKey !== 'meeting_summary' && <p className="text-xs text-foreground-500">Another question already uses AI Meeting Summary. Clear that selection before choosing this question.</p>}
      </div>}
      {field.aptemType === 5 && <div id={anchorId(`options:${field.key}`)}><FormField label="Options" hint="One option per line. Values must be unique; at most 4,000 characters each." error={problemFor(`options:${field.key}`)}><TextAreaControl value={(field.options || []).join('\n')} onChange={value => update(index, { options: value.split('\n') })} /></FormField></div>}
      <div className="flex flex-wrap items-center gap-2">
        {field.aptemType !== 11 && <label className="mr-auto text-xs"><input type="checkbox" checked={!!field.mandatory} onChange={e => update(index, { mandatory: e.target.checked })} /> Required</label>}
        <button type="button" className={buttonClass} disabled={index === 0} onClick={() => onChange(move(fields, index, -1))}>Move question up</button>
        <button type="button" className={buttonClass} disabled={index === fields.length - 1} onClick={() => onChange(move(fields, index, 1))}>Move question down</button>
        <button type="button" className={removeButtonClass} onClick={() => { if (window.confirm('Remove this question and its conditional questions?')) onChange(ordered(fields.filter((_, i) => i !== index))); }}>Remove question</button>
      </div>
      {field.aptemType === 6 && depth < 10 && <div className="space-y-4 border-t border-background-200 pt-4">
        <p className="text-xs text-foreground-500">Follow-up questions appear only for the selected answer.</p>
        {(['ifTrue', 'ifFalse'] as const).map(branch => {
          const answer = branch === 'ifTrue' ? 'Yes' : 'No';
          return <div key={branch} role="group" aria-label={`${label}: when answer is ${answer}`} className="min-w-0 space-y-3 rounded-lg border-l-4 border-primary-200 bg-background-100 p-2 sm:p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground-700">
              <CornerDownRight size={17} className="shrink-0" aria-hidden="true"/>
              <h4>When answer is <span className={`inline-block rounded-md px-2 py-1 ${branch === 'ifTrue' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{answer}</span></h4>
            </div>
            {!field[branch]?.length && <p className="text-xs text-foreground-500">No follow-up questions yet.</p>}
            <Fields fields={field[branch] || []} onChange={children => update(index, { [branch]: children })} depth={depth + 1}
              numberPrefix={`${number}.${branch === 'ifTrue' ? 'Y' : 'N'}`} addLabel={`Add follow-up for ${answer}`} summaryMapped={summaryMapped} allowEmployer={allowEmployer} problemFor={problemFor} />
          </div>;
        })}
      </div>}
      </div>
    </fieldset>;
    })}
    <button type="button" className={`${buttonClass} inline-flex items-center gap-2 border-dashed`} onClick={() => onChange([...fields, { ...newField(), order: fields.length }])}><Plus size={15} aria-hidden="true"/>{addLabel}</button>
  </div>;
}

export function PreviewForm({ preview }: { preview: TemplatePreview }) {
  const [open, setOpen] = useState(preview.sections[0]?.id || '');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  return <div className="space-y-3">
    <p className="text-sm text-foreground-500">Try the form and its conditional questions. Preview answers are not saved.</p>
    <ReviewFormRenderer sections={preview.sections} answers={answers} onAnswerChange={(id, value) => setAnswers(previous => ({ ...previous, [id]: value }))} openSectionId={open} onOpenSectionChange={setOpen} />
  </div>;
}

export function TemplateEditor({ template, programmeName, onClose, onSaved }: { template: TemplateDetail; programmeName: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template.name);
  const [definition, setDefinition] = useState<MigratedDefinition>(() => structuredClone(template.definition));
  const [hoursDraft, setHoursDraft] = useState(String(template.definition.otjh?.expectedHours ?? 0));
  const [requestError, setRequestError] = useState('');
  const [conflictFields, setConflictFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  // Only after a refused save, so a half-typed new question is not marked up while
  // the author is still filling it in. From then on the marks clear as they type.
  const [validationMode, setValidationMode] = useState<'save' | 'preview' | null>(null);
  const problems = validationMode ? definitionProblems(name, definition)
    .filter(problem => validationMode === 'save' || problem.anchor !== 'name') : [];
  const error = problemSummary(problems) || requestError;
  const problemFor = (anchor: string) => problems.find(problem => problem.anchor === anchor)?.message
    || (conflictFields.includes(anchor) ? 'Keep the type and options used by saved answers, or add a new question.' : undefined);
  useEffect(() => { setRequestError(''); setConflictFields([]); }, [name, definition]);
  const dirty = name !== template.name || JSON.stringify(definition) !== JSON.stringify(template.definition);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const close = () => { if (!busy && (!dirty || window.confirm('Discard unsaved template changes?'))) onClose(); };
  const sections = definition.sections;
  const signatureDefaults = { advisor: template.review_family !== 'PSP', participant: template.review_family !== 'PSP', employer: template.review_family !== 'MCM' && template.review_family !== 'PSP' };
  const signatures = definition.signatures ?? signatureDefaults;
  const updateSections = (next: MigratedDefinition['sections']) => setDefinition(current => ({ ...current, sections: next }));
  /**
   * Reports the problems the server would refuse the whole request for, and takes the
   * author to the first one. The dialog body scrolls independently, so a message left
   * at the top of it is invisible from anywhere further down the form.
   */
  const blocked = (found: Problem[]) => {
    if (!found.length) return false;
    const node = document.getElementById(anchorId(found[0].anchor));
    // jsdom implements neither, and this is presentation only.
    node?.scrollIntoView?.({ block: 'center' });
    node?.querySelector<HTMLElement>('input, textarea, select')?.focus?.({ preventScroll: true });
    return true;
  };
  const save = async () => {
    setValidationMode('save'); setRequestError(''); setConflictFields([]);
    if (blocked(definitionProblems(name, definition))) return;
    setBusy(true);
    try { await updateMigratedTemplate(template, { name, definition }); onSaved(); }
    catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Unable to save template.');
      if (err instanceof TemplateAnswerConflictError) {
        setConflictFields(err.fields);
        setPreview(null);
        // Preview may be mounted instead of the editor when the response arrives.
        window.requestAnimationFrame(() => blocked(err.fields.map(anchor => ({ anchor, message: '' }))));
      }
    }
    finally { setBusy(false); }
  };
  const showPreview = async () => {
    // Preview posts the definition to the same validator, so it refuses the same
    // drafts. The name is not part of that payload and cannot block a preview.
    setValidationMode('preview'); setRequestError(''); setConflictFields([]);
    if (blocked(definitionProblems(name, definition).filter(problem => problem.anchor !== 'name'))) return;
    setBusy(true);
    try { setPreview(await previewMigratedDefinition(definition)); }
    catch (err) { setRequestError(err instanceof Error ? err.message : 'Unable to preview template.'); }
    finally { setBusy(false); }
  };
  return <Modal title={preview ? `Previewing ${templateKind(template)} ${FAMILY_LABELS[template.review_family]} Template` : `Editing ${templateKind(template)} Template`} onClose={close} size="max-w-5xl" dismissible={!busy}
    footer={<div className="flex w-full flex-wrap items-center justify-end gap-2">
      {/* The dialog body scrolls, so the banner at the top of it is the one thing an
          author working further down never sees. The footer does not scroll away.
          aria-hidden: the banner is the single live region, announced once. */}
      {error && <p aria-hidden="true" className="mr-auto basis-full text-xs font-semibold leading-5 text-red-700 sm:basis-auto sm:max-w-[55%]">{error}</p>}
      <button className={buttonClass} disabled={busy} onClick={close}>Cancel</button><button className={buttonClass} disabled={busy} onClick={() => preview ? setPreview(null) : void showPreview()}>{preview ? 'Back to editor' : 'Preview'}</button><button className={buttonClass} disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Please wait…' : 'Save template'}</button></div>}>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <div className="mb-4">
      {template.scope === 'PROGRAMME' && <p className="font-semibold text-foreground-900">{programmeName}</p>}
      <p className="text-sm text-foreground-500">{FAMILY_LABELS[template.review_family]}</p>
    </div>
    <div className="mb-5 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm leading-6 text-sky-900">
      {template.review_family === 'PSP'
        ? 'Manage the global Personal Support Plan questions and required signatures here. No signatures are required by default. Learner information, Functional Skills and Reviews Schedule belong to each learner and are not shared template answers. Learner answer permissions are configured per question.'
        : template.scope === 'GLOBAL'
        ? 'Changes apply to migrated reviews using this Standard Template while they are still editable. Working reviews synchronise when opened by the coach or checked on save. Reviews awaiting signatures or completed keep their saved version.'
        : 'This programme-specific copy can be edited independently. Working reviews synchronise when opened by the coach or checked on save. Reviews awaiting signatures or completed keep their saved version.'}
    </div>
    {!template.is_active && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Saved but not in use. Saving your changes does not enable this version.{template.scope === 'PROGRAMME' ? ' Choose Use Custom Version when it is ready.' : ' Enable it from More when it is ready.'}</p>}
    {preview ? <PreviewForm preview={preview} /> : <fieldset disabled={busy} className="space-y-5">
      <div id={anchorId('name')}><FormField label="Template name" error={problemFor('name')}><TextControl value={name} onChange={setName} /></FormField><LengthHint value={name.trim()} limit={255}/></div>
      <fieldset className="space-y-3 rounded-xl border border-background-200 p-4">
        <legend className="px-1 text-sm font-semibold">Signatures required from</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {([['advisor', 'Coach'], ['participant', 'Learner'], ['employer', 'Employer']] as const).map(([role, label]) =>
            <label key={role} className="flex items-center gap-2">
              <input type="checkbox" checked={signatures[role]} onChange={event => setDefinition(current => ({
                ...current, signatures: { ...(current.signatures ?? signatureDefaults), [role]: event.target.checked },
              }))} />{label}
            </label>)}
        </div>
        <p className="text-xs text-foreground-500">Applies to editable reviews using this template. Submitted and completed reviews keep their saved signature requirements. {template.review_family === 'PSP' ? 'Saving all required answers sends the plan for the selected signatures. If none are selected, the plan completes on save.' : 'If none are selected, submitting a completed form completes the review without signatures.'}</p>
      </fieldset>
      <fieldset className="space-y-3 rounded-xl border border-background-200 p-4">
        <legend className="px-1 text-sm font-semibold">Off-the-job hours</legend>
        <div id={anchorId('hours')}><FormField label="Expected OTJH (hours)" error={problemFor('hours')}>
          <TextControl type="number" min={0} max={999999.99} step="0.01" value={hoursDraft}
            onChange={value => { setHoursDraft(value); setDefinition(current => ({ ...current, otjh: {
              countsTowardsOtjh: current.otjh?.countsTowardsOtjh ?? false, expectedHours: value === '' ? 0 : Number(value),
            } })); }} />
        </FormField></div>
        <p className="text-xs text-foreground-500">Hours credited for one completed review.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={definition.otjh?.countsTowardsOtjh ?? false}
          onChange={event => setDefinition(current => ({ ...current, otjh: {
            expectedHours: current.otjh?.expectedHours ?? 0, countsTowardsOtjh: event.target.checked,
          } }))} />Counts towards learner's total OTJH</label>
        <p className="text-xs text-foreground-500">Applies to editable reviews using this template. Hours are fixed when the review is submitted and credited once all required signatures are saved. Previously completed reviews are unchanged. These are configured review hours, not measured attendance.</p>
      </fieldset>
      <div className="pt-2"><h2 className="text-base font-bold text-foreground-900">Form sections</h2><p className="mt-1 text-sm text-foreground-500">Each section groups related questions. Yes / No branches contain their follow-up questions.</p></div>
      {sections.map((section, index) => {
        const count = definitionCounts({ sections: [section] }).questions;
        return <section key={section.key} aria-label={`Section ${index + 1}`} className="min-w-0 overflow-hidden rounded-2xl border-2 border-primary-200 bg-background-100/40">
        <div className="space-y-3 border-b border-primary-200 bg-primary-50 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="inline-flex items-center gap-2 text-base font-bold text-primary-900"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white"><Layers size={18} aria-hidden="true"/></span>Section {index + 1}</h3>
          <span className="rounded-full border border-primary-200 bg-background-50 px-3 py-1 text-xs font-semibold text-primary-700">{count} {count === 1 ? 'question' : 'questions'}</span>
        </div>
        <div id={anchorId(`title:${section.key}`)}><FormField label={`Section ${index + 1} title`} error={problemFor(`title:${section.key}`)}><TextControl value={section.title} onChange={title => updateSections(sections.map((s, i) => i === index ? { ...s, title } : s))} /></FormField><LengthHint value={section.title} limit={4000}/></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={index === 0} onClick={() => updateSections(move(sections, index, -1))}>Move section up</button>
          <button type="button" className={buttonClass} disabled={index === sections.length - 1} onClick={() => updateSections(move(sections, index, 1))}>Move section down</button>
          <button type="button" className={removeButtonClass} onClick={() => { if (window.confirm('Remove this section and its questions?')) updateSections(ordered(sections.filter((_, i) => i !== index))); }}>Remove section</button>
        </div>
        </div>
        <div id={anchorId(`fields:${section.key}`)} className="p-3 sm:p-5">
          {problemFor(`fields:${section.key}`) && <p className="mb-3 text-[11px] font-semibold text-red-600">{problemFor(`fields:${section.key}`)}</p>}
          <Fields fields={section.fields} onChange={fields => updateSections(sections.map((s, i) => i === index ? { ...s, fields } : s))}
          numberPrefix={`${index + 1}.`} addLabel={`Add question to section ${index + 1}`} summaryMapped={sections.some(s => hasSummary(s.fields))} allowEmployer={template.review_family === 'PR' || template.review_family === 'PR_SKILLS_RADAR'} problemFor={problemFor} /></div>
      </section>;
      })}
      <div id={anchorId('sections')}>
        {problemFor('sections') && <p className="mb-2 text-[11px] font-semibold text-red-600">{problemFor('sections')}</p>}
        <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary-300 bg-primary-50 px-4 py-4 text-sm font-semibold text-primary-700 hover:bg-primary-100" onClick={() => updateSections([...sections, { key: key(), title: '', order: sections.length, fields: [newField()] }])}><Plus size={18} aria-hidden="true"/>Add section</button>
      </div>
    </fieldset>}
  </Modal>;
}
