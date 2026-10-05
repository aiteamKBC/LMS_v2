import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  fetchCurriculumKsbAchievement,
  fetchCurriculumKsbAchievementConsumptions,
  type CurriculumKsbAchievementFilters,
  type CurriculumKsbAchievementItem,
  type CurriculumKsbAchievementResponse,
  type CurriculumKsbConsumption,
} from '@/lib/curriculumApi';

const FILTER_KEYS = ['cohort_id', 'group_id', 'module_id', 'learner_id', 'component_id', 'ksb_type', 'search', 'date_from', 'date_to'] as const;

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function filterParams(search: URLSearchParams): CurriculumKsbAchievementFilters {
  return {
    cohortId: search.get('cohort_id') || undefined,
    groupId: search.get('group_id') || undefined,
    moduleId: search.get('module_id') || undefined,
    learnerId: search.get('learner_id') || undefined,
    componentId: search.get('component_id') || undefined,
    ksbType: search.get('ksb_type') || undefined,
    search: search.get('search') || undefined,
    dateFrom: search.get('date_from') || undefined,
    dateTo: search.get('date_to') || undefined,
    page: Number(search.get('log_page') || 1),
    pageSize: 50,
    ksbPage: Number(search.get('ksb_page') || 1),
    ksbPageSize: 25,
  };
}

function Pager({ page, pageSize, total, hasNext, onPage }: { page: number; pageSize: number; total: number; hasNext: boolean; onPage: (page: number) => void }) {
  const first = total ? ((page - 1) * pageSize) + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <div className="flex items-center justify-between border-t border-background-200 px-3 py-2 text-[11px] text-foreground-500"><span>{first}–{last} of {total}</span><div className="flex gap-1"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg border border-background-200 px-2.5 py-1.5 font-semibold disabled:opacity-40">Previous</button><button type="button" disabled={!hasNext} onClick={() => onPage(page + 1)} className="rounded-lg border border-background-200 px-2.5 py-1.5 font-semibold disabled:opacity-40">Next</button></div></div>;
}

function ConsumptionTable({ rows }: { rows: CurriculumKsbConsumption[] }) {
  return <div className="overflow-x-auto rounded-xl border border-background-200"><table className="min-w-[980px] w-full text-left text-[12px]"><thead className="bg-background-100 text-[10px] uppercase tracking-wider text-foreground-400"><tr>{['Learner', 'KSB', 'Cohort', 'Group', 'Module', 'Week', 'Component', 'Type', 'Consumed at'].map(label => <th key={label} className="px-3 py-2 font-bold">{label}</th>)}</tr></thead><tbody className="divide-y divide-background-200/70">{rows.map(row => <tr key={row.effectiveConsumptionId} className="hover:bg-primary-50/30"><td className="px-3 py-2 font-semibold">{row.learner.name}</td><td className="px-3 py-2"><span className="font-bold">{row.ksb.code}</span><span className="ml-1 text-foreground-400">{row.ksb.type}</span></td><td className="px-3 py-2">{row.cohort.name || '—'}</td><td className="px-3 py-2">{row.group.name || '—'}</td><td className="px-3 py-2">{row.module.title || '—'}</td><td className="px-3 py-2">{row.week.title || '—'}</td><td className="px-3 py-2">{row.component.title || '—'}</td><td className="px-3 py-2">{row.component.type || '—'}</td><td className="px-3 py-2 whitespace-nowrap">{formatDate(row.consumedAt)}</td></tr>)}</tbody></table></div>;
}

export function KsbAchievementTab({ programmeId }: { programmeId: string }) {
  const [url, setUrl] = useSearchParams();
  const [view, setView] = useState<'ksb' | 'log'>('ksb');
  const [data, setData] = useState<CurriculumKsbAchievementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CurriculumKsbAchievementItem | null>(null);
  const [detail, setDetail] = useState<CurriculumKsbConsumption[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const params = useMemo(() => filterParams(url), [url]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetchCurriculumKsbAchievement(programmeId, params, controller.signal).then(setData).catch(err => { if (err?.name !== 'AbortError') setError(err?.message || 'Could not load KSB achievement.'); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [programmeId, params]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetailLoading(true);
    fetchCurriculumKsbAchievementConsumptions(programmeId, selected.ksbDefinitionId, params, controller.signal).then(result => setDetail(result.items)).catch(() => setDetail([])).finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [programmeId, selected, params]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(url);
    if (value) next.set(key, value); else next.delete(key);
    setUrl(next, { replace: true });
  };
  const clearFilters = () => setUrl(new URLSearchParams(), { replace: true });
  const setPage = (key: 'log_page' | 'ksb_page', page: number) => {
    const next = new URLSearchParams(url);
    if (page <= 1) next.delete(key); else next.set(key, String(page));
    setUrl(next, { replace: true });
  };
  const activeFilters = FILTER_KEYS.filter(key => url.get(key));
  const source = data?.appliedSource;

  if (loading && !data) return <div className="rounded-2xl border border-background-200 bg-background-100 p-8 text-center text-sm text-foreground-500">Loading actual KSB consumption…</div>;
  if (error) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">{error}</div>;
  if (!source?.id) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8"><p className="font-heading text-lg font-bold text-amber-900">No KSB source is applied to this programme.</p><p className="mt-1 text-sm text-amber-800">KSB achievement cannot be calculated until an Applied KSB Source is configured.</p></div>;

  return <div className="space-y-4">
    <div className="rounded-2xl border border-background-200 bg-background-100 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">KSB Achievement</p><h2 className="mt-1 font-heading text-xl font-bold text-foreground-950">Actual KSB consumption across this programme</h2><p className="mt-1 text-sm text-foreground-500">Applied source: <span className="font-semibold text-foreground-800">{source.label || source.id}</span> · {source.definitionCount} KSB definitions</p></div><div className="flex rounded-xl border border-background-200 bg-background-50 p-1"><button type="button" onClick={() => setView('ksb')} className={`rounded-lg px-3 py-2 text-xs font-bold ${view === 'ksb' ? 'bg-foreground-900 text-white' : 'text-foreground-500'}`}>By KSB</button><button type="button" onClick={() => setView('log')} className={`rounded-lg px-3 py-2 text-xs font-bold ${view === 'log' ? 'bg-foreground-900 text-white' : 'text-foreground-500'}`}>Consumption Log</button></div></div>
      <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">{[['Applied KSBs', data.summary.appliedKsbCount], ['Consumed KSBs', data.summary.consumedKsbCount], ['Learners', data.summary.learnerCount], ['Effective consumptions', data.summary.consumptionCount]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-background-200 bg-background-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">{label}</p><p className="mt-1 text-lg font-heading font-bold text-foreground-950">{value}</p></div>)}</div>
    </div>
    <div className="rounded-2xl border border-background-200 bg-background-100 p-4"><div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5"><input value={url.get('search') || ''} onChange={e => setFilter('search', e.target.value)} placeholder="Search KSB code or description" className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-xs" /><select value={url.get('ksb_type') || ''} onChange={e => setFilter('ksb_type', e.target.value)} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-xs"><option value="">All KSB types</option><option value="knowledge">Knowledge</option><option value="skill">Skill</option><option value="behaviour">Behaviour</option></select><input value={url.get('cohort_id') || ''} onChange={e => setFilter('cohort_id', e.target.value)} placeholder="Cohort ID" className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-xs" /><input value={url.get('group_id') || ''} onChange={e => setFilter('group_id', e.target.value)} placeholder="Group ID" className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-xs" /><input value={url.get('module_id') || ''} onChange={e => setFilter('module_id', e.target.value)} placeholder="Module ID" className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-xs" /><input value={url.get('learner_id') || ''} onChange={e => setFilter('learner_id', e.target.value)} placeholder="Learner ID" className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-xs" /><input type="date" value={url.get('date_from') || ''} onChange={e => setFilter('date_from', e.target.value)} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-xs" /><input type="date" value={url.get('date_to') || ''} onChange={e => setFilter('date_to', e.target.value)} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-xs" /><button type="button" onClick={clearFilters} disabled={!activeFilters.length} className="h-9 rounded-lg border border-background-200 px-3 text-xs font-bold text-foreground-600 disabled:opacity-40">Clear all</button></div>{activeFilters.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{activeFilters.map(key => <button key={key} type="button" onClick={() => setFilter(key, '')} className="rounded-full bg-primary-50 px-2.5 py-1 text-[11px] font-semibold text-primary-700">{key.replaceAll('_', ' ')}: {url.get(key)} ×</button>)}</div>}</div>
    {view === 'ksb' ? <div className="overflow-x-auto rounded-2xl border border-background-200 bg-background-100"><table className="min-w-[900px] w-full text-left text-[12px]"><thead className="bg-background-100 text-[10px] uppercase tracking-wider text-foreground-400"><tr>{['KSB', 'Type', 'Description', 'Learners consumed', 'Consumptions', 'Components', 'First consumed', 'Last consumed'].map(label => <th key={label} className="px-3 py-2 font-bold">{label}</th>)}</tr></thead><tbody className="divide-y divide-background-200/70">{data.items.map(item => <tr key={item.ksbDefinitionId} onClick={() => setSelected(item)} className="cursor-pointer hover:bg-primary-50/40"><td className="px-3 py-3 font-bold text-primary-700">{item.code}</td><td className="px-3 py-3 capitalize">{item.type}</td><td className="max-w-[300px] px-3 py-3 text-foreground-600">{item.description}</td><td className="px-3 py-3">{item.learnerCount}</td><td className="px-3 py-3">{item.consumptionCount}</td><td className="px-3 py-3">{item.componentCount}</td><td className="px-3 py-3 whitespace-nowrap">{formatDate(item.firstConsumedAt)}</td><td className="px-3 py-3 whitespace-nowrap">{formatDate(item.lastConsumedAt)}</td></tr>)}</tbody></table>{!data.items.some(item => item.consumptionCount) && <p className="p-8 text-center text-sm text-foreground-500">{activeFilters.length ? 'No KSB consumption matches the current filters.' : 'No KSB consumption has been recorded for this programme.'}</p>}<Pager page={data.ksbPagination.page} pageSize={data.ksbPagination.pageSize} total={data.ksbPagination.total} hasNext={data.ksbPagination.hasNext} onPage={page => setPage('ksb_page', page)} /></div> : <div><ConsumptionTable rows={data.consumptionLog.items} /><div className="rounded-b-xl border border-t-0 border-background-200 bg-background-100"><Pager page={data.consumptionLog.page} pageSize={data.consumptionLog.pageSize} total={data.consumptionLog.total} hasNext={data.consumptionLog.hasNext} onPage={page => setPage('log_page', page)} /></div></div>}
    {selected && <div className="fixed inset-0 z-50 flex justify-end bg-foreground-950/30" onClick={() => setSelected(null)}><aside className="h-full w-full max-w-2xl overflow-y-auto bg-background-50 p-5 shadow-2xl" onClick={e => e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">KSB consumption</p><h3 className="mt-1 font-heading text-xl font-bold">{selected.code} · {selected.description}</h3><p className="mt-1 text-sm text-foreground-500">{selected.learnerCount} learners · {selected.consumptionCount} effective consumptions · {selected.componentCount} components</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close" className="rounded-lg p-2 text-foreground-500 hover:bg-background-200"><AppIcon className="ri-close-line" /></button></div><div className="mt-5">{detailLoading ? <p className="text-sm text-foreground-500">Loading consumption details…</p> : <ConsumptionTable rows={detail} />}</div></aside></div>}
  </div>;
}
