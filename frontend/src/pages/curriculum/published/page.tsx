import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface PublishedCurriculum {
  id: string;
  name: string;
  programme: string;
  level: number;
  version: string;
  publishedDate: string;
  publishedBy: string;
  status: 'live' | 'scheduled' | 'superseded';
  modulesCount: number;
  totalKsbs: number;
  activeCohorts: number;
  totalLearners: number;
  lastDeliveryReview: string;
  qaRating: 'outstanding' | 'good' | 'requires-improvement';
  nextReviewDue: string;
}

const PUBLISHED: PublishedCurriculum[] = [
  { id: 'pub-01', name: 'Marketing Executive Curriculum', programme: 'Marketing Executive L4', level: 4, version: 'v2.1', publishedDate: '6 Jun 2026', publishedBy: 'Emma Walsh', status: 'live', modulesCount: 12, totalKsbs: 34, activeCohorts: 3, totalLearners: 42, lastDeliveryReview: '1 Jun 2026', qaRating: 'good', nextReviewDue: '1 Sep 2026' },
  { id: 'pub-02', name: 'Business Administrator Curriculum', programme: 'Business Administrator L3', level: 3, version: 'v3.0', publishedDate: '4 Jun 2026', publishedBy: 'James Carter', status: 'live', modulesCount: 14, totalKsbs: 37, activeCohorts: 4, totalLearners: 58, lastDeliveryReview: '28 May 2026', qaRating: 'outstanding', nextReviewDue: '28 Aug 2026' },
  { id: 'pub-03', name: 'Data Analyst Curriculum', programme: 'Data Analyst L4', level: 4, version: 'v1.5', publishedDate: '2 Jun 2026', publishedBy: 'Emma Walsh', status: 'live', modulesCount: 10, totalKsbs: 29, activeCohorts: 2, totalLearners: 24, lastDeliveryReview: '25 May 2026', qaRating: 'good', nextReviewDue: '25 Aug 2026' },
  { id: 'pub-04', name: 'Digital Marketer Curriculum', programme: 'Digital Marketer L3', level: 3, version: 'v2.0', publishedDate: '22 May 2026', publishedBy: 'James Carter', status: 'live', modulesCount: 10, totalKsbs: 30, activeCohorts: 2, totalLearners: 31, lastDeliveryReview: '15 May 2026', qaRating: 'good', nextReviewDue: '15 Aug 2026' },
  { id: 'pub-05', name: 'Accountancy Curriculum', programme: 'Accountancy L3', level: 3, version: 'v2.3', publishedDate: '30 May 2026', publishedBy: 'Emma Walsh', status: 'live', modulesCount: 9, totalKsbs: 28, activeCohorts: 2, totalLearners: 26, lastDeliveryReview: '20 May 2026', qaRating: 'good', nextReviewDue: '20 Aug 2026' },
  { id: 'pub-06', name: 'Project Manager Curriculum', programme: 'Project Manager L4', level: 4, version: 'v1.8', publishedDate: '27 May 2026', publishedBy: 'Emma Walsh', status: 'live', modulesCount: 11, totalKsbs: 31, activeCohorts: 2, totalLearners: 28, lastDeliveryReview: '18 May 2026', qaRating: 'good', nextReviewDue: '18 Aug 2026' },
  { id: 'pub-07', name: 'Software Developer Curriculum v2.0', programme: 'Software Developer L4', level: 4, version: 'v2.0-draft', publishedDate: '—', publishedBy: 'James Carter', status: 'scheduled', modulesCount: 12, totalKsbs: 32, activeCohorts: 0, totalLearners: 0, lastDeliveryReview: '—', qaRating: 'requires-improvement', nextReviewDue: '30 Jun 2026' },
  { id: 'pub-08', name: 'HR Consultant Curriculum', programme: 'HR Consultant L5', level: 5, version: 'v1.0-draft', publishedDate: '—', publishedBy: 'Emma Walsh', status: 'scheduled', modulesCount: 13, totalKsbs: 36, activeCohorts: 0, totalLearners: 0, lastDeliveryReview: '—', qaRating: 'requires-improvement', nextReviewDue: '15 Jul 2026' },
  { id: 'pub-09', name: 'Marketing Executive Curriculum v1.5', programme: 'Marketing Executive L4', level: 4, version: 'v1.5', publishedDate: '3 Apr 2026', publishedBy: 'Emma Walsh', status: 'superseded', modulesCount: 11, totalKsbs: 32, activeCohorts: 0, totalLearners: 8, lastDeliveryReview: '15 May 2026', qaRating: 'good', nextReviewDue: '—' },
  { id: 'pub-10', name: 'Business Administrator Curriculum v2.4', programme: 'Business Administrator L3', level: 3, version: 'v2.4', publishedDate: '22 Apr 2026', publishedBy: 'Emma Walsh', status: 'superseded', modulesCount: 13, totalKsbs: 32, activeCohorts: 1, totalLearners: 12, lastDeliveryReview: '20 May 2026', qaRating: 'good', nextReviewDue: '—' },
];

export default function CurriculumPublished() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = PUBLISHED.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.programme.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    return true;
  });

  const live = PUBLISHED.filter(c => c.status === 'live').length;
  const scheduled = PUBLISHED.filter(c => c.status === 'scheduled').length;
  const superseded = PUBLISHED.filter(c => c.status === 'superseded').length;
  const totalActiveLearners = PUBLISHED.filter(c => c.status === 'live').reduce((s, c) => s + c.totalLearners, 0);

  const statusConfig: Record<string, { bg: string; text: string; icon: string; label: string }> = {
    live: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'ri-check-double-line', label: 'Live' },
    scheduled: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'ri-calendar-line', label: 'Scheduled' },
    superseded: { bg: 'bg-foreground-100', text: 'text-foreground-500', icon: 'ri-archive-line', label: 'Superseded' },
  };

  const ratingConfig: Record<string, { bg: string; text: string; label: string }> = {
    outstanding: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Outstanding' },
    good: { bg: 'bg-primary-100', text: 'text-primary-700', label: 'Good' },
    'requires-improvement': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Requires Improvement' },
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Published Curriculum" pageSubtitle="View and manage published curriculum versions available for cohort delivery" userName="Emma Walsh" userRole="Curriculum Lead">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-book-open-line text-white text-2xl"></AppIcon></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Published Curriculum</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{PUBLISHED.length} curricula</strong> · {live} live · {scheduled} scheduled · {totalActiveLearners} learners on live curricula</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-emerald-300">{live}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Live</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-amber-300">{scheduled}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Scheduled</p></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Live Curricula" value={String(live)} sub="Currently in delivery" icon="ri-book-open-line" color="emerald" />
          <StatCard label="Active Learners" value={String(totalActiveLearners)} sub="Across all live programmes" icon="ri-group-line" color="primary" />
          <StatCard label="Scheduled" value={String(scheduled)} sub="Awaiting go-live date" icon="ri-calendar-line" color="amber" />
          <StatCard label="Superseded" value={String(superseded)} sub="Previous versions" icon="ri-archive-line" color="neutral" />
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search curricula..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' }, { key: 'live', label: 'Live' }, { key: 'scheduled', label: 'Scheduled' }, { key: 'superseded', label: 'Superseded' }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(curriculum => {
            const sc = statusConfig[curriculum.status] || statusConfig.superseded;
            const rc = ratingConfig[curriculum.qaRating] || ratingConfig['requires-improvement'];
            return (
              <div key={curriculum.id} className={`bg-background-50 rounded-xl border p-5 card-premium transition-smooth ${curriculum.status === 'live' ? 'border-emerald-200/50 hover:border-emerald-300/50' : curriculum.status === 'scheduled' ? 'border-amber-200/50 hover:border-amber-300/50' : 'border-foreground-200/60 hover:border-primary-200/50'}`}>
                <div className="flex items-start gap-3 mb-3">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${curriculum.status === 'live' ? 'bg-emerald-100 text-emerald-700' : curriculum.status === 'scheduled' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-400'}`}>
                    <span className="text-sm font-bold">{curriculum.level}</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-foreground-900">{curriculum.name}</h3>
                      <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                        <AppIcon className={`${sc.icon} text-[10px]`}></AppIcon>{sc.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-foreground-400">{curriculum.programme} · v{curriculum.version}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-background-100/50 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-foreground-400">Modules</p>
                    <p className="text-base font-bold text-foreground-900">{curriculum.modulesCount}</p>
                  </div>
                  <div className="bg-background-100/50 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-foreground-400">Total KSBs</p>
                    <p className="text-base font-bold text-foreground-900">{curriculum.totalKsbs}</p>
                  </div>
                  {curriculum.status === 'live' && (
                    <>
                      <div className="bg-background-100/50 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-foreground-400">Cohorts</p>
                        <p className="text-base font-bold text-foreground-900">{curriculum.activeCohorts}</p>
                      </div>
                      <div className="bg-background-100/50 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-foreground-400">Learners</p>
                        <p className="text-base font-bold text-foreground-900">{curriculum.totalLearners}</p>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-foreground-400 mb-3">
                  <span className={`px-2 py-0.5 rounded-full font-medium ${rc.bg} ${rc.text}`}>{rc.label}</span>
                  {curriculum.status === 'live' && <span className="inline-flex items-center gap-1"><AppIcon className="ri-calendar-check-line text-[11px]"></AppIcon>Next review: {curriculum.nextReviewDue}</span>}
                  {curriculum.publishedDate !== '—' && <span className="inline-flex items-center gap-1"><AppIcon className="ri-calendar-line text-[11px]"></AppIcon>Published: {curriculum.publishedDate}</span>}
                </div>

                <div className="flex items-center gap-2">
                  <button title="View details" aria-label="View details" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-smooth hover:bg-primary-600 cursor-pointer whitespace-nowrap"><AppIcon className="ri-eye-line text-[13px]"></AppIcon>View Details</button>
                  {curriculum.status === 'live' && <button title="Download curriculum" aria-label="Download curriculum" className="inline-flex items-center justify-center rounded-lg border border-background-200 bg-background-50 px-3 py-1.5 text-foreground-600 transition-smooth hover:bg-background-100 cursor-pointer whitespace-nowrap"><AppIcon className="ri-download-line text-[13px]"></AppIcon></button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}

function StatCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: string; color: string }) {
  const iconBg = color === 'emerald' ? 'bg-emerald-100 text-emerald-600' : color === 'primary' ? 'bg-primary-100 text-primary-600' : color === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-foreground-100 text-foreground-500';
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium cursor-pointer">
      <div className="flex items-start justify-between mb-3"><span className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}><AppIcon className={`${icon} text-sm`}></AppIcon></span></div>
      <p className="text-[11px] text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{sub}</p>
    </div>
  );
}
