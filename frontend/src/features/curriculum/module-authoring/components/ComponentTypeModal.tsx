import {
  type ModuleComponentType,
  componentTypes,
  componentTypeGroups,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { isSelfStudyComponent } from '@/pages/curriculum/module-builder/freeCoursePolicy';
import {
  componentToneClasses,
  selectedComponentTypes,
  toggleComponentType,
} from '@/features/curriculum/module-authoring/model/componentSelection';
import { AppIcon } from '@/components/feature/AppIcon';
import { componentTypeDescription } from '@/pages/curriculum/module-builder/componentAuthoringModel';
import { useState } from 'react';


export function ComponentTypeChecklist({ selectedTypes, onToggle, selfStudyOnly = false }: {
  selectedTypes: Set<ModuleComponentType>;
  onToggle: (type: ModuleComponentType) => void;
  selfStudyOnly?: boolean;
}) {
  const availableTypes = componentTypes.filter(item => !selfStudyOnly || isSelfStudyComponent(item.type));
  return (
    <div className="space-y-4">
      {componentTypeGroups.map(group => (
        <section key={group} className="rounded-lg border border-background-200 bg-background-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-500">{group}</p>
            <span className="rounded-md bg-background-100 px-2 py-1 text-[9px] font-bold text-foreground-400">
              {availableTypes.filter(item => item.group === group).length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {availableTypes.filter(item => item.group === group).map(item => {
              const tone = componentToneClasses(item.tone);
              const checked = selectedTypes.has(item.type);
              return (
                <label
                  key={item.type}
                  className={`group grid min-h-[68px] cursor-pointer grid-cols-[18px_38px_minmax(0,1fr)_18px] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-smooth ${checked ? 'border-primary-300 bg-primary-50 text-primary-800 shadow-sm shadow-primary-100/70' : 'border-background-200 bg-background-100/40 text-foreground-700 hover:border-primary-200 hover:bg-primary-50/50'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(item.type)}
                    className="h-4 w-4 rounded border-foreground-300 accent-primary-500"
                  />
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.soft} ${tone.text}`}>
                    <AppIcon className={`${item.icon} text-base`}></AppIcon>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-foreground-900 group-hover:text-primary-800">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium leading-snug text-foreground-500">{componentTypeDescription(item.type)}</span>
                  </span>
                  <AppIcon className={`${checked ? 'ri-checkbox-circle-fill text-primary-500' : 'ri-add-circle-line text-foreground-300 group-hover:text-primary-400'} text-base`}></AppIcon>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}


export function ComponentTypeModal({ onClose, onAdd, title = 'What do you want to add?', description = 'Select one or more component types. You can edit the details after.', submitLabel = 'Add', initialSelectedTypes = [], selfStudyOnly = false }: {
  onClose: () => void;
  onAdd: (types: ModuleComponentType[]) => void | Promise<void>;
  title?: string;
  description?: string;
  submitLabel?: string;
  initialSelectedTypes?: ModuleComponentType[];
  selfStudyOnly?: boolean;
}) {
  const availableTypes = componentTypes.filter(item => !selfStudyOnly || isSelfStudyComponent(item.type));
  const [selectedTypes, setSelectedTypes] = useState<Set<ModuleComponentType>>(() => new Set(initialSelectedTypes));
  const selected = selectedComponentTypes(selectedTypes);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-background-200 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="border-b border-background-200 bg-background-50 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600">
                <AppIcon className="ri-layout-grid-line text-lg"></AppIcon>
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-heading font-bold text-foreground-950">{title}</h3>
                <p className="mt-1 text-[12px] font-medium text-foreground-500">{description}</p>
              </div>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-500 transition-smooth hover:bg-background-100 hover:text-foreground-900" aria-label="Close">
              <AppIcon className="ri-close-line text-lg"></AppIcon>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-primary-100 bg-primary-50 px-2.5 py-1 text-[11px] font-bold text-primary-700">{selected.length} selected</span>
            <span className="rounded-lg border border-background-200 bg-background-100 px-2.5 py-1 text-[11px] font-bold text-foreground-500">{availableTypes.length} available</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-background-100/45 p-4">
          <ComponentTypeChecklist
            selfStudyOnly={selfStudyOnly}
            selectedTypes={selectedTypes}
            onToggle={type => setSelectedTypes(current => toggleComponentType(current, type))}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-background-200 bg-background-50 px-5 py-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelectedTypes(new Set(availableTypes.map(item => item.type)))} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
              Select all
            </button>
            <button type="button" onClick={() => setSelectedTypes(new Set())} disabled={!selected.length} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:opacity-40">
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
              Cancel
            </button>
            <button type="button" onClick={() => onAdd(selected)} disabled={!selected.length} className="inline-flex h-9 min-w-[150px] items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50">
              <AppIcon className="ri-add-line"></AppIcon>
              {submitLabel} {selected.length || ''} component{selected.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
