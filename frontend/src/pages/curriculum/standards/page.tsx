import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { fetchCurriculumStandards, type CurriculumStandard } from '@/lib/curriculumApi';
import { curriculumNavItems } from '@/mocks/navigation';

const typeStyles = {
  knowledge: { label: 'Knowledge', text: 'text-primary-700', bg: 'bg-primary-50', bar: 'bg-primary-500', ring: 'ring-primary-100' },
  skills: { label: 'Skills', text: 'text-amber-700', bg: 'bg-amber-50', bar: 'bg-amber-500', ring: 'ring-amber-100' },
  behaviours: { label: 'Behaviours', text: 'text-emerald-700', bg: 'bg-emerald-50', bar: 'bg-emerald-500', ring: 'ring-emerald-100' },
};

function statusLabel(status: string) {
  const value = status.toLowerCase();
  if (value.includes('approved')) return 'Approved';
  if (value.includes('retired')) return 'Retired';
  if (value.includes('development')) return 'In development';
  return status || 'Unknown';
}

function statusClass(status: string) {
  const value = status.toLowerCase();
  if (value.includes('approved')) return 'bg-emerald-50 text-emerald-700 border-emerald-200/70';
  if (value.includes('retired')) return 'bg-foreground-100 text-foreground-600 border-foreground-200/70';
  return 'bg-amber-50 text-amber-700 border-amber-200/70';
}

function numberText(value: number) {
  return new Intl.NumberFormat('en-GB').format(value);
}

function shortDate(value: string) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return value;
}

function StandardSkeletons() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_19rem] gap-5">
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-foreground-200/60 bg-background-50 p-5 animate-pulse">
            <div className="flex items-start gap-4">
              <SkeletonBlock className="h-14 w-14 rounded-xl" />
              <div className="flex-1 space-y-3">
                <SkeletonBlock className="h-4 w-56 max-w-full" />
                <SkeletonBlock className="h-3 w-80 max-w-full" />
                <SkeletonBlock className="h-10 w-full rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-5 animate-pulse">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="mt-5 h-24 w-full rounded-lg" />
        <SkeletonBlock className="mt-4 h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function CurriculumStandards() {
  const [standards, setStandards] = useState<CurriculumStandard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('all');
  const [route, setRoute] = useState('all');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchCurriculumStandards(controller.signal)
      .then(result => {
        setStandards(result);
        setError(null);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load Skills England standards');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const levelOptions = useMemo(() => {
    return Array.from(new Set(standards.map(item => item.level).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [standards]);

  const routeOptions = useMemo(() => {
    return Array.from(new Set(standards.map(item => item.route).filter(Boolean))).sort();
  }, [standards]);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(standards.map(item => statusLabel(item.status)).filter(Boolean))).sort();
  }, [standards]);

  const totals = useMemo(() => {
    const active = standards.filter(item => item.status.toLowerCase().includes('approved')).length;
    return standards.reduce(
      (acc, item) => ({
        standards: acc.standards + 1,
        active,
        ksbs: acc.ksbs + item.total,
        knowledge: acc.knowledge + item.knowledge,
        skills: acc.skills + item.skills,
        behaviours: acc.behaviours + item.behaviours,
      }),
      { standards: 0, active: 0, ksbs: 0, knowledge: 0, skills: 0, behaviours: 0 },
    );
  }, [standards]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return standards.filter(item => {
      const matchesSearch = !query || [
        item.name,
        item.code,
        item.route,
        item.larsCode,
        item.sampleKsbs?.map(ksb => `${ksb.code} ${ksb.description}`).join(' '),
      ].some(value => String(value || '').toLowerCase().includes(query));
      const matchesLevel = level === 'all' || item.level === level;
      const matchesRoute = route === 'all' || item.route === route;
      const matchesStatus = status === 'all' || statusLabel(item.status) === status;
      return matchesSearch && matchesLevel && matchesRoute && matchesStatus;
    });
  }, [level, route, search, standards, status]);

  const richestStandard = useMemo(() => {
    return [...standards].sort((a, b) => b.total - a.total)[0];
  }, [standards]);

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Skills England Standards" pageSubtitle={`${numberText(totals.standards)} standards from standard_ksbs`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="min-h-full bg-background-100 p-4 sm:p-5 lg:p-6 space-y-4">
        <section
          className="relative overflow-hidden rounded-2xl border border-primary-900/20 bg-primary-950 text-white shadow-lg"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.18),transparent_34%),linear-gradient(135deg,rgba(109,40,217,0.35),rgba(15,23,42,0))]" />
          <div className="relative px-5 py-6 sm:px-7 sm:py-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                  <AppIcon className="ri-database-2-line text-2xl" />
                </span>
                <div className="max-w-3xl">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase text-white/75">Source table</span>
                    <span className="text-[11px] font-semibold text-cyan-100">curriculum.standard_ksbs</span>
                  </div>
                  <h2 className="font-heading text-xl font-bold text-white">Government standard library</h2>
                  <p className="mt-1 text-[13px] font-medium leading-relaxed text-white/90">
                    Live KSB definitions grouped by apprenticeship standard, version, funding, route and delivery status.
                  </p>
                </div>
              </div>
              <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
                {[
                  { label: 'Standards', value: totals.standards, color: 'text-white' },
                  { label: 'KSBs', value: totals.ksbs, color: 'text-primary-100' },
                  { label: 'Approved', value: totals.active, color: 'text-primary-100' },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-white px-4 py-3 text-center shadow-sm ring-1 ring-white/70">
                    <p className="text-2xl font-black text-primary-950">{numberText(item.value)}</p>
                    <p className="text-[10px] font-black uppercase text-foreground-500">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200/70 bg-red-50 px-4 py-3 text-[12px] font-bold text-red-800">
            Curriculum API error: {error}. Start the Django backend and refresh.
          </div>
        )}

        <section className="rounded-xl border border-foreground-300/70 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(16rem,1fr)_10rem_13rem_11rem]">
            <label className="relative block">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400" />
              <input
                type="text"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search by standard, code, route, LARS or KSB..."
                className="h-10 w-full rounded-lg border border-foreground-200/70 bg-background-50 pl-9 pr-3 text-[13px] text-foreground-900 outline-none transition-smooth placeholder:text-foreground-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
              />
            </label>
            <select value={level} onChange={event => setLevel(event.target.value)} className="h-10 rounded-lg border border-foreground-200/70 bg-background-50 px-3 text-[12px] font-medium text-foreground-700 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100">
              <option value="all">All levels</option>
              {levelOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={route} onChange={event => setRoute(event.target.value)} className="h-10 rounded-lg border border-foreground-200/70 bg-background-50 px-3 text-[12px] font-medium text-foreground-700 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100">
              <option value="all">All routes</option>
              {routeOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={status} onChange={event => setStatus(event.target.value)} className="h-10 rounded-lg border border-foreground-200/70 bg-background-50 px-3 text-[12px] font-medium text-foreground-700 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100">
              <option value="all">All statuses</option>
              {statusOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </section>

        {loading ? (
          <StandardSkeletons />
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold text-foreground-500">{numberText(filtered.length)} matching standards</p>
                <div className="hidden items-center gap-2 sm:flex">
                  {[
                    { key: 'knowledge', value: totals.knowledge },
                    { key: 'skills', value: totals.skills },
                    { key: 'behaviours', value: totals.behaviours },
                  ].map(item => {
                    const style = typeStyles[item.key as keyof typeof typeStyles];
                    return <span key={item.key} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${style.bg} ${style.text}`}>{style.label}: {numberText(item.value)}</span>;
                  })}
                </div>
              </div>

              {filtered.map(standard => {
                const knowledgeWidth = standard.total ? (standard.knowledge / standard.total) * 100 : 0;
                const skillsWidth = standard.total ? (standard.skills / standard.total) * 100 : 0;
                const behavioursWidth = standard.total ? (standard.behaviours / standard.total) * 100 : 0;

                return (
                  <Link key={standard.id} to={`/curriculum/standards/${standard.id}`} className="group block rounded-xl border border-foreground-300/70 bg-white p-4 shadow-sm transition-smooth hover:border-primary-300 hover:shadow-md">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <div className="flex min-w-0 flex-1 items-start gap-4">
                        <div className="flex h-14 min-w-[4rem] shrink-0 flex-col items-center justify-center rounded-xl bg-primary-50 px-2 text-primary-800 ring-2 ring-primary-100 transition-smooth group-hover:ring-primary-200">
                          <span className="text-[11px] font-black">{standard.code}</span>
                          <span className="text-[9px] font-semibold text-primary-500">v{standard.version}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-bold text-foreground-950 group-hover:text-primary-700">{standard.name}</h3>
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusClass(standard.status)}`}>{statusLabel(standard.status)}</span>
                          </div>
                          <p className="mt-1 text-[11px] font-medium text-foreground-700">
                            {standard.level || 'Level not recorded'} - {standard.route || 'Route not recorded'} - Funding {standard.maxFunding || 'N/A'}
                          </p>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            {[
                              { key: 'knowledge', value: standard.knowledge },
                              { key: 'skills', value: standard.skills },
                              { key: 'behaviours', value: standard.behaviours },
                            ].map(item => {
                              const style = typeStyles[item.key as keyof typeof typeStyles];
                              return (
                                <div key={item.key} className={`rounded-lg px-3 py-2 ${style.bg} ${style.ring} ring-1`}>
                                  <p className={`text-base font-black ${style.text}`}>{numberText(item.value)}</p>
                                  <p className="truncate text-[9px] font-bold text-foreground-700">{style.label}</p>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-background-200">
                            <div className="flex h-full">
                              <span className="bg-primary-500" style={{ width: `${knowledgeWidth}%` }} />
                              <span className="bg-amber-500" style={{ width: `${skillsWidth}%` }} />
                              <span className="bg-emerald-500" style={{ width: `${behavioursWidth}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2 lg:w-72">
                        {(standard.sampleKsbs || []).slice(0, 2).map(ksb => (
                          <div key={`${standard.id}-${ksb.code}`} className="rounded-lg border border-foreground-300/60 bg-background-100 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] font-black text-foreground-900">{ksb.code}</span>
                              <span className="truncate text-[10px] font-black text-foreground-700">{ksb.type}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-5 text-foreground-800">{ksb.description}</p>
                          </div>
                        ))}
                        <div className="flex items-center justify-between pt-1 text-[10px] font-semibold text-foreground-400">
                          <span>{numberText(standard.total)} total KSBs</span>
                          <span className="flex items-center gap-1 text-primary-600 opacity-0 transition-smooth group-hover:opacity-100">Open <AppIcon className="ri-arrow-right-line" /></span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}

              {!filtered.length && (
                <div className="rounded-xl border border-dashed border-foreground-200 bg-background-50 px-5 py-10 text-center">
                  <AppIcon className="ri-search-eye-line text-3xl text-foreground-300" />
                  <p className="mt-2 text-sm font-bold text-foreground-800">No standards found</p>
                  <p className="text-[12px] text-foreground-500">Try a different code, route, status or KSB term.</p>
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <div className="rounded-xl border border-foreground-300/70 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground-900">Source Health</h3>
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]" />
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg bg-background-100 px-3 py-2">
                    <p className="text-[9px] font-bold uppercase text-foreground-400">Rows imported</p>
                    <p className="text-lg font-black text-foreground-950">{numberText(totals.ksbs)}</p>
                  </div>
                  <div className="rounded-lg bg-background-100 px-3 py-2">
                    <p className="text-[9px] font-bold uppercase text-foreground-400">Last sync</p>
                    <p className="text-[12px] font-bold text-foreground-800">{shortDate(standards[0]?.lastSynced || '')}</p>
                  </div>
                  <div className="rounded-lg bg-background-100 px-3 py-2">
                    <p className="text-[9px] font-bold uppercase text-foreground-400">Largest standard</p>
                    <p className="truncate text-[12px] font-bold text-foreground-800">{richestStandard?.name || 'N/A'}</p>
                    <p className="text-[10px] font-semibold text-primary-600">{richestStandard ? `${numberText(richestStandard.total)} KSBs` : ''}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-foreground-300/70 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold text-foreground-900">KSB Mix</h3>
                <div className="mt-4 space-y-3">
                  {[
                    { key: 'knowledge', value: totals.knowledge },
                    { key: 'skills', value: totals.skills },
                    { key: 'behaviours', value: totals.behaviours },
                  ].map(item => {
                    const style = typeStyles[item.key as keyof typeof typeStyles];
                    const width = totals.ksbs ? (item.value / totals.ksbs) * 100 : 0;
                    return (
                      <div key={item.key}>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[11px] font-bold text-foreground-700">{style.label}</span>
                          <span className={`text-[11px] font-black ${style.text}`}>{numberText(item.value)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-background-200">
                          <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
