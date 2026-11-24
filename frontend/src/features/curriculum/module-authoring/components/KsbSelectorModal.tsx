import { type CurriculumStandard, type CurriculumKsbSet } from '@/lib/curriculumApi';
import {
  type KsbOption,
  type KsbWeightClass,
  flattenKsbEntries,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { useState, useMemo, useEffect } from 'react';
import {
  ksbStandardSourceId,
  standardToKsbOptions,
  ksbSetSourceId,
  ksbSourceIdsMatch,
  ksbSourceIdAliases,
} from '@/features/curriculum/module-authoring/model/ksbSources';
import { ksbVisualTone } from '../model/ksbPresentation';
import {
  defaultKsbWeight,
  clampKsbWeight,
  DEFAULT_KSB_WEIGHT_CLASS,
  normaliseKsbWeightClass,
  clampPositiveKsbWeight,
} from '@/features/curriculum/module-authoring/model/ksbWeights';
import Swal from 'sweetalert2';
import { AppIcon } from '@/components/feature/AppIcon';
import { SelectMenu } from '@/components/feature/SelectField';
import { WEIGHT_CLASS_OPTIONS } from '@/features/curriculum/module-authoring/components/ksbOptions';
import { EmptyState } from '@/features/curriculum/module-authoring/components/EditorPrimitives';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';


export function KsbSelectorModal({ standards, standardsLoading, ksbSets, ksbSetsLoading, initialSourceId, lockedSourceId, onClose, onAddMany }: {
  standards: CurriculumStandard[];
  standardsLoading: boolean;
  ksbSets: CurriculumKsbSet[];
  ksbSetsLoading: boolean;
  initialSourceId: string;
  lockedSourceId?: string;
  onClose: () => void;
  onAddMany: (items: Array<{ option: KsbOption; weight: number; weightClass: KsbWeightClass }>) => void;
}) {
  const [weightsByKsbId, setWeightsByKsbId] = useState<Record<string, number>>({});
  const [weightClassesByKsbId, setWeightClassesByKsbId] = useState<Record<string, KsbWeightClass>>({});
  const [selectedKsbIds, setSelectedKsbIds] = useState<Set<string>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = useState(initialSourceId);
  const [sourceMode, setSourceMode] = useState<'standard' | 'profile'>('profile');
  const [addingKsbs, setAddingKsbs] = useState(false);
  const [ksbSearch, setKsbSearch] = useState('');
  const [ksbTypeFilter, setKsbTypeFilter] = useState<'all' | 'knowledge' | 'skill' | 'behaviour'>('all');
  const sourceLocked = Boolean(lockedSourceId);
  const standardSourceOptions = useMemo(() => standards.map(standard => ({
      id: ksbStandardSourceId(standard),
      label: `${standard.code} - ${standard.name} (${standard.total} KSBs)`,
      options: standardToKsbOptions(standard),
    })), [standards]);
  const profileSourceOptions = useMemo(() => ksbSets.map(set => {
    const sourceId = ksbSetSourceId(set);
    const options = flattenKsbEntries(set.ksbs).map(option => ({ ...option, sourceType: 'framework', sourceId }));
    return {
      id: sourceId,
      label: `${set.programmeName || set.standard || 'Profile'}${set.standard ? ` (${set.standard})` : ''} (${options.length} KSBs)`,
      options,
    };
  }), [ksbSets]);
  const sourceOptions = [...profileSourceOptions, ...standardSourceOptions];
  useEffect(() => {
    const preferredSourceId = lockedSourceId;
    if (sourceLocked && preferredSourceId) {
      setSourceMode(preferredSourceId.startsWith('standard:') ? 'standard' : 'profile');
      setSelectedSourceId(preferredSourceId);
    }
  }, [lockedSourceId, sourceLocked]);
  const selectedSource = sourceOptions.find(source => ksbSourceIdsMatch(source.id, selectedSourceId)) || null;
  const resolvedSelectedSource = selectedSource
    || sourceOptions.find(source => ksbSourceIdsMatch(source.id, selectedSourceId))
    || null;
  const selectedSourceValue = resolvedSelectedSource?.id || (sourceLocked ? selectedSourceId : '');
  const sourceLabels = Object.fromEntries([
    [
      '',
      ksbSetsLoading || standardsLoading ? 'Loading KSB sources...' : 'No source selected',
    ],
    ...sourceOptions.flatMap(source => ksbSourceIdAliases(source.id).map(alias => [alias, source.label])),
  ]);
  const sourceKsbOptions = useMemo(() => resolvedSelectedSource?.options || [], [resolvedSelectedSource]);
  const filteredKsbOptions = useMemo(() => {
    const query = ksbSearch.trim().toLowerCase();
    return sourceKsbOptions.filter(option => {
      const tone = ksbVisualTone(option.code, option.type);
      if (ksbTypeFilter !== 'all' && tone.label.toLowerCase() !== ksbTypeFilter) return false;
      if (!query) return true;
      return option.code.toLowerCase().includes(query) || option.description.toLowerCase().includes(query);
    });
  }, [sourceKsbOptions, ksbSearch, ksbTypeFilter]);
  const weightForOption = (option: KsbOption) => weightsByKsbId[option.id] ?? defaultKsbWeight(weightClassForOption(option));
  const updateOptionWeight = (option: KsbOption, value: number) => {
    setWeightsByKsbId(current => ({ ...current, [option.id]: clampKsbWeight(value) }));
  };
  const weightClassForOption = (option: KsbOption) => weightClassesByKsbId[option.id] ?? DEFAULT_KSB_WEIGHT_CLASS;
  const updateOptionWeightClass = (option: KsbOption, value: string) => {
    const nextWeightClass = normaliseKsbWeightClass(value);
    setWeightClassesByKsbId(current => ({ ...current, [option.id]: nextWeightClass }));
    setWeightsByKsbId(current => ({ ...current, [option.id]: defaultKsbWeight(nextWeightClass) }));
  };
  const toggleOption = (option: KsbOption) => {
    setSelectedKsbIds(current => {
      const next = new Set(current);
      if (next.has(option.id)) next.delete(option.id);
      else next.add(option.id);
      return next;
    });
  };
  const selectedItems = sourceKsbOptions
    .filter(option => selectedKsbIds.has(option.id))
    .map(option => {
      const weightClass = weightClassForOption(option);
      return { option, weight: clampPositiveKsbWeight(weightForOption(option), weightClass), weightClass };
    });
  const handleAddSelectedKsbs = () => {
    if (!selectedItems.length || addingKsbs) return;
    const count = selectedItems.length;
    setAddingKsbs(true);
    void Swal.fire({
      title: 'Adding KSBs...',
      text: `Mapping ${count} selected KSB${count === 1 ? '' : 's'}.`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: {
        popup: 'kbc-standard-swal-popup',
        title: 'kbc-standard-swal-title',
        htmlContainer: 'kbc-standard-swal-text',
      },
      didOpen: () => Swal.showLoading(),
    });
    window.setTimeout(() => {
      onAddMany(selectedItems);
      void Swal.fire({
        icon: 'success',
        title: 'KSBs added',
        text: `${count} KSB${count === 1 ? ' has' : 's have'} been mapped successfully.`,
        timer: 1400,
        timerProgressBar: true,
        showConfirmButton: false,
        customClass: {
          popup: 'kbc-standard-swal-popup',
          title: 'kbc-standard-swal-title',
          htmlContainer: 'kbc-standard-swal-text',
        },
      });
    }, 250);
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-background-50 shadow-2xl overflow-hidden" onClick={event => event.stopPropagation()}>
        <div className="px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <h3 className="text-sm font-heading font-bold text-white">Add KSBs</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20"><AppIcon className="ri-close-line"></AppIcon></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-3">
            {!sourceLocked ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-[10px] font-bold uppercase text-amber-700">Choose KSB source first</p>
                <p className="mt-0.5 text-[11px] font-semibold text-amber-800">Select a KSB Source from the module-level dropdown, then click Add KSBs again.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-primary-600">KSB source</p>
                <p className="mt-0.5 truncate text-[12px] font-bold text-primary-950">{sourceLabels[selectedSourceValue] || selectedSourceValue.replace(/^(profile|standard):/, '')}</p>
              </div>
            )}
          </div>
          {resolvedSelectedSource && Boolean(sourceKsbOptions.length) && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-[220px]">
                <AppIcon className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-foreground-400"></AppIcon>
                <input
                  type="text"
                  value={ksbSearch}
                  onChange={event => setKsbSearch(event.target.value)}
                  placeholder="Search KSB code or text"
                  className="h-8 w-full rounded-md border border-foreground-200/60 bg-background-50 pl-7 pr-2 text-[11px] font-semibold text-foreground-900 outline-none focus:border-primary-300"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {(['all', 'knowledge', 'skill', 'behaviour'] as const).map(filterValue => (
                  <button
                    key={filterValue}
                    type="button"
                    onClick={() => setKsbTypeFilter(filterValue)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize transition-smooth ${
                      ksbTypeFilter === filterValue
                        ? 'bg-primary-500 text-white'
                        : 'bg-background-100 text-foreground-500 hover:bg-background-200'
                    }`}
                  >
                    {filterValue}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="max-h-96 overflow-y-auto space-y-2">
            {filteredKsbOptions.map(option => {
              const tone = ksbVisualTone(option.code, option.type);
              const selected = selectedKsbIds.has(option.id);
              return (
              <div key={option.id} className={`rounded-xl border border-l-4 px-3 py-2 transition-smooth ${selected ? tone.selectedRow : tone.row}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleOption(option)}
                      className="mt-1 h-4 w-4 rounded border-foreground-300 text-primary-600 focus:ring-primary-300"
                    />
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tone.iconClass}`}>
                      <AppIcon className={`${tone.icon} text-[13px]`}></AppIcon>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] font-bold text-foreground-900">{option.code}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.badgeClass}`}>{tone.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.weightClass}`}>{clampKsbWeight(weightForOption(option))}%</span>
                      </div>
                      <p className="mt-1 text-[11px] text-foreground-600 leading-relaxed">{option.description}</p>
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-2 sm:w-56">
                    <div className="block">
                      <span className="text-[9px] font-semibold uppercase text-foreground-400">Weight class</span>
                      <div className="mt-1">
                        <SelectMenu
                          ariaLabel="Weight class"
                          value={weightClassForOption(option)}
                          onChange={value => updateOptionWeightClass(option, value)}
                          options={WEIGHT_CLASS_OPTIONS}
                          size="sm"
                        />
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-[9px] font-semibold uppercase text-foreground-400">Weight</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={clampPositiveKsbWeight(weightForOption(option), weightClassForOption(option))}
                        onChange={event => updateOptionWeight(option, Number(event.target.value))}
                        className="mt-1 h-8 w-full rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[12px] font-bold text-foreground-900 outline-none focus:border-primary-300"
                      />
                    </label>
                  </div>
                </div>
              </div>
              );
            })}
            {!sourceLocked && !resolvedSelectedSource && <EmptyState text="Choose a KSB Source from the module-level dropdown first." />}
            {sourceLocked && !resolvedSelectedSource && (ksbSetsLoading || standardsLoading
              ? <LoadingSkeleton label="Loading the selected KSB Source" variant="rows" />
              : <EmptyState text="The selected KSB Source is no longer available." />)}
            {resolvedSelectedSource && !sourceKsbOptions.length && <EmptyState text="No KSBs are available for this selection." />}
            {resolvedSelectedSource && Boolean(sourceKsbOptions.length) && !filteredKsbOptions.length && <EmptyState text="No KSBs match your search or filter." />}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-background-200 pt-3">
            <p className="text-[11px] font-semibold text-foreground-500">{selectedItems.length} KSB{selectedItems.length === 1 ? '' : 's'} selected</p>
            <button
              type="button"
              disabled={!selectedItems.length || addingKsbs}
              onClick={handleAddSelectedKsbs}
              className="h-9 rounded-lg bg-primary-500 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-foreground-200 disabled:text-foreground-400"
            >
              {addingKsbs ? 'Adding...' : 'Add KSBs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
