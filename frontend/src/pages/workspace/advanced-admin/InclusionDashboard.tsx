import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Archive, FileText, Search } from 'lucide-react';
import {
  advancedAdminInclusion, advancedAdminInclusionReportPdf,
  type AdvancedAdminInclusionReport, type AdvancedAdminInclusionTicket,
  type AdvancedAdminInclusionNote, type AdvancedAdminInclusionEvidence,
  type AdvancedAdminLearner, type AdvancedAdminSupportTicket,
} from '@/api/advancedAdmin';
import InclusionReportDialog from './InclusionReportDialog';

type InclusionData = Awaited<ReturnType<typeof advancedAdminInclusion>>;
type ReportStatus = 'all' | 'open' | 'closed';
type RiskFilter = 'all' | 'red' | 'amber' | 'green' | 'unrated';
type EvidenceFilter = 'all' | 'has' | 'missing';

const emptyData: InclusionData = { reports: [], tickets: [], supportTickets: [] };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function savedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateLabel(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function riskLevel(report: AdvancedAdminInclusionReport): string {
  const fallback = record(report.overview).overallRiskLevel;
  return report.riskLevel || (typeof fallback === 'string' ? fallback : '') || 'Not recorded';
}

function riskBucket(level: string): RiskFilter {
  const value = level.trim().toLowerCase();
  if (value === 'high' || value === 'very high' || value === 'critical') return 'red';
  if (value === 'medium' || value === 'moderate') return 'amber';
  if (value === 'low') return 'green';
  return 'unrated';
}

function isClosed(status: string): boolean {
  return status.trim().toLowerCase() === 'closed';
}

function scoreLabel(report: AdvancedAdminInclusionReport): string {
  const overview = record(report.overview);
  const score = savedNumber(overview.overallScore);
  const maximum = savedNumber(overview.overallMaxScore);
  return score === null || maximum === null ? 'Not recorded' : `${score}/${maximum}`;
}

function completionLabel(report: AdvancedAdminInclusionReport): string {
  const overview = record(report.overview);
  const completed = savedNumber(overview.completedReportsCount);
  const expected = savedNumber(overview.expectedReportsCount);
  return completed === null || expected === null ? 'Not recorded' : `${completed}/${expected}`;
}

function reportHasNotes(report: AdvancedAdminInclusionReport): boolean {
  return report.notes.length > 0 || report.evidence.length > 0;
}

const riskStyles: Record<RiskFilter, string> = {
  all: 'bg-slate-100 text-slate-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  green: 'bg-emerald-50 text-emerald-700',
  unrated: 'bg-slate-100 text-slate-700',
};

function RiskBadge({ level }: { level: string }) {
  const bucket = riskBucket(level);
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${riskStyles[bucket]}`}>{level}</span>;
}

function NotesAndEvidence({ notes, evidence }: { notes: AdvancedAdminInclusionNote[]; evidence: AdvancedAdminInclusionEvidence[] }) {
  return <div className="grid gap-4 lg:grid-cols-2">
    <section className="rounded-xl border border-primary-100 bg-primary-50/40 p-4">
      <h4 className="font-semibold text-foreground-900">Notes ({notes.length})</h4>
      {notes.length ? <ul className="mt-3 space-y-2">{notes.map(note => <li key={note.id} className="rounded-lg bg-white p-3 text-sm">
        <p className="whitespace-pre-wrap">{note.note}</p>
        <p className="mt-2 text-xs text-foreground-500">{[note.createdBy, dateLabel(note.createdAt)].filter(Boolean).join(' · ')}</p>
      </li>)}</ul> : <p className="mt-2 text-sm text-foreground-500">No notes recorded.</p>}
    </section>
    <section className="rounded-xl border border-primary-100 bg-primary-50/40 p-4">
      <h4 className="font-semibold text-foreground-900">Evidence ({evidence.length})</h4>
      {evidence.length ? <ul className="mt-3 space-y-2">{evidence.map(file => <li key={file.id} className="text-sm">
        {file.url ? <a href={file.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-700 underline">{file.fileName}</a>
          : <span>{file.fileName}</span>}
      </li>)}</ul> : <p className="mt-2 text-sm text-foreground-500">No evidence recorded.</p>}
    </section>
  </div>;
}

export default function InclusionDashboard({ learnerId, learner }: { learnerId: number; learner: AdvancedAdminLearner }) {
  const [data, setData] = useState<InclusionData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<ReportStatus>('all');
  const [risk, setRisk] = useState<RiskFilter>('all');
  const [notes, setNotes] = useState<EvidenceFilter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setData(emptyData); setError(''); setLoading(true);
    setSelectedReportId(null); setSelectedCaseId(null);
    advancedAdminInclusion(learnerId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load Inclusion records.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [learnerId]);

  const reports = useMemo(() => data.reports.filter(report => Boolean(report.archived) === showArchived), [data.reports, showArchived]);
  const openCount = reports.filter(report => !isClosed(report.status)).length;
  const closedCount = reports.length - openCount;
  const visible = useMemo(() => reports.filter(report => {
    if (status === 'open' && isClosed(report.status)) return false;
    if (status === 'closed' && !isClosed(report.status)) return false;
    if (risk !== 'all' && riskBucket(riskLevel(report)) !== risk) return false;
    if (notes === 'has' && !reportHasNotes(report)) return false;
    if (notes === 'missing' && reportHasNotes(report)) return false;
    const needle = search.trim().toLowerCase();
    return !needle || [learner.name, report.programme, report.organisation, report.coach,
      report.status, riskLevel(report), dateLabel(report.createdAt)]
      .some(value => String(value || '').toLowerCase().includes(needle));
  }), [reports, status, risk, notes, search, learner.name]);
  const selectedReport = data.reports.find(report => report.id === selectedReportId);
  const filteredTickets = data.tickets.filter(ticket => Boolean(ticket.archived) === showArchived);
  const filteredSupportTickets = data.supportTickets.filter(ticket => Boolean(ticket.archived) === showArchived);
  const supportCases: Array<{ key: string; subject: string; status: string; details: string; date: string | null; notes: AdvancedAdminInclusionNote[]; evidence: AdvancedAdminInclusionEvidence[]; reportId?: string | null }> = [
    ...filteredTickets.map((ticket: AdvancedAdminInclusionTicket) => ({ key: `inclusion:${ticket.id}`, subject: ticket.subject,
      status: ticket.status, details: ticket.details, date: ticket.createdAt, notes: ticket.notes, evidence: ticket.evidence,
      reportId: ticket.sourceReportId })),
    ...filteredSupportTickets.map((ticket: AdvancedAdminSupportTicket) => ({ key: `support:${ticket.id}`,
      subject: ticket.subject, status: ticket.statusLabel || ticket.status, details: ticket.details,
      date: ticket.createdAt, notes: ticket.notes, evidence: ticket.evidence })),
  ];
  const selectedCase = supportCases.find(item => item.key === selectedCaseId);
  const selectedCaseReport = selectedCase?.reportId && data.reports.find(report => report.id === selectedCase.reportId);

  return <div className="space-y-5" aria-label="Inclusion dashboard for selected learner">
    <header className="flex flex-wrap items-center gap-4 rounded-[24px] border border-primary-100 bg-white p-5 shadow-sm">
      <div className="mr-2">
        <h2 className="text-lg font-bold text-primary-950">Student Support</h2>
        <p className="mt-1 text-sm text-primary-600">Review this learner's support and inclusion needs.</p>
      </div>
      <span className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-900">{learner.name}</span>
      <Link to="/workspace/advanced-admin" className="inline-flex items-center gap-2 rounded-xl bg-primary-950 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"><ArrowLeft size={16} />Back to Cards</Link>
    </header>

    <section className="space-y-5 rounded-[24px] border border-primary-100 bg-white p-5 shadow-sm">
      <div><h2 className="text-lg font-bold text-primary-950">Inclusion Dashboard</h2><p className="mt-1 text-sm text-primary-600">Saved screening reports and support tickets for {learner.name}.</p></div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {loading && <p role="status" className="rounded-xl bg-primary-50 p-4 text-sm text-primary-800">Loading Inclusion records…</p>}
      {!loading && !error && <>
        <div className="rounded-2xl border border-primary-100 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-100 pb-3">
            <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-foreground-700 sm:max-w-lg"><Search size={16} aria-hidden="true" /><span className="sr-only">Search this learner's reports</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search this learner's reports" className="w-full bg-transparent outline-none" /></label>
            <button type="button" aria-pressed={showArchived} onClick={() => { setShowArchived(value => !value); setSelectedReportId(null); setSelectedCaseId(null); }} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${showArchived ? 'border-primary-600 bg-primary-50 text-primary-900' : 'border-primary-200 text-primary-800'}`}><Archive size={15} />Archived</button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3" aria-label="Report status">
            {([
              ['all', 'All Reports', reports.length], ['open', 'Open Tickets', openCount], ['closed', 'Closed Tickets', closedCount],
            ] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`rounded-xl border p-3 text-left text-sm ${status === value ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'border-primary-100 hover:bg-primary-50'}`}><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs">{count} for this learner</span></button>)}
          </div>
          <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50/40 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Risk level</p>
            <div className="mt-2 flex flex-wrap gap-2">{([
              ['all', 'All'], ['red', 'Red'], ['amber', 'Amber'], ['green', 'Green'], ['unrated', 'Unrated'],
            ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={risk === value} onClick={() => setRisk(value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${risk === value ? 'border-primary-800 bg-primary-950 text-white' : 'border-primary-200 bg-white text-primary-800'}`}>{label} <span className="ml-1">{reports.filter(item => value === 'all' || riskBucket(riskLevel(item)) === value).length}</span></button>)}</div>
            <p className="mt-3 text-xs font-bold uppercase tracking-wide text-primary-700">Notes / evidence</p>
            <div className="mt-2 flex flex-wrap gap-2">{([
              ['all', 'All'], ['has', 'Has notes/evidence'], ['missing', 'Missing notes/evidence'],
            ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={notes === value} onClick={() => setNotes(value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${notes === value ? 'border-primary-800 bg-primary-950 text-white' : 'border-primary-200 bg-white text-primary-800'}`}>{label} <span className="ml-1">{reports.filter(item => value === 'all' || (value === 'has' ? reportHasNotes(item) : !reportHasNotes(item))).length}</span></button>)}</div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-label="Visible report summary">
          {([
            ['Total reports', visible.length, 'text-teal-700'],
            ['High risk', visible.filter(item => riskBucket(riskLevel(item)) === 'red').length, 'text-red-600'],
            ['Moderate risk', visible.filter(item => riskBucket(riskLevel(item)) === 'amber').length, 'text-amber-700'],
            ['Low risk', visible.filter(item => riskBucket(riskLevel(item)) === 'green').length, 'text-emerald-700'],
          ] as const).map(([label, count, colour]) => <div key={label} className="rounded-xl border border-primary-100 bg-primary-50/40 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{label}</p><p className={`mt-2 text-2xl font-bold ${colour}`}>{count}</p></div>)}
          <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Recorded tier</p><p className="mt-2 text-sm font-semibold text-primary-900">{visible.length ? [...new Set(visible.map(item => item.progressTier).filter((tier): tier is number => tier != null))].map(tier => `Tier ${tier}`).join(', ') || 'Not recorded' : '—'}</p></div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-primary-100">
          <table className="min-w-[1050px] w-full text-left text-sm">
            <thead className="bg-primary-50 text-xs font-semibold text-primary-800"><tr>{['Learner', 'Programme', 'Organisation', 'Coach', 'Risk', 'System tier', 'Progress tier', 'Score', 'Reports', 'Date', 'View'].map(label => <th key={label} scope="col" className="px-3 py-3">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-primary-100">{visible.map(report => <tr key={report.id} className="hover:bg-primary-50/40">
              <td className="px-3 py-3 font-semibold text-primary-950">{learner.name}<span className="block text-xs font-normal text-primary-600">{learner.email || ''}</span></td>
              <td className="px-3 py-3">{report.programme || learner.programme}</td>
              <td className="px-3 py-3">{report.organisation || 'Not recorded'}</td>
              <td className="px-3 py-3">{report.coach || learner.coach || 'Not recorded'}</td>
              <td className="px-3 py-3"><RiskBadge level={riskLevel(report)} /></td>
              <td className="px-3 py-3 text-foreground-500">Not recorded</td>
              <td className="px-3 py-3">{report.progressTier == null ? 'Not recorded' : `Tier ${report.progressTier}`}</td>
              <td className="px-3 py-3 font-semibold">{scoreLabel(report)}</td>
              <td className="px-3 py-3">{completionLabel(report)}</td>
              <td className="px-3 py-3">{dateLabel(report.createdAt)}</td>
              <td className="px-3 py-3"><button type="button" onClick={event => { event.currentTarget.focus(); setSelectedReportId(report.id); setSelectedCaseId(null); }} className="rounded-lg bg-primary-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-800" aria-haspopup="dialog">View</button></td>
            </tr>)}</tbody>
          </table>
          {!visible.length && <p className="p-5 text-sm text-foreground-600">No screening reports match these filters for this learner.</p>}
        </div>

        {selectedReport && <InclusionReportDialog key={selectedReport.id} learnerId={learnerId} learner={learner} report={selectedReport} onClose={() => setSelectedReportId(null)} />}

        <section className="space-y-3 border-t border-primary-100 pt-5" aria-label="Support tickets for selected learner">
          <div><h3 className="text-lg font-bold text-primary-950">Support tickets and actions</h3><p className="mt-1 text-sm text-foreground-600">{supportCases.length} ticket{supportCases.length === 1 ? '' : 's'} linked to this learner.</p></div>
          {!supportCases.length && <p className="rounded-xl bg-primary-50 p-4 text-sm text-foreground-600">No support tickets recorded for this learner.</p>}
          {supportCases.map(ticket => <div key={ticket.key} className="rounded-xl border border-primary-100 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold text-primary-950">{ticket.subject || 'Support ticket'}</h4><p className="mt-1 text-xs text-foreground-600">{ticket.status} · {dateLabel(ticket.date)} · {ticket.notes.length} notes · {ticket.evidence.length} evidence</p></div>
              <button type="button" onClick={() => { setSelectedCaseId(value => value === ticket.key ? null : ticket.key); setSelectedReportId(null); }} aria-expanded={selectedCaseId === ticket.key} className="rounded-lg bg-primary-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-800">Ticket details</button></div>
            {selectedCase?.key === ticket.key && <div className="mt-4 space-y-3 border-t border-primary-100 pt-4"><p className="whitespace-pre-wrap text-sm text-foreground-700">{ticket.details || 'No details recorded.'}</p>
              {selectedCaseReport && <a href={advancedAdminInclusionReportPdf(learnerId, selectedCaseReport.id)} className="inline-flex items-center gap-2 rounded-lg border border-primary-200 px-3 py-2 text-sm font-semibold text-primary-800"><FileText size={15} />Download linked report PDF</a>}
              <NotesAndEvidence notes={ticket.notes} evidence={ticket.evidence} /></div>}
          </div>)}
        </section>
      </>}
    </section>
  </div>;
}
