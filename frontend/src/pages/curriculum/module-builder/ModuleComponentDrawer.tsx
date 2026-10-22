import { useId, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { Modal } from '@/pages/users/components/Modal';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { getComponentDefinition } from './componentAuthoringModel';
import type { ModuleCatalogueItem, ModuleComponent, ModuleWeek } from './moduleAuthoringData';
import { formatHoursMinutes } from '@/lib/format';
import styles from './ModuleEditor.module.css';

const tabs = [
  { id: 'content', label: 'Content', icon: 'ri-file-text-line' },
  { id: 'delivery', label: 'Delivery', icon: 'ri-route-line' },
  { id: 'mapping', label: 'KSB Mapping', icon: 'ri-shield-check-line' },
  { id: 'quality', label: 'Quality & History', icon: 'ri-history-line' },
] as const;
type Tab = typeof tabs[number]['id'];

export function ModuleComponentDrawer({ module, week, component, savedComponent, saving, moduleDirty, error, locked, children, mappings, onChange, onDiscard, onSave, onClose }: {
  module: ModuleCatalogueItem; week: ModuleWeek; component: ModuleComponent; savedComponent: ModuleComponent | null;
  saving: boolean; moduleDirty: boolean; error: string | null; locked: boolean;
  children: ReactNode; mappings: ReactNode;
  onChange: (updates: Partial<ModuleComponent>) => void;
  onDiscard: (component: ModuleComponent) => void; onSave: () => Promise<unknown>; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('content');
  // A newly added component has no persisted row yet. Reset its edits to the
  // opening draft; removing the new component remains the structure's action.
  const opening = useRef(component);
  const baseline = savedComponent || opening.current;
  const dirty = JSON.stringify(component) !== JSON.stringify(baseline);
  const definition = getComponentDefinition(component.type);
  const scope = module.groupId || module.cohortId ? 'Scoped module content' : 'Reusable source content';
  const id = useId();
  const busy = useRef(false);
  const [confirming, setConfirming] = useState(false);

  const discard = () => onDiscard(baseline);
  const close = async () => {
    if (saving || busy.current) return;
    if (!dirty) { onClose(); return; }
    busy.current = true;
    setConfirming(true);
    try {
      await showCurriculumConfirm({
        title: 'Discard component changes?',
        text: 'Only this component will be reset. Other pending module changes will stay in the editor.',
        confirmButtonText: 'Discard changes', cancelButtonText: 'Keep editing',
        onConfirm: () => { discard(); onClose(); },
      });
    } finally { busy.current = false; setConfirming(false); }
  };
  const save = async () => {
    if (saving || busy.current || locked) return;
    busy.current = true;
    try { await onSave(); } finally { busy.current = false; }
  };
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setTab(tabs[next].id);
    document.getElementById(`${id}-${tabs[next].id}`)?.focus();
  };
  const setting = (key: string, value: string) => onChange({ settings: { ...component.settings, [key]: value } });
  return <Modal className={`${styles.drawer} workspace-module-component-drawer`} scrollResetKey={tab} dismissible={!saving && !confirming} onClose={() => { void close(); }} title={<span className={styles.drawerHeading} data-component-type={component.type}>
    <span className={styles.typeIcon}><AppIcon className={definition.icon} /></span>
    <span className={styles.drawerIdentity}><small>{definition.label} · {definition.group}</small><strong>{component.title || definition.label}</strong><small>{formatHoursMinutes(component.expectedOtjh)} · module content</small></span>
    <span className={styles.status}>{String(component.settings.contentStatus || 'Status not set')}</span>
  </span>} footer={<>
    <div className={styles.footerState} role="status"><AppIcon className={saving ? 'ri-loader-4-line animate-spin' : dirty ? 'ri-edit-line' : 'ri-checkbox-circle-line'} />{saving ? 'Saving module…' : dirty ? 'Unsaved component changes' : savedComponent ? 'No component changes' : 'New component · not saved'}</div>
    <div className={styles.footerActions}><button type="button" onClick={() => { void close(); }} disabled={saving}>Cancel</button><button type="button" disabled={!dirty || saving || locked} onClick={discard}><AppIcon className="ri-arrow-go-back-line" />Discard changes</button><button type="button" className={styles.primary} disabled={saving || locked || !moduleDirty} onClick={() => { void save(); }}><AppIcon className="ri-save-line" />{saving ? 'Saving…' : 'Save component'}</button></div>
  </>}>
    <div className={styles.drawerContext} data-component-type={component.type}>
      <div className={styles.chips}><span>{scope}</span><span className={styles.typeChip}>{definition.label}</span><span>{formatHoursMinutes(component.expectedOtjh)} · {component.points} pts</span><span>{dirty ? 'Unsaved changes' : 'No changes'}</span></div>
      <p><AppIcon className="ri-folder-line" />{module.programmeName} · {module.title} · {week.title || `Week ${week.weekNumber}`}</p>
      <small>Save component saves all pending changes in this module. {savedComponent ? '' : 'Discard resets this new component to its opening draft.'}</small>
      <small>Discard resets the form to the last module save. Uploads, quiz edits and placed copies use their own actions.</small>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Component settings">{tabs.map((item, index) => <button key={item.id} id={`${id}-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`${id}-panel`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => moveTab(event, index)}><AppIcon className={item.icon} />{item.label}</button>)}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <fieldset disabled={locked || saving} className={styles.drawerFields}>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0} className={styles.drawerContent} data-tab={tab}>
        {component.type === 'quiz' && <section hidden={tab !== 'content'} className={styles.extraFields}><h3>Assessment details</h3><label>Assessment brief<textarea rows={3} value={component.description} onChange={event => onChange({ description: event.target.value })} /></label><p>Questions, assessment criteria and marks are managed in the linked Quiz Workspace.</p></section>}
        {['reading', 'powerpoint'].includes(component.type) && <section hidden={tab !== 'content'} className={styles.extraFields}><h3>Content link</h3><label>{component.type === 'reading' ? 'Reading resource URL' : 'Presentation URL'}<input type="url" value={String(component.settings[component.type === 'reading' ? 'resourceUrl' : 'presentationUrl'] || '')} onChange={event => setting(component.type === 'reading' ? 'resourceUrl' : 'presentationUrl', event.target.value)} /></label>{component.type === 'reading' && <label>Learning outcomes<textarea rows={3} value={String(component.settings.mainLearningOutcomes || '')} onChange={event => setting('mainLearningOutcomes', event.target.value)} /></label>}</section>}
        <div className={styles.sharedEditor}>{children}</div>
        <div hidden={tab !== 'mapping'} className={styles.mapping}>{mappings}</div>
        <section hidden={tab !== 'quality'} className={styles.extraFields}><h3>Record identity & history</h3><dl><dt>Component</dt><dd>{component.id}</dd><dt>Source</dt><dd>{component.sourceId || 'No source reference'}</dd>{component.copiedFromId && <><dt>Copied from</dt><dd>{component.copiedFromId}</dd></>}<dt>Week</dt><dd>{week.id}</dd></dl><p>Version and configured requirements belong to this component. Learner attempts and marks are not edited here. Component revision history is not provided by this editor.</p></section>
      </div>
    </fieldset>
  </Modal>;
}
