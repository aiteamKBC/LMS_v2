import { createPortal } from 'react-dom';
import type { ModuleBuilderListItem } from '@/features/curriculum/module-authoring/model/catalogueTypes';
import { type CurriculumKsbSet, type CurriculumStandard, type CurriculumProgramme } from '@/lib/curriculumApi';
import { useState, useMemo, useEffect } from 'react';
import {
  ksbMapSourceOptions,
  cleanKsbSourceId,
  ksbSetForModule,
  ksbSetSourceId,
  standardForModule,
  ksbStandardSourceId,
} from '@/features/curriculum/module-authoring/model/ksbSources';
import {
  moduleKsbMapRows,
  uniquePlacementOtjh,
  formatKsbOtjh,
  formatKsbWeight,
  programmeKsbMapRows,
  type ModuleKsbMapRow,
} from '@/features/curriculum/module-authoring/model/ksbCoverage';
import { AppIcon } from '@/components/feature/AppIcon';
import { ksbVisualTone, ksbCodeChipClass } from '../model/ksbPresentation';


export function ModuleKsbMapModal({ module, sourceLabels, ksbSets, standards, programmes, onClose, onBuild }: {
  module: ModuleBuilderListItem;
  sourceLabels: Record<string, string>;
  ksbSets: CurriculumKsbSet[];
  standards: CurriculumStandard[];
  programmes: CurriculumProgramme[];
  onClose: () => void;
  onBuild: () => void;
}) {
  const [query, setQuery] = useState('');
  const allSourceOptions = useMemo(() => ksbMapSourceOptions(ksbSets, standards), [ksbSets, standards]);
  const defaultSourceId = useMemo(() => {
    const selected = cleanKsbSourceId(module.ksbProfileSourceId);
    if (selected && allSourceOptions.some(option => option.id === selected)) return selected;
    const matchingProfile = ksbSetForModule(ksbSets, module, programmes);
    if (matchingProfile) return ksbSetSourceId(matchingProfile);
    const matchingStandard = standardForModule(standards, module, programmes);
    return matchingStandard ? ksbStandardSourceId(matchingStandard) : allSourceOptions[0]?.id || '';
  }, [allSourceOptions, ksbSets, module, programmes, standards]);
  const sourceOptions = useMemo(() => {
    return allSourceOptions
      .map(option => {
        const appliedCount = moduleKsbMapRows(module, sourceLabels, option, option.id === defaultSourceId).length;
        return {
          ...option,
          appliedCount,
        };
      })
      .filter(option => option.appliedCount > 0 || option.id === defaultSourceId);
  }, [allSourceOptions, defaultSourceId, module, sourceLabels]);
  const [selectedSourceId, setSelectedSourceId] = useState(defaultSourceId);
  useEffect(() => {
    if (!selectedSourceId && defaultSourceId) setSelectedSourceId(defaultSourceId);
    else if (selectedSourceId && sourceOptions.length && !sourceOptions.some(option => option.id === selectedSourceId)) setSelectedSourceId(defaultSourceId);
  }, [defaultSourceId, selectedSourceId, sourceOptions]);
  const selectedSource = sourceOptions.find(option => option.id === selectedSourceId) || allSourceOptions.find(option => option.id === selectedSourceId) || null;
  const rows = moduleKsbMapRows(module, sourceLabels, selectedSource, selectedSource?.id === defaultSourceId);
  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter(row => {
      const matchesSearch = !search || [
        row.code,
        row.description,
        row.source,
        row.applied ? 'mapped applied used' : 'not mapped unused',
        ...row.locations,
      ].some(value => String(value || '').toLowerCase().includes(search));
      return matchesSearch;
    });
  }, [query, rows]);
  const groups = [
    { key: 'K' as const, title: 'Knowledge', icon: 'ri-book-open-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('K')) },
    { key: 'S' as const, title: 'Skills', icon: 'ri-tools-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('S')) },
    { key: 'B' as const, title: 'Behaviours', icon: 'ri-user-heart-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('B')) },
  ];
  const visiblePlacementCount = filteredRows.reduce((total, row) => total + row.placements.length, 0);
  const visibleWeight = filteredRows.reduce((total, row) => total + row.weight, 0);
  const visibleOtjh = uniquePlacementOtjh(filteredRows);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);
  const dialog = (
    <div role="dialog" aria-modal="true" aria-labelledby="module-ksb-map-title" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="border-b border-background-200 bg-primary-950 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">KSB Coverage</p>
              <h3 id="module-ksb-map-title" className="mt-1 truncate text-base font-heading font-bold text-white">{module.title}</h3>
              <p className="mt-1 text-[11px] font-semibold text-white/70">Applied KSBs, placement, weight and OTJH for this module.</p>
            </div>
            <button type="button" aria-label="Close module KSB review" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white transition-smooth hover:bg-white/20">
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>
        </div>
        <div className="border-b border-background-200 bg-background-50 px-5 py-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[300px_minmax(260px,1fr)_auto] xl:items-end">
            <div className="block">
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-foreground-400">KSB source</span>
              <div className="flex min-h-10 w-full items-center rounded-lg border border-background-200 bg-background-100 px-3 py-2">
                {selectedSource ? (
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold text-foreground-950">{selectedSource.title}</p>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-foreground-500">{selectedSource.subtitle}</p>
                  </div>
                ) : (
                  <span className="text-[12px] font-semibold text-foreground-500">No applied KSB sources</span>
                )}
              </div>
            </div>
            <div className="relative">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search code, description, week or component..." className="h-10 w-full rounded-lg border border-background-200 bg-background-100 pl-9 pr-3 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:bg-background-50" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <KsbCoverageMetric label="KSBs" value={String(filteredRows.length)} />
              <KsbCoverageMetric label="Placements" value={String(visiblePlacementCount)} />
              <KsbCoverageMetric label="OTJH" value={formatKsbOtjh(visibleOtjh)} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold text-foreground-500">
            <span className="rounded-md border border-background-200 bg-background-100 px-2 py-1">Mapped weight: {formatKsbWeight(visibleWeight)}</span>
            <span className="rounded-md border border-background-200 bg-background-100 px-2 py-1">Applied KSBs only</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {rows.length ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {groups.map(group => (
                  <ModuleKsbGroupPanel key={group.key} group={group} />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-background-300 bg-background-100 p-8 text-center">
              <AppIcon className="ri-node-tree text-3xl text-foreground-300"></AppIcon>
              <p className="mt-2 text-[13px] font-bold text-foreground-700">No applied KSBs for this source</p>
              <p className="mt-1 text-[12px] text-foreground-500">Choose another source or use Edit mappings to attach KSBs to weeks or components.</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-semibold text-foreground-700 transition-smooth hover:bg-background-100">
            Close
          </button>
          <button type="button" onClick={onBuild} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-[12px] font-bold text-white transition-smooth hover:bg-primary-600">
            <AppIcon className="ri-hammer-line"></AppIcon>
            Edit mappings
          </button>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}


export function ProgrammeKsbMapModal({ programmeName, modules, sourceLabels, onClose }: {
  programmeName: string;
  modules: ModuleBuilderListItem[];
  sourceLabels: Record<string, string>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => programmeKsbMapRows(modules, sourceLabels, programmeName), [modules, programmeName, sourceLabels]);
  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter(row => {
      if (!search) return true;
      return [
        row.code,
        row.description,
        row.source,
        ...row.locations,
      ].some(value => String(value || '').toLowerCase().includes(search));
    });
  }, [query, rows]);
  const groups = [
    { key: 'K' as const, title: 'Knowledge', icon: 'ri-book-open-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('K')) },
    { key: 'S' as const, title: 'Skills', icon: 'ri-tools-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('S')) },
    { key: 'B' as const, title: 'Behaviours', icon: 'ri-user-heart-line', rows: filteredRows.filter(row => row.code.toUpperCase().startsWith('B')) },
  ];

  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="border-b border-background-200 bg-primary-950 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">Programme KSB Coverage</p>
              <h3 className="mt-1 truncate text-base font-heading font-bold text-white">{programmeName}</h3>
              <p className="mt-1 text-[11px] font-semibold text-white/70">Applied KSBs across {modules.length} module{modules.length === 1 ? '' : 's'} in this programme.</p>
            </div>
            <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white transition-smooth hover:bg-white/20">
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>
        </div>
        <div className="border-b border-background-200 bg-background-50 px-5 py-3">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search code, source, module, week or component..." className="h-10 w-full rounded-lg border border-background-200 bg-background-100 pl-9 pr-3 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:bg-background-50" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {rows.length ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {groups.map(group => (
                <ModuleKsbGroupPanel key={group.key} group={group} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-background-300 bg-background-100 p-8 text-center">
              <AppIcon className="ri-node-tree text-3xl text-foreground-300"></AppIcon>
              <p className="mt-2 text-[13px] font-bold text-foreground-700">No detailed KSB mappings in this programme</p>
              <p className="mt-1 text-[12px] text-foreground-500">Add KSB mappings to weeks or components to see programme coverage here.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end border-t border-background-200 bg-background-50 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-background-200 bg-background-50 px-4 py-2 text-[12px] font-semibold text-foreground-700 transition-smooth hover:bg-background-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}


export function ModuleKsbGroupPanel({ group }: {
  group: { key: 'K' | 'S' | 'B'; title: string; icon: string; rows: ModuleKsbMapRow[] };
}) {
  const tone = ksbVisualTone(group.key);
  const placementCount = group.rows.reduce((total, row) => total + row.placements.length, 0);
  const groupOtjh = uniquePlacementOtjh(group.rows);
  return (
    <section className={`flex min-h-0 flex-col rounded-xl border border-l-4 bg-background-100/35 ${tone.row}`}>
      <div className="border-b border-background-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`grid h-9 w-9 place-items-center rounded-lg ${tone.iconClass}`}>
              <AppIcon className={`${group.icon} text-sm`}></AppIcon>
            </span>
            <div>
              <h4 className="text-[12px] font-black uppercase text-foreground-800">{group.title}</h4>
              <p className="mt-0.5 text-[10px] font-semibold text-foreground-400">{placementCount} placement{placementCount === 1 ? '' : 's'} - {formatKsbOtjh(groupOtjh)} OTJH</p>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${tone.badgeClass}`}>{group.rows.length}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {group.rows.map(row => (
          <ModuleKsbMapCard key={row.code} row={row} />
        ))}
        {!group.rows.length && <p className="rounded-xl border border-dashed border-background-300 bg-background-50 px-3 py-8 text-center text-[11px] font-semibold text-foreground-400">None mapped.</p>}
      </div>
    </section>
  );
}


export function ModuleKsbMapCard({ row }: { row: ModuleKsbMapRow }) {
  const kind = row.code.toUpperCase().slice(0, 1);
  const tone = ksbVisualTone(kind);
  const totalOtjh = row.placements.reduce((total, placement) => total + Number(placement.otjh || 0), 0);
  const totalPoints = row.placements.reduce((total, placement) => total + Number(placement.points || 0), 0);
  return (
    <article className={`rounded-xl border bg-background-50 p-3 shadow-sm transition-smooth hover:border-primary-200 hover:shadow-md ${tone.selectedRow}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-lg border px-2.5 py-1 text-[12px] font-black ${ksbCodeChipClass(row.code)}`}>{row.code}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${row.applied ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'}`}>{row.applied ? `${row.placements.length} place${row.placements.length === 1 ? '' : 's'}` : 'Not mapped'}</span>
            {row.classificationLabels.map(label => <span key={label} className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold text-foreground-500">{label}</span>)}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${row.applied ? ksbCodeChipClass(row.code) : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'}`}>{formatKsbWeight(row.weight)}</span>
      </div>
      <p className="mt-2 line-clamp-3 text-[12px] font-medium leading-relaxed text-foreground-700">{row.description || 'No description available.'}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <KsbCoverageMetric label="Weight" value={formatKsbWeight(row.weight)} compact />
        <KsbCoverageMetric label="OTJH" value={formatKsbOtjh(totalOtjh)} compact />
        <KsbCoverageMetric label="Points" value={String(totalPoints)} compact />
      </div>
      <div className="mt-3 space-y-2">
        {row.applied ? <div>
          <p className="mb-1 flex items-center gap-1 text-[8px] font-black uppercase text-foreground-400">
            <AppIcon className="ri-map-pin-line text-[10px]"></AppIcon>
            Applied in
          </p>
          <div className="space-y-1.5">
            {row.placements.map(placement => (
              <div key={`${placement.scope}:${placement.label}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-background-200 bg-background-100 px-2.5 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-black text-foreground-800">{placement.label}</p>
                  <p className="mt-0.5 text-[8px] font-bold uppercase text-foreground-400">{placement.scope}</p>
                </div>
                <span className="rounded-md bg-background-50 px-2 py-1 text-[9px] font-black text-emerald-700">{formatKsbOtjh(placement.otjh)}</span>
                <span className="rounded-md bg-background-50 px-2 py-1 text-[9px] font-black text-foreground-600">{placement.points} pts</span>
              </div>
            ))}
          </div>
        </div> : (
          <div className="rounded-lg border border-dashed border-background-300 bg-background-50 px-2.5 py-2 text-[10px] font-bold text-foreground-400">
            Not applied to any week or component yet.
          </div>
        )}
      </div>
    </article>
  );
}


export function KsbCoverageMetric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-background-200 bg-background-100 ${compact ? 'px-2 py-1.5' : 'min-w-20 px-3 py-2'}`}>
      <p className="text-[8px] font-black uppercase text-foreground-400">{label}</p>
      <p className={`${compact ? 'text-[11px]' : 'text-[13px]'} mt-0.5 font-black text-foreground-900`}>{value}</p>
    </div>
  );
}
