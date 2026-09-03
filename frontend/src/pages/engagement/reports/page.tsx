import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { useToast } from '@/hooks/useToast';
import {
  fetchLearnerAnalytics, fetchReportData,
  type LearnerAnalyticsRow, type PointsRewardsReport, type ClubActivityReport, type EventAttendanceReport,
} from '@/api/engagement';

const engagementNav = roleNavMap.engagement;

type ReportId = 'engagement-scoreboard' | 'points-rewards' | 'club-activity' | 'event-attendance';
type RiskFilter = 'all' | 'red' | 'amber' | 'green';

interface ReportMeta {
  id: ReportId;
  name: string;
  description: string;
  type: 'dashboard' | 'summary' | 'detailed';
  category: string;
  icon: string;
  bg: string;
  text: string;
}

const REPORTS: ReportMeta[] = [
  { id: 'engagement-scoreboard', name: 'Engagement Scoreboard', description: 'Live engagement scores across all learners, with risk categorisation', type: 'dashboard', category: 'Overview', icon: 'ri-dashboard-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  { id: 'points-rewards', name: 'Points & Rewards Summary', description: 'Points awarded by category, plus voucher claim and redemption status', type: 'summary', category: 'Rewards', icon: 'ri-file-list-line', bg: 'bg-secondary-100', text: 'text-secondary-700' },
  { id: 'club-activity', name: 'Club Activity Report', description: 'Membership, meetings, and marked attendance across every club', type: 'detailed', category: 'Clubs', icon: 'ri-file-chart-line', bg: 'bg-accent-100', text: 'text-accent-700' },
  { id: 'event-attendance', name: 'Event Attendance Report', description: 'Bookings, attendance, and no-shows for every event', type: 'detailed', category: 'Events', icon: 'ri-file-chart-line', bg: 'bg-accent-100', text: 'text-accent-700' },
];

// Minimal CSV builder — one flat table of rows sharing the same keys.
function toCsv(rows: Record<string, string | number | null>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Compact select used for the per-report filter bar — same visual language
// (light border, small text) across every report's filter row.
function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] font-medium text-foreground-500">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2 py-1 rounded-md border border-foreground-200/60 bg-background-50 text-[10px] text-foreground-700 focus:outline-none focus:ring-1 focus:ring-primary-400/40 cursor-pointer"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export default function EngagementReportsPage() {
  const navigate = useNavigate();
  const operator = useOperatorIdentity();
  const { warning } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const [generatingId, setGeneratingId] = useState<ReportId | null>(null);
  const [expandedId, setExpandedId] = useState<ReportId | null>(null);
  const [lastGenerated, setLastGenerated] = useState<Partial<Record<ReportId, string>>>({});
  const [scoreboard, setScoreboard] = useState<LearnerAnalyticsRow[] | null>(null);
  const [pointsRewards, setPointsRewards] = useState<PointsRewardsReport | null>(null);
  const [clubActivity, setClubActivity] = useState<ClubActivityReport | null>(null);
  const [eventAttendance, setEventAttendance] = useState<EventAttendanceReport | null>(null);

  // Per-report filters. Scoreboard's programme filter narrows the fetch
  // itself (the backend already supports ?programme=); the rest filter the
  // already-fetched data client-side, since their endpoints return everything.
  const [scoreboardProgramme, setScoreboardProgramme] = useState('');
  const [scoreboardRisk, setScoreboardRisk] = useState<RiskFilter>('all');
  const [pointsCategory, setPointsCategory] = useState('all');
  const [clubLocation, setClubLocation] = useState('all');
  const [eventType, setEventType] = useState('all');

  const filtered = REPORTS.filter(r => {
    const matchCat = categoryFilter === 'all' || r.category === categoryFilter;
    const matchType = typeFilter === 'all' || r.type === typeFilter;
    return matchCat && matchType;
  });

  const scoreboardFiltered = useMemo(
    () => (scoreboard ? scoreboard.filter(r => scoreboardRisk === 'all' || r.riskLevel === scoreboardRisk) : null),
    [scoreboard, scoreboardRisk],
  );
  const pointsFiltered = useMemo(() => {
    if (!pointsRewards) return null;
    const byCategory = pointsCategory === 'all' ? pointsRewards.byCategory : pointsRewards.byCategory.filter(c => c.category === pointsCategory);
    return { ...pointsRewards, byCategory };
  }, [pointsRewards, pointsCategory]);
  const clubFiltered = useMemo(() => {
    if (!clubActivity) return null;
    const clubs = clubLocation === 'all' ? clubActivity.clubs : clubActivity.clubs.filter(c => c.location === clubLocation);
    return { ...clubActivity, clubs };
  }, [clubActivity, clubLocation]);
  const eventFiltered = useMemo(() => {
    if (!eventAttendance) return null;
    const events = eventType === 'all' ? eventAttendance.events : eventAttendance.events.filter(e => e.type === eventType);
    return { ...eventAttendance, events };
  }, [eventAttendance, eventType]);

  async function generate(report: ReportMeta) {
    setGeneratingId(report.id);
    try {
      if (report.id === 'engagement-scoreboard') setScoreboard(await fetchLearnerAnalytics(scoreboardProgramme.trim() || undefined));
      else if (report.id === 'points-rewards') setPointsRewards(await fetchReportData('points-rewards'));
      else if (report.id === 'club-activity') setClubActivity(await fetchReportData('club-activity'));
      else if (report.id === 'event-attendance') setEventAttendance(await fetchReportData('event-attendance'));
      setLastGenerated(prev => ({ ...prev, [report.id]: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }));
      setExpandedId(report.id);
    } catch (err: any) {
      warning('Could not generate report', err.message);
    } finally {
      setGeneratingId(null);
    }
  }

  async function downloadReport(report: ReportMeta) {
    try {
      if (report.id === 'engagement-scoreboard') {
        const rows = scoreboardFiltered ?? (await fetchLearnerAnalytics(scoreboardProgramme.trim() || undefined)).filter(r => scoreboardRisk === 'all' || r.riskLevel === scoreboardRisk);
        downloadCsv('engagement-scoreboard.csv', toCsv(rows.map(r => ({
          learner: r.name, programme: r.programme, cohort: r.cohort, score: r.engagementScore ?? '', risk: r.riskLevel ?? '',
        }))));
      } else if (report.id === 'points-rewards') {
        const data = pointsFiltered ?? await fetchReportData('points-rewards');
        downloadCsv('points-rewards-summary.csv', toCsv(data.byCategory.map(c => ({ category: c.category, points: c.points, learners: c.learners }))));
      } else if (report.id === 'club-activity') {
        const data = clubFiltered ?? await fetchReportData('club-activity');
        downloadCsv('club-activity-report.csv', toCsv(data.clubs.map(c => ({
          club: c.name, location: c.location, members: c.members, meetings: c.meetings,
          meetingsScheduled: c.meetingsScheduled, attendanceMarked: c.totalAttendanceMarked,
        }))));
      } else if (report.id === 'event-attendance') {
        const data = eventFiltered ?? await fetchReportData('event-attendance');
        downloadCsv('event-attendance-report.csv', toCsv(data.events.map(e => ({
          event: e.title, date: e.date, type: e.type, booked: e.booked, present: e.present,
          absent: e.absent, attendanceRatePct: e.attendanceRate ?? '',
        }))));
      }
    } catch (err: any) {
      warning('Could not download report', err.message);
    }
  }

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Engagement Reports" pageSubtitle="Generate live engagement reports for management review"
      userName={operator.name} userRole={operator.role}
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Engagement Reports"
          description={`${REPORTS.length} reports available, each generated from live data. Filter, generate to preview inline, or download as CSV.`}
          icon="ri-bar-chart-box-line"
          imageUrl="https://readdy.ai/api/search-image?query=professional%20reports%20analytics%20dashboard%20modern%20workspace%20warm%20lighting%20data%20visualization&width=400&height=160&seq=reports-01&orientation=landscape"
          imageAlt="Engagement Reports"
          stats={[{ label: 'Reports', value: String(REPORTS.length) }, { label: 'Dashboards', value: String(REPORTS.filter(r => r.type === 'dashboard').length) }, { label: 'Downloadable', value: String(REPORTS.length) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/workspace/engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-dashboard-line text-sm"></AppIcon> Dashboard
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-heart-line text-sm"></AppIcon> Learner Engagement
          </button>
          <button onClick={() => navigate('/engagement/attendance-risk')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-alert-line text-sm"></AppIcon> Attendance Risk
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'Overview', 'Rewards', 'Clubs', 'Events'].map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {(['all', 'dashboard', 'summary', 'detailed'] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <span className="text-sm font-heading font-semibold text-foreground-900">Available Reports</span>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} reports</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(report => (
              <div key={report.id}>
                <div className="p-4 flex items-center gap-4 flex-wrap">
                  <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${report.bg} ${report.text}`}>
                    <AppIcon className={`${report.icon} text-sm`}></AppIcon>
                  </span>
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[13px] font-semibold text-foreground-900">{report.name}</span>
                      <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{report.category}</span>
                    </div>
                    <p className="text-[11px] text-foreground-500">{report.description}</p>
                    <p className="text-[10px] text-foreground-400 mt-1">Last generated: {lastGenerated[report.id] ?? 'Never'}</p>

                    {/* Per-report filters — narrow the data before generating/downloading */}
                    <div className="flex items-center gap-3 flex-wrap mt-2">
                      {report.id === 'engagement-scoreboard' && (
                        <>
                          <label className="flex items-center gap-1.5 text-[10px] font-medium text-foreground-500">
                            Programme
                            <input
                              type="text" value={scoreboardProgramme} onChange={e => setScoreboardProgramme(e.target.value)}
                              placeholder="e.g. Business Admin" className="px-2 py-1 rounded-md border border-foreground-200/60 bg-background-50 text-[10px] text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 w-40"
                            />
                          </label>
                          <FilterSelect label="Risk" value={scoreboardRisk} onChange={v => setScoreboardRisk(v as RiskFilter)} options={[
                            { value: 'all', label: 'All' }, { value: 'red', label: 'Red' }, { value: 'amber', label: 'Amber' }, { value: 'green', label: 'Green' },
                          ]} />
                        </>
                      )}
                      {report.id === 'points-rewards' && (
                        <FilterSelect label="Category" value={pointsCategory} onChange={setPointsCategory} options={[
                          { value: 'all', label: 'All' },
                          ...(pointsRewards?.byCategory.map(c => ({ value: c.category, label: c.category })) ?? []),
                        ]} />
                      )}
                      {report.id === 'club-activity' && (
                        <FilterSelect label="Location" value={clubLocation} onChange={setClubLocation} options={[
                          { value: 'all', label: 'All' },
                          ...Array.from(new Set(clubActivity?.clubs.map(c => c.location) ?? [])).map(l => ({ value: l, label: l })),
                        ]} />
                      )}
                      {report.id === 'event-attendance' && (
                        <FilterSelect label="Type" value={eventType} onChange={setEventType} options={[
                          { value: 'all', label: 'All' },
                          ...Array.from(new Set(eventAttendance?.events.map(e => e.type) ?? [])).map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
                        ]} />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => generate(report)}
                      disabled={generatingId === report.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <AppIcon className="ri-play-line"></AppIcon> {generatingId === report.id ? 'Generating…' : 'Generate'}
                    </button>
                    <button onClick={() => downloadReport(report)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-download-line"></AppIcon> Download CSV
                    </button>
                  </div>
                </div>

                {expandedId === report.id && (
                  <div className="px-4 pb-4">
                    <div className="rounded-lg border border-foreground-200/60 bg-background-100/40 p-4 overflow-x-auto">
                      {report.id === 'engagement-scoreboard' && scoreboardFiltered && <ScoreboardPreview rows={scoreboardFiltered} />}
                      {report.id === 'points-rewards' && pointsFiltered && <PointsRewardsPreview data={pointsFiltered} />}
                      {report.id === 'club-activity' && clubFiltered && <ClubActivityPreview data={clubFiltered} />}
                      {report.id === 'event-attendance' && eventFiltered && <EventAttendancePreview data={eventFiltered} />}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function ScoreboardPreview({ rows }: { rows: LearnerAnalyticsRow[] }) {
  const counts = { green: 0, amber: 0, red: 0, none: 0 };
  rows.forEach(r => { counts[r.riskLevel ?? 'none']++; });
  const sorted = [...rows].sort((a, b) => (a.engagementScore ?? 999) - (b.engagementScore ?? 999));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-[11px] font-semibold">
        <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">{counts.green} green</span>
        <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">{counts.amber} amber</span>
        <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-700">{counts.red} red</span>
        <span className="px-2 py-1 rounded-full bg-background-200 text-foreground-500">{counts.none} no score yet</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-foreground-500 border-b border-foreground-200/60">
            <th className="py-1.5 pr-3">Learner</th><th className="py-1.5 pr-3">Programme</th><th className="py-1.5 pr-3">Score</th><th className="py-1.5">Risk</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 25).map(r => (
            <tr key={r.id} className="border-b border-foreground-200/30">
              <td className="py-1.5 pr-3 font-medium text-foreground-800">{r.name}</td>
              <td className="py-1.5 pr-3 text-foreground-500">{r.programme}</td>
              <td className="py-1.5 pr-3">{r.engagementScore ?? '—'}</td>
              <td className="py-1.5">{r.riskLevel ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <p className="text-[10px] text-foreground-400">No learners match the current filters.</p>}
      {sorted.length > 25 && <p className="text-[10px] text-foreground-400">Showing the 25 lowest-scoring learners of {sorted.length} — the CSV download includes everyone matching the current filters.</p>}
    </div>
  );
}

function PointsRewardsPreview({ data }: { data: PointsRewardsReport }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <Stat label="Total awarded" value={data.totalPointsAwarded} />
        <Stat label="This month" value={data.pointsAwardedThisMonth} />
        <Stat label="Committed to claims" value={data.pointsCommittedToClaims} />
      </div>
      <table className="w-full text-[11px]">
        <thead><tr className="text-left text-foreground-500 border-b border-foreground-200/60"><th className="py-1.5 pr-3">Category</th><th className="py-1.5 pr-3">Points</th><th className="py-1.5">Learners</th></tr></thead>
        <tbody>{data.byCategory.map(c => (
          <tr key={c.category} className="border-b border-foreground-200/30">
            <td className="py-1.5 pr-3 font-medium text-foreground-800">{c.category}</td>
            <td className="py-1.5 pr-3">{c.points}</td>
            <td className="py-1.5">{c.learners}</td>
          </tr>
        ))}</tbody>
      </table>
      {data.byCategory.length === 0 && <p className="text-[10px] text-foreground-400">No categories match the current filter.</p>}
    </div>
  );
}

function ClubActivityPreview({ data }: { data: ClubActivityReport }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <Stat label="Clubs" value={data.totalClubs} />
        <Stat label="Members" value={data.totalMembers} />
        <Stat label="Meetings" value={data.totalMeetings} />
        <Stat label="Points from attendance" value={data.pointsAwardedForAttendance} />
      </div>
      <table className="w-full text-[11px]">
        <thead><tr className="text-left text-foreground-500 border-b border-foreground-200/60"><th className="py-1.5 pr-3">Club</th><th className="py-1.5 pr-3">Members</th><th className="py-1.5 pr-3">Meetings</th><th className="py-1.5">Attendance marked</th></tr></thead>
        <tbody>{data.clubs.map(c => (
          <tr key={c.clubId} className="border-b border-foreground-200/30">
            <td className="py-1.5 pr-3 font-medium text-foreground-800">{c.name}</td>
            <td className="py-1.5 pr-3">{c.members}</td>
            <td className="py-1.5 pr-3">{c.meetings}</td>
            <td className="py-1.5">{c.totalAttendanceMarked}</td>
          </tr>
        ))}</tbody>
      </table>
      {data.clubs.length === 0 && <p className="text-[10px] text-foreground-400">No clubs match the current filter.</p>}
    </div>
  );
}

function EventAttendancePreview({ data }: { data: EventAttendanceReport }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <Stat label="Events" value={data.totalEvents} />
        <Stat label="Booked" value={data.totalBooked} />
        <Stat label="Present" value={data.totalPresent} />
        <Stat label="Points from attendance" value={data.pointsAwardedForAttendance} />
      </div>
      <table className="w-full text-[11px]">
        <thead><tr className="text-left text-foreground-500 border-b border-foreground-200/60"><th className="py-1.5 pr-3">Event</th><th className="py-1.5 pr-3">Booked</th><th className="py-1.5 pr-3">Present</th><th className="py-1.5">Attendance rate</th></tr></thead>
        <tbody>{data.events.map(e => (
          <tr key={e.eventId} className="border-b border-foreground-200/30">
            <td className="py-1.5 pr-3 font-medium text-foreground-800">{e.title}</td>
            <td className="py-1.5 pr-3">{e.booked}</td>
            <td className="py-1.5 pr-3">{e.present}</td>
            <td className="py-1.5">{e.attendanceRate !== null ? `${e.attendanceRate}%` : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      {data.events.length === 0 && <p className="text-[10px] text-foreground-400">No events match the current filter.</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="px-2.5 py-1 rounded-lg bg-background-50 border border-foreground-200/60">
      <span className="font-semibold text-foreground-900">{value}</span> <span className="text-foreground-500">{label}</span>
    </span>
  );
}
