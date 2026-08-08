import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchEmployerPortal, type EmployerLearnerCard, type EmployerPortal } from '@/api/employerPortal';
import { Hero, StatCard, btnSecondary } from '@/pages/users/components/ui';

// ============================================================================
// The employer's side page: one card per learner who works for them.
//
// Reached from the Users directory's View action on an employer row. Their
// learners are the ones whose Created_users."Employer_id" points at this
// employer — the reference column, not the free-text employer name, which is
// what makes this list trustworthy.
//
// A card shows the learner's progress at a glance plus how many documents still
// need this employer's signature; clicking it opens the learner page where both
// live. Outstanding paperwork is surfaced on the card itself so an employer with
// several learners can see where they are needed without opening each one.
// ============================================================================

const employerNav = roleNavMap.apprentice;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function LearnerCard({ card, onOpen }: { card: EmployerLearnerCard; onOpen: () => void }) {
  const needsAction = card.outstandingCount > 0;
  return (
    <button
      onClick={onOpen}
      className={`text-left bg-background-50 rounded-2xl border p-5 card-premium transition-smooth cursor-pointer hover:border-primary-300 ${
        needsAction ? 'border-amber-300/70' : 'border-foreground-200/60'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`w-11 h-11 rounded-xl flex items-center justify-center text-[13px] font-bold shrink-0 ${
          card.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-primary-50 text-primary-700 border border-primary-200/40'
        }`}>
          {initials(card.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground-900 truncate" title={card.name}>{card.name}</p>
          <p className="text-[12px] text-foreground-500 truncate" title={card.email}>{card.email}</p>
        </div>
        {/* The status the whole page keys off: Active leads with performance,
            anything else leads with the paperwork. */}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
          card.isActive
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
            : 'bg-amber-50 text-amber-700 border-amber-200/50'
        }`}>
          {card.programmeStatus || 'Not set'}
        </span>
      </div>

      <dl className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <dt className="text-foreground-500">Programme</dt>
          <dd className="text-foreground-800 font-medium truncate max-w-[60%]" title={card.programme}>
            {card.programme || '—'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <dt className="text-foreground-500">Cohort</dt>
          <dd className="text-foreground-800 font-medium truncate max-w-[60%]" title={card.cohort}>
            {card.cohort || '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-4 pt-3 border-t border-foreground-100">
        {needsAction ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-700">
            <i className="ri-error-warning-line" />
            {card.outstandingCount} document{card.outstandingCount === 1 ? '' : 's'} need your signature
          </span>
        ) : card.documentsTotal > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
            <i className="ri-check-double-line" />All documents signed
          </span>
        ) : (
          <span className="text-[12px] text-foreground-400">No documents to sign yet</span>
        )}
      </div>
    </button>
  );
}

export default function EmployerPortalPage() {
  const { employerId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<EmployerPortal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchEmployerPortal(employerId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [employerId]);

  const learners = data?.learners ?? [];
  const active = learners.filter((l) => l.isActive).length;

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={employerNav.label}
      navItems={employerNav.items}
      workspaceLabel={employerNav.workspaceLabel}
      pageTitle="Employer"
      pageSubtitle={data?.employer.name ?? 'Employer portal'}
      userName="Enrolment Officer"
      userRole="Enrolment Officer"
    >
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="animate-fade-in-up">
          <Hero
            icon="ri-briefcase-line"
            title={data?.employer.name || 'Employer'}
            subtitle={
              data
                ? <>
                    {data.employer.employerGroupNames.join(', ') || 'No organisation'}
                    {' · '}
                    <strong>{learners.length} learner{learners.length === 1 ? '' : 's'}</strong>
                    {data.outstandingTotal > 0 && <> · {data.outstandingTotal} awaiting your signature</>}
                  </>
                : undefined
            }
            right={
              <button onClick={() => navigate('/users')} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/15 backdrop-blur-sm border border-white/25 text-white rounded-xl text-[13px] font-semibold hover:bg-white/25 transition-smooth cursor-pointer">
                <i className="ri-arrow-left-line" />Back to users
              </button>
            }
          />
        </div>

        {loading && (
          <p className="py-16 text-center text-[13px] text-foreground-400">
            <i className="ri-loader-4-line animate-spin mr-2" />Loading learners…
          </p>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{error}</p>
            <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              <StatCard icon="ri-group-line" label="Learners" value={learners.length} tint="primary" />
              <StatCard icon="ri-play-circle-line" label="Active on programme" value={active} tint="emerald" />
              <StatCard icon="ri-draft-line" label="Awaiting your signature" value={data.outstandingTotal} tint="amber" />
            </div>

            {learners.length === 0 ? (
              <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-12 text-center card-premium">
                <i className="ri-group-line text-3xl text-foreground-300" />
                <p className="text-[13px] text-foreground-500 mt-3">
                  No learners are linked to this employer yet.
                </p>
                <p className="text-[12px] text-foreground-400 mt-1">
                  A learner is linked by choosing this employer on their record.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
                {learners.map((card) => (
                  <LearnerCard
                    key={`${card.kind}-${card.id}`}
                    card={card}
                    onOpen={() => navigate(`/employers/${employerId}/learner/${card.kind}/${card.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
