import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ModuleOverviewView } from '@/pages/learner/my-learning/ModuleOverviewView';
import { loadModuleStructure } from './moduleAuthoringData';
import {
  EMPTY_OVERVIEW,
  ModuleOverviewError,
  OVERVIEW_LIMITS,
  loadModuleOverview,
  newSectionId,
  normaliseOverview,
  photoUrlProblem,
  saveModuleOverview,
  validateOverview,
  type ModuleOverviewFields,
  type ModuleOverviewRecord,
  type OverviewFieldError,
  type OverviewListField,
  type OverviewSection,
  type OverviewSectionList,
} from './moduleOverviewApi';
import { buildPreviewModel, previewSourceFromStructure, type OverviewPreviewSource } from './moduleOverviewPreview';

const LIST_FIELDS: Record<Exclude<OverviewListField, 'highlights'>, { label: string; hint: string; placeholder: string }> = {
  prerequisites: { label: 'Prerequisites', hint: 'Shown in the sidebar as “Before you start”.', placeholder: 'e.g. Completion of Module 1' },
  requirements: { label: 'Learner requirements', hint: 'Shown in the sidebar as “What you will need”.', placeholder: 'e.g. A laptop with Microsoft Teams' },
  targetAudience: { label: 'Target audience', hint: 'Shown in the sidebar as “Who this module is for”.', placeholder: 'e.g. Apprentices new to coaching roles' },
};

/** Quick-add headings for common Description sections. Every section stays fully editable. */
const SECTION_PRESETS = ["What you'll practise", 'Enrolment and access', 'Using the course player', 'Learning objectives'];

const inputClass = 'w-full rounded-lg border border-background-200 bg-white px-3 py-2 text-sm text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100 aria-[invalid=true]:border-danger-300';
const smallButton = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40';

const NO_SECTION_ERRORS: Record<OverviewSectionList, string[]> = { descriptionSections: [], sidebarSections: [] };

type PreviewState = { status: 'loading' | 'ready' | 'failed'; source: OverviewPreviewSource };
type PreviewModule = { title: string; programmeName?: string; coverImage?: string };

/**
 * Manage Module Overview: an editor with a live learner preview.
 *
 * Writes only `curriculum.modules.module_overview` through its own endpoint,
 * and only when Save is clicked. The preview renders the learner page's own
 * component from the unsaved draft plus the module's existing records (title,
 * programme, cover, curriculum, tutor), which are read-only here.
 */
export function ModuleOverviewModal({ moduleCatalogueId, moduleTitle, module, onClose, onSaved, loadPreviewSource }: {
  moduleCatalogueId: string;
  moduleTitle: string;
  /** The Module Builder card's own values, used until (or if) the stored structure cannot be read. */
  module?: PreviewModule;
  onClose: () => void;
  onSaved?: (hasOverview: boolean) => void;
  /** Injectable for tests; defaults to the module's stored structure (a read-only GET). */
  loadPreviewSource?: (moduleCatalogueId: string) => Promise<OverviewPreviewSource | null>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [record, setRecord] = useState<ModuleOverviewRecord | null>(null);
  const [fields, setFields] = useState<ModuleOverviewFields>(EMPTY_OVERVIEW);
  const [loaded, setLoaded] = useState<ModuleOverviewFields>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<OverviewFieldError[]>([]);
  // Section errors are indexed by the cleaned list that was validated/sent, per list.
  const [errorSectionIds, setErrorSectionIds] = useState<Record<OverviewSectionList, string[]>>(NO_SECTION_ERRORS);
  const [conflict, setConflict] = useState<ModuleOverviewRecord | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const fallbackSource = useMemo(() => previewSourceFromStructure(null, {
    title: module?.title || moduleTitle, programme: module?.programmeName, coverUrl: module?.coverImage,
  }), [module?.title, module?.programmeName, module?.coverImage, moduleTitle]);
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading', source: fallbackSource });

  const apply = (next: ModuleOverviewRecord) => {
    setRecord(next);
    setFields(next.overview);
    setLoaded(next.overview);
    setFieldErrors([]);
    setErrorSectionIds(NO_SECTION_ERRORS);
    setConflict(null);
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadModuleOverview(moduleCatalogueId, controller.signal)
      .then(result => { if (!controller.signal.aborted) { apply(result); setError(''); } })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'The module overview could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [moduleCatalogueId]);

  // The curriculum for the preview: the module's stored structure, read only.
  useEffect(() => {
    let active = true;
    const load = loadPreviewSource || (async (id: string) => {
      const structure = await loadModuleStructure(id);
      return structure ? previewSourceFromStructure(structure, fallbackSource) : null;
    });
    setPreview({ status: 'loading', source: fallbackSource });
    load(moduleCatalogueId)
      .then(source => { if (active) setPreview({ status: source ? 'ready' : 'failed', source: source || fallbackSource }); })
      .catch(() => { if (active) setPreview({ status: 'failed', source: fallbackSource }); });
    return () => { active = false; };
  }, [moduleCatalogueId, loadPreviewSource, fallbackSource]);

  const dirty = useMemo(() => JSON.stringify(normaliseOverview(fields)) !== JSON.stringify(normaliseOverview(loaded)), [fields, loaded]);
  const tutorName = record?.tutorName || '';
  const photoUrl = fields.instructorPhotoUrl.trim();
  const avatarUrl = photoUrl && !photoUrlProblem(photoUrl) ? photoUrl : (!photoUrl ? record?.defaultPhotoUrl || '' : '');
  useEffect(() => setAvatarFailed(false), [avatarUrl]);
  const previewModel = useMemo(() => buildPreviewModel(preview.source, record, fields), [preview.source, record, fields]);

  const errorFor = (field: string) => fieldErrors.filter(item => item.field === field || item.field.startsWith(`${field}[`) || item.field.startsWith(`${field}.`)).map(item => item.message);
  const sectionErrors = (list: OverviewSectionList, id: string, part?: string) => {
    const index = errorSectionIds[list].indexOf(id);
    return index < 0 ? [] : errorFor(`${list}[${index}]${part ? `.${part}` : ''}`);
  };
  const set = <K extends keyof ModuleOverviewFields>(key: K, value: ModuleOverviewFields[K]) => {
    setFields(current => ({ ...current, [key]: value }));
    setNotice('');
  };
  const setSections = (list: OverviewSectionList, update: (sections: OverviewSection[]) => OverviewSection[]) => {
    setFields(current => ({ ...current, [list]: update(current[list]) }));
    setNotice('');
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm('Discard your unsaved changes to this module overview?')) return;
    onClose();
  };

  const discard = () => {
    if (!dirty || !window.confirm('Discard all unsaved changes and go back to the saved overview?')) return;
    setFields(loaded);
    setFieldErrors([]);
    setErrorSectionIds(NO_SECTION_ERRORS);
    setError('');
    setNotice('Changes discarded.');
  };

  const save = async () => {
    if (!record) return;
    const clean = normaliseOverview(fields);
    const problems = validateOverview(clean, tutorName);
    setFieldErrors(problems);
    setErrorSectionIds({ descriptionSections: clean.descriptionSections.map(section => section.id),
      sidebarSections: clean.sidebarSections.map(section => section.id) });
    setNotice('');
    setError('');
    if (problems.length) {
      setError('Check the highlighted fields.');
      setPane('edit');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveModuleOverview(moduleCatalogueId, clean, record.updatedAt);
      apply(saved);
      setNotice(saved.hasOverview ? 'Module overview saved.' : 'Module overview cleared. Learners will see the module’s own details only.');
      onSaved?.(saved.hasOverview);
    } catch (reason) {
      if (reason instanceof ModuleOverviewError && reason.conflict) {
        setConflict(reason.current);
        setError(reason.message);
      } else if (reason instanceof ModuleOverviewError && reason.fields.length) {
        setFieldErrors(reason.fields);
        setError(reason.message);
      } else {
        setError(reason instanceof Error ? reason.message : 'The module overview could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  };

  const unavailable = record ? !record.available : false;
  const editable = !loading && Boolean(record) && !unavailable;
  const sectionsFull = fields.descriptionSections.length >= OVERVIEW_LIMITS.sections;
  const sidebarFull = fields.sidebarSections.length >= OVERVIEW_LIMITS.sidebarSections;
  const usedHeadings = new Set(fields.descriptionSections.map(section => section.heading.trim().toLowerCase()));
  // Every operation names its list, so a sidebar edit can never touch a Description section (or vice versa).
  const addSection = (list: OverviewSectionList, heading: string) => setSections(list, sections =>
    [...sections, { id: newSectionId([...fields.descriptionSections, ...fields.sidebarSections, ...sections]), heading, body: '', bullets: [] }]);
  const moveSection = (list: OverviewSectionList, index: number, offset: number) => setSections(list, sections => {
    const next = [...sections];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    return next;
  });
  const removeSection = (list: OverviewSectionList, section: OverviewSection) => {
    const hasContent = section.heading.trim() || section.body.trim() || section.bullets.some(item => item.trim());
    if (hasContent && !window.confirm(`Delete the “${section.heading.trim() || 'untitled'}” section? It is removed from the draft now and from learners when you save.`)) return;
    setSections(list, sections => sections.filter(item => item.id !== section.id));
  };
  const updateSection = (list: OverviewSectionList, id: string, patch: Partial<OverviewSection>) =>
    setSections(list, sections => sections.map(item => (item.id === id ? { ...item, ...patch } : item)));

  return (
    <div className="fixed inset-0 z-[80] flex bg-black/50 p-2 backdrop-blur-sm sm:p-4" onClick={requestClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); requestClose(); } }}
        className="mx-auto flex h-full w-full max-w-[1680px] flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl"
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase text-primary-600">Manage Module Overview</p>
            <h2 id={titleId} className="mt-1 break-words text-lg font-bold">{moduleTitle}</h2>
            <p className="mt-1 text-xs text-foreground-500">
              Edit what learners read on this module&apos;s overview page. The title, programme, tutor, cover, curriculum and
              progress come from the module itself and are not edited here.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />Unsaved changes
            </span>}
            <button type="button" onClick={discard} disabled={!dirty || saving} className="rounded-lg border border-danger-200 bg-white px-3 py-2 text-sm font-semibold text-danger-700 disabled:cursor-not-allowed disabled:border-background-200 disabled:text-foreground-400">Discard changes</button>
            <button type="button" onClick={requestClose} className="rounded-lg border px-3 py-2 text-sm font-semibold">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={!editable || saving || !dirty} aria-busy={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-primary-300">
              <AppIcon name={saving ? 'ri-loader-4-line' : 'ri-save-3-line'} size={16} className={saving ? 'animate-spin' : ''} />
              {saving ? 'Saving…' : 'Save overview'}
            </button>
          </div>
        </header>

        <div role="tablist" aria-label="Editor view" className="flex gap-1 border-b bg-white px-5 py-2 xl:hidden">
          {(['edit', 'preview'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={pane === value}
            onClick={() => setPane(value)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${pane === value ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200' : 'text-foreground-600'}`}>
            {value === 'edit' ? 'Edit' : 'Preview'}
          </button>)}
        </div>

        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(440px,540px)_minmax(0,1fr)]">
          <form
            aria-label="Module overview content"
            className={`${pane === 'edit' ? 'flex' : 'hidden'} min-h-0 flex-col overflow-auto border-r border-background-200 xl:flex`}
            noValidate
            onSubmit={event => { event.preventDefault(); void save(); }}
          >
            <div className="flex flex-col gap-4 p-5">
              {error && <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm font-semibold text-danger-700">{error}</p>}
              {conflict && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <span>Your edits are still in the form. Load the latest version to continue from it.</span>
                <button type="button" onClick={() => { apply(conflict); setError(''); setNotice('Loaded the latest saved version.'); }} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold">Load latest version</button>
              </div>}
              {notice && !error && <p role="status" className="rounded-xl border border-success-200 bg-success-50 p-4 text-sm font-semibold text-success-700">{notice}</p>}

              {loading ? (
                <p role="status" className="rounded-xl border bg-white p-6 text-sm">Loading the module overview…</p>
              ) : !record ? null : unavailable ? (
                <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Module overview storage is not set up on this database yet.
                </p>
              ) : (
                <>
                  <Group title="Hero" hint="Shown under the module title, beside the cover and progress card.">
                    <TextField label="Short summary" hint="One or two sentences." value={fields.summary}
                      limit={OVERVIEW_LIMITS.summary} errors={errorFor('summary')} onChange={value => set('summary', value)} />
                  </Group>

                  <Group title="Description tab" hint="Headings, paragraphs and lists in the order shown here. Leave a blank line between paragraphs.">
                    <TextField label="About this module (optional)" value={fields.description}
                      limit={OVERVIEW_LIMITS.description} errors={errorFor('description')} multiline rows={5} onChange={value => set('description', value)} />

                    <div className="grid gap-3" aria-label="Description sections" role="group">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-sm font-semibold text-foreground-900">Sections</h4>
                        <span className="text-xs text-foreground-500">{fields.descriptionSections.length}/{OVERVIEW_LIMITS.sections}</span>
                      </div>
                      {fields.descriptionSections.length === 0 && <p className="rounded-lg border border-dashed border-background-300 bg-white p-3 text-xs text-foreground-500">
                        No sections yet. Add one below; empty sections are never shown to learners.
                      </p>}
                      {fields.descriptionSections.map((section, index) => <SectionEditor key={section.id} section={section} index={index}
                        count={fields.descriptionSections.length} errors={part => sectionErrors('descriptionSections', section.id, part)}
                        onChange={patch => updateSection('descriptionSections', section.id, patch)} onMove={offset => moveSection('descriptionSections', index, offset)}
                        onRemove={() => removeSection('descriptionSections', section)} />)}
                      <div role="group" aria-label="Add a section" className="grid gap-2 rounded-lg border border-dashed border-primary-200 bg-primary-50/40 p-3">
                        <p className="text-xs font-semibold text-foreground-700">Add a section{sectionsFull ? ' (limit reached)' : ''}</p>
                        <div className="flex flex-wrap gap-2">
                          {SECTION_PRESETS.map(heading => <button key={heading} type="button" disabled={sectionsFull || usedHeadings.has(heading.toLowerCase())}
                            onClick={() => addSection('descriptionSections', heading)} className={`${smallButton} border-primary-200 bg-white text-primary-700`}>
                            <AppIcon name="ri-add-line" size={14} />{heading}
                          </button>)}
                          <button type="button" disabled={sectionsFull} onClick={() => addSection('descriptionSections', '')}
                            className={`${smallButton} border-primary-300 bg-primary-600 text-white`}>
                            <AppIcon name="ri-add-line" size={14} />Custom section
                          </button>
                        </div>
                      </div>
                    </div>

                    <ListEditor label="Course highlights" hint="Shown as a checklist after the sections." placeholder="e.g. Self-paced online study"
                      items={fields.highlights} errors={errorFor('highlights')} onChange={value => set('highlights', value)} />
                  </Group>

                  <Group title="Sidebar" hint="Course details (sections and activity counts) come from the curriculum automatically.">
                    {(Object.keys(LIST_FIELDS) as (keyof typeof LIST_FIELDS)[]).map(field => <ListEditor key={field} {...LIST_FIELDS[field]}
                      items={fields[field]} errors={errorFor(field)} onChange={value => set(field, value)} />)}

                    <div className="grid gap-3" aria-label="Custom sidebar sections" role="group">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-sm font-semibold text-foreground-900">Custom sidebar sections</h4>
                        <span className="text-xs text-foreground-500">{fields.sidebarSections.length}/{OVERVIEW_LIMITS.sidebarSections}</span>
                      </div>
                      <p className="text-xs text-foreground-500">Shown as extra cards below the sidebar information above. Empty sections are never shown to learners.</p>
                      {fields.sidebarSections.map((section, index) => <SectionEditor key={section.id} section={section} index={index}
                        label="Sidebar section" count={fields.sidebarSections.length} errors={part => sectionErrors('sidebarSections', section.id, part)}
                        onChange={patch => updateSection('sidebarSections', section.id, patch)} onMove={offset => moveSection('sidebarSections', index, offset)}
                        onRemove={() => removeSection('sidebarSections', section)} />)}
                      <button type="button" disabled={sidebarFull} onClick={() => addSection('sidebarSections', '')}
                        className={`${smallButton} w-fit border-primary-300 bg-primary-600 text-white`}>
                        <AppIcon name="ri-add-line" size={14} />Add Sidebar Section{sidebarFull ? ' (limit reached)' : ''}
                      </button>
                    </div>
                  </Group>

                  <Group title="Instructor">
                    {tutorName ? (
                      <p className="text-sm text-foreground-600">
                        Tutor on this module: <strong className="text-foreground-900">{tutorName}</strong>. The details below are
                        shown only while {tutorName} is this module&apos;s tutor.
                      </p>
                    ) : (
                      <p className="text-sm text-foreground-600">No tutor is assigned to this module, so no instructor is shown to learners.</p>
                    )}
                    {record.previousTutorDetails && <p className="rounded-lg bg-background-100 p-3 text-xs text-foreground-600">
                      Instructor details saved for {record.previousTutorDetails} are kept but hidden, because they are no longer this module&apos;s tutor.
                      Entering details here replaces them.
                    </p>}
                    {tutorName && <div className="grid gap-4 sm:grid-cols-[88px_minmax(0,1fr)]">
                      <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-full bg-background-100 ring-4 ring-primary-50">
                        {avatarUrl && !avatarFailed
                          ? <img src={avatarUrl} alt={`${tutorName} preview`} className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />
                          : <AppIcon name="ri-user-3-line" size={30} className="text-foreground-400" />}
                      </div>
                      <div className="grid gap-4">
                        <TextField label="Instructor photo URL (optional)"
                          hint={record.defaultPhotoUrl ? 'Leave blank to use the standard Kent Business College photo for this tutor.' : 'A public https:// image (.jpg, .png, .webp, .gif or .avif). Leave blank for no photo.'}
                          value={fields.instructorPhotoUrl} limit={OVERVIEW_LIMITS.url} errors={errorFor('instructorPhotoUrl')} type="url"
                          onChange={value => set('instructorPhotoUrl', value)}
                          action={fields.instructorPhotoUrl ? { label: 'Remove photo URL', onClick: () => set('instructorPhotoUrl', '') } : undefined} />
                        {avatarFailed && avatarUrl && <p role="status" className="text-xs text-danger-700">This image could not be loaded. Learners will not see a broken image; the photo will simply be hidden.</p>}
                        <TextField label="Instructor biography (optional)" value={fields.instructorBio} limit={OVERVIEW_LIMITS.instructorBio}
                          errors={errorFor('instructorBio')} multiline rows={4} onChange={value => set('instructorBio', value)}
                          action={fields.instructorBio ? { label: 'Remove biography', onClick: () => set('instructorBio', '') } : undefined} />
                      </div>
                    </div>}
                  </Group>
                </>
              )}
            </div>
          </form>

          <section aria-label="Live preview" className={`${pane === 'preview' ? 'flex' : 'hidden'} min-h-0 flex-col bg-background-100 xl:flex`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-background-200 bg-white/70 px-5 py-2.5 text-xs text-foreground-600">
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground-800"><AppIcon name="ri-eye-line" size={14} />Learner preview</span>
              <span>{preview.status === 'loading' ? 'Loading the curriculum and learning outcomes…'
                : preview.status === 'failed' ? 'The curriculum could not be loaded for the preview; learners still see it.'
                  : 'Updates as you type. Nothing is saved until you click Save overview.'}</span>
              <span className="w-full text-[11px] text-foreground-500">Learner-specific progress, completion and grades are not shown here.</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
              <div className="mx-auto max-w-[1180px] rounded-2xl bg-white p-4 shadow-sm ring-1 ring-background-200 sm:p-6">
                <ModuleOverviewView preview model={previewModel} coverUrl={preview.source.coverUrl}
                  curriculumStatus={preview.status === 'loading' ? 'loading' : preview.status === 'failed' ? 'unavailable' : 'ready'}
                  progress={null} ctaLabel="Start learning" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} className="grid gap-4 rounded-xl border border-background-200 bg-white p-4">
    <div>
      <h3 id={id} className="text-sm font-bold text-foreground-900">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-foreground-500">{hint}</p>}
    </div>
    {children}
  </section>;
}

function SectionEditor({ section, index, count, errors, onChange, onMove, onRemove, label = 'Section' }: {
  section: OverviewSection; index: number; count: number; errors: (part?: string) => string[];
  onChange: (patch: Partial<OverviewSection>) => void; onMove: (offset: number) => void; onRemove: () => void;
  /** Field-label prefix: "Section" (Description tab) or "Sidebar section". */
  label?: string;
}) {
  const name = section.heading.trim() || `${label.toLowerCase()} ${index + 1}`;
  return <fieldset className="grid gap-3 rounded-lg border border-background-200 bg-background-50 p-3" data-section-id={section.id}>
    <legend className="sr-only">{label} {index + 1}</legend>
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-bold uppercase text-foreground-500">{label} {index + 1}</span>
      <div className="flex gap-1">
        <button type="button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)} className={`${smallButton} border-background-200 bg-white`}><AppIcon name="ri-arrow-up-line" size={14} /></button>
        <button type="button" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)} className={`${smallButton} border-background-200 bg-white`}><AppIcon name="ri-arrow-down-line" size={14} /></button>
        <button type="button" aria-label={`Delete ${name}`} onClick={onRemove} className={`${smallButton} border-danger-200 bg-white text-danger-700`}><AppIcon name="ri-delete-bin-line" size={14} />Delete</button>
      </div>
    </div>
    <TextField label={`${label} ${index + 1} heading`} value={section.heading} limit={OVERVIEW_LIMITS.sectionHeading} errors={errors('heading')}
      onChange={value => onChange({ heading: value })} />
    <TextField label={`${label} ${index + 1} text`} value={section.body} limit={OVERVIEW_LIMITS.sectionBody} errors={errors('body')}
      multiline rows={4} onChange={value => onChange({ body: value })} />
    <ListEditor label={`${label} ${index + 1} bullet points`} hint="Optional." placeholder="e.g. Ask an open question" items={section.bullets}
      errors={errors('bullets')} onChange={value => onChange({ bullets: value })} />
  </fieldset>;
}

function TextField({ label, hint, value, limit, errors, multiline = false, rows = 3, type = 'text', onChange, action }: {
  label: string; hint?: string; value: string; limit: number; errors: string[]; multiline?: boolean; rows?: number; type?: string;
  onChange: (value: string) => void; action?: { label: string; onClick: () => void };
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', errors.length ? `${id}-error` : '', `${id}-count`].filter(Boolean).join(' ');
  const common = { id, value, 'aria-invalid': errors.length > 0, 'aria-describedby': describedBy, className: inputClass };
  return <div className="grid gap-1.5">
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-foreground-900">{label}</label>
      {action && <button type="button" onClick={action.onClick} className="text-xs font-semibold text-danger-700 hover:underline">{action.label}</button>}
    </div>
    {hint && <p id={`${id}-hint`} className="text-xs text-foreground-500">{hint}</p>}
    {multiline
      ? <textarea {...common} rows={rows} onChange={event => onChange(event.target.value)} />
      : <input {...common} type={type} onChange={event => onChange(event.target.value)} />}
    <div className="flex justify-between gap-3 text-xs">
      <span id={`${id}-error`} className="text-danger-700">{errors.join(' ')}</span>
      <span id={`${id}-count`} className={value.trim().length > limit ? 'text-danger-700' : 'text-foreground-400'}>{value.trim().length}/{limit}</span>
    </div>
  </div>;
}

function ListEditor({ label, hint, placeholder, items, errors, onChange }: {
  label: string; hint?: string; placeholder: string; items: string[]; errors: string[];
  onChange: (items: string[]) => void;
}) {
  const id = useId();
  const full = items.length >= OVERVIEW_LIMITS.listItems;
  return <fieldset className="grid gap-2" aria-describedby={`${id}-hint${errors.length ? ` ${id}-error` : ''}`}>
    <legend className="text-sm font-semibold text-foreground-900">{label}</legend>
    <p id={`${id}-hint`} className="text-xs text-foreground-500">{hint ? `${hint} ` : ''}Up to {OVERVIEW_LIMITS.listItems} items.</p>
    {items.map((item, index) => (
      <div key={index} className="flex items-center gap-2">
        <input
          aria-label={`${label} item ${index + 1}`}
          value={item}
          placeholder={placeholder}
          maxLength={OVERVIEW_LIMITS.listItem + 50}
          className={inputClass}
          onChange={event => onChange(items.map((current, position) => (position === index ? event.target.value : current)))}
        />
        <button type="button" aria-label={`Remove ${label.toLowerCase()} item ${index + 1}`}
          onClick={() => onChange(items.filter((_, position) => position !== index))}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-white text-foreground-500 hover:border-danger-200 hover:text-danger-700">
          <AppIcon name="ri-close-line" size={16} />
        </button>
      </div>
    ))}
    <button type="button" disabled={full} onClick={() => onChange([...items, ''])}
      className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 disabled:opacity-50">
      <AppIcon name="ri-add-line" size={14} />Add item
    </button>
    {errors.length > 0 && <p id={`${id}-error`} className="text-xs text-danger-700">{errors.join(' ')}</p>}
  </fieldset>;
}
