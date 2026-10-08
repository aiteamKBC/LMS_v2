import { BarChart3, Check, Clock3, FileText, ShieldCheck, UserRound, Users } from 'lucide-react';
import type { AdvancedAdminCoachingSessionDetail, AdvancedAdminReview } from '@/api/advancedAdmin';
import StructuredRecord from './StructuredRecord';

type Report = Record<string, unknown>;
type Evidence = { quote?: string; speaker?: string; timecode?: string; why_it_matters?: string };
type CheckItem = { metric?: string; result?: string; notes?: string; rag?: string; rating_1_to_5?: number; evidence?: Evidence[] };

const asText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const asRecord = (value: unknown): Report | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Report : null;
const initials = (value: string) => value.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
const speakerColor = (value: string) => ['bg-primary-600', 'bg-emerald-600', 'bg-sky-600'][
  [...value].reduce((total, letter) => total + letter.charCodeAt(0), 0) % 3];

function decodeTranscriptText(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity] || '');
}

function transcriptTurns(content: string) {
  return content.replace(/\r/g, '').split(/\n\s*\n/).flatMap(block => {
    const lines = block.trim().split('\n');
    const timing = lines.findIndex(line => /^(?:\d+:)?\d{2}:\d{2}(?:\.\d+)?\s+-->\s+/.test(line));
    if (timing < 0) return [];
    const start = lines[timing].split('-->')[0].trim();
    const raw = lines.slice(timing + 1).join(' ').trim();
    const voice = raw.match(/^<v(?:\s+([^>]+))?>([\s\S]*?)(?:<\/v>)?$/i);
    const speaker = voice?.[1]?.trim() || 'Speaker';
    const text = decodeTranscriptText(voice ? voice[2] : raw).trim();
    return text ? [{ start, speaker, text }] : [];
  });
}

export function TranscriptPanel({ detail, fallback }: { detail: AdvancedAdminCoachingSessionDetail | null; fallback: string }) {
  const content = detail?.transcript?.content;
  if (!content?.trim()) return <EmptyPanel text={fallback} />;
  const turns = transcriptTurns(content);
  const words = (turns.length ? turns.map(turn => turn.text).join(' ') : content)
    .split(/\s+/).filter(Boolean).length;
  return <section className="rounded-2xl border border-foreground-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground-100 pb-4">
      <div><h4 className="font-bold text-primary-950">Session Transcript</h4><p className="mt-1 text-xs text-foreground-500">{turns.length ? `${turns.length} turns` : 'Original meeting transcript'}</p></div>
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><FileText size={14} />{words.toLocaleString()} words</span>
    </div>
    {turns.length ? <ol className="mt-4 divide-y divide-primary-100 overflow-hidden rounded-xl border border-primary-100">
      {turns.map((turn, index) => <li key={`${turn.start}-${index}`} className="grid gap-3 p-3 sm:grid-cols-[4.5rem_2rem_1fr] sm:p-4">
        <span className="pt-1 text-xs font-semibold tabular-nums text-foreground-400">{turn.start}</span>
        <span aria-hidden="true" className={`flex size-8 items-center justify-center rounded-full text-xs font-bold text-white ${speakerColor(turn.speaker)}`}>{initials(turn.speaker)}</span>
        <div className="min-w-0"><div className="flex flex-wrap items-baseline gap-2"><strong className="text-xs text-primary-700">{turn.speaker}</strong><span className="text-xs text-foreground-400">{turn.start}</span></div><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground-800">{turn.text}</p></div>
      </li>)}</ol> : <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-foreground-800">{content}</p>}
  </section>;
}

export function EmptyPanel({ text }: { text: string }) {
  return <p className="rounded-2xl border border-foreground-200 bg-white p-5 text-sm text-foreground-600">{text}</p>;
}

function InfoTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="flex min-w-0 items-center gap-3 rounded-xl border border-primary-100 bg-white p-3">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">{icon}</span>
    <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{label}</p><p className="truncate text-xs font-semibold text-primary-950" title={value}>{value}</p></div>
  </div>;
}

function Score({ label, value, caption }: { label: string; value: number; caption: string }) {
  const score = Math.max(0, Math.min(100, Math.round(value)));
  return <div className="flex items-center gap-3 p-4">
    <span className="flex size-12 shrink-0 items-center justify-center rounded-full border-4 border-emerald-500 text-sm font-extrabold text-primary-950">{score}</span>
    <div className="min-w-0 flex-1"><strong className="text-sm text-primary-950">{label}</strong><p className="text-xs text-foreground-500">{caption}</p><div className="mt-2 h-1.5 w-28 rounded-full bg-primary-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${score}%` }} /></div></div>
  </div>;
}

function QualityCheck({ item }: { item: CheckItem }) {
  const rag = asText(item.rag)?.toLowerCase();
  const tone = rag === 'red' ? 'border-red-100 bg-red-50/70 text-red-800' : rag === 'amber' || rag === 'yellow'
    ? 'border-amber-100 bg-amber-50/70 text-amber-800' : 'border-emerald-100 bg-emerald-50/70 text-emerald-800';
  const label = rag === 'red' ? 'Not met' : rag === 'amber' || rag === 'yellow' ? 'Partial' : rag === 'green' ? 'Met' : item.rag || 'Recorded';
  return <article className={`rounded-xl border p-4 ${tone}`}>
    <div className="flex items-start justify-between gap-2"><h6 className="font-bold text-primary-950">{item.metric || 'Quality check'}</h6><span className="shrink-0 rounded-full border border-current px-2 py-0.5 text-xs font-semibold">{label}</span></div>
    {item.notes && <p className="mt-2 text-sm leading-6 text-foreground-700">{item.notes}</p>}
    {item.result && item.result !== label && <p className="mt-2 text-xs text-foreground-600">{item.result}</p>}
    <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-white px-2 py-1">RAG: {item.rag || 'Not recorded'}</span>{asNumber(item.rating_1_to_5) !== null && <span className="rounded-full bg-white px-2 py-1">Score: {item.rating_1_to_5}/5</span>}{Array.isArray(item.evidence) && <span className="rounded-full bg-white px-2 py-1">{item.evidence.length} evidence {item.evidence.length === 1 ? 'quote' : 'quotes'}</span>}</div>
    {Array.isArray(item.evidence) && item.evidence.length > 0 && <details className="mt-3 rounded-lg border border-current/10 bg-white p-3 text-sm text-foreground-700"><summary className="cursor-pointer font-semibold">Evidence</summary><div className="mt-3 space-y-3">{item.evidence.map((evidence, index) => <blockquote key={index} className="border-l-2 border-primary-200 pl-3"><p className="whitespace-pre-wrap">{evidence.quote || 'No quote recorded'}</p><footer className="mt-1 text-xs text-foreground-500">{[evidence.speaker, evidence.timecode].filter(Boolean).join(' · ')}</footer>{evidence.why_it_matters && <p className="mt-1 text-xs">{evidence.why_it_matters}</p>}</blockquote>)}</div></details>}
  </article>;
}

export function AiReportPanel({ report, review, detail, fallback }: { report: Report | null; review: AdvancedAdminReview; detail: AdvancedAdminCoachingSessionDetail | null; fallback: string }) {
  if (!report) return <EmptyPanel text={fallback} />;
  const overall = asRecord(report.overall_rating);
  const checks: CheckItem[] = Array.isArray(report.qa) ? report.qa.filter(item => asRecord(item)) as CheckItem[] : [];
  const average = asNumber(overall?.average_rating);
  const safeguarding = checks.find(item => /safeguard/i.test(item.metric || ''));
  const safeguardingScore = asNumber(safeguarding?.rating_1_to_5);
  const counts = checks.reduce((sum, item) => { const key = (item.rag || '').toLowerCase(); if (key === 'green') sum.met++; else if (key === 'amber' || key === 'yellow') sum.partial++; else if (key === 'red') sum.notMet++; return sum; }, { met: 0, partial: 0, notMet: 0 });
  const judgement = asText(overall?.professional_judgement);
  const summary = asText(report.executive_summary);
  const actions = Array.isArray(report.priority_actions) ? report.priority_actions : [];
  const strengths = Array.isArray(report.strengths) ? report.strengths : [];
  const known = new Set(['qa', 'date', 'Group', 'coach', 'learner', 'duration', 'employer', 'programme', 'strengths', 'session_id', 'meeting_type', 'overall_rating', 'priority_actions', 'executive_summary', 'duration_score_1_to_5', 'duration_inferred_minutes']);
  const additional = Object.fromEntries(Object.entries(report).filter(([key]) => !known.has(key)));
  return <div className="space-y-4">
    <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
      <div className="bg-emerald-50 p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2">{asText(overall?.rag) && <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-bold text-emerald-700">{asText(overall?.rag)}</span>}{asText(overall?.qualitative) && <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700">{asText(overall?.qualitative)}</span>}</div><div className="mt-2 flex flex-wrap items-end justify-between gap-2"><div><h4 className="text-lg font-extrabold text-primary-950">AI Quality Report</h4><p className="mt-1 text-xs text-foreground-600">Meeting quality, safeguarding and actions from the matched session.</p></div><div className="flex flex-wrap gap-2 text-xs">{asText(report.meeting_type) && <span className="rounded-full bg-white px-2.5 py-1">{asText(report.meeting_type)}</span>}{asText(report.duration) && <span className="rounded-full bg-white px-2.5 py-1">{asText(report.duration)}</span>}<span className="rounded-full bg-white px-2.5 py-1">{checks.length} QA checks</span></div></div></div>
      {(average !== null || safeguardingScore !== null) && <div className="grid divide-y divide-foreground-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">{average !== null && <Score label="QA Score" value={average * 20} caption="Overall coaching quality" />}{safeguardingScore !== null && <Score label="Safeguarding" value={safeguardingScore * 20} caption="Risk and welfare signal" />}</div>}
    </section>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><InfoTile label="Learner" value={asText(report.learner) || review.learnerName || detail?.learnerName || 'Not recorded'} icon={<UserRound size={16} />} /><InfoTile label="Coach" value={asText(report.coach) || detail?.coachName || review.coachName || 'Not recorded'} icon={<UserRound size={16} />} /><InfoTile label="Employer" value={asText(report.employer) || detail?.managerName || review.managerName || 'Not recorded'} icon={<Users size={16} />} /><InfoTile label="Duration" value={asText(report.duration) || 'Not recorded'} icon={<Clock3 size={16} />} /><InfoTile label="Type" value={asText(report.meeting_type) || review.type} icon={<BarChart3 size={16} />} /></div>
    {(judgement || summary) && <div className="grid gap-4 md:grid-cols-2">{judgement && <section className="rounded-2xl border border-foreground-200 bg-white p-5 shadow-sm"><h5 className="flex items-center gap-2 font-bold text-primary-950"><ShieldCheck size={17} className="text-primary-600" />Professional Judgement</h5><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-foreground-700">{judgement}</p></section>}{summary && <section className="rounded-2xl border border-foreground-200 bg-white p-5 shadow-sm"><h5 className="flex items-center gap-2 font-bold text-primary-950"><FileText size={17} className="text-primary-600" />Executive Summary</h5><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-foreground-700">{summary}</p></section>}</div>}
    {checks.length > 0 && <section className="overflow-hidden rounded-2xl border border-foreground-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground-100 p-4"><div><h5 className="font-extrabold uppercase text-primary-950">What was achieved</h5><p className="mt-1 text-xs text-foreground-500">Quality checks recorded for this review</p></div><div className="flex gap-2 text-xs font-bold"><span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{counts.met} met</span><span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{counts.partial} partial</span><span className="rounded-full bg-red-50 px-2 py-1 text-red-700">{counts.notMet} not met</span></div></div><div className="grid gap-3 p-4 md:grid-cols-2">{checks.map((item, index) => <QualityCheck key={`${item.metric || 'check'}-${index}`} item={item} />)}</div></section>}
    {strengths.length > 0 && <section className="rounded-2xl border border-foreground-200 bg-white p-5"><h5 className="font-bold text-primary-950">Strengths</h5><ul className="mt-3 space-y-2 text-sm text-foreground-700">{strengths.map((item, index) => <li key={index} className="flex gap-2"><Check size={16} className="shrink-0 text-emerald-600" /><span>{String(item)}</span></li>)}</ul></section>}
    {actions.length > 0 && <section className="rounded-2xl border border-foreground-200 bg-white p-5"><h5 className="font-bold text-primary-950">Priority Actions</h5><div className="mt-3 grid gap-3 md:grid-cols-2">{actions.map((item, index) => { const action = asRecord(item); return <div key={index} className="rounded-xl border border-primary-100 bg-primary-50/40 p-3 text-sm"><p className="font-semibold text-primary-950">{asText(action?.action) || 'Action'}</p><p className="mt-1 text-xs text-foreground-600">{[asText(action?.owner), asText(action?.due)].filter(Boolean).join(' · ')}</p></div>; })}</div></section>}
    {Object.keys(additional).length > 0 && <details className="rounded-2xl border border-foreground-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-primary-950">Additional report details</summary><div className="mt-4"><StructuredRecord value={additional} /></div></details>}
  </div>;
}

export function AttendancePanel({ detail, fallback, transcriptUnavailable }: { detail: AdvancedAdminCoachingSessionDetail | null; fallback: string; transcriptUnavailable: string }) {
  if (!detail?.attendance) return <EmptyPanel text={fallback} />;
  const { attendance } = detail;
  const learner = Boolean(attendance.learner || detail.learnerAttended === true);
  const manager = Boolean(attendance.manager || detail.managerAttended === true);
  const quality = learner && manager ? 'Both attended' : 'Partial record';
  const planned = detail.plannedDate?.slice(0, 10);
  const actual = (detail.actualStartAt || attendance.startAt)?.slice(0, 10);
  const days = planned && actual ? Math.round((Date.parse(`${actual}T00:00:00Z`) - Date.parse(`${planned}T00:00:00Z`)) / 86400000) : null;
  const attendee = (label: string, present: boolean, seconds?: number | null) => <div className={`flex items-center gap-3 rounded-xl border p-4 ${present ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-foreground-200 bg-white text-foreground-600'}`}><span className="flex size-10 items-center justify-center rounded-full bg-white"><UserRound size={18} /></span><div><strong className="text-sm text-primary-950">{label}</strong><p className="text-xs font-semibold">{present ? `Attended${seconds != null ? ` · ${Math.round(seconds / 60)} min` : ''}` : 'No attendance record'}</p></div></div>;
  return <div className="space-y-4">
    <section className="rounded-2xl border border-foreground-200 bg-white p-5"><h4 className="font-bold text-primary-950">Attendance Quality <span className="ml-2 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{quality}</span></h4><p className="mt-3 text-sm text-foreground-600">{learner && manager ? 'Learner and manager attendance recorded.' : 'Attendance records are shown below.'}{detail.transcript?.content ? ' A transcript is available.' : ''}</p></section>
    <div className="grid gap-3 md:grid-cols-2">{attendee('Learner Attendance', learner, attendance.learner?.durationSeconds)}{attendee('Manager Attendance', manager, attendance.manager?.durationSeconds)}</div>
    <section className="rounded-2xl border border-foreground-200 bg-white p-5"><h5 className="font-bold text-primary-950">Session Metrics</h5><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-primary-50 p-5 text-center"><p className="text-xs font-bold uppercase text-foreground-500">Days diff</p><strong className="mt-1 block text-2xl text-primary-950">{days === null || Number.isNaN(days) ? '—' : `${days > 0 ? '+' : ''}${days}`}</strong><p className="text-xs text-foreground-500">{days === null || Number.isNaN(days) ? 'Not recorded' : days === 0 ? 'On planned date' : 'From planned date'}</p></div><div className="rounded-xl bg-primary-50 p-5 text-center"><p className="text-xs font-bold uppercase text-foreground-500">Transcript</p><FileText size={24} className="mx-auto mt-2 text-emerald-600" /><p className="mt-1 text-xs font-semibold text-emerald-700">{detail.transcript?.content?.trim() ? 'Available' : 'Not available'}</p>{!detail.transcript?.content?.trim() && <p className="mt-1 text-xs text-foreground-500">{transcriptUnavailable}</p>}</div></div></section>
  </div>;
}
