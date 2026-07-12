import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { SkeletonBlock } from '@/components/feature/CurriculumSkeletons';
import { fetchCurriculumStandardDetail, type CurriculumStandard, type CurriculumStandardKsb } from '@/lib/curriculumApi';
import { curriculumNavItems } from '@/mocks/navigation';

type KsbTab = 'All' | 'Knowledge' | 'Skill' | 'Behaviour';

const typeMeta: Record<Exclude<KsbTab, 'All'>, { label: string; icon: string; text: string; bg: string; border: string; bar: string }> = {
  Knowledge: { label: 'Knowledge', icon: 'ri-lightbulb-line', text: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200/70', bar: 'bg-primary-500' },
  Skill: { label: 'Skills', icon: 'ri-tools-line', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200/70', bar: 'bg-amber-500' },
  Behaviour: { label: 'Behaviours', icon: 'ri-heart-line', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200/70', bar: 'bg-emerald-500' },
};

function statusLabel(status: string) {
  const value = status.toLowerCase();
  if (value.includes('approved')) return 'Approved for delivery';
  if (value.includes('retired')) return 'Retired';
  return status || 'Unknown';
}

function statusClass(status: string) {
  const value = status.toLowerCase();
  if (value.includes('approved')) return 'bg-emerald-200 text-emerald-950 border-emerald-100';
  if (value.includes('retired')) return 'bg-white text-foreground-800 border-white';
  return 'bg-amber-200 text-amber-950 border-amber-100';
}

function shortDate(value: string) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return value;
}

function countByType(ksbs: CurriculumStandardKsb[], type: KsbTab) {
  if (type === 'All') return ksbs.length;
  return ksbs.filter(ksb => ksb.type === type).length;
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-6 animate-pulse">
        <SkeletonBlock className="h-12 w-12 rounded-xl" />
        <SkeletonBlock className="mt-5 h-5 w-72 max-w-full" />
        <SkeletonBlock className="mt-3 h-3 w-full max-w-2xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-foreground-200/60 bg-background-50 p-4 animate-pulse">
              <SkeletonBlock className="h-4 w-36" />
              <SkeletonBlock className="mt-3 h-3 w-full" />
              <SkeletonBlock className="mt-2 h-3 w-5/6" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-5 animate-pulse">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="mt-5 h-28 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default function IfateStandardPage() {
  const { id = '' } = useParams();
  const [standard, setStandard] = useState<CurriculumStandard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<KsbTab>('All');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchCurriculumStandardDetail(id, controller.signal)
      .then(result => {
        setStandard(result);
        setError(null);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load Skills England standard');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [id]);

  const ksbs = useMemo(() => standard?.ksbs || [], [standard]);
  const filteredKsbs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ksbs.filter(ksb => {
      const matchesTab = activeTab === 'All' || ksb.type === activeTab;
      const matchesSearch = !query || `${ksb.code} ${ksb.type} ${ksb.description}`.toLowerCase().includes(query);
      return matchesTab && matchesSearch;
    });
  }, [activeTab, ksbs, search]);

  const totals = useMemo(() => ({
    Knowledge: countByType(ksbs, 'Knowledge'),
    Skill: countByType(ksbs, 'Skill'),
    Behaviour: countByType(ksbs, 'Behaviour'),
  }), [ksbs]);

  const tabs: KsbTab[] = ['All', 'Knowledge', 'Skill', 'Behaviour'];

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={standard ? `${standard.code} - ${standard.name}` : 'Skills England Standard'}
      pageSubtitle={standard ? `${standard.level || 'Level not recorded'} - Version ${standard.version || 'N/A'}` : 'KSB source view'}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2 text-[11px] font-medium text-foreground-400">
          <Link to="/curriculum/standards" className="transition-smooth hover:text-primary-600">Standards</Link>
          <i className="ri-arrow-right-s-line text-[12px]" />
          <span className="text-foreground-700">{standard?.code || id}</span>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200/70 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend and refresh.
          </div>
        )}

        {loading || !standard ? (
          <DetailSkeleton />
        ) : (
          <>
            <section
              className="overflow-hidden rounded-2xl border border-primary-900/20 text-white shadow-lg"
              style={{ background: 'linear-gradient(135deg, #140726 0%, #35105c 52%, #073a42 100%)' }}
            >
              <div className="px-5 py-6 sm:px-7">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <span className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-white text-primary-950 shadow-sm ring-1 ring-white/70">
                      <span className="text-sm font-black">{standard.code}</span>
                      <span className="text-[10px] font-bold text-primary-700">v{standard.version}</span>
                    </span>
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClass(standard.status)}`}>{statusLabel(standard.status)}</span>
                        <span className="rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[10px] font-bold text-white">LARS {standard.larsCode || 'N/A'}</span>
                      </div>
                      <h2 className="font-heading text-xl font-black text-white" style={{ color: '#ffffff' }}>{standard.name}</h2>
                      <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-white" style={{ color: '#ffffff' }}>
                        {standard.route || 'Route not recorded'} - {standard.degree || 'Qualification type not recorded'} - {standard.duration || 'Duration not recorded'}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {[
                          { icon: 'ri-stack-line', label: standard.level || 'Level N/A' },
                          { icon: 'ri-route-line', label: standard.route || 'Route N/A' },
                          { icon: 'ri-price-tag-3-line', label: `Funding ${standard.maxFunding || 'N/A'}` },
                          { icon: 'ri-time-line', label: `${standard.minimumHours || 'N/A'} min hours` },
                          { icon: 'ri-history-line', label: `Synced ${shortDate(standard.lastSynced)}` },
                        ].map(item => (
                          <span key={item.label} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-white/30 bg-white px-3 text-[11px] font-black text-primary-950 shadow-sm">
                            <i className={`${item.icon} text-[13px] text-primary-700`} />
                            <span className="truncate">{item.label}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'KSBs', value: standard.total, color: 'text-white' },
                      { label: 'Hours', value: standard.minimumHours || 'N/A', color: 'text-cyan-200' },
                      { label: 'Funding', value: standard.maxFunding || 'N/A', color: 'text-emerald-200' },
                    ].map(item => (
                      <div key={item.label} className="rounded-xl bg-white px-4 py-3 text-center shadow-sm ring-1 ring-white/70">
                        <p className="text-lg font-black text-primary-950">{item.value}</p>
                        <p className="text-[10px] font-black uppercase text-foreground-500">{item.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(['Knowledge', 'Skill', 'Behaviour'] as const).map(type => {
                const meta = typeMeta[type];
                const value = totals[type];
                const width = standard.total ? (value / standard.total) * 100 : 0;
                return (
                  <div key={type} className={`rounded-xl border ${meta.border} ${meta.bg} p-4 shadow-sm`}>
                    <div className="flex items-center justify-between">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/70 ${meta.text}`}>
                        <i className={`${meta.icon} text-lg`} />
                      </span>
                      <p className={`text-2xl font-black ${meta.text}`}>{value}</p>
                    </div>
                    <p className="mt-3 text-[12px] font-black text-foreground-900">{meta.label}</p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70">
                      <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="space-y-4">
                <div className="rounded-xl border border-foreground-300/70 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <label className="relative block flex-1">
                      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Search KSB code or description..."
                        className="h-10 w-full rounded-lg border border-foreground-200/70 bg-background-50 pl-9 pr-3 text-[13px] text-foreground-900 outline-none transition-smooth placeholder:text-foreground-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                      />
                    </label>
                    <div className="flex gap-1 overflow-x-auto rounded-lg bg-background-100 p-1">
                      {tabs.map(tab => (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab)}
                          className={`shrink-0 rounded-md px-3 py-2 text-[11px] font-bold transition-smooth ${activeTab === tab ? 'bg-white text-foreground-950 shadow-sm' : 'text-foreground-700 hover:text-foreground-950'}`}
                        >
                          {tab === 'Skill' ? 'Skills' : tab === 'All' ? 'All' : tab}
                          <span className="ml-1 text-[10px] font-black text-foreground-500">{countByType(ksbs, tab)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { icon: 'ri-shield-check-line', label: 'Government source', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
                      { icon: 'ri-sort-asc', label: 'Natural KSB order', tone: 'bg-primary-50 text-primary-800 border-primary-200' },
                      { icon: 'ri-focus-3-line', label: `${filteredKsbs.length} visible`, tone: 'bg-amber-50 text-amber-800 border-amber-200' },
                    ].map(item => (
                      <span key={item.label} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${item.tone}`}>
                        <i className={`${item.icon} text-[12px]`} />
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  {filteredKsbs.map(ksb => {
                    const meta = typeMeta[ksb.type];
                    const isExpanded = expanded === `${ksb.type}-${ksb.code}`;
                    return (
                      <article key={`${ksb.type}-${ksb.code}-${ksb.id}`} className="overflow-hidden rounded-xl border border-foreground-300/70 bg-white shadow-sm">
                        <button
                          onClick={() => setExpanded(isExpanded ? null : `${ksb.type}-${ksb.code}`)}
                          className="flex w-full items-start gap-3 p-4 text-left transition-smooth hover:bg-background-100/70"
                        >
                          <span className={`flex h-11 min-w-[3.5rem] shrink-0 items-center justify-center rounded-lg border px-2 ${meta.border} ${meta.bg} ${meta.text}`}>
                            <span className="font-mono text-[12px] font-black">{ksb.code}</span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-[10px] font-black uppercase ${meta.text}`}>{meta.label}</span>
                              <span className="text-[10px] font-bold text-foreground-600">{standard.code} v{standard.version}</span>
                              <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-black uppercase text-foreground-600">Skills England</span>
                            </div>
                            <p className={`mt-1 text-[13px] font-medium leading-6 text-foreground-900 ${isExpanded ? '' : 'line-clamp-2'}`}>{ksb.description}</p>
                          </div>
                          <i className={`ri-arrow-down-s-line mt-1 text-foreground-400 transition-smooth ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>

              <aside className="space-y-4">
                <div className="rounded-xl border border-foreground-300/70 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-foreground-900">Standard Record</h3>
                  <div className="mt-4 space-y-3">
                    {[
                      { label: 'Reference', value: standard.standardRef },
                      { label: 'Version', value: standard.version },
                      { label: 'Updated by source', value: standard.dateUpdated || 'Not recorded' },
                      { label: 'Synced into LMS', value: shortDate(standard.lastSynced) },
                      { label: 'EQA provider', value: standard.eqaProvider || 'Not recorded' },
                      { label: 'Approved for delivery', value: standard.approvedForDelivery || 'Not recorded' },
                    ].map(item => (
                      <div key={item.label} className="rounded-lg bg-background-100 px-3 py-2">
                        <p className="text-[9px] font-black uppercase text-foreground-500">{item.label}</p>
                        <p className="mt-0.5 text-[12px] font-bold text-foreground-800">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-foreground-300/70 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-foreground-900">Source Link</h3>
                  <p className="mt-2 break-words text-[11px] font-medium leading-5 text-foreground-700">{standard.sourceUrl || 'No source URL stored'}</p>
                  {standard.sourceUrl && (
                    <a href={standard.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700">
                      <i className="ri-external-link-line text-sm" />
                      Open source
                    </a>
                  )}
                </div>
              </aside>
            </section>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
