import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface Review {
  id: string;
  apprentice: string;
  initials: string;
  programme: string;
  date: string;
  type: string;
  period: string;
  coach: string;
  status: 'Scheduled' | 'Completed' | 'Awaiting Employer' | 'Awaiting Coach';
  progressAtReview: number;
  attendanceSinceLast: number;
  otjhSinceLast: number;
  summary: string;
  actionRequired: string;
}

const REVIEWS: Review[] = [
  { id: 'rv-01', apprentice: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', date: '25 Jun 2026', type: 'Monthly Progress Review', period: 'June 2026', coach: 'Med Maher', status: 'Scheduled', progressAtReview: 42, attendanceSinceLast: 86, otjhSinceLast: 16, summary: 'First quarterly review covering initial modules and workplace integration', actionRequired: 'Prepare evidence of workplace application' },
  { id: 'rv-02', apprentice: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', date: '28 May 2026', type: 'Monthly Progress Review', period: 'May 2026', coach: 'Med Maher', status: 'Awaiting Employer', progressAtReview: 28, attendanceSinceLast: 90, otjhSinceLast: 22, summary: 'Strong start. Sophie has settled well into the programme structure.', actionRequired: 'Employer sign-off required' },
  { id: 'rv-03', apprentice: 'Tom Richards', initials: 'TR', programme: 'Marketing Executive L4', date: '25 Jun 2026', type: 'Monthly Progress Review', period: 'June 2026', coach: 'Med Maher', status: 'Scheduled', progressAtReview: 38, attendanceSinceLast: 82, otjhSinceLast: 14, summary: 'Attendance concerns — 3 missed sessions this period', actionRequired: 'Discuss attendance improvement plan' },
  { id: 'rv-04', apprentice: 'Tom Richards', initials: 'TR', programme: 'Marketing Executive L4', date: '28 May 2026', type: 'Monthly Progress Review', period: 'May 2026', coach: 'Med Maher', status: 'Completed', progressAtReview: 26, attendanceSinceLast: 92, otjhSinceLast: 20, summary: 'Good initial engagement with the programme', actionRequired: '' },
  { id: 'rv-05', apprentice: 'Daniel Clarke', initials: 'DC', programme: 'Business Admin L3', date: '28 Jun 2026', type: 'Quarterly Review', period: 'Q2 2026', coach: 'Med Maher', status: 'Scheduled', progressAtReview: 68, attendanceSinceLast: 94, otjhSinceLast: 35, summary: 'Approaching midpoint review — strong performance across all areas', actionRequired: 'Gateway readiness assessment' },
  { id: 'rv-06', apprentice: 'Daniel Clarke', initials: 'DC', programme: 'Business Admin L3', date: '28 May 2026', type: 'Monthly Progress Review', period: 'May 2026', coach: 'Med Maher', status: 'Completed', progressAtReview: 62, attendanceSinceLast: 95, otjhSinceLast: 30, summary: 'Excellent performance. Daniel is exceeding expectations.', actionRequired: '' },
  { id: 'rv-07', apprentice: 'Mark Jensen', initials: 'MJ', programme: 'Digital Marketer L3', date: '22 Jun 2026', type: 'Monthly Progress Review', period: 'June 2026', coach: 'Med Maher', status: 'Awaiting Employer', progressAtReview: 72, attendanceSinceLast: 88, otjhSinceLast: 28, summary: 'Nearing completion. KSB portfolio needs final employer validation.', actionRequired: 'Sign off KSB portfolio evidence' },
  { id: 'rv-08', apprentice: 'Mark Jensen', initials: 'MJ', programme: 'Digital Marketer L3', date: '22 May 2026', type: 'Monthly Progress Review', period: 'May 2026', coach: 'Med Maher', status: 'Completed', progressAtReview: 66, attendanceSinceLast: 90, otjhSinceLast: 25, summary: 'On track for planned end date', actionRequired: '' },
];

export default function EmployerProgressReviews() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedReview, setExpandedReview] = useState<string | null>(null);

  const filtered = REVIEWS.filter(r => {
    if (search && !r.apprentice.toLowerCase().includes(search.toLowerCase()) && !r.type.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  const awaiting = REVIEWS.filter(r => r.status === 'Awaiting Employer').length;
  const scheduled = REVIEWS.filter(r => r.status === 'Scheduled').length;
  const completed = REVIEWS.filter(r => r.status === 'Completed').length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Progress Reviews" pageSubtitle="Review and sign off apprentice progress reviews" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-file-chart-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Progress Reviews</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{REVIEWS.length} reviews</strong> · {awaiting} awaiting your signature · {scheduled} upcoming · {completed} completed
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{awaiting}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Need Signing</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{scheduled}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Upcoming</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Alert */}
        {awaiting > 0 && (
          <div className="bg-red-50 border border-red-200/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <AppIcon className="ri-pen-nib-line text-red-600 text-base"></AppIcon>
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">{awaiting} progress reviews need your signature</p>
              <p className="text-[12px] text-red-600 mt-0.5">Employer sign-off is required to confirm progress and keep funding compliant</p>
            </div>
            <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-[12px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-pen-nib-line mr-1"></AppIcon> Review &amp; Sign
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reviews..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All', count: REVIEWS.length },{ key: 'Awaiting Employer', label: 'Need Signing', count: awaiting },{ key: 'Scheduled', label: 'Upcoming', count: scheduled },{ key: 'Completed', label: 'Completed', count: completed }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {f.label} <span className="ml-1 text-[10px] opacity-60">{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Reviews List */}
        <div className="space-y-3">
          {filtered.map(review => {
            const isOpen = expandedReview === review.id;
            const statusConfig = {
              'Scheduled': { bg: 'bg-primary-50 border-primary-200/50', text: 'text-primary-700', icon: 'ri-calendar-line' },
              'Completed': { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700', icon: 'ri-check-double-line' },
              'Awaiting Employer': { bg: 'bg-red-50 border-red-200/50', text: 'text-red-700', icon: 'ri-pen-nib-line' },
              'Awaiting Coach': { bg: 'bg-amber-50 border-amber-200/50', text: 'text-amber-700', icon: 'ri-time-line' },
            };
            const sc = statusConfig[review.status];

            return (
              <div key={review.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => setExpandedReview(isOpen ? null : review.id)}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 ${review.status === 'Awaiting Employer' ? 'bg-red-100 text-red-700 ring-red-200' : review.status === 'Scheduled' ? 'bg-primary-100 text-primary-700 ring-primary-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                    <span className="text-sm font-bold">{review.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{review.apprentice}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{review.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{review.type} · {review.period} · Coach: {review.coach}</p>
                  </div>
                  <div className="hidden md:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
                    <span>{review.date}</span>
                    <span>{review.progressAtReview}% progress</span>
                    <span>{review.attendanceSinceLast}% att.</span>
                  </div>
                  <AppIcon className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></AppIcon>
                </div>
                {isOpen && (
                  <div className="mt-4 ml-14 pt-3 border-t border-background-200/30 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="bg-background-100 rounded-lg p-3 text-center">
                        <p className="text-lg font-heading font-semibold text-foreground-900">{review.progressAtReview}%</p>
                        <p className="text-[10px] text-foreground-400">Overall Progress</p>
                      </div>
                      <div className="bg-background-100 rounded-lg p-3 text-center">
                        <p className="text-lg font-heading font-semibold text-foreground-900">{review.attendanceSinceLast}%</p>
                        <p className="text-[10px] text-foreground-400">Attendance</p>
                      </div>
                      <div className="bg-background-100 rounded-lg p-3 text-center">
                        <p className="text-lg font-heading font-semibold text-foreground-900">{review.otjhSinceLast}h</p>
                        <p className="text-[10px] text-foreground-400">OTJH This Period</p>
                      </div>
                    </div>
                    <div className="bg-background-100 rounded-xl p-4">
                      <p className="text-[11px] font-semibold text-foreground-600 mb-1">Review Summary</p>
                      <p className="text-[12px] text-foreground-800">{review.summary}</p>
                      {review.actionRequired && (
                        <div className="flex items-start gap-2 mt-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                          <AppIcon className="ri-alert-line text-amber-600 text-xs mt-0.5"></AppIcon>
                          <p className="text-[11px] text-amber-700">{review.actionRequired}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {review.status === 'Awaiting Employer' ? (
                        <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-pen-nib-line mr-1"></AppIcon> Sign Now
                        </button>
                      ) : (
                        <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-eye-line mr-1"></AppIcon> View Full Review
                        </button>
                      )}
                      <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                        <AppIcon className="ri-chat-1-line mr-1"></AppIcon> Discuss with Coach
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}