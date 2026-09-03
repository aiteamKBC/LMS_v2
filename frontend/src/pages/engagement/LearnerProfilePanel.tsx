import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { useToast } from '@/hooks/useToast';
import { fetchPointsGrants, fetchRecognitions, fetchVoucherClaims, type EngagementPointsGrant } from '@/api/engagement';
import type { Recognition, VoucherClaim } from '@/mocks/engagement-data';
import { EmptyState } from '@/components/feature/EmptyState';

interface LearnerProfilePanelProps {
  /** Real enrolment learner id (Created_users.id); panel is closed when null. */
  learnerId: string | null;
  learnerName?: string;
  programme?: string;
  cohort?: string;
  email?: string;
  onClose: () => void;
}

type TabKey = 'overview' | 'activity' | 'recognition' | 'rewards';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { key: 'activity', label: 'Activity', icon: 'ri-line-chart-line' },
  { key: 'recognition', label: 'Recognition', icon: 'ri-award-line' },
  { key: 'rewards', label: 'Rewards', icon: 'ri-gift-line' },
];

const RECOGNITION_TYPE: Record<Recognition['type'], { icon: string; wrap: string }> = {
  badge: { icon: 'ri-award-line', wrap: 'bg-primary-100 text-primary-700' },
  certificate: { icon: 'ri-file-shield-line', wrap: 'bg-emerald-100 text-emerald-700' },
  spotlight: { icon: 'ri-star-line', wrap: 'bg-accent-100 text-accent-700' },
  milestone: { icon: 'ri-flag-line', wrap: 'bg-secondary-100 text-secondary-700' },
  achievement: { icon: 'ri-trophy-line', wrap: 'bg-amber-100 text-amber-700' },
};

const CLAIM_STATUS: Record<VoucherClaim['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-primary-100 text-primary-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

function StatTile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-background-100/50 rounded-lg p-3">
      <p className="text-[10px] text-foreground-400 mb-1">{label}</p>
      <p className="font-semibold text-foreground-900 text-[13px]">{value}</p>
      {sub}
    </div>
  );
}

// Real monthly points trend from the learner's own grants — no synthesised data.
function monthlyTrend(grants: EngagementPointsGrant[]): { month: string; points: number }[] {
  const now = new Date();
  const buckets: { key: string; month: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, month: d.toLocaleDateString('en-GB', { month: 'short' }) });
  }
  const totals = new Map(buckets.map(b => [b.key, 0]));
  for (const grant of grants) {
    const d = new Date(grant.awardedAt);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + grant.points);
  }
  return buckets.map(b => ({ month: b.month, points: totals.get(b.key) ?? 0 }));
}

function isThisMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function LearnerProfilePanel({ learnerId, learnerName, programme, cohort, email, onClose }: LearnerProfilePanelProps) {
  const navigate = useNavigate();
  const { success, warning, info } = useToast();
  const [tab, setTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(false);
  const [grants, setGrants] = useState<EngagementPointsGrant[]>([]);
  const [recognitions, setRecognitions] = useState<Recognition[]>([]);
  const [claims, setClaims] = useState<VoucherClaim[]>([]);

  useEffect(() => {
    if (!learnerId) return;
    setTab('overview');
    setLoading(true);
    let cancelled = false;
    Promise.all([fetchPointsGrants(learnerId), fetchRecognitions(learnerId), fetchVoucherClaims(learnerId)])
      .then(([grantRows, recognitionRows, claimRows]) => {
        if (cancelled) return;
        setGrants(grantRows); setRecognitions(recognitionRows); setClaims(claimRows);
      })
      .catch((reason: unknown) => {
        if (!cancelled) warning('Could not load engagement profile', reason instanceof Error ? reason.message : undefined);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [learnerId, warning]);

  const overallPoints = grants.reduce((s, g) => s + g.points, 0);
  const pointsThisMonth = grants.filter(g => isThisMonth(g.awardedAt)).reduce((s, g) => s + g.points, 0);
  const recognitionPoints = recognitions.reduce((s, r) => s + r.points, 0);
  const redeemedPoints = claims.filter(c => c.status !== 'rejected').reduce((s, c) => s + c.points, 0);
  const latestRecognition = recognitions[0]?.title;
  const recentGrants = [...grants].slice(0, 8);

  function goAward() { onClose(); navigate('/engagement/recognition'); }
  async function copyEmail() {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      success('Email copied', email);
    } catch {
      info('Copy blocked', 'Your browser blocked clipboard access.');
    }
  }
  function logCall() {
    info('Call logging coming soon', 'Call & WhatsApp logs need a real integration before they can be recorded here.');
  }

  return (
    <RightSlidePanel isOpen={!!learnerId} onClose={onClose} title={learnerName} coloredHeader width="w-[480px]">
      {learnerId && (
        <div className="space-y-5">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full shrink-0 overflow-hidden bg-background-200 flex items-center justify-center text-base font-bold text-primary-700">
              {(learnerName ?? '?').charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground-900">{learnerName ?? 'Learner'}</p>
              <p className="text-[11px] text-foreground-400">{programme || '—'} &middot; {cohort || '—'}</p>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={goAward} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer">
              <AppIcon className="ri-award-line"></AppIcon> Award Recognition
            </button>
            <button onClick={copyEmail} disabled={!email} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <AppIcon className="ri-mail-line"></AppIcon> Copy Email
            </button>
            <button onClick={logCall} className="col-span-2 flex items-center justify-center gap-1.5 px-3 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">
              <AppIcon className="ri-phone-line"></AppIcon> Log Call
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${tab === t.key ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <AppIcon className={`${t.icon} text-xs`}></AppIcon>
                {t.label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-foreground-400 text-[11px]">
              <AppIcon className="ri-loader-4-line animate-spin"></AppIcon> Loading profile…
            </div>
          )}

          {!loading && (
            <>
              {/* ---- OVERVIEW ---- */}
              {tab === 'overview' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <StatTile label="Overall Points" value={overallPoints.toLocaleString()} />
                    <StatTile label="Points This Month" value={`+${pointsThisMonth}`} />
                    <StatTile label="Recognitions" value={String(recognitions.length)} sub={latestRecognition ? <span className="block text-[9px] text-foreground-400 truncate mt-0.5">{latestRecognition}</span> : undefined} />
                    <StatTile label="Points Redeemed" value={redeemedPoints.toLocaleString()} />
                  </div>

                  {grants.length === 0 && recognitions.length === 0 && claims.length === 0 && (
                    <EmptyState icon="ri-inbox-line" title="No engagement activity yet" />
                  )}
                </div>
              )}

              {/* ---- ACTIVITY ---- */}
              {tab === 'activity' && (
                <div className="space-y-5">
                  <div>
                    <p className="text-[11px] font-medium text-foreground-800 mb-2">Points Earned — Last 6 Months</p>
                    <div className="bg-background-100/40 rounded-lg p-2">
                      <ResponsiveContainer width="100%" height={140}>
                        <AreaChart data={monthlyTrend(grants)} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
                          <defs>
                            <linearGradient id="pointsFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="oklch(var(--primary-500))" stopOpacity={0.35} />
                              <stop offset="100%" stopColor="oklch(var(--primary-500))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} width={34} />
                          <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
                          <Area type="monotone" dataKey="points" stroke="oklch(var(--primary-500))" strokeWidth={2.5} fill="url(#pointsFill)" name="Points" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-foreground-800 mb-2">Recent Grants</p>
                    {recentGrants.length === 0 ? (
                      <p className="text-[11px] text-foreground-400 py-3 text-center">No points grants yet</p>
                    ) : (
                      <div className="space-y-1.5">
                        {recentGrants.map(grant => (
                          <div key={grant.id} className="flex items-center justify-between bg-background-100/50 rounded-lg p-2.5">
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium text-foreground-800 truncate">{grant.rule}</p>
                              <p className="text-[10px] text-foreground-400">{grant.awardedAt}{grant.sourceType ? ` · ${grant.sourceType}` : ''}</p>
                            </div>
                            <span className="shrink-0 ml-2 text-[11px] font-bold text-accent-600">+{grant.points}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ---- RECOGNITION ---- */}
              {tab === 'recognition' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium text-foreground-800">Recognitions Received</p>
                    <span className="text-[10px] font-semibold text-accent-600">{recognitions.length} · {recognitionPoints} pts</span>
                  </div>
                  {recognitions.length === 0 ? (
                    <div className="space-y-2">
                      <EmptyState icon="ri-award-line" title="No recognitions yet" />
                      <button onClick={goAward} className="mx-auto block text-[10px] font-semibold text-primary-600 hover:text-primary-700 cursor-pointer">Award the first one →</button>
                    </div>
                  ) : (
                    recognitions.map(rec => {
                      const cfg = RECOGNITION_TYPE[rec.type];
                      return (
                        <div key={rec.id} className="flex items-start gap-2.5 bg-background-100/50 rounded-lg p-3">
                          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.wrap}`}><AppIcon className={`${cfg.icon} text-sm`}></AppIcon></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[12px] font-semibold text-foreground-900 truncate">{rec.title}</p>
                              <span className="text-[11px] font-bold text-accent-600 shrink-0">{rec.points} pts</span>
                            </div>
                            <p className="text-[10px] text-foreground-500 line-clamp-2 mt-0.5">{rec.description}</p>
                            <p className="text-[9px] text-foreground-400 mt-1">{rec.awardedBy} &middot; {rec.awardedAt} &middot; {rec.public ? 'Public' : 'Private'}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* ---- REWARDS ---- */}
              {tab === 'rewards' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium text-foreground-800">Reward Claims</p>
                    <span className="text-[10px] font-semibold text-accent-600">{claims.length} · {redeemedPoints} pts redeemed</span>
                  </div>
                  {claims.length === 0 ? (
                    <EmptyState icon="ri-gift-line" title="No reward claims yet" />
                  ) : (
                    claims.map(claim => (
                      <div key={claim.id} className="flex items-center gap-2.5 bg-background-100/50 rounded-lg p-3">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${claim.deliveryType === 'digital' ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-700'}`}>
                          <AppIcon className={claim.deliveryType === 'digital' ? 'ri-mail-send-line' : 'ri-box-3-line'}></AppIcon>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold text-foreground-900 truncate">{claim.reward}</p>
                          <p className="text-[9px] text-foreground-400">{claim.points} pts &middot; {claim.requestedAt}</p>
                        </div>
                        <span className={`shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full ${CLAIM_STATUS[claim.status]}`}>{claim.status}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </RightSlidePanel>
  );
}
