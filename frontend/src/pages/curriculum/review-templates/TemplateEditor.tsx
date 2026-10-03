import { useEffect, useState } from 'react';
import { Modal } from '@/pages/users/components/Modal';
import { FormField, TextControl, TextAreaControl } from '@/pages/curriculum/shared/entities/ui';
import { ReviewFormRenderer } from '@/components/reviews/ReviewFormRenderer';
import { FAMILY_LABELS, previewMigratedDefinition, updateMigratedTemplate, type MigratedDefinition, type MigratedField,
  type TemplateDetail, type TemplatePreview } from '@/api/migratedReviewTemplates';
import { templateKind } from './templateDisplay';

export const buttonClass = 'rounded-lg border border-primary-200 bg-background-50 px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50';
const selectClass = 'h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-sm';
const fieldTypes = [[1, 'Text'], [13, 'Text Multiline'], [2, 'Yes / No'], [4, 'Date'], [5, 'List'], [6, 'Yes / No with conditions'], [11, 'Heading and description']] as const;
const key = () => `field-${crypto.randomUUID()}`;
const newField = (): MigratedField => ({ key: key(), title: '', aptemType: 13, order: 0, mandatory: false, description: '', options: [], ifTrue: [], ifFalse: [] });

function ordered<T extends { order: number }>(items: T[]) { return items.map((item, order) => ({ ...item, order })); }
function move<T extends { order: number }>(items: T[], index: number, offset: number) {
  const result = [...items];
  [result[index], result[index + offset]] = [result[index + offset], result[index]];
  return ordered(result);
}

function hasSummary(fields: MigratedField[]): boolean {
  return fields.some(field => field.semanticKey === 'meeting_summary' || hasSummary(field.ifTrue || []) || hasSummary(field.ifFalse || []));
}

function Fields({ fields, onChange, depth = 0, summaryMapped }: { fields: MigratedField[]; onChange: (fields: MigratedField[]) => void; depth?: number; summaryMapped: boolean }) {
  const update = (index: number, changes: Partial<MigratedField>) => onChange(fields.map((field, i) => i === index ? { ...field, ...changes } : field));
  return <div className="space-y-3">
    {fields.map((field, index) => <fieldset key={field.key} className="space-y-3 rounded-xl border border-background-200 bg-background-100/50 p-4">
      <legend className="px-1 text-xs font-semibold">Question {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Question label"><TextControl value={field.title} onChange={title => update(index, { title })} /></FormField>
        <FormField label="Field type"><select className={selectClass} value={field.aptemType} onChange={event => {
          const aptemType = Number(event.target.value);
          if (field.semanticKey === 'meeting_summary' && ![1, 13].includes(aptemType)
            && !window.confirm('Changing this field type will turn off Use as AI Meeting Summary. The question will remain in the template. Continue?')) return;
          if (aptemType !== 6 && ((field.ifTrue?.length || 0) + (field.ifFalse?.length || 0)) && !window.confirm('Changing this type removes its conditional questions. Continue?')) return;
          update(index, { aptemType, ...(![1, 13].includes(aptemType) ? { semanticKey: undefined } : {}), ...(aptemType !== 6 ? { ifTrue: [], ifFalse: [] } : {}) });
        }}>{!fieldTypes.some(([value]) => value === field.aptemType) && <option value={field.aptemType}>Unsupported type {field.aptemType}</option>}
          {fieldTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      </div>
      <FormField label="Help text"><TextAreaControl value={field.description || ''} onChange={description => update(index, { description })} rows={2} /></FormField>
      {depth === 0 && [1, 13].includes(field.aptemType) && <div className="space-y-1 text-sm">
        <label><input type="checkbox" checked={field.semanticKey === 'meeting_summary'}
          disabled={summaryMapped && field.semanticKey !== 'meeting_summary'}
          onChange={event => update(index, { semanticKey: event.target.checked ? 'meeting_summary' : undefined })} /> Use as AI Meeting Summary</label>
        <p className="text-xs text-foreground-500">Check Session can use the generated meeting summary for this field. The coach can review and edit the answer before submission.</p>
        {summaryMapped && field.semanticKey !== 'meeting_summary' && <p className="text-xs text-foreground-500">Another question already uses AI Meeting Summary. Clear that selection before choosing this question.</p>}
      </div>}
      {field.aptemType === 5 && <FormField label="Options" hint="One option per line. Values must be unique."><TextAreaControl value={(field.options || []).join('\n')} onChange={value => update(index, { options: value.split('\n') })} /></FormField>}
      <div className="flex flex-wrap items-center gap-2">
        {field.aptemType !== 11 && <label className="mr-auto text-xs"><input type="checkbox" checked={!!field.mandatory} onChange={e => update(index, { mandatory: e.target.checked })} /> Required</label>}
        <button type="button" className={buttonClass} disabled={index === 0} onClick={() => onChange(move(fields, index, -1))}>Move question up</button>
        <button type="button" className={buttonClass} disabled={index === fields.length - 1} onClick={() => onChange(move(fields, index, 1))}>Move question down</button>
        <button type="button" className={buttonClass} onClick={() => { if (window.confirm('Remove this question and its conditional questions?')) onChange(ordered(fields.filter((_, i) => i !== index))); }}>Remove question</button>
      </div>
      {field.aptemType === 6 && depth < 10 && (['ifTrue', 'ifFalse'] as const).map(branch => <div key={branch} className="border-l-2 border-primary-200 pl-3">
        <h4 className="mb-2 text-sm font-semibold">When answer is {branch === 'ifTrue' ? 'Yes' : 'No'}</h4>
        <Fields fields={field[branch] || []} onChange={children => update(index, { [branch]: children })} depth={depth + 1} summaryMapped={summaryMapped} />
      </div>)}
    </fieldset>)}
    <button type="button" className={buttonClass} onClick={() => onChange([...fields, { ...newField(), order: fields.length }])}>Add question</button>
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const dirty = name !== template.name || JSON.stringify(definition) !== JSON.stringify(template.definition);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const close = () => { if (!busy && (!dirty || window.confirm('Discard unsaved template changes?'))) onClose(); };
  const sections = definition.sections;
  const updateSections = (next: MigratedDefinition['sections']) => setDefinition({ sections: next });
  const save = async () => {
    setBusy(true); setError('');
    try { await updateMigratedTemplate(template, { name, definition }); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to save template.'); }
    finally { setBusy(false); }
  };
  const showPreview = async () => {
    setBusy(true); setError('');
    try { setPreview(await previewMigratedDefinition(definition)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to preview template.'); }
    finally { setBusy(false); }
  };
  return <Modal title={preview ? `Previewing ${templateKind(template)} ${FAMILY_LABELS[template.review_family]} Template` : `Editing ${templateKind(template)} Template`} onClose={close} size="max-w-5xl" dismissible={!busy}
    footer={<div className="flex justify-end gap-2"><button className={buttonClass} disabled={busy} onClick={close}>Cancel</button><button className={buttonClass} disabled={busy} onClick={() => preview ? setPreview(null) : void showPreview()}>{preview ? 'Back to editor' : 'Preview'}</button><button className={buttonClass} disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Please wait…' : 'Save template'}</button></div>}>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <div className="mb-4">
      {template.scope === 'PROGRAMME' && <p className="font-semibold text-foreground-900">{programmeName}</p>}
      <p className="text-sm text-foreground-500">{FAMILY_LABELS[template.review_family]}</p>
    </div>
    <div className="mb-5 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm leading-6 text-sky-900">
      {template.scope === 'GLOBAL'
        ? 'Changes apply to future or uninitialised migrated reviews using this Standard Template. Reviews already started keep their saved version.'
        : 'This programme-specific copy can be edited independently. Reviews already started keep their saved version.'}
    </div>
    {!template.is_active && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Saved but not in use. Saving your changes does not enable this version.{template.scope === 'PROGRAMME' ? ' Choose Use Custom Version when it is ready.' : ' Enable it from More when it is ready.'}</p>}
    {preview ? <PreviewForm preview={preview} /> : <fieldset disabled={busy} className="space-y-5">
      <FormField label="Template name"><TextControl value={name} onChange={setName} /></FormField>
      {sections.map((section, index) => <section key={section.key} className="space-y-3 rounded-2xl border border-background-200 p-4">
        <FormField label={`Section ${index + 1} title`}><TextControl value={section.title} onChange={title => updateSections(sections.map((s, i) => i === index ? { ...s, title } : s))} /></FormField>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={index === 0} onClick={() => updateSections(move(sections, index, -1))}>Move section up</button>
          <button type="button" className={buttonClass} disabled={index === sections.length - 1} onClick={() => updateSections(move(sections, index, 1))}>Move section down</button>
          <button type="button" className={buttonClass} onClick={() => { if (window.confirm('Remove this section and its questions?')) updateSections(ordered(sections.filter((_, i) => i !== index))); }}>Remove section</button>
        </div>
        <Fields fields={section.fields} onChange={fields => updateSections(sections.map((s, i) => i === index ? { ...s, fields } : s))} summaryMapped={sections.some(s => hasSummary(s.fields))} />
      </section>)}
      <button type="button" className={buttonClass} onClick={() => updateSections([...sections, { key: key(), title: '', order: sections.length, fields: [newField()] }])}>Add section</button>
    </fieldset>}
  </Modal>;
}
