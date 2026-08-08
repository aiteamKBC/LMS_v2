import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { useToast } from '@/hooks/useToast';
import {
  ENGAGEMENT_LEARNERS, RECOGNITIONS, VOUCHER_CLAIMS, CATCHUP_ITEMS,
  type EngagementLearner, type Recognition, type VoucherClaim,
} from '@/mocks/engagement-data';

interface LearnerProfilePanelProps {
  /** Learner to show; panel is closed when null. Resolved against the shared roster. */
  learnerId: string | null;
  onClose: () => void;
}

type TabKey = 'overview' | 'activity' | 'recognition' | 'rewards';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { key: 'activity', label: 'Activity', icon: 'ri-line-chart-line' },
  { key: 'recognition', label: 'Recognition', icon: 'ri-award-line' },
  { key: 'rewards', label: 'Rewards', icon: 'ri-gift-line' },
];

// Recognition type → medallion styling (mirrors the recognition page taxonomy).
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

function scoreColor(v: number): string {
  return v >= 70 ? 'bg-emerald-500' : v >= 45 ? 'bg-amber-500' : 'bg-red-500';
}
function scoreText(v: number): string {
  return v >= 70 ? 'text-emerald-600' : v >= 45 ? 'text-amber-600' : 'text-red-600';
}

// Deterministic per-learner points trend for the sparkline. There's no real
// time-series in the mock roster, so we synthesise 6 stable months that END at
// the learner's real `pointsThisMonth` and lean up/down per `monthlyStatus`.
// Deterministic (seeded off the id) so it doesn't flicker between renders.
function pointsTrend(learner: EngagementLearner): { month: string; points: number }[] {
  let seed = 0;
  for (let i = 0; i < learner.id.length; i++) seed = (seed * 31 + learner.id.charCodeAt(i)) % 997;
  const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const dir = learner.monthlyStatus === 'rising' ? 1 : learner.monthlyStatus === 'falling' ? -1 : 0;
  const base = Math.max(learner.pointsThisMonth, 10);
  return months.map((month, i) => {
    if (i === months.length - 1) return { month, points: learner.pointsThisMonth };
    const wobble = ((seed >> i) % 6) * 5;              // 0..25, stable per learner
    const ramp = dir * (months.length - 1 - i) * 8;    // earlier months lower when rising
    return { month, points: Math.max(5, Math.round(base - ramp + wobble - 10)) };
  });
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="bg-background-100/50 rounded-lg p-3">
      <p className="text-[10px] text-foreground-400 mb-1">{label}</p>
      <p className="font-semibold text-foreground-900 text-[13px]">{value}</p>
      {sub}
    </div>
  );
}

function ProgressBar({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-foreground-400">{label}</span>
        <span className="text-[10px] font-semibold text-foreground-700">{detail}</span>
      </div>
      <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${scoreColor(value)}`} style={{ width: `${Math.min(value, 100)}%` }}></div>
      </div>
    </div>
  );
}

export function LearnerProfilePanel({ learnerId, onClose }: LearnerProfilePanelProps) {
  const navigate = useNavigate();
  const { success, info } = useToast();
  const [tab, setTab] = useState<TabKey>('overview');

  // Reset to the first tab whenever a different learner is opened.
  useEffect(() => { if (learnerId) setTab('overview'); }, [learnerId]);

  const learner = learnerId ? ENGAGEMENT_LEARNERS.find(l => l.id === learnerId) ?? null : null;
  const recognitions = learner ? RECOGNITIONS.filter(r => r.learnerId === learner.id) : [];
  const claims = learner ? VOUCHER_CLAIMS.filter(c => c.learnerId === learner.id) : [];
  const catchups = learner ? CATCHUP_ITEMS.filter(c => c.learnerId === learner.id) : [];

  const attendancePct = learner ? Math.round((learner.sessionsAttended / learner.totalSessions) * 100) : 0;
  const recognitionPoints = recognitions.reduce((s, r) => s + r.points, 0);
  const redeemedPoints = claims.filter(c => c.status !== 'rejected').reduce((s, c) => s + c.points, 0);

  function goAward() { onClose(); navigate('/engagement/recognition'); }
  function goAttendance() { onClose(); navigate('/engagement/attendance-risk'); }
  async function copyEmail() {
    if (!learner) return;
    try {
      await navigator.clipboard.writeText(learner.email);
      success('Email copied', learner.email);
    } catch {
      info('Copy blocked', 'Your browser blocked clipboard access.');
    }
  }
  function logCall() {
    info('Call logging coming soon', 'Call & WhatsApp logs need a real integration before they can be recorded here.');
  }

  return (
    <RightSlidePanel isOpen={!!learner} onClose={onClose} title={learner?.name} coloredHeader width="w-[480px]">
      {learner && (
        <div className="space-y-5">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full shrink-0 overflow-hidden bg-background-200">
              {learner.avatarImg ? (
                <img src={learner.avatarImg} alt={learner.name} className="w-full h-full object-cover" />
              ) : (
                <div className={`w-full h-full flex items-center justify-center text-base font-bold ${learner.riskLevel === 'red' ? 'bg-red-100 text-red-700' : learner.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{learner.name.charAt(0)}</div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground-900">{learner.name}</p>
              <p className="text-[11px] text-foreground-400">{learner.programme} &middot; {learner.cohort}</p>
              <p className="text-[10px] text-foreground-400">Coach: {learner.coach} &middot; Active {learner.lastActive}</p>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={goAward} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer">
              <AppIcon className="ri-award-line"></AppIcon> Award Recognition
            </button>
            <button onClick={copyEmail} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">
              <AppIcon className="ri-mail-line"></AppIcon> Message
            </button>
            <button onClick={logCall} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">
              <AppIcon className="ri-phone-line"></AppIcon> Log Call
            </button>
            <button onClick={goAttendance} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">
              <AppIcon className="ri-alert-line"></AppIcon> Attendance Risk
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

          {/* ---- OVERVIEW ---- */}
          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${learner.riskLevel === 'red' ? 'bg-red-100 text-red-700' : learner.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{learner.riskLevel.toUpperCase()} risk</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${learner.overallStatus === 'on-track' ? 'bg-emerald-100 text-emerald-700' : learner.overallStatus === 'monitor' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{learner.overallStatus === 'on-track' ? 'On Track' : learner.overallStatus === 'monitor' ? 'Monitor' : 'At Risk'}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full bg-background-100 ${learner.trend === 'up' ? 'text-emerald-600' : learner.trend === 'down' ? 'text-red-600' : 'text-foreground-500'}`}>
                  <AppIcon className={learner.trend === 'up' ? 'ri-arrow-up-line' : learner.trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'}></AppIcon> {learner.trend}
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-foreground-800">Engagement Score</span>
                  <span className={`text-[11px] font-bold ${scoreText(learner.engagementScore)}`}>{learner.engagementScore}%</span>
                </div>
                <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${scoreColor(learner.engagementScore)}`} style={{ width: `${learner.engagementScore}%` }}></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <StatTile label="Overall Points" value={learner.overallPoints.toLocaleString()} />
                <StatTile label="Points This Month" value={`+${learner.pointsThisMonth}`} sub={<span className={`inline-flex items-center gap-0.5 mt-0.5 text-[9px] font-semibold ${learner.monthlyStatus === 'rising' ? 'text-emerald-600' : learner.monthlyStatus === 'falling' ? 'text-red-600' : 'text-foreground-400'}`}><AppIcon className={learner.monthlyStatus === 'rising' ? 'ri-arrow-up-line' : learner.monthlyStatus === 'falling' ? 'ri-arrow-down-line' : 'ri-subtract-line'}></AppIcon>{learner.monthlyStatus}</span>} />
                <StatTile label="Badges" value={String(learner.badgesCount)} sub={<span className="block text-[9px] text-foreground-400 truncate mt-0.5">{learner.topBadge}</span>} />
                <StatTile label="Last Attendance" value={learner.lastAttendance} />
              </div>

              {learner.flags.length > 0 && (
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[11px] font-medium text-foreground-800 mb-1.5">Flags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {learner.flags.map(flag => (
                      <span key={flag} className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{flag}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-amber-50/50 rounded-lg p-3">
                <p className="text-[11px] font-medium text-amber-800 mb-0.5">Recommended Action</p>
                <p className="text-[11px] text-amber-700">{learner.attendanceAction}</p>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {learner.employerNotified && <span className="text-[10px] text-amber-600 font-medium">Employer notified</span>}
                  {learner.interventionDate && <span className="text-[10px] text-amber-600">Intervention: {learner.interventionDate}</span>}
                </div>
              </div>
            </div>
          )}

          {/* ---- ACTIVITY ---- */}
          {tab === 'activity' && (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-medium text-foreground-800 mb-2">Points Earned — Last 6 Months</p>
                <div className="bg-background-100/40 rounded-lg p-2">
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={pointsTrend(learner)} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
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
                <p className="text-[11px] font-medium text-foreground-800 mb-2">Attendance &amp; Progress</p>
                <div className="space-y-2">
                  <ProgressBar label="Session Attendance" value={attendancePct} detail={`${learner.sessionsAttended}/${learner.totalSessions} sessions`} />
                  <ProgressBar label="Evidence Submission" value={Math.round((learner.evidenceSubmitted / learner.evidenceTarget) * 100)} detail={`${learner.evidenceSubmitted}/${learner.evidenceTarget} pieces`} />
                  <ProgressBar label="OTJH Progress" value={Math.round((learner.otjhHours / learner.otjhTarget) * 100)} detail={`${learner.otjhHours}/${learner.otjhTarget}h`} />
                  <ProgressBar label="Quiz Average" value={learner.quizAverage} detail={`${learner.quizAverage}%`} />
                  <ProgressBar label="KSB Progression" value={learner.ksbProgress} detail={`${learner.ksbProgress}%`} />
                  <ProgressBar label="Message Response" value={learner.messageResponse} detail={`${learner.messageResponse}%`} />
                </div>
              </div>

              {catchups.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-foreground-800 mb-2">Catch-up Sessions</p>
                  <div className="space-y-1.5">
                    {catchups.map(cu => (
                      <div key={cu.id} className="flex items-center justify-between bg-background-100/50 rounded-lg p-2.5">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-foreground-800 truncate">{cu.missedSessions.join(', ')}</p>
                          <p className="text-[10px] text-foreground-400">{cu.reason} &middot; {cu.totalHours}h</p>
                        </div>
                        <span className={`shrink-0 ml-2 text-[9px] font-semibold px-2 py-0.5 rounded-full ${cu.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : cu.status === 'scheduled' ? 'bg-primary-100 text-primary-700' : 'bg-red-100 text-red-700'}`}>{cu.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                <div className="flex flex-col items-center justify-center text-center gap-2 py-8 bg-background-100/40 rounded-lg">
                  <AppIcon className="ri-award-line text-2xl text-foreground-300"></AppIcon>
                  <p className="text-[11px] font-semibold text-foreground-700">No recognitions yet</p>
                  <button onClick={goAward} className="text-[10px] font-semibold text-primary-600 hover:text-primary-700 cursor-pointer">Award the first one →</button>
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
                <div className="flex flex-col items-center justify-center text-center gap-2 py-8 bg-background-100/40 rounded-lg">
                  <AppIcon className="ri-gift-line text-2xl text-foreground-300"></AppIcon>
                  <p className="text-[11px] font-semibold text-foreground-700">No reward claims yet</p>
                </div>
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
        </div>
      )}
    </RightSlidePanel>
  );
}
