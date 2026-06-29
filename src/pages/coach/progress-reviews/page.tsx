import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { PREPARATION_FORMS_DATA } from '@/mocks/preparation-forms';
import PreparationFormsPanel from './components/PreparationFormsPanel';

const coachNav = roleNavMap.coach;

const PROGRESS_REVIEWS = [
  { id: 'pr-1', learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', reviewDate: '25 Jun 2026', period: 'Q2 2026', status: 'upcoming' as const, overallProgress: 42, otjhProgress: 62, ksbProgress: 38, evidenceCount: 12, employerSigned: false, tutorSigned: false, coachNotes: 'Amber risk. Needs OTJH catch-up plan before review.' },
  { id: 'pr-2', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', reviewDate: '19 Jun 2026', period: 'Q2 2026', status: 'upcoming' as const, overallProgress: 28, otjhProgress: 22, ksbProgress: 25, evidenceCount: 5, employerSigned: false, tutorSigned: false, coachNotes: 'Red risk. Attendance and evidence both critical.' },
  { id: 'pr-3', learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', reviewDate: '20 Jun 2026', period: 'Q2 2026', status: 'upcoming' as const, overallProgress: 68, otjhProgress: 73, ksbProgress: 72, evidenceCount: 22, employerSigned: true, tutorSigned: true, coachNotes: 'On track. Positive review expected.' },
  { id: 'pr-4', learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', reviewDate: '18 Jun 2026', period: 'Q2 2026', status: 'upcoming' as const, overallProgress: 85, otjhProgress: 92, ksbProgress: 92, evidenceCount: 28, employerSigned: true, tutorSigned: true, coachNotes: 'High performer. Consider Gateway discussion.' },
  { id: 'pr-5', learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', reviewDate: '23 Jun 2026', period: 'Q2 2026', status: 'upcoming' as const, overallProgress: 55, otjhProgress: 56, ksbProgress: 58, evidenceCount: 16, employerSigned: false, tutorSigned: false, coachNotes: 'On track. Standard review.' },
  { id: 'pr-6', learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', reviewDate: '22 Jun 2026', period: 'Q2 2026', status: 'upcoming' as const, overallProgress: 60, otjhProgress: 60, ksbProgress: 64, evidenceCount: 18, employerSigned: false, tutorSigned: true, coachNotes: 'On track. Employer signature pending.' },
];

const COMPLETED_REVIEWS = [
  { id: 'pr-7', learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', reviewDate: '15 Mar 2026', period: 'Q1 2026', status: 'completed' as const, overallProgress: 52, rating: 'On Track', employerSigned: true, tutorSigned: true },
  { id: 'pr-8', learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', reviewDate: '10 Mar 2026', period: 'Q1 2026', status: 'completed' as const, overallProgress: 72, rating: 'Exceeding', employerSigned: true, tutorSigned: true },
  { id: 'pr-9', learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', reviewDate: '12 Apr 2026', period: 'Q1 2026', status: 'completed' as const, overallProgress: 42, rating: 'On Track', employerSigned: true, tutorSigned: true },
];

export default function CoachProgressReviews() {
  const [tab, setTab] = useState<'upcoming' | 'completed' | 'prep-forms'>('upcoming');
  const [expanded, setExpanded] = useState<string | null>(null);

  const data = tab === 'upcoming' ? PROGRESS_REVIEWS : tab === 'completed' ? COMPLETED_REVIEWS : [];
  const upcoming = PROGRESS_REVIEWS.length;
  const completed = COMPLETED_REVIEWS.length;
  const employerPending = PROGRESS_REVIEWS.filter(r => !r.employerSigned).length;
  const newPrepForms = PREPARATION_FORMS_DATA.filter(f => f.status === 'new').length;
  const totalPrepForms = PREPARATION_FORMS_DATA.length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Progress Reviews" pageSubtitle="Manage learner progress reviews and sign-offs" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-file-chart-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Progress Reviews</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{upcoming} upcoming</strong> reviews, {completed} completed. {employerPending} pending employer signatures.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{upcoming}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Upcoming</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{completed}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Completed</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{employerPending}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Pending Sign</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalPrepForms}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Prep Forms</p>
                {newPrepForms > 0 && (
                  <p className="text-[9px] text-amber-300 mt-0.5">{newPrepForms} new</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setTab('upcoming')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'upcoming' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Upcoming <span className="text-[10px] opacity-60">({upcoming})</span></button>
          <button onClick={() => setTab('completed')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'completed' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Completed <span className="text-[10px] opacity-60">({completed})</span></button>
          <button onClick={() => setTab('prep-forms')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${tab === 'prep-forms' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
            Preparation Forms <span className="text-[10px] opacity-60">({totalPrepForms})</span>
            {newPrepForms > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold">{newPrepForms}</span>
            )}
          </button>
        </div>

        {/* Preparation Forms Tab Content */}
        {tab === 'prep-forms' && <PreparationFormsPanel />}

        {/* Reviews (Upcoming / Completed) */}
        {tab !== 'prep-forms' && (
          <div className="space-y-3">
            {data.map(review => {
              const isOpen = expanded === review.id;
              return (
                <div key={review.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => setExpanded(isOpen ? null : review.id)}>
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${review.status === 'upcoming' ? 'bg-primary-100 text-primary-700 ring-primary-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                      <span className="text-sm font-bold">{review.initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground-900">{review.learner}</p>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${review.status === 'upcoming' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{review.status}</span>
                        {'rating' in review && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-accent-100 text-accent-700">{review.rating}</span>}
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{review.programme} · {review.reviewDate} · {review.period}</p>
                    </div>
                    <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
                      {'overallProgress' in review && <span>Progress: {review.overallProgress}%</span>}
                      {'employerSigned' in review && <span>Employer: {review.employerSigned ? <i className="ri-check-line text-emerald-500"></i> : <i className="ri-close-line text-red-400"></i>}</span>}
                      {'tutorSigned' in review && <span>Tutor: {review.tutorSigned ? <i className="ri-check-line text-emerald-500"></i> : <i className="ri-close-line text-red-400"></i>}</span>}
                    </div>
                    <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></i>
                  </div>
                  {isOpen && 'coachNotes' in review && (
                    <div className="mt-4 ml-14 pt-3 border-t border-background-200/30 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="bg-background-100/50 rounded-lg p-3 text-center">
                          <p className="text-[10px] text-foreground-400 mb-1">Overall Progress</p>
                          <div className="w-full bg-background-200 rounded-full h-2 mb-1.5"><div className="h-2 rounded-full bg-primary-500" style={{ width: `${review.overallProgress}%` }}></div></div>
                          <p className="text-lg font-bold text-foreground-900">{review.overallProgress}%</p>
                        </div>
                        <div className="bg-background-100/50 rounded-lg p-3 text-center">
                          <p className="text-[10px] text-foreground-400 mb-1">OTJH Progress</p>
                          <p className="text-lg font-bold text-foreground-900">{review.otjhProgress}%</p>
                        </div>
                        <div className="bg-background-100/50 rounded-lg p-3 text-center">
                          <p className="text-[10px] text-foreground-400 mb-1">Evidence Count</p>
                          <p className="text-lg font-bold text-foreground-900">{review.evidenceCount}</p>
                        </div>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-3 border border-amber-200/30">
                        <p className="text-[12px] text-foreground-700"><strong>Coach Notes:</strong> {review.coachNotes}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-file-chart-line mr-1"></i> Prep Review</button>
                        <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-pen-nib-line mr-1"></i> Sign Off</button>
                        <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-mail-line mr-1"></i> Request Employer Sign</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}