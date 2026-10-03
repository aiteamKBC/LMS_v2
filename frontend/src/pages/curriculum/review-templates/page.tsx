import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { AppIcon } from '@/components/feature/AppIcon';
import { Modal } from '@/pages/users/components/Modal';
import { FormField, TextControl } from '@/pages/curriculum/shared/entities/ui';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { curriculumNavItems } from '@/mocks/navigation';
import { FAMILY_LABELS, MIGRATED_FAMILIES, createMigratedOverride, getMigratedTemplate, importMigratedTemplate,
  listMigratedTemplates, previewMigratedTemplate, resetMigratedOverride, updateMigratedTemplate,
  type MigratedFamily, type MigratedTemplate, type TemplateDetail, type TemplateLibrary, type TemplatePreview,
} from '@/api/migratedReviewTemplates';
import { PreviewForm, TemplateEditor, buttonClass } from './TemplateEditor';
import { MoreActions, TemplateMetadata, TemplateStatistics, menuItemClass } from './TemplatePresentation';
import { templateKind, updatedLabel } from './templateDisplay';

const subtitle = 'Set the standard review forms and customise them for individual programmes.';
const primaryButton = 'rounded-lg border border-primary-600 bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50';
type SwitchRequest = { template: MigratedTemplate; toStandard: boolean };

export default function ReviewTemplatesPage() {
  const { programmes, error: programmesError } = useCurriculumProgrammes({ visibility: 'all' });
  const [programmeKey, setProgrammeKey] = useState('');
  const [library, setLibrary] = useState<TemplateLibrary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<TemplateDetail | null>(null);
  const [preview, setPreview] = useState<{ template: MigratedTemplate; form: TemplatePreview } | null>(null);
  const [details, setDetails] = useState<MigratedTemplate | null>(null);
  const [savedVersions, setSavedVersions] = useState<{ family: MigratedFamily; scope: 'GLOBAL' | 'PROGRAMME' } | null>(null);
  const [switchRequest, setSwitchRequest] = useState<SwitchRequest | null>(null);
  const [importFamily, setImportFamily] = useState<MigratedFamily | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [importName, setImportName] = useState('');
  const generation = useRef(0);
  const actionRunning = useRef(false);
  const programmeName = programmes.find(p => `id:${p.sourceId || p.id}` === programmeKey)?.name || 'Selected programme';
  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await listMigratedTemplates(programmeKey, signal);
      if (!signal?.aborted && requestId === generation.current) setLibrary(result);
    } catch (err) {
      if (!signal?.aborted && requestId === generation.current) { setLibrary(null); setError(err instanceof Error ? err.message : 'Unable to load templates.'); }
    } finally { if (!signal?.aborted && requestId === generation.current) setLoading(false); }
  }, [programmeKey]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const action = async (work: () => Promise<unknown>) => {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update template.'); }
    finally { actionRunning.current = false; setBusy(false); }
  };
  const editable = !!library?.can_manage;
  const disabled = busy || loading;
  const versions = (family: MigratedFamily, scope: 'GLOBAL' | 'PROGRAMME') =>
    library?.templates.filter(t => t.review_family === family && t.scope === scope) || [];
  const selectTemplate = (family: MigratedFamily, scope: 'GLOBAL' | 'PROGRAMME') => {
    const matching = versions(family, scope);
    return matching.find(t => t.is_active) || matching[0];
  };
  const previewTemplate = (template: MigratedTemplate) => void action(async () => {
    const form = await previewMigratedTemplate(template.id);
    setSavedVersions(null); setPreview({ template, form });
  });
  const editTemplate = (template: MigratedTemplate) => void action(async () => {
    const result = await getMigratedTemplate(template.id);
    setSavedVersions(null); setEditor(result);
  });
  const toggleStandard = (template: MigratedTemplate) => void action(async () => {
    await updateMigratedTemplate(template, { is_active: !template.is_active });
    await load();
    setNotice(template.is_active ? 'Standard Template deactivated. Reviews already started keep their saved version.' : 'Standard Template enabled for programmes without a custom version.');
  });
  const openImport = (family: MigratedFamily) => {
    setSourceId(''); setImportName(`${FAMILY_LABELS[family]} Standard Template`); setError(''); setImportFamily(family);
  };
  const requestSwitch = (template: MigratedTemplate, toStandard: boolean) => {
    setSavedVersions(null); setError(''); setSwitchRequest({ template, toStandard });
  };
  const confirmSwitch = () => {
    if (!switchRequest) return;
    const { template, toStandard } = switchRequest;
    void action(async () => {
      if (toStandard) await resetMigratedOverride(template);
      else await updateMigratedTemplate(template, { is_active: true });
      setSwitchRequest(null); await load();
      setNotice(toStandard ? 'This programme now uses the Standard Template. Its custom version is still saved.' : 'This programme now uses its Custom Template.');
    });
  };
  const more = (family: MigratedFamily, scope: 'GLOBAL' | 'PROGRAMME', template?: MigratedTemplate) => {
    const saved = versions(family, scope);
    return <MoreActions label={`More actions for ${scope === 'GLOBAL' ? 'Standard' : 'Custom'} ${FAMILY_LABELS[family]}`} disabled={disabled}>
      {editable && scope === 'GLOBAL' && template && <button className={menuItemClass} disabled={disabled} onClick={() => toggleStandard(template)}>{template.is_active ? 'Deactivate' : 'Enable Standard Template'}</button>}
      {editable && scope === 'GLOBAL' && <button className={menuItemClass} disabled={disabled} onClick={() => openImport(family)}>Import another form</button>}
      {template && <button className={menuItemClass} onClick={() => setDetails(template)}>View source details</button>}
      {saved.length > 1 && <button className={menuItemClass} onClick={() => setSavedVersions({ family, scope })}>Saved versions ({saved.length})</button>}
    </MoreActions>;
  };

  return <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Review Templates" pageSubtitle={subtitle}>
    <main className="min-h-full bg-background-100 p-4 sm:p-5 lg:p-6">
      <div className="mx-auto max-w-[1560px] space-y-8">
        <div className="space-y-4">
          <Link className="inline-flex items-center gap-1 text-sm text-primary-700" to="/curriculum/library"><AppIcon className="ri-arrow-left-line" /> Library</Link>
          <WorkspaceHeroBanner title="Review Templates" description={subtitle} eyebrow="Migrated Aptem Reviews" icon="ri-file-list-3-line" />
        </div>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button className={buttonClass} disabled={disabled} onClick={() => void load()}>Reload</button></div>}
        {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {loading && <p role="status">Loading templates…</p>}
        {library && <>
          {!editable && <p className="text-sm text-foreground-500">Read-only access. Template changes require Curriculum or administrator access.</p>}
          <section aria-labelledby="standard-templates-heading" className="space-y-4">
            <div><h2 id="standard-templates-heading" className="font-heading text-xl font-bold text-foreground-900">Standard Templates</h2>
              <p className="mt-1 text-sm text-foreground-500">These templates are used by all programmes unless a custom version is enabled.</p></div>
            <div className="grid gap-4 xl:grid-cols-3">
              {MIGRATED_FAMILIES.map(family => {
                const template = selectTemplate(family, 'GLOBAL');
                return <article aria-label={`Standard ${FAMILY_LABELS[family]}`} key={family} className="flex min-w-0 flex-col rounded-2xl border border-background-200 bg-background-50 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3"><span className="rounded-xl bg-primary-50 p-2 text-primary-600"><AppIcon className="ri-file-list-3-line text-lg" /></span><h3 className="font-heading text-base font-bold">{FAMILY_LABELS[family]}</h3></div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${template?.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-background-100 text-foreground-500'}`}>{template ? template.is_active ? 'Active' : 'Not in use' : 'Not available'}</span>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground-800">Standard Template</p>
                  <p className="mt-1 text-sm text-foreground-500">{template?.is_active ? 'Used by programmes without a custom version.' : template ? 'A standard version is saved but is not currently in use.' : 'No Standard Template Available. Import a form to get started.'}</p>
                  {template && <TemplateStatistics template={template} />}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                    {template ? <><button className={buttonClass} disabled={disabled} onClick={() => previewTemplate(template)}>Preview</button>
                      {editable && <button className={buttonClass} disabled={disabled} onClick={() => editTemplate(template)}>Edit</button>}
                      {more(family, 'GLOBAL', template)}</>
                      : editable && <button className={buttonClass} disabled={disabled} onClick={() => openImport(family)}>Import historical form</button>}
                  </div>
                </article>;
              })}
            </div>
          </section>
          <section aria-labelledby="programme-customisation-heading" className="space-y-5 rounded-2xl border border-background-200 bg-background-50 p-5 sm:p-6">
            <div><h2 id="programme-customisation-heading" className="font-heading text-xl font-bold text-foreground-900">Programme Customisation</h2>
              <p className="mt-1 text-sm text-foreground-500">Choose a programme to use the standard templates or create programme-specific versions.</p></div>
            <div className="max-w-xl"><FormField label="Programme"><select className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-sm" value={programmeKey} disabled={disabled} onChange={event => { setProgrammeKey(event.target.value); setNotice(''); }}>
              <option value="">Choose a programme</option>{programmes.map(programme => <option key={programme.sourceId || programme.id} value={`id:${programme.sourceId || programme.id}`}>{programme.name}</option>)}
            </select></FormField></div>
            {programmesError && <p role="alert" className="text-sm text-red-700">{programmesError}</p>}
            {!programmeKey && <p className="rounded-xl bg-background-100 p-4 text-sm text-foreground-500">Select a programme to see which templates it uses.</p>}
            {programmeKey && !loading && <div className="grid gap-4 xl:grid-cols-3">{MIGRATED_FAMILIES.map(family => {
              const custom = selectTemplate(family, 'PROGRAMME');
              const standard = versions(family, 'GLOBAL').find(t => t.is_active);
              const resolution = library.resolutions.find(r => r.review_family === family);
              const current = library.templates.find(t => t.id === resolution?.resolved_template_id);
              const usingCustom = current?.scope === 'PROGRAMME';
              const savedCustom = custom && !custom.is_active;
              return <article aria-label={`Programme ${FAMILY_LABELS[family]}`} key={family} className="flex min-w-0 flex-col rounded-xl border border-background-200 bg-background-50 p-5">
                <div className="flex items-center justify-between gap-2"><h3 className="font-heading font-bold">{FAMILY_LABELS[family]}</h3>{custom && more(family, 'PROGRAMME', custom)}</div>
                <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Currently using</p>
                <p className={`mt-1 text-base font-semibold ${current ? 'text-foreground-900' : 'text-amber-800'}`}>{current ? usingCustom ? 'Using Custom Template' : 'Using Standard Template' : 'No Standard Template Available'}</p>
                <p className="mt-2 text-sm leading-6 text-foreground-500">{usingCustom ? `This programme has its own ${FAMILY_LABELS[family]} template.`
                  : current ? `This programme currently uses the standard ${FAMILY_LABELS[family]} template.`
                    : savedCustom ? 'Enable the saved custom version or make a standard template available.' : 'This programme does not have a custom template and no standard template is active.'}</p>
                {current && <TemplateStatistics template={current} />}
                {savedCustom && <div className="mt-4 rounded-xl bg-background-100 p-3 text-xs text-foreground-600">
                  <p className="font-semibold">Custom version saved but not in use</p>
                  <p className="mt-1 leading-5">A custom version is saved for this programme but is not currently in use.</p>
                  {current && <p className="mt-3">Current template: <span className="font-medium">Standard {FAMILY_LABELS[family]}</span></p>}
                  <p className="mt-2">Saved custom version: <span className="break-words font-medium">{custom.name}</span></p>
                  <p className="mt-1 text-foreground-500">Updated {updatedLabel(custom)}</p>
                </div>}
                <div className="mt-auto space-y-3 pt-5">
                  <div className="flex flex-wrap gap-2">
                    {current && <button className={buttonClass} disabled={disabled} onClick={() => previewTemplate(current)}>{savedCustom ? 'Preview Standard' : 'Preview'}</button>}
                    {editable && custom && <button className={buttonClass} disabled={disabled} onClick={() => editTemplate(custom)}>{savedCustom ? 'Edit Custom Version' : 'Edit Custom Template'}</button>}
                    {editable && savedCustom && <button className={primaryButton} disabled={disabled} onClick={() => requestSwitch(custom, false)}>Use Custom Version</button>}
                    {editable && !custom && <button className={buttonClass} disabled={disabled || !standard} onClick={() => void action(async () => {
                      const result = await createMigratedOverride(programmeKey, family, `${FAMILY_LABELS[family]} Custom Template`);
                      await load(); setEditor(result);
                    })}>{standard ? 'Customise for this programme' : 'Create Custom Template'}</button>}
                  </div>
                  {editable && usingCustom && custom && <button className="text-xs font-semibold text-primary-700 underline underline-offset-4 disabled:text-foreground-400 disabled:no-underline" disabled={disabled || !standard} onClick={() => requestSwitch(custom, true)}>Use Standard Template</button>}
                  {editable && !standard && (!custom || usingCustom) && <p className="text-xs leading-5 text-foreground-500">{usingCustom ? 'Enable a Standard Template above before switching to it.' : 'Import and enable a Standard Template above before creating a custom version.'}</p>}
                </div>
              </article>;
            })}</div>}
          </section>
        </>}
      </div>
    </main>
    {editor && <TemplateEditor key={editor.id} template={editor} programmeName={programmeName} onClose={() => setEditor(null)} onSaved={() => {
      setEditor(null); setNotice(editor.is_active ? 'Template saved. Reviews already started keep their saved version.' : 'Template saved but not in use. Enable this version explicitly when it is ready.'); void load();
    }} />}
    {preview && <Modal title={`Previewing ${templateKind(preview.template)} ${FAMILY_LABELS[preview.template.review_family]} Template`} size="max-w-5xl" onClose={() => setPreview(null)}>
      {preview.template.scope === 'PROGRAMME' && <p className="mb-4 font-semibold">{programmeName}</p>}<PreviewForm preview={preview.form} />
    </Modal>}
    {details && <Modal title={`${templateKind(details)} ${FAMILY_LABELS[details.review_family]} Template details`} onClose={() => setDetails(null)}><TemplateMetadata template={details} /></Modal>}
    {savedVersions && <Modal title={`Saved ${savedVersions.scope === 'GLOBAL' ? 'Standard' : 'Custom'} ${FAMILY_LABELS[savedVersions.family]} versions`} dismissible={!busy} onClose={() => setSavedVersions(null)}>
      <div className="space-y-4">{versions(savedVersions.family, savedVersions.scope).map(template => {
        const anotherActive = versions(template.review_family, template.scope).some(t => t.is_active && t.id !== template.id);
        return <div key={template.id} className="rounded-xl border border-background-200 p-4">
          <h3 className="font-semibold">{template.name}</h3><p className="mt-1 text-xs text-foreground-500">{template.is_active ? 'Currently in use' : 'Saved but not in use'} · Updated {updatedLabel(template)}</p>
          <div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} disabled={disabled} onClick={() => previewTemplate(template)}>Preview</button>
            {editable && <><button className={buttonClass} disabled={disabled} onClick={() => editTemplate(template)}>Edit</button>
              {!template.is_active && <button className={buttonClass} disabled={disabled || anotherActive} onClick={() => template.scope === 'GLOBAL' ? toggleStandard(template) : requestSwitch(template, false)}>{template.scope === 'GLOBAL' ? 'Enable Standard Template' : 'Use Custom Version'}</button>}</>}
          </div>
          {editable && !template.is_active && anotherActive && <p className="mt-2 text-xs text-foreground-500">{template.scope === 'GLOBAL' ? 'Deactivate the current Standard Template before enabling this version.' : 'Use the Standard Template before switching to another custom version.'}</p>}
        </div>;
      })}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>
    </Modal>}
    {switchRequest && <Modal title={switchRequest.toStandard ? 'Use the Standard Template for this programme?' : 'Use this Custom Template for this programme?'} dismissible={!busy} onClose={() => setSwitchRequest(null)}
      footer={<><button className={buttonClass} disabled={busy} onClick={() => setSwitchRequest(null)}>Cancel</button><button className={primaryButton} disabled={busy} onClick={confirmSwitch}>{busy ? 'Please wait…' : 'Confirm'}</button></>}>
      <p className="mb-3 font-semibold">{programmeName} · {FAMILY_LABELS[switchRequest.template.review_family]}</p>
      <p className="text-sm leading-6 text-foreground-600">{switchRequest.toStandard
        ? 'Future or uninitialised migrated reviews will use the Standard Template. Existing reviews that already started will keep their saved version.'
        : 'Future or uninitialised migrated reviews will use this custom version.'}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Modal>}
    {importFamily && <Modal title={`Import ${FAMILY_LABELS[importFamily]} Standard Template`} dismissible={!busy} onClose={() => setImportFamily(null)} footer={<button className={buttonClass} disabled={busy || !Number.isInteger(Number(sourceId)) || Number(sourceId) <= 0 || !importName.trim()} onClick={() => void action(async () => {
      const result = await importMigratedTemplate(importFamily, Number(sourceId), importName);
      setImportFamily(null); await load(); setEditor(result);
    })}>Import draft</button>}>
      <div className="space-y-4"><p className="text-sm leading-6 text-foreground-500">Importing creates a new saved version from a completed Aptem review. Only its questions and form structure are copied. The current Standard Template stays in use until you explicitly enable another version.</p>
        <p className="text-sm text-foreground-500">The new version is not active. Review and save your changes before enabling it.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <FormField label="Source internal review ID"><TextControl type="number" min={1} value={sourceId} onChange={setSourceId} disabled={busy} /></FormField>
        <FormField label="Template name"><TextControl value={importName} onChange={setImportName} disabled={busy} /></FormField></div>
    </Modal>}
  </WorkspaceShell>;
}
